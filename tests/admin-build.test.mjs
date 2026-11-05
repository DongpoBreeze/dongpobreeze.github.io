import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { buildAdmin } from '../scripts/build-admin.mjs';

test('build creates independent author login and editor pages with local assets, noindex and restrictive script policies', async (t) => {
  const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const outputDir = await mkdtemp(join(tmpdir(), 'blog-admin-build-')); t.after(() => rm(outputDir, { recursive: true, force: true }));
  await buildAdmin({ rootDir, outputDir });
  const html = await readFile(join(outputDir, 'admin/index.html'), 'utf8');
  const script = await readFile(join(outputDir, 'admin/editor.js'), 'utf8');
  const initial = JSON.parse(await readFile(join(outputDir, 'admin/initial.json'), 'utf8'));
  const authorHtml = await readFile(join(outputDir, 'author/index.html'), 'utf8');
  const authorScript = await readFile(join(outputDir, 'author/author.js'), 'utf8');
  const authorCss = await readFile(join(outputDir, 'author/styles.css'), 'utf8');
  assert.match(html, /noindex, nofollow, noarchive/);
  assert.match(html, /script-src 'self';/);
  assert.doesNotMatch(html, /unsafe-eval|<script[^>]*src="https?:/);
  assert.match(html, /connect-src 'self' https:\/\/api\.github\.com;/);
  assert.ok((await stat(join(outputDir, 'admin/editor.css'))).size > 10000);
  assert.ok(script.includes('所见即所得'), 'Chinese locale is bundled');
  assert.ok(script.includes('noopener noreferrer'), 'external links have safe attributes');
  assert.equal(typeof JSON.parse(initial.config).name, 'string');
  assert.match(initial.configSha, /^[a-f0-9]{40}$/);
  assert.equal(initial.token, undefined);
  assert.equal(initial.posts, undefined);
  assert.match(html, /id="workspace-shell" hidden inert/);
  assert.match(html, /id="auth-wait"/);
  assert.doesNotMatch(html, /id="author-gate"|id="github-token"|id="connect-form"|id="connection-dialog"/);
  assert.match(html, /id="disconnect-button"/);
  assert.match(authorHtml, /id="author-gate"/);
  assert.match(authorHtml, /id="github-token" type="password"/);
  assert.match(authorHtml, /id="confirm-connect"/);
  assert.doesNotMatch(authorHtml, /workspace-shell|draft-list|id="editor"|toastui|editor\.js|editor\.css/);
  assert.doesNotMatch(authorScript, /indexedDB|toastui|ProseMirror|DOMPurify|draftRecord/);
  assert.doesNotMatch(authorCss, /toastui/);
  assert.ok(Buffer.byteLength(authorScript) < 30000, 'author login is a small bundle without the rich text editor');
  assert.match(authorHtml, /noindex, nofollow, noarchive/);
  assert.match(authorHtml, /script-src 'self'; style-src 'self';/);
  assert.match(authorHtml, /connect-src https:\/\/api\.github\.com;/);
  assert.doesNotMatch(authorHtml, /unsafe-inline|unsafe-eval|<script[^>]*src="https?:/);
  for (const resource of authorHtml.matchAll(/(?:src|href)="(\/author\/[^\"]+)"/g)) {
    assert.ok((await stat(join(outputDir, resource[1]))).isFile(), 'author resource exists: ' + resource[1]);
  }
  assert.match(authorHtml, /href="\/" class="back-link">← 返回公开博客/);
});
