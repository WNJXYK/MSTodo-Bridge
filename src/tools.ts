import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod/v4';
import { createRegistry, resolveProvider, listAllTasks, providerStatuses, ManagedProvider } from './registry.js';
import { toMcpError } from './errors.js';
import { LoginManager } from './login.js';

const providerParam = z
  .string()
  .optional()
  .describe('Provider id (mstodo). Omit when exactly one provider is connected.');

const loginManagers = new Map<string, LoginManager>();

function loginManagerFor(p: ManagedProvider): LoginManager {
  let m = loginManagers.get(p.id);
  if (!m) {
    m = new LoginManager(p);
    loginManagers.set(p.id, m);
  }
  return m;
}

function json(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

function fail(err: unknown) {
  const e = toMcpError(err);
  return {
    content: [{ type: 'text' as const, text: `${e.message} (code: ${e.code})` }],
    isError: true,
  };
}

async function call<T>(fn: () => T | Promise<T>) {
  try {
    return json(await fn());
  } catch (err) {
    return fail(err);
  }
}

/** Aggregate first page of every list of one provider. */
async function aggregateProviderTasks(p: ManagedProvider, includeCompleted: boolean) {
  const lists = await p.listTaskLists();
  const out: unknown[] = [];
  for (const list of lists) {
    const page = await p.listTasks(list.id, { includeCompleted });
    out.push({ list: list.name, listId: list.id, tasks: page.tasks });
  }
  return { provider: p.id, lists: out };
}

export function registerTaskTools(server: McpServer): Map<string, ManagedProvider> {
  const registry = createRegistry();

  server.registerTool(
    'login_status',
    {
      description:
        'Check whether Microsoft To Do is connected. Use before task tools; if not connected, call start_login.',
      inputSchema: {},
    },
    async () =>
      call(async () => {
        const p = resolveProvider(registry, undefined);
        return loginManagerFor(p).status();
      }),
  );

  server.registerTool(
    'start_login',
    {
      description:
        'Begin connecting Microsoft To Do. Returns a URL the user must open in their browser and click consent. ' +
        'If the browser cannot reach the local machine (remote/hosted MCP), the user should copy the final ' +
        'address-bar URL after consent and you pass it to paste_callback. Call login_status afterwards.',
      inputSchema: {},
    },
    async () =>
      call(async () => {
        const p = resolveProvider(registry, undefined);
        return loginManagerFor(p).start();
      }),
  );

  server.registerTool(
    'paste_callback',
    {
      description:
        'Finish login when the browser redirect cannot reach this machine: pass the full localhost callback URL ' +
        'the user copied from the address bar after consenting.',
      inputSchema: { url: z.string().min(1).describe('完整回调地址，含 code 与 state 参数') },
    },
    async ({ url }) => {
      try {
        const p = resolveProvider(registry, undefined);
        const out = await loginManagerFor(p).paste(url);
        if (!out.ok) return fail(new Error(out.message));
        return json({ ok: true, message: out.message });
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    'list_providers',
    {
      description:
        'Show the Microsoft To Do provider and its auth state and capabilities. Run this first to learn what is available.',
      inputSchema: {},
    },
    async () => call(() => ({ providers: providerStatuses(registry) })),
  );

  server.registerTool(
    'list_task_lists',
    {
      description: 'List the task lists (folders) of a provider.',
      inputSchema: { provider: providerParam },
    },
    async ({ provider }) =>
      call(async () => {
        const p = resolveProvider(registry, provider);
        await p.ensureAuth();
        return { provider: p.id, lists: await p.listTaskLists() };
      }),
  );

  server.registerTool(
    'create_task_list',
    {
      description: 'Create a new task list (folder).',
      inputSchema: { provider: providerParam, name: z.string().min(1) },
    },
    async ({ provider, name }) =>
      call(async () => {
        const p = resolveProvider(registry, provider);
        await p.ensureAuth();
        return p.createTaskList(name);
      }),
  );

  server.registerTool(
    'delete_task_list',
    {
      description: 'Delete an entire task list and its tasks. Irreversible.',
      inputSchema: { provider: providerParam, listId: z.string() },
    },
    async ({ provider, listId }) =>
      call(async () => {
        const p = resolveProvider(registry, provider);
        await p.ensureAuth();
        await p.deleteTaskList(listId);
        return { deleted: true, listId };
      }),
  );

  server.registerTool(
    'list_tasks',
    {
      description:
        'List tasks. Give listId for one list; omit it to page across every list of the provider.',
      inputSchema: {
        provider: providerParam,
        listId: z.string().optional().describe('Omit to aggregate across all lists'),
        includeCompleted: z.boolean().optional().default(false),
        cursor: z.string().optional().describe('Pagination cursor from a previous call (single-list mode only)'),
      },
    },
    async ({ provider, listId, includeCompleted, cursor }) =>
      call(async () => {
        const p = resolveProvider(registry, provider);
        await p.ensureAuth();
        if (listId) return { provider: p.id, ...(await p.listTasks(listId, { includeCompleted, cursor })) };
        return aggregateProviderTasks(p, includeCompleted);
      }),
  );

  server.registerTool(
    'search_tasks',
    {
      description: 'Search open tasks by substring across every list of every connected provider.',
      inputSchema: { provider: providerParam, query: z.string().min(1) },
    },
    async ({ provider, query }) =>
      call(async () => {
        const q = query.toLowerCase();
        if (provider) {
          const p = resolveProvider(registry, provider);
          await p.ensureAuth();
          const agg = await aggregateProviderTasks(p, true);
          const matches = agg.lists.flatMap((l) =>
            (l as { tasks: { id: string; title: string; notes?: string; dueDate?: string | null; listId: string }[] }).tasks
              .filter(
                (t) =>
                  t.title.toLowerCase().includes(q) ||
                  (t.notes ?? '').toLowerCase().includes(q),
              )
              .map((t) => ({ ...t, list: (l as { list: string }).list })),
          );
          return { provider: p.id, query, matches };
        }
        const all = await listAllTasks(registry, { includeCompleted: true });
        return {
          query,
          matches: all.map((r) => ({
            provider: r.provider,
            matches: r.tasks
              .filter(
                (t) =>
                  t.title.toLowerCase().includes(q) ||
                  (t.notes ?? '').toLowerCase().includes(q),
              )
              .map((t) => ({ id: t.id, title: t.title, notes: t.notes, dueDate: t.dueDate, listId: t.listId })),
          })),
        };
      }),
  );

  server.registerTool(
    'get_task',
    {
      description: 'Fetch one task by list and task id.',
      inputSchema: { provider: providerParam, listId: z.string(), taskId: z.string() },
    },
    async ({ provider, listId, taskId }) =>
      call(async () => {
        const p = resolveProvider(registry, provider);
        await p.ensureAuth();
        return p.getTask(listId, taskId);
      }),
  );

  server.registerTool(
    'create_task',
    {
      description:
        'Create a task. dueDate accepts ISO date (2026-08-25) or RFC 3339 datetime. parentTaskId nests it as a subtask where supported.',
      inputSchema: {
        provider: providerParam,
        listId: z.string().optional().describe('Omit for the provider default list'),
        title: z.string().min(1),
        notes: z.string().optional(),
        dueDate: z.string().optional(),
        parentTaskId: z.string().optional(),
      },
    },
    async ({ provider, listId, title, notes, dueDate, parentTaskId }) =>
      call(async () => {
        const p = resolveProvider(registry, provider);
        await p.ensureAuth();
        return p.createTask({ listId, title, notes, dueDate, parentTaskId });
      }),
  );

  server.registerTool(
    'update_task',
    {
      description:
        'Update a task (partial). Set status "completed" or "needsAction", change title/notes, or set dueDate (null removes it).',
      inputSchema: {
        provider: providerParam,
        listId: z.string(),
        taskId: z.string(),
        title: z.string().optional(),
        notes: z.string().optional(),
        dueDate: z.string().nullable().optional(),
        status: z.enum(['needsAction', 'completed']).optional(),
      },
    },
    async ({ provider, listId, taskId, title, notes, dueDate, status }) =>
      call(async () => {
        const p = resolveProvider(registry, provider);
        await p.ensureAuth();
        return p.updateTask({ listId, taskId, title, notes, dueDate, status });
      }),
  );

  server.registerTool(
    'complete_task',
    {
      description: 'Mark a task completed.',
      inputSchema: { provider: providerParam, listId: z.string(), taskId: z.string() },
    },
    async ({ provider, listId, taskId }) =>
      call(async () => {
        const p = resolveProvider(registry, provider);
        await p.ensureAuth();
        return p.completeTask(listId, taskId);
      }),
  );

  server.registerTool(
    'delete_task',
    {
      description: 'Delete a task permanently.',
      inputSchema: { provider: providerParam, listId: z.string(), taskId: z.string() },
    },
    async ({ provider, listId, taskId }) =>
      call(async () => {
        const p = resolveProvider(registry, provider);
        await p.ensureAuth();
        await p.deleteTask(listId, taskId);
        return { deleted: true, listId, taskId };
      }),
  );

  server.registerTool(
    'move_task_between_lists',
    {
      description:
        'Recreate an existing task in another list and delete it from the source list (Graph To Do has no native move). Use to reorganize.',
      inputSchema: {
        provider: providerParam,
        fromListId: z.string(),
        taskId: z.string(),
        toListId: z.string().describe('Destination list'),
      },
    },
    async ({ provider, fromListId, taskId, toListId }) =>
      call(async () => {
        const p = resolveProvider(registry, provider);
        await p.ensureAuth();
        if (fromListId === toListId) throw new Error('Source and destination lists are identical.');
        const original = await p.getTask(fromListId, taskId);
        const created = await p.createTask({
          listId: toListId,
          title: original.title,
          notes: original.notes,
          dueDate: original.dueDate ?? undefined,
        });
        await p.deleteTask(fromListId, taskId);
        return created;
      }),
  );

  return registry;
}
