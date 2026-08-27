import {
  TaskProvider,
  TaskList,
  Task,
  CreateTaskInput,
  UpdateTaskInput,
  ListTasksOptions,
  ProviderCapabilities,
} from './types.js';
import { AuthError, ApiError, UnsupportedError } from '../errors.js';
import { readJson, writeJson } from '../storage.js';
import { proxyFetch } from '../proxy.js';

// ---------- Graph API shapes (only the fields we consume) ----------

interface GraphTodoTask {
  id: string;
  title?: string;
  body?: { content?: string; contentType?: string };
  status?: 'notStarted' | 'completed' | 'inProgress' | 'waitingOnOthers' | 'deferred';
  dueDateTime?: { dateTime?: string; timeZone?: string } | null;
  completedDateTime?: { dateTime?: string; timeZone?: string } | null;
  createdDateTime?: string;
  lastModifiedDateTime?: string;
}

interface GraphTaskList {
  id: string;
  displayName?: string;
  wellknownListName?: string;
}

interface MsAuthFile {
  accessToken?: string;
  expiresAt?: number;
  refreshToken?: string;
  clientId?: string;
  clientSecret?: string;
}

const GRAPH_BASE = process.env.TASKBRIDGE_GRAPH_ENDPOINT ?? 'https://graph.microsoft.com/v1.0';

/**
 * Built-in Entra public-client app id ("mstodo-bridge").
 * Public clients carry no secret, so shipping it inside a distributed open
 * source tool is standard practice (same model as VS Code / Azure CLI).
 * TASKBRIDGE_MS_CLIENT_ID overrides it for self-hosted app registrations.
 */
export const BUILTIN_MS_CLIENT_ID = 'ea65305e-1a1a-4f77-b579-d8a0f1b4abca';

/**
 * Microsoft To Do provider backed by Microsoft Graph.
 *
 * Auth: OAuth2 authorization-code + PKCE against the v2 endpoint, raw fetch
 * (no MSAL runtime dep). Users register their own Entra "public client"
 * (SPA/mobile-desktop app, no secret required) and either set
 * TASKBRIDGE_MS_CLIENT_ID or paste the id in the web GUI.
 */
export class MsTodoProvider implements TaskProvider {
  readonly id = 'mstodo';
  readonly displayName = 'Microsoft To Do';
  readonly capabilities: ProviderCapabilities = {
    manageLists: true,
    subtasks: false, // checklistItems are not addressable as tasks; v1 skips them
    moveTasks: false, // Graph To Do has no move endpoint; recreate+delete would surprise
    serverSearch: false, // fetch + client-side filter (no reliable $search on tasks)
    clearCompleted: false,
  };

  static readonly AUTHORIZE_URL_SUFFIX = '/oauth2/v2.0/authorize';
  static readonly TOKEN_URL_SUFFIX = '/oauth2/v2.0/token';

  private auth: MsAuthFile | null = null;
  private defaultListId: string | null = null;

  constructor(
    private envClientId = process.env.TASKBRIDGE_MS_CLIENT_ID ?? '',
    private authority = process.env.TASKBRIDGE_MS_AUTHORITY ?? 'https://login.microsoftonline.com/common',
  ) {
    // Fall back to the built-in id when no valid override is provided.
    if (!this.envClientId || !/^[0-9a-f-]{36}$/i.test(this.envClientId)) {
      this.envClientId = BUILTIN_MS_CLIENT_ID;
    }
  }

  private tokenFile = 'mstodo-auth.json';

  scopes(): string {
    return 'offline_access Tasks.ReadWrite User.Read';
  }

  // ---------- OAuth lifecycle (driven by the admin GUI) ----------

  getClientCredentials(): { clientId: string; clientSecret?: string } {
    const stored = readJson<MsAuthFile>(this.tokenFile);
    const clientId = this.envClientId || stored?.clientId || BUILTIN_MS_CLIENT_ID;
    const clientSecret = stored?.clientSecret || undefined;
    return { clientId, clientSecret };
  }

  hasClientCredentials(): boolean {
    return !!this.envClientId || !!readJson<MsAuthFile>(this.tokenFile)?.clientId;
  }

  isAuthenticated(): boolean {
    return !!readJson<MsAuthFile>(this.tokenFile)?.refreshToken;
  }

  disconnect(): void {
    const existing = readJson<MsAuthFile>(this.tokenFile) ?? {};
    writeJson(this.tokenFile, {
      ...(existing.clientId ? { clientId: existing.clientId } : {}),
      ...(existing.clientSecret ? { clientSecret: existing.clientSecret } : {}),
    });
    this.auth = null;
  }

  saveClientCredentials(clientId: string, clientSecret?: string): void {
    const existing = readJson<MsAuthFile>(this.tokenFile) ?? {};
    writeJson(this.tokenFile, { ...existing, clientId, ...(clientSecret ? { clientSecret } : {}) });
    this.envClientId = clientId;
  }

  buildAuthorizeUrl(redirectUri: string, state: string, codeChallenge: string): string {
    const { clientId } = this.getClientCredentials();
    const url = new URL(`${this.authority}${MsTodoProvider.AUTHORIZE_URL_SUFFIX}`);
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', this.scopes());
    url.searchParams.set('state', state);
    url.searchParams.set('code_challenge', codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    return url.toString();
  }

  async exchangeCode(code: string, redirectUri: string, codeVerifier: string): Promise<void> {
    const { clientId, clientSecret } = this.getClientCredentials();
    const body = new URLSearchParams({
      client_id: clientId,
      code,
      code_verifier: codeVerifier,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
      scope: this.scopes(),
    });
    if (clientSecret) body.set('client_secret', clientSecret);
    const res = await proxyFetch(`${this.authority}${MsTodoProvider.TOKEN_URL_SUFFIX}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) {
      throw new ApiError(
        `Microsoft code exchange failed (${res.status}): ${truncate(await res.text(), 300)}`,
        res.status,
      );
    }
    const data = (await res.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
    };
    if (!data.refresh_token) {
      throw new AuthError(
        'Microsoft did not return a refresh token. Re-run the connection flow and make sure you consent for the account you intend to use.',
        this.id,
      );
    }
    this.saveTokens({
      accessToken: data.access_token,
      expiresAt: Date.now() + data.expires_in * 1000,
      refreshToken: data.refresh_token,
    });
  }

  // ---------- token storage / refresh ----------

  async ensureAuth(): Promise<void> {
    const cache = readJson<MsAuthFile>(this.tokenFile);
    if (!cache?.refreshToken) {
      throw new AuthError(
        'No Microsoft To Do credentials found. Connect the account from the mstodo-bridge web GUI.',
        this.id,
      );
    }
    this.auth = cache;
    if (!cache.expiresAt || Date.now() >= cache.expiresAt - 120_000) {
      await this.refreshAccessToken();
    }
  }

  saveTokens(tokens: { accessToken: string; expiresAt: number; refreshToken: string }): void {
    const existing = readJson<MsAuthFile>(this.tokenFile) ?? {};
    const next: MsAuthFile = { ...existing, ...tokens };
    writeJson(this.tokenFile, next);
    this.auth = next;
  }

  private async refreshAccessToken(): Promise<void> {
    if (!this.auth?.refreshToken) throw new AuthError('No refresh token stored', this.id);
    const { clientId, clientSecret } = this.getClientCredentials();
    const body = new URLSearchParams({
      client_id: clientId,
      grant_type: 'refresh_token',
      refresh_token: this.auth.refreshToken,
      scope: this.scopes(),
    });
    if (clientSecret) body.set('client_secret', clientSecret);
    const res = await proxyFetch(`${this.authority}${MsTodoProvider.TOKEN_URL_SUFFIX}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) {
      const text = await res.text();
      if (res.status === 400 && text.includes('invalid_grant')) {
        writeJson(this.tokenFile, {});
        throw new AuthError('Microsoft refresh token expired or revoked. Re-connect the account.', this.id);
      }
      throw new ApiError(`Microsoft token refresh failed (${res.status}): ${truncate(text, 300)}`, res.status);
    }
    const data = (await res.json()) as { access_token: string; refresh_token?: string; expires_in: number };
    this.auth = {
      ...this.auth,
      accessToken: data.access_token,
      expiresAt: Date.now() + data.expires_in * 1000,
      refreshToken: data.refresh_token ?? this.auth.refreshToken,
    };
    writeJson(this.tokenFile, this.auth);
  }

  private accessToken(): string {
    const tok = this.auth?.accessToken;
    if (!tok) throw new AuthError('Not authenticated', this.id);
    return tok;
  }

  // ---------- low-level graph calls ----------

  private async graph<T>(
    method: string,
    urlPath: string,
    body?: unknown,
    query?: Record<string, string>,
  ): Promise<T> {
    const url = new URL(`${GRAPH_BASE}${urlPath}`);
    if (query) {
      for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    }
    let res: Response;
    try {
      res = await proxyFetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${this.accessToken()}`,
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch (err) {
      throw new ApiError(
        `Network error talking to Microsoft Graph: ${err instanceof Error ? err.message : err}`,
      );
    }
    if (res.status === 401) {
      throw new AuthError('Microsoft rejected the access token', this.id);
    }
    if (!res.ok) {
      const text = await res.text();
      throw new ApiError(`Graph API ${method} ${urlPath} failed (${res.status}): ${truncate(text, 300)}`, res.status);
    }
    if (res.status === 204) return {} as T;
    return (await res.json()) as T;
  }

  // ---------- lists ----------

  async listTaskLists(): Promise<TaskList[]> {
    const out: TaskList[] = [];
    let next: string | undefined = '/me/todo/lists';
    type ListsPage = { value: GraphTaskList[]; '@odata.nextLink'?: string };
    while (next) {
      const page: ListsPage = await this.graph<ListsPage>('GET', next);
      for (const l of page.value ?? []) {
        out.push({ id: l.id, name: l.displayName ?? '(untitled)' });
      }
      next = page['@odata.nextLink']
        ? page['@odata.nextLink'].replace(GRAPH_BASE, '')
        : undefined;
    }
    return out;
  }

  async createTaskList(name: string): Promise<TaskList> {
    const created = await this.graph<GraphTaskList>('POST', '/me/todo/lists', { displayName: name });
    return { id: created.id, name: created.displayName ?? name };
  }

  async deleteTaskList(id: string): Promise<void> {
    await this.graph<void>('DELETE', `/me/todo/lists/${encodeURIComponent(id)}`);
  }

  private async resolveDefaultListId(): Promise<string> {
    if (this.defaultListId) return this.defaultListId;
    const all = await this.graph<{ value: GraphTaskList[] }>('GET', '/me/todo/lists');
    const defList = all.value.find((l) => l.wellknownListName === 'defaultList');
    this.defaultListId = defList?.id ?? all.value[0]?.id ?? '';
    if (!this.defaultListId) throw new ApiError('No task list available in Microsoft account');
    return this.defaultListId;
  }

  // ---------- tasks ----------

  private mapTask(t: GraphTodoTask, listId: string): Task {
    return {
      id: t.id,
      listId,
      title: t.title ?? '',
      notes: t.body?.content || undefined,
      dueDate: t.dueDateTime?.dateTime ?? null,
      isCompleted: t.status === 'completed',
      completedAt: t.completedDateTime?.dateTime ?? null,
      createdAt: t.createdDateTime ?? null,
      updatedAt: t.lastModifiedDateTime ?? null,
    };
  }

  async listTasks(
    listId: string,
    options?: ListTasksOptions,
  ): Promise<{ tasks: Task[]; nextCursor?: string | undefined }> {
    const query: Record<string, string> = { $top: '100' };
    if (options?.cursor) query.$skiptoken = options.cursor;
    // Graph To Do does not reliably support $filter/$orderby on tasks;
    // filter client-side and page with $skiptoken from @odata.nextLink.
    const page = await this.graph<{ value: GraphTodoTask[]; '@odata.nextLink'?: string }>(
      'GET',
      `/me/todo/lists/${encodeURIComponent(listId)}/tasks`,
      undefined,
      query,
    );
    const includeCompleted = options?.includeCompleted ?? false;
    const tasks = (page.value ?? [])
      .filter((t) => includeCompleted || t.status !== 'completed')
      .map((t) => this.mapTask(t, listId));
    const nextCursor = page['@odata.nextLink']
      ? new URL(page['@odata.nextLink']).searchParams.get('$skiptoken') ?? undefined
      : undefined;
    return { tasks, nextCursor };
  }

  async getTask(listId: string, taskId: string): Promise<Task> {
    const t = await this.graph<GraphTodoTask>(
      'GET',
      `/me/todo/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`,
    );
    return this.mapTask(t, listId);
  }

  async createTask(input: CreateTaskInput): Promise<Task> {
    const listId = input.listId ?? (await this.resolveDefaultListId());
    const body: Record<string, unknown> = { title: input.title };
    if (input.notes !== undefined) body.body = { content: input.notes, contentType: 'text' };
    if (input.dueDate !== undefined) body.dueDateTime = toGraphDateTime(input.dueDate);
    const created = await this.graph<GraphTodoTask>(
      'POST',
      `/me/todo/lists/${encodeURIComponent(listId)}/tasks`,
      body,
    );
    return this.mapTask(created, listId);
  }

  async updateTask(input: UpdateTaskInput): Promise<Task> {
    const patch: Record<string, unknown> = {};
    if (input.title !== undefined) patch.title = input.title;
    if (input.notes !== undefined) patch.body = { content: input.notes, contentType: 'text' };
    if (input.dueDate !== undefined) {
      patch.dueDateTime = input.dueDate === null ? null : toGraphDateTime(input.dueDate);
    }
    if (input.status === 'completed') {
      patch.status = 'completed';
      patch.completedDateTime = { dateTime: new Date().toISOString(), timeZone: 'UTC' };
    } else if (input.status === 'needsAction') {
      patch.status = 'notStarted';
      patch.completedDateTime = null;
    }
    const updated = await this.graph<GraphTodoTask>(
      'PATCH',
      `/me/todo/lists/${encodeURIComponent(input.listId)}/tasks/${encodeURIComponent(input.taskId)}`,
      patch,
    );
    return this.mapTask(updated, input.listId);
  }

  async completeTask(listId: string, taskId: string): Promise<Task> {
    return this.updateTask({ listId, taskId, status: 'completed' });
  }

  async deleteTask(listId: string, taskId: string): Promise<void> {
    await this.graph<void>(
      'DELETE',
      `/me/todo/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`,
    );
  }

  async moveTask(): Promise<Task> {
    throw new UnsupportedError(
      'Microsoft To Do has no move API; create the task in the target list and delete the original.',
    );
  }

  async clearCompleted(): Promise<{ removed: number }> {
    throw new UnsupportedError(
      'Microsoft To Do does not offer bulk-clear of completed tasks; delete them individually.',
    );
  }
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n)}…`;
}

/** Convert an ISO date or RFC3339 datetime into Graph dueDateTime shape. */
function toGraphDateTime(iso: string): { dateTime: string; timeZone: string } {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    throw new ApiError(`Invalid date: "${iso}". Use ISO date (2026-08-25) or RFC 3339 datetime.`);
  }
  // If input was date-only, keep it as midnight so the day survives round-trips.
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(iso.trim());
  return {
    dateTime: dateOnly ? `${iso.trim()}T00:00:00.000` : d.toISOString(),
    timeZone: 'UTC',
  };
}
