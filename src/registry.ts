import { TaskProvider, ProviderOAuth, Task, ListTasksOptions } from './providers/types.js';
import { MsTodoProvider } from './providers/mstodo.js';
import { AuthError, TaskBridgeError } from './errors.js';

export type ManagedProvider = TaskProvider & ProviderOAuth;

export function createRegistry(): Map<string, ManagedProvider> {
  const providers: ManagedProvider[] = [new MsTodoProvider()];
  return new Map(providers.map((p) => [p.id, p]));
}

export function resolveProvider(
  registry: Map<string, ManagedProvider>,
  providerId: string | undefined,
): ManagedProvider {
  const ids = [...registry.keys()];
  if (providerId) {
    const p = registry.get(providerId);
    if (!p) {
      throw new TaskBridgeError(`Unknown provider "${providerId}". Available: ${ids.join(', ')}.`);
    }
    return p;
  }
  const ready = ids.map((id) => registry.get(id)!).filter((p) => p.isAuthenticated());
  if (ready.length === 1) return ready[0]!;
  if (ready.length === 0) {
    throw new AuthError(
      `No provider is connected yet. Open the web GUI (\`taskbridge-mcp --http\`), connect Microsoft To Do there, or pass an explicit provider id (${ids.join(', ')}).`,
      'registry',
    );
  }
  throw new TaskBridgeError(
    `Multiple providers are connected (${ready.map((p) => p.id).join(', ')}); pass "provider" to choose one.`,
  );
}

export interface ProviderStatus {
  id: string;
  displayName: string;
  connected: boolean;
  clientConfigured: boolean;
  capabilities: TaskProvider['capabilities'];
}

export function providerStatuses(registry: Map<string, ManagedProvider>): ProviderStatus[] {
  return [...registry.values()].map((p) => ({
    id: p.id,
    displayName: p.displayName,
    connected: p.isAuthenticated(),
    clientConfigured: p.hasClientCredentials(),
    capabilities: p.capabilities,
  }));
}

/** List tasks across every list of every connected provider (for search / overview). */
export async function listAllTasks(
  registry: Map<string, ManagedProvider>,
  options?: ListTasksOptions,
): Promise<{ provider: string; tasks: Task[] }[]> {
  const out: { provider: string; tasks: Task[] }[] = [];
  for (const p of registry.values()) {
    if (!p.isAuthenticated()) continue;
    try {
      await p.ensureAuth();
      const lists = await p.listTaskLists();
      const tasks: Task[] = [];
      for (const list of lists) {
        // First page per list is enough for search/overview surfaces.
        const page = await p.listTasks(list.id, options);
        tasks.push(...page.tasks);
      }
      out.push({ provider: p.id, tasks });
    } catch {
      // Provider failed (e.g. revoked token) — skip it, report the rest.
    }
  }
  return out;
}
