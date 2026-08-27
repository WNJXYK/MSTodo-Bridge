import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OAuthStateStore, codeChallengeS256 } from './oauth.js';

test('codeChallengeS256 matches the RFC 7636 appendix B vector', () => {
  const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
  assert.equal(codeChallengeS256(verifier), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
});

test('OAuthStateStore round-trips a pending auth', () => {
  const store = new OAuthStateStore();
  const pending = store.create('mstodo', 'http://localhost:7860/oauth/mstodo/callback');
  const taken = store.take(pending.state, 'mstodo');
  assert.ok(taken);
  assert.equal(taken.providerId, 'mstodo');
  assert.equal(taken.redirectUri, 'http://localhost:7860/oauth/mstodo/callback');
  assert.ok(taken.codeVerifier.length >= 43, 'PKCE verifier must be >= 43 chars');
});

test('state is single-use: a second take returns null', () => {
  const store = new OAuthStateStore();
  const pending = store.create('other', 'http://localhost:7860/oauth/other/callback');
  assert.ok(store.take(pending.state, 'other'));
  assert.equal(store.take(pending.state, 'other'), null);
});

test('take rejects mismatched provider, unknown state and null', () => {
  const store = new OAuthStateStore();
  const pending = store.create('mstodo', 'http://localhost:7860/oauth/mstodo/callback');
  assert.equal(store.take(pending.state, 'other'), null);
  assert.equal(store.take('forged-state', 'mstodo'), null);
  assert.equal(store.take(null, 'mstodo'), null);
  // The mismatched take consumed the entry — replay must not succeed either.
  assert.equal(store.take(pending.state, 'mstodo'), null);
});

test('entries expire after the TTL', () => {
  const store = new OAuthStateStore();
  const pending = store.create('mstodo', 'http://localhost:7860/oauth/mstodo/callback');
  const realNow = Date.now;
  try {
    Date.now = () => realNow() + 11 * 60 * 1000; // TTL is 10 minutes
    assert.equal(store.take(pending.state, 'mstodo'), null);
  } finally {
    Date.now = realNow;
  }
});
