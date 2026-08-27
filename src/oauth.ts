import { randomBytes, createHash } from 'node:crypto';

/**
 * Per-connection OAuth state, held in memory only.
 * Each authorize URL gets a fresh state + PKCE verifier; both are one-shot
 * and expire after 10 minutes, per RFC 9700 practice.
 */

export interface PendingAuth {
  providerId: string;
  state: string;
  codeVerifier: string;
  redirectUri: string;
  createdAt: number;
}

const TTL_MS = 10 * 60 * 1000;

export class OAuthStateStore {
  private pending = new Map<string, PendingAuth>();

  create(providerId: string, redirectUri: string): PendingAuth {
    const state = randomBytes(24).toString('base64url');
    const verifier = randomBytes(48).toString('base64url');
    const entry: PendingAuth = {
      providerId,
      state,
      codeVerifier: verifier,
      redirectUri,
      createdAt: Date.now(),
    };
    this.pending.set(state, entry);
    this.sweep();
    return entry;
  }

  /** Consume the state (one-time). Returns null when unknown or expired. */
  take(state: string | null, providerId: string): PendingAuth | null {
    if (!state) return null;
    const entry = this.pending.get(state);
    if (!entry) return null;
    this.pending.delete(state);
    if (entry.providerId !== providerId) return null;
    if (Date.now() - entry.createdAt > TTL_MS) return null;
    return entry;
  }

  private sweep(): void {
    const now = Date.now();
    for (const [k, v] of this.pending) {
      if (now - v.createdAt > TTL_MS) this.pending.delete(k);
    }
  }
}

export function codeChallengeS256(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}
