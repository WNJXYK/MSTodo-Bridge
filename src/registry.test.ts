import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveProvider, providerStatuses } from './registry.js';
import type { ManagedProvider } from './registry.js';
import { AuthError, TaskBridgeError } from './errors.js';

function fake(id: string, authed: boolean, configured = true): ManagedProvider {
  const stub = () => {
    throw new Error('not implemented in fake');
  };
  return {
    id,
    displayName: `fake-${id}`,
    capabilities: {
      manageLists: true,
      subtasks: false,
      moveTasks: false,
      serverSearch: false,
      clearCompleted: false,
    },
    ensureAuth: stub,
    listTaskLists: stub,
    createTaskList: stub,
    deleteTaskList: stub,
    listTasks: stub,
    getTask: stub,
    createTask: stub,
    updateTask: stub,
    completeTask: stub,
    deleteTask: stub,
    moveTask: stub,
    clearCompleted: stub,
    hasClientCredentials: () => configured,
    isAuthenticated: () => authed,
    buildAuthorizeUrl: stub,
    exchangeCode: stub,
    disconnect: stub,
    saveClientCredentials: stub,
  };
}

test('resolveProvider with no connected provider raises AuthError', () => {
  const registry = new Map([[ 'mstodo', fake('mstodo', false) ]]);
  assert.throws(() => resolveProvider(registry, undefined), AuthError);
});

test('resolveProvider auto-selects the single connected provider', () => {
  const registry = new Map<string, ManagedProvider>([
    ['mstodo', fake('mstodo', false)],
    ['work', fake('work', true)],
  ]);
  assert.equal(resolveProvider(registry, undefined).id, 'work');
});

test('resolveProvider demands an explicit id when several are connected', () => {
  const registry = new Map<string, ManagedProvider>([
    ['mstodo', fake('mstodo', true)],
    ['work', fake('work', true)],
  ]);
  assert.throws(() => resolveProvider(registry, undefined), TaskBridgeError);
  assert.equal(resolveProvider(registry, 'work').id, 'work');
});

test('resolveProvider with an explicit id works even when not yet connected', () => {
  const registry = new Map<string, ManagedProvider>([['mstodo', fake('mstodo', false)]]);
  assert.equal(resolveProvider(registry, 'mstodo').id, 'mstodo');
});

test('resolveProvider rejects unknown ids', () => {
  const registry = new Map<string, ManagedProvider>([['mstodo', fake('mstodo', true)]]);
  assert.throws(() => resolveProvider(registry, 'todoist'), /Unknown provider/);
});

test('providerStatuses reports connection and credential state', () => {
  const registry = new Map<string, ManagedProvider>([
    ['mstodo', fake('mstodo', true)],
    ['work', fake('work', false, false)],
  ]);
  const statuses = providerStatuses(registry);
  assert.deepEqual(
    statuses.map((s) => [s.id, s.connected, s.clientConfigured]),
    [
      ['mstodo', true, true],
      ['work', false, false],
    ],
  );
});
