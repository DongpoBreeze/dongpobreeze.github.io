import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canonicalBody, defaultSlug, displayBody, draftRecord, isRealDate, parsePost, prepareImage, recordFromPost, serializePost, serializeSettings, validatePost, validateSlug } from '../admin/content.mjs';
import { clearSession, readSession, saveSession } from '../admin/drafts.mjs';

const source = '\uFEFF---\r\n# 保留这段注释\r\ntitle: "中文标题：一次学习"\r\ndate: 2026-11-03\r\ndescription: "第一行\\n第二行"\r\ntags: [学习, 日常]\r\ncustom:\r\n  nested: [1, "你好"]\r\n  enabled: true\r\n---\r\n\r\n## 理解\r\n\r\n**加粗**、[外链](https://example.com/?a=1&b=2)\r\n\r\n| 名称 | 数值 |\r\n| --- | ---: |\r\n| 甲 | 42 |\r\n\r\n```js\r\nconst x = "中文";\r\n```\r\n';

test('Chinese YAML/Markdown round-trip preserves unknown fields, comments, exact body, and implicit nested slug', () => {
  const path = 'content/posts/学习/2026-11-03_Embedding学习.md';
  const record = recordFromPost(source, path, 'before');
  const originalBody = record.body;
  record.description = '更新摘要：仍保留正文';
  const written = serializePost(record);
  const parsed = parsePost(written, path);
  assert.equal(parsed.data.description, record.description);
  assert.deepEqual(parsed.data.custom, { nested: [1, '你好'], enabled: true });
  assert.match(written, /# 保留这段注释/);
  assert.equal(parsed.body, originalBody);
  assert.equal(parsed.slug, '学习-2026-11-03-embedding学习');
  assert.equal(parsed.data.slug, undefined);
  assert.equal(parsePost(serializePost(recordFromPost(written, path, 'after')), path).body, originalBody);
});

test('explicit slug remains stable even when changing title, date and tags', () => {
  const record = recordFromPost(source.replace('date: 2026', 'slug: "原有_地址"\r\ndate: 2026'), 'content/posts/old-name.md', 'sha');
  record.title = '完全不同的标题'; record.date = '2024-02-29'; record.tags = ['新主题'];
  const parsed = parsePost(serializePost(record), record.path);
  assert.equal(parsed.slug, '原有_地址');
  assert.equal(parsed.data.slug, '原有_地址');
  assert.equal(record.path, 'content/posts/old-name.md');
});

test('replacing known YAML values preserves anchors used by unknown metadata aliases', () => {
  const record = recordFromPost('---\ntitle: &heading 中文标题\ndate: 2026-11-05\ntags: &topics [学习, 日常]\ncustom:\n  aliases: *topics\n  heading: *heading\n---\n正文', 'content/posts/a.md', 'before');
  record.title = '新标题'; record.tags = ['随笔'];
  const serialized = serializePost(record);
  const parsed = parsePost(serialized, record.path);
  assert.deepEqual(parsed.data.custom, { aliases: ['随笔'], heading: '新标题' });
  assert.match(serialized, /&topics/); assert.match(serialized, /\*topics/);
  assert.equal(parsed.body, '正文');
});

test('real user article leading-blank-line regression loads without changing content or derived URL', () => {
  const path = 'content/posts/2026-11-03-embedding学习.md';
  // Fixture mirrors the user-authored article; never depend on mutable live content.
  const actual = '\r\n---\r\ntitle: 我的第一篇文章\r\ndate: 2026-11-03\r\ndescription: 总结embedding学习的总结\r\ntags:\r\n  - 日常\r\n  - 学习\r\n---\r\n\r\n从这里开始写。\r\n\r\n## embedding的理解\r\n[链接]([https://example.com](https://aieng-zh.cn/lessons/11-llm-engineering/04-embeddings/?learningPath=applied-ai-engineer))\r\n\r\n- 第一条\r\n- 第二条\r\n';
  const record = recordFromPost(actual, path, 'existing');
  assert.equal(record.slug, '2026-11-03-embedding学习');
  assert.equal(record.title, '我的第一篇文章');
  assert.match(record.body, /embedding的理解/);
  assert.equal(parsePost(serializePost(record), path).body, record.body);
  assert.equal(recordFromPost('\uFEFF\r\n \t\r\n---\r\ntitle: 测试\r\ndate: 2026-11-05\r\n---\r\n正文', 'content/posts/a.md', null).title, '测试');
});

test('draft:true files with unfinished metadata can be opened but cannot publish until complete', () => {
  const record = recordFromPost('---\ndraft: true\ncustom: 保留\n---\n正在构思', 'content/posts/unfinished.md', 'sha');
  assert.equal(record.remoteDraft, true); assert.equal(record.title, '');
  assert.throws(() => validatePost(record), /标题/);
  record.title = '完成标题'; record.date = '2026-11-05';
  validatePost(record);
  assert.equal(parsePost(serializePost(record), record.path).data.draft, false);
  assert.equal(parsePost(serializePost(record, { draft: true }), record.path).data.draft, true);
});

test('publication validates dates, content, route limits and Unicode case collisions', () => {
  for (const valid of ['2024-02-29', '0001-01-01', '2026-11-05']) assert.equal(isRealDate(valid), true);
  for (const invalid of ['2025-02-29', '2026-04-31', '2026-13-01', '0000-01-01', '2026-1-01', new Date()]) assert.equal(isRealDate(invalid), false);
  for (const valid of ['中文_文章-1', 'école', 'a'.repeat(200)]) assert.equal(validateSlug(valid), valid);
  for (const invalid of ['con', 'LPT9', '-first', 'a/b', 'a b', '中'.repeat(67), 'a'.repeat(201), '']) assert.throws(() => validateSlug(invalid));
  assert.equal(defaultSlug('content/posts/A Folder/X.Y_测试.md'), 'a-folder-x-y-测试');
  const record = { title: '标题', body: '正文', date: '2026-11-05', slug: 'Existing', tags: [], path: '' };
  assert.throws(() => validatePost({ ...record, body: ' \n ' }), /正文为空/);
  assert.throws(() => validatePost(record, [{ slug: 'existing', path: 'content/posts/other.md' }]), /已被/);
  assert.throws(() => parsePost('---\ntitle: x\ntitle: y\n---\ntext'), /YAML/);
  assert.throws(() => parsePost('---\n- a\n- b\n---\ntext'), /映射/);
});

test('settings form preserves unknown JSON and rejects malformed values', () => {
  const record = { configText: JSON.stringify({ name: '旧名', baseUrl: 'https://example.com', about: false, custom: { nested: ['保存'] } }), name: '新名', author: '作者', tagline: '短句', description: '介绍' };
  assert.deepEqual(JSON.parse(serializeSettings(record)), { name: '新名', baseUrl: 'https://example.com', about: false, custom: { nested: ['保存'] }, author: '作者', tagline: '短句', description: '介绍' });
  assert.throws(() => serializeSettings({ ...record, author: '' }), /完整填写/);
});

test('draft allow-list stores blobs and canonical paths without authentication or temporary URLs', () => {
  const blob = new Blob(['image'], { type: 'image/png' });
  const record = draftRecord({ id: 'draft', kind: 'post', body: '![图](/assets/uploads/uuid.png)', title: '标题', token: 'SENTINEL_CREDENTIAL', client: { token: 'SENTINEL_CREDENTIAL' }, auth: 'SENTINEL_CREDENTIAL', images: [{ path: 'assets/uploads/uuid.png', blob, url: 'blob:transient', token: 'SENTINEL_CREDENTIAL' }] });
  assert.doesNotMatch(JSON.stringify(record), /SENTINEL_CREDENTIAL|blob:transient/);
  assert.equal(record.images[0].blob, blob);
  const images = [{ path: 'assets/uploads/uuid.png', url: 'blob:temporary-id' }];
  const body = '![中文图](/assets/uploads/uuid.png)';
  assert.equal(canonicalBody(displayBody(body, images), images), body);
  const values = new Map(); const storage = { getItem: (key) => values.get(key), setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
  assert.equal(saveSession('LOCAL_TEST_ONLY', storage), true); assert.equal(readSession(storage), 'LOCAL_TEST_ONLY'); clearSession(storage); assert.equal(readSession(storage), '');
  assert.equal(saveSession('LOCAL_TEST_ONLY', { setItem() { throw new Error('blocked'); } }), false);
});

test('image staging accepts raster signatures, rejects disguised active content and oversize files', async () => {
  const png = new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0])], { type: 'image/png' });
  assert.equal((await prepareImage(png, 'fixed-id')).path, 'assets/uploads/fixed-id.png');
  for (const type of ['image/svg+xml', 'text/html', 'application/octet-stream']) await assert.rejects(prepareImage(new Blob(['<svg onload=alert(1)>'], { type })), /只接受/);
  await assert.rejects(prepareImage(new Blob(['<script>alert(1)</script>'], { type: 'image/png' })), /实际格式/);
  await assert.rejects(prepareImage(new Blob([new Uint8Array(10 * 1024 * 1024 + 1)], { type: 'image/png' })), /10 MB/);
});
