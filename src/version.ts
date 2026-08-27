import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/** Single source of truth: dist/../package.json, so it can never drift. */
export const VERSION: string = (require('../package.json') as { version: string }).version;
