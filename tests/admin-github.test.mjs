import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bytesToBase64, ConflictError, decodeBase64Text, GitHubClient, GitHubError, REPOSITORY_ID } from '../admin/github.mjs';

const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...headers } });
const fakeToken = 'LOCAL_TEST_CREDENTIAL';
function mockGit({ files = [], failImage = false, race = false } = {}) {
  const calls = [];
  const fetcher = async (url, options) => {
    const path = new URL(url).pathname; const body = options.body ? JSON.parse(options.body) : undefined;
    calls.push({ url, method: options.method, body, options });
    if (path.endsWith('/git/ref/heads/main')) return json({ object: { sha: 'head-before' } });
    if (path.endsWith('/git/commits/head-before')) return json({ tree: { sha: 'base-tree' } });
    if (path.endsWith('/git/trees/base-tree')) return json({ tree: files.map(([path, sha]) => ({ path, sha, type: 'blob' })), truncated: false });
    if (path.endsWith('/git/blobs')) { if (failImage && body.encoding === 'base64') return json({}, 403); return json({ sha: body.encoding === 'base64' ? 'image-blob' : 'text-blob' }); }
    if (path.endsWith('/git/trees')) return json({ sha: 'new-tree' });
    if (path.endsWith('/git/commits')) return json({ sha: 'new-commit' });
    if (path.endsWith('/git/refs/heads/main')) return json(race ? {} : { object: { sha: 'new-commit' } }, race ? 422 : 200);
    throw new Error('Unexpected mock API request: ' + path);
  };
  return { client: new GitHubClient(fakeToken, fetcher), calls };
}

test('default native fetch retains its browser global receiver', async (t) => {
  t.mock.method(globalThis, 'fetch', async function () { assert.equal(this, globalThis); return json({ login: 'bound' }); });
  const client = new GitHubClient(fakeToken);
  assert.equal((await client.request('/user')).login, 'bound');
});

test('GitHub transport restricts origin, omits cookies/referrers/redirects and provides actionable error messages', async () => {
  for (const [status, expected] of [[401, /令牌无效/], [403, /读写权限/], [404, /只选中/], [429, /频繁/], [500, /HTTP 500/]]) {
    const client = new GitHubClient(fakeToken, async (url, options) => {
      assert.equal(url, 'https://api.github.com/user'); assert.equal(options.credentials, 'omit'); assert.equal(options.referrerPolicy, 'no-referrer'); assert.equal(options.redirect, 'error'); assert.equal(options.headers.Authorization, 'Bearer ' + fakeToken);
      return json({ message: 'UNTRUSTED_REMOTE_RESPONSE' }, status);
    });
    await assert.rejects(client.request('/user'), expected);
  }
  const offline = new GitHubClient(fakeToken, async () => { throw new Error('remote: ' + fakeToken); });
  await assert.rejects(offline.request('/user'), (error) => /检查网络/.test(error.message) && !error.message.includes(fakeToken));
  await assert.rejects(offline.request('https://evil.test'), /无效/);
  await assert.rejects(offline.request('//evil.test'), /无效/);
  offline.clear(); await assert.rejects(offline.request('/user'), /先连接/);
  const quota = new GitHubClient(fakeToken, async () => json({}, 403, { 'x-ratelimit-remaining': '0' }));
  await assert.rejects(quota.request('/user'), /额度/);
});

test('connection checks user, target repository identity and push permission', async () => {
  for (const repository of [{ id: REPOSITORY_ID, permissions: { push: false } }, { id: 5, permissions: { push: true } }]) {
    const client = new GitHubClient(fakeToken, async (url) => json(url.endsWith('/user') ? { login: 'DongpoBreeze' } : repository));
    await assert.rejects(client.connect(), /写权限/);
  }
  const client = new GitHubClient(fakeToken, async (url) => json(url.endsWith('/user') ? { login: 'dongpobreeze' } : { id: REPOSITORY_ID, permissions: { push: true } }));
  assert.equal((await client.connect()).login, 'dongpobreeze');
  const outsider = new GitHubClient(fakeToken, async (url) => json(url.endsWith('/user') ? { login: 'OtherWriter' } : { id: REPOSITORY_ID, permissions: { push: true } }));
  await assert.rejects(outsider.connect(), /仅对作者/);
});

test('article and staged image enter one atomic Git commit, with force:false and credentials outside bodies', async () => {
  const { client, calls } = mockGit({ files: [['content/posts/existing.md', 'original-sha'], ['unrelated.txt', 'preserved']] });
  const result = await client.commitChanges([{ path: 'assets/uploads/uuid.png', expectedSha: null, content: new Blob([new Uint8Array([1, 2, 3])]) }, { path: 'content/posts/existing.md', expectedSha: 'original-sha', content: '---\ntitle: 中文\n---\n正文' }], 'Update title');
  assert.equal(result.files.get('content/posts/existing.md'), 'text-blob');
  const writes = calls.filter((call) => call.method !== 'GET');
  assert.deepEqual(writes.map((call) => [call.method, new URL(call.url).pathname.split('/').pop()]), [['POST', 'blobs'], ['POST', 'blobs'], ['POST', 'trees'], ['POST', 'commits'], ['PATCH', 'main']]);
  const tree = writes[2].body;
  assert.equal(tree.base_tree, 'base-tree');
  assert.deepEqual(tree.tree.map((entry) => entry.path), ['assets/uploads/uuid.png', 'content/posts/existing.md']);
  assert.deepEqual(writes[3].body.parents, ['head-before']);
  assert.deepEqual(writes[4].body, { sha: 'new-commit', force: false });
  assert.doesNotMatch(JSON.stringify(writes.map((call) => call.body)), new RegExp(fakeToken));
});

test('changed remote SHA, unexpectedly existing new file, and new-image path collisions fail before any mutation', async () => {
  for (const changes of [[{ path: 'content/posts/a.md', expectedSha: 'old', content: 'text' }], [{ path: 'content/posts/a.md', expectedSha: null, content: 'text' }], [{ path: 'assets/uploads/a.png', expectedSha: null, content: new Blob(['x']) }]]) {
    const { client, calls } = mockGit({ files: [['content/posts/a.md', 'new'], ['assets/uploads/a.png', 'exists']] });
    await assert.rejects(client.commitChanges(changes, 'update'), ConflictError);
    assert.equal(calls.filter((call) => call.method !== 'GET').length, 0);
  }
});

test('route validation snapshot rejects a concurrent new commit before making any writes', async () => {
  const { client, calls } = mockGit();
  await assert.rejects(client.commitChanges([{ path: 'content/posts/new.md', expectedSha: null, content: 'new article' }], 'publish', { expectedHead: 'earlier-route-check-head' }), ConflictError);
  assert.equal(calls.filter((call) => call.method !== 'GET').length, 0);
});

test('image failure never creates a tree/commit/ref update, preserving the published article', async () => {
  const { client, calls } = mockGit({ failImage: true });
  await assert.rejects(client.commitChanges([{ path: 'assets/uploads/a.png', expectedSha: null, content: new Blob(['image']) }, { path: 'content/posts/a.md', expectedSha: null, content: 'article' }], 'publish'), GitHubError);
  assert.equal(calls.filter((call) => call.method !== 'GET').length, 1);
  assert.ok(calls.every((call) => call.method !== 'PATCH'));
});

test('concurrent branch update at ref uses a safe conflict error and never force pushes', async () => {
  const { client, calls } = mockGit({ race: true });
  await assert.rejects(client.commitChanges([{ path: 'content/posts/a.md', expectedSha: null, content: 'local draft remains in caller' }], 'publish'), ConflictError);
  const patch = calls.find((call) => call.method === 'PATCH');
  assert.equal(patch.body.force, false);
  assert.equal(calls.filter((call) => call.method === 'PATCH').length, 1);
});

test('deletion checks SHA and creates a null tree entry in the same safe transaction', async () => {
  const { client, calls } = mockGit({ files: [['content/posts/a.md', 'before']] });
  await client.commitChanges([{ path: 'content/posts/a.md', expectedSha: 'before', content: null }], 'delete');
  const tree = calls.find((call) => call.method === 'POST' && new URL(call.url).pathname.endsWith('/trees'));
  assert.deepEqual(tree.body.tree, [{ path: 'content/posts/a.md', mode: '100644', type: 'blob', sha: null }]);
  assert.equal(calls.filter((call) => new URL(call.url).pathname.endsWith('/blobs')).length, 0);
});

test('existing uppercase Markdown extension supports updates and deletion without widening other write paths', async () => {
  for (const content of ['更新正文', null]) {
    const { client, calls } = mockGit({ files: [['content/posts/旧文章.MD', 'before']] });
    await client.commitChanges([{ path: 'content/posts/旧文章.MD', expectedSha: 'before', content }], 'update');
    assert.equal(calls.find((call) => call.method === 'PATCH').body.force, false);
  }
  const { client } = mockGit();
  await assert.rejects(client.commitChanges([{ path: 'blog.config.JSON', expectedSha: null, content: '{}' }], 'reject'), /路径/);
});

test('UTF8 base64 and incomplete repository responses are handled without content corruption', async () => {
  const text = '中文标题\n# 正文 🌿';
  assert.equal(decodeBase64Text(bytesToBase64(new TextEncoder().encode(text))), text);
  const client = new GitHubClient(fakeToken, async (url) => json(url.includes('/git/ref/') ? { object: { sha: 'head' } } : url.includes('/git/commits/') ? { tree: { sha: 'tree' } } : { tree: [], truncated: true }));
  await assert.rejects(client.snapshot(), /完整目录/);
  for (const path of ['.github/workflows/publish.yml', 'content/posts/../secret.md', 'assets/uploads/active.svg']) {
    const { client } = mockGit(); await assert.rejects(client.commitChanges([{ path, expectedSha: null, content: 'x' }], 'reject'), /路径/);
  }
});
