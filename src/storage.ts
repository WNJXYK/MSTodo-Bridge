import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

/**
 * Token/credential storage.
 *
 * Design constraints:
 * - Must work cross-platform with zero native deps (keytar is optional and
 *   flaky on Windows CI), so we use a per-user JSON file with 0600 perms.
 * - Path can be overridden via TASKBRIDGE_CONFIG_DIR for tests/portability.
 */
export function configDir(): string {
  const override = process.env.TASKBRIDGE_CONFIG_DIR;
  if (override) return override;
  return path.join(os.homedir(), '.taskbridge-mcp');
}

export function ensureConfigDir(): string {
  const dir = configDir();
  fs.mkdirSync(dir, { recursive: true });
  try {
    fs.chmodSync(dir, 0o700);
  } catch {
    // chmod is a no-op on most Windows filesystems; ignore
  }
  return dir;
}

export function readJson<T>(name: string): T | null {
  const file = path.join(configDir(), name);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch (err) {
    throw new Error(
      `Config file ${file} is corrupt (${err instanceof Error ? err.message : err}). ` +
        `Delete it and re-run the auth flow.`,
    );
  }
}

export function writeJson(name: string, data: unknown): void {
  ensureConfigDir();
  const file = path.join(configDir(), name);
  fs.writeFileSync(file, JSON.stringify(data, null, 2), { mode: 0o600 });
}
