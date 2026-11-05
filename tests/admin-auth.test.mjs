import assert from 'node:assert/strict';
import { test } from 'node:test';
import { authorPath, authorReason, EDITOR_PATH, restoreAuthor, SessionStorageError, signInAuthor } from '../admin/auth.mjs';
import { clearSession, readSession, saveSession, sessionAvailable } from '../admin/session.mjs';
import { DraftStore } from '../admin/drafts.mjs';

const fakeToken = 'LOCAL_AUTH_TEST_CREDENTIAL';
function memoryStorage() {
  const values = new Map();
  return { values, getItem: (key) => values.get(key) || null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
}
function clientFactory({ error, wait } = {}) {
  const calls = [];
  return { calls, createClient: (token) => {
    const record = { token, cleared: false }; calls.push(record);
    return { connect: async () => { if (wait) await wait; if (error) throw error; return { login: 'DongpoBreeze' }; }, clear: () => { record.cleared = true; } };
  } };
}

test('author sign-in saves only a verified credential under the existing session key', async () => {
  const storage = memoryStorage(); const { createClient, calls } = clientFactory();
  const auth = await signInAuthor('  ' + fakeToken + '  ', { storage, createClient });
  assert.equal(auth.login, 'DongpoBreeze');
  assert.equal(calls[0].token, fakeToken);
  assert.deepEqual([...storage.values], [['dongpo-blog-editor-session', fakeToken]]);
  assert.equal(readSession(storage), fakeToken);
  clearSession(storage); assert.equal(readSession(storage), '');
});

test('unavailable session storage never fakes sign-in or starts GitHub validation', async () => {
  for (const storage of [
    { getItem() { return null; }, setItem() { throw new Error('blocked'); }, removeItem() {} },
    { getItem() { return null; }, setItem() {}, removeItem() {} }
  ]) {
    const { createClient, calls } = clientFactory();
    assert.equal(sessionAvailable(storage), false);
    await assert.rejects(signInAuthor(fakeToken, { storage, createClient }), SessionStorageError);
    assert.equal(calls.length, 0);
  }
});

test('throwing browser sessionStorage getter is caught inside all session helpers', (t) => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, get() { throw new Error('SecurityError'); } });
  t.after(() => { if (descriptor) Object.defineProperty(globalThis, 'sessionStorage', descriptor); else delete globalThis.sessionStorage; });
  assert.equal(readSession(), ''); assert.equal(saveSession(fakeToken), false); assert.equal(sessionAvailable(), false); assert.doesNotThrow(() => clearSession());
});

test('owner or API rejection and network errors clear stale sessions without swallowing actionable errors', async () => {
  for (const error of [Object.assign(new Error('仅对作者 DongpoBreeze 开放'), { status: 403 }), Object.assign(new Error('令牌无效或已过期'), { status: 401 }), Object.assign(new Error('请检查网络后重试'), { status: 0 })]) {
    const storage = memoryStorage(); saveSession(fakeToken, storage); const { createClient, calls } = clientFactory({ error });
    await assert.rejects(restoreAuthor({ storage, createClient }), (actual) => actual === error);
    assert.equal(readSession(storage), ''); assert.equal(calls[0].cleared, true);
  }
});

test('no session avoids API calls; restored session verifies again before any editor can open', async () => {
  const storage = memoryStorage(); const { createClient, calls } = clientFactory();
  assert.equal(await restoreAuthor({ storage, createClient }), null); assert.equal(calls.length, 0);
  saveSession(fakeToken, storage);
  assert.equal((await restoreAuthor({ storage, createClient })).login, 'DongpoBreeze'); assert.equal(calls.length, 1);
});

test('a late validation response cannot restore a session after the request is no longer current', async () => {
  let finish;
  const wait = new Promise((resolve) => { finish = resolve; }); const storage = memoryStorage();
  const { createClient, calls } = clientFactory({ wait }); let current = true;
  const pending = signInAuthor(fakeToken, { storage, createClient, isCurrent: () => current });
  current = false; finish();
  assert.equal(await pending, null); assert.equal(calls[0].cleared, true); assert.equal(readSession(storage), '');
});

test('a late failed request does not clear a replacement session', async () => {
  let finish;
  const wait = new Promise((resolve) => { finish = resolve; }); const storage = memoryStorage(); saveSession(fakeToken, storage);
  const { createClient } = clientFactory({ wait, error: new Error('old request failed') }); let current = true;
  const pending = restoreAuthor({ storage, createClient, isCurrent: () => current });
  current = false; saveSession('NEW_LOCAL_TEST_CREDENTIAL', storage); finish();
  assert.equal(await pending, null); assert.equal(readSession(storage), 'NEW_LOCAL_TEST_CREDENTIAL');
});

test('navigation is limited to fixed local paths and enumerable credential-free reasons', () => {
  assert.equal(EDITOR_PATH, '/admin/');
  assert.equal(authorPath(), '/author/');
  assert.equal(authorPath('session-expired'), '/author/?reason=session-expired');
  assert.equal(authorPath('signed-out'), '/author/?reason=signed-out');
  assert.equal(authorPath('https://evil.test/?token=' + fakeToken), '/author/');
  assert.match(authorReason('?reason=session-expired&returnTo=https://evil.test'), /失效/);
  assert.equal(authorReason('?reason=' + fakeToken), '');
});

test('a pending IndexedDB open cannot retain a database connection after exiting the editor', async (t) => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
  const request = {}; let closed = 0;
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: { open: () => request } });
  t.after(() => { if (descriptor) Object.defineProperty(globalThis, 'indexedDB', descriptor); else delete globalThis.indexedDB; });
  const store = new DraftStore(); const pending = store.open(); store.close();
  request.result = { close: () => { closed += 1; } }; request.onsuccess();
  await assert.rejects(pending, /会话已结束/);
  assert.equal(closed, 1);
});
