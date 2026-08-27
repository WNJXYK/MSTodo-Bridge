/** A task list (folder) in a provider. */
export interface TaskList {
  id: string;
  name: string;
}

/** Unified task shape. Providers map their native objects onto this. */
export interface Task {
  /** Provider-native task id */
  id: string;
  /** Owning list id */
  listId: string;
  title: string;
  notes?: string | undefined;
  /** RFC 3339 or null when unset */
  dueDate?: string | null | undefined;
  isCompleted: boolean;
  completedAt?: string | null | undefined;
  createdAt?: string | null | undefined;
  updatedAt?: string | null | undefined;
  /** Native parent id for subtasks, undefined if top-level */
  parentTaskId?: string | undefined;
  /** Provider-specific extras that don't fit the unified model. */
  raw?: Record<string, unknown> | undefined;
}

export interface CreateTaskInput {
  listId?: string;
  title: string;
  notes?: string;
  /** ISO date or RFC 3339 datetime */
  dueDate?: string;
  /** Parent task id to nest under (subtask support varies by provider) */
  parentTaskId?: string;
}

export interface UpdateTaskInput {
  listId: string;
  taskId: string;
  title?: string;
  notes?: string;
  dueDate?: string | null;
  status?: 'needsAction' | 'completed';
}

/**
 * Capability flags a provider declares. The server surfaces these so the AI
 * knows what will actually work instead of failing mid-call.
 */
export interface ProviderCapabilities {
  /** Can create/update/delete lists themselves */
  manageLists: boolean;
  /** Can create subtasks under an existing task */
  subtasks: boolean;
  /** Can reorder/move tasks within or across lists */
  moveTasks: boolean;
  /** Server-side search, false means client-side filtering of full fetches */
  serverSearch: boolean;
  /** Clear/remove all completed tasks in a list */
  clearCompleted: boolean;
}

export interface ListTasksOptions {
  /** Include tasks already marked completed (default: false) */
  includeCompleted?: boolean;
  /** Opaque pagination cursor from a previous call */
  cursor?: string;
}

/**
 * The contract every provider adapter implements.
 * All methods may throw ProviderError with a user-actionable message.
 */
export interface TaskProvider {
  readonly id: string;
  readonly displayName: string;
  readonly capabilities: ProviderCapabilities;

  /** Throw AuthError if no valid credentials / cannot refresh. */
  ensureAuth(): Promise<void>;

  listTaskLists(): Promise<TaskList[]>;
  createTaskList(name: string): Promise<TaskList>;
  deleteTaskList(id: string): Promise<void>;

  listTasks(listId: string, options?: ListTasksOptions): Promise<{ tasks: Task[]; nextCursor?: string }>;
  getTask(listId: string, taskId: string): Promise<Task>;
  createTask(input: CreateTaskInput): Promise<Task>;
  updateTask(input: UpdateTaskInput): Promise<Task>;
  completeTask(listId: string, taskId: string): Promise<Task>;
  deleteTask(listId: string, taskId: string): Promise<void>;

  /** Move/reorder; providers without capability.moveTasks throw UnsupportedError */
  moveTask(
    fromListId: string,
    taskId: string,
    toListId?: string,
    newParentId?: string,
  ): Promise<Task>;

  /** Remove all completed tasks from a list. */
  clearCompleted(listId: string): Promise<{ removed: number }>;
}

/**
 * OAuth lifecycle surface the admin GUI drives. Providers implement this so
 * the HTTP server can host one uniform connect/disconnect flow.
 */
export interface ProviderOAuth {
  /** OAuth client credentials are configured (env or GUI). */
  hasClientCredentials(): boolean;
  /** A usable refresh token is stored. */
  isAuthenticated(): boolean;
  /** Authorization URL for the admin to visit; callback lands on this server. */
  buildAuthorizeUrl(redirectUri: string, state: string, codeChallenge: string): string;
  /** Exchange the authorization code (with PKCE verifier) for stored tokens. */
  exchangeCode(code: string, redirectUri: string, codeVerifier: string): Promise<void>;
  /** Drop stored user tokens; keep client credentials. */
  disconnect(): void;
  /** Store OAuth client credentials entered in the GUI (secret optional for public clients). */
  saveClientCredentials(clientId: string, clientSecret?: string): void;
}
