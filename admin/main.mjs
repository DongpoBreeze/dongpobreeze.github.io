import Editor from '@toast-ui/editor';
import '@toast-ui/editor/dist/i18n/zh-cn';
import '@toast-ui/editor/dist/toastui-editor.css';
import DOMPurify from 'dompurify';
import MarkdownIt from 'markdown-it';
import { canonicalBody, displayBody, draftRecord, parsePost, prepareImage, recordFromPost, serializePost, serializeSettings, validatePost } from './content.mjs';
import { ACTIONS_URL } from './github.mjs';
import { DraftStore } from './drafts.mjs';
import { clearSession, readSession } from './session.mjs';
import { authorPath, restoreAuthor } from './auth.mjs';

const $ = (id) => document.getElementById(id);
const store = new DraftStore();
const markdown = new MarkdownIt({ html: false, linkify: false });
const state = { current: null, client: null, login: '', posts: [], drafts: [], snapshot: null, initial: null, busy: false, suppress: false, revision: 0, savedRevision: 0, timer: null, saveQueue: Promise.resolve(), sourceOpen: false, sourceChanged: false, editorShadow: '', remoteLoaded: false, unpersisted: false, locked: true, navigation: 0, authGeneration: 0, exiting: false };
let editor;

function textNode(tag, content, className) { const node = document.createElement(tag); node.textContent = content; if (className) node.className = className; return node; }
function showNotice(message, error = false, actions = false) {
  if (state.locked) { $('auth-status').textContent = message; return; }
  const notice = $('notice');
  notice.replaceChildren(textNode('span', message)); notice.classList.toggle('error', error); notice.hidden = false;
  if (actions) { const link = textNode('a', '查看 GitHub Actions ↗'); link.href = ACTIONS_URL; link.target = '_blank'; link.rel = 'noopener noreferrer'; notice.append(link); }
}
function saveStatus(message, failed = false) { $('save-status').textContent = message; $('save-status').classList.toggle('failed', failed); }
function errorMessage(error) { return error?.message || '操作未完成，请重试。正文仍保留在此页面。'; }
function today() { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
function newPost() { return { id: crypto.randomUUID(), kind: 'post', path: '', baseSha: null, frontMatter: '', body: '', title: '', date: today(), description: '', tags: [], slug: '', explicitSlug: true, remoteDraft: false, images: [] }; }
function isMeaningful(record) { return record.kind !== 'post' || Boolean(record.title?.trim() || record.body?.trim() || record.images?.length || record.description?.trim() || record.pendingSource?.trim() || record.tags?.length || record.slug); }
function setBusy(busy) {
  state.busy = busy;
  $('editing-view').inert = busy; $('settings-view').inert = busy; document.querySelector('.sidebar').inert = busy;
  for (const id of ['publish-button', 'withdraw-button', 'delete-remote', 'disconnect-button', 'new-post', 'edit-about', 'edit-settings', 'refresh-posts', 'import-button']) $(id).disabled = busy;
  $('publish-button').textContent = busy ? '正在提交…' : state.current?.kind === 'settings' ? '发布站点资料' : state.current?.kind === 'about' ? '发布关于我' : state.current?.path && !state.current.remoteDraft ? '更新文章' : '发布文章';
}
function changed() {
  if (state.suppress || state.locked || state.exiting || !state.current) return;
  state.revision += 1; state.unpersisted = true;
  saveStatus('尚未保存…');
  clearTimeout(state.timer);
  state.timer = setTimeout(() => { saveCurrent().catch((error) => { saveStatus('本机保存失败，请导出备份', true); showNotice(errorMessage(error), true); }); }, 900);
}
function ensureSlug(record) { if (record.kind === 'post' && !record.slug) record.slug = 'post-' + record.date.replace(/-/g, '') + '-' + record.id.slice(0, 8); }
async function saveCurrent({ quiet = false } = {}) {
  clearTimeout(state.timer);
  if (state.locked || state.exiting || !state.current || !isMeaningful(state.current)) return true;
  const record = draftRecord(state.current);
  const revision = state.revision;
  state.saveQueue = state.saveQueue.catch(() => {}).then(() => store.save(record));
  await state.saveQueue;
  if (state.current?.id === record.id && state.revision === revision) { state.savedRevision = revision; state.unpersisted = false; saveStatus((record.pendingSource !== undefined ? '原文已存本机 · 尚未应用' : '已保存到本机') + ' · ' + new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })); }
  if (!quiet) await refreshDrafts();
  return true;
}
async function beforeSwitch() {
  if (state.busy || state.locked) return false;
  try { do { await saveCurrent(); } while (state.unpersisted && isMeaningful(state.current)); return true; } catch (error) { showNotice(errorMessage(error), true); return false; }
}
function releaseImages(record) { for (const image of record?.images || []) if (image.url) URL.revokeObjectURL(image.url); }
function hydrate(record) { record.images = (record.images || []).map((image) => ({ ...image, url: URL.createObjectURL(image.blob) })); return record; }
function syncEditor() {
  state.suppress = true;
  try { editor.setMarkdown(displayBody(state.current.body, state.current.images), false); state.editorShadow = editor.getMarkdown(); }
  finally { state.suppress = false; }
}
function updateCount() { $('word-count').textContent = (state.current?.body || '').replace(/\s/g, '').length.toLocaleString('zh-CN') + ' 字符'; }
async function loadRecord(record, { skipSave = false, navigation = ++state.navigation } = {}) {
  if (state.locked || navigation !== state.navigation) return;
  if (!skipSave && !(await beforeSwitch())) return;
  if (navigation !== state.navigation || state.locked) return;
  releaseImages(state.current);
  state.current = hydrate(record); state.revision = 0; state.savedRevision = 0; state.unpersisted = false;
  state.sourceOpen = record.pendingSource !== undefined; state.sourceChanged = state.sourceOpen; $('source-panel').hidden = !state.sourceOpen; $('editor').hidden = state.sourceOpen;
  $('source-text').value = record.pendingSource || '';
  renderCurrent();
  saveStatus(record.updatedAt ? '已恢复本机草稿 · ' + new Date(record.updatedAt).toLocaleString('zh-CN') : record.path ? '已载入远程版本' : '准备就绪');
  $('notice').hidden = true;
  renderDraftList(); renderPostList();
}
function renderCurrent() {
  const record = state.current;
  const settings = record.kind === 'settings';
  const post = record.kind === 'post';
  $('settings-view').hidden = !settings; $('editing-view').hidden = settings;
  $('metadata').hidden = !post; $('document-title').hidden = !post;
  $('writing-hint').textContent = post ? '在这里写下正文。选中文字即可排版，也可以拖入或粘贴图片。' : '向读者介绍自己。支持排版、图片和链接，发布后显示在“关于我”页面。';
  $('source-button').textContent = post ? '完整 Markdown 原文' : 'Markdown 原文';
  $('document-kind').textContent = settings ? '站点资料' : record.kind === 'about' ? '关于我' : record.path ? record.remoteDraft ? '仓库草稿 / 已撤下' : '已发布文章' : '新的文章';
  $('preview-button').hidden = settings;
  if (settings) { for (const key of ['name', 'author', 'tagline', 'description']) $('site-' + key).value = record[key] || ''; }
  else {
    $('document-title').value = record.title || ''; $('post-date').value = record.date || today(); $('post-tags').value = (record.tags || []).join(', '); $('post-description').value = record.description || '';
    $('post-slug').value = record.slug || ''; $('post-slug').readOnly = Boolean(record.path);
    $('slug-help').textContent = record.path ? '现有文章地址固定：/posts/' + record.slug + '/' : '第一次发布后固定，避免旧链接失效。新文章留空时自动生成。';
    $('remote-actions').hidden = !post || !record.path;
    $('withdraw-button').hidden = record.remoteDraft;
    $('view-post').hidden = record.remoteDraft;
    $('view-post').href = '/posts/' + encodeURIComponent(record.slug || '') + '/';
    syncEditor(); updateCount();
  }
  setBusy(state.busy);
}
async function refreshDrafts() {
  const generation = state.authGeneration;
  if (state.locked || state.exiting) return;
  const drafts = await store.all();
  if (state.locked || state.exiting || generation !== state.authGeneration) return;
  state.drafts = drafts.sort((a, b) => b.updatedAt - a.updatedAt);
  renderDraftList();
}
function renderDraftList() {
  $('draft-count').textContent = state.drafts.length;
  const list = $('draft-list'); list.replaceChildren();
  if (!state.drafts.length) { list.append(textNode('li', '还没有本机草稿', 'empty')); return; }
  for (const record of state.drafts) {
    const li = document.createElement('li'); const button = document.createElement('button'); button.className = 'item local-item'; button.classList.toggle('active', state.current?.id === record.id);
    button.append(textNode('span', record.kind === 'settings' ? '站点资料' : record.kind === 'about' ? '关于我' : record.title || '未命名文章', 'item-title'), textNode('small', new Date(record.updatedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) + (record.images.length ? ' · ' + record.images.length + ' 张本机图片' : '')));
    button.addEventListener('click', () => run(async () => { if (state.busy || state.current?.id === record.id) return; const navigation = ++state.navigation; const latest = await store.get(record.id); if (!latest) throw new Error('此本机草稿已被删除，请刷新列表。'); await loadRecord(latest, { navigation }); }));
    const remove = textNode('button', '×', 'delete-local'); remove.title = '删除本机草稿'; remove.setAttribute('aria-label', '删除本机草稿：' + (record.title || record.kind));
    remove.addEventListener('click', () => run(async () => {
      if (state.busy) return;
      if (!(await confirmAction('删除本机草稿？', '将删除此浏览器中的正文和待上传图片。此操作无法撤销，不影响仓库文章。', '删除本机草稿', true))) return;
      if (state.current?.id === record.id) { clearTimeout(state.timer); await state.saveQueue.catch(() => {}); await store.remove(record.id); await loadRecord(newPost(), { skipSave: true }); }
      else await store.remove(record.id);
      await refreshDrafts();
    }));
    li.append(button, remove); list.append(li);
  }
}
function renderPostList() {
  const list = $('post-list'); list.replaceChildren();
  const filter = $('post-filter').value.trim().toLocaleLowerCase();
  const posts = state.posts.filter((post) => post.title.toLocaleLowerCase().includes(filter));
  if (state.remoteLoaded && !posts.length) { list.append(textNode('li', filter ? '没有匹配的文章' : '仓库还没有文章，开始写第一篇吧。', 'empty')); return; }
  for (const post of posts) {
    const li = document.createElement('li'); const button = document.createElement('button'); button.className = 'item'; button.classList.toggle('active', state.current?.path === post.path);
    button.append(textNode('span', post.title || post.path, 'item-title'), textNode('small', post.error ? '格式待修正 · 请在 GitHub 检查' : (post.remoteDraft ? '已撤下 / 仓库草稿' : '已发布') + ' · ' + post.date));
    button.addEventListener('click', () => run(async () => {
      if (state.busy || state.current?.path === post.path) return;
      if (post.error) throw new Error(post.path + '：' + post.error);
      const navigation = ++state.navigation;
      const local = await store.get(post.path);
      if (local) { await loadRecord(local, { navigation }); if (navigation === state.navigation) showNotice('已恢复此文章的本机草稿。发布时会核对远程版本，避免覆盖更新。'); }
      else await loadRecord(recordFromPost(post.source, post.path, post.baseSha), { navigation });
    }));
    li.append(button); list.append(li);
  }
}
async function loadRemote({ notify = false } = {}) {
  if (!state.client) throw new Error('请先连接 GitHub，即可读取最新仓库文章。');
  const client = state.client;
  $('refresh-posts').disabled = true; $('remote-note').textContent = '正在从 GitHub 读取最新内容…';
  try {
    const snapshot = await client.snapshot();
    const files = [...snapshot.files.values()].filter((file) => file.path.startsWith('content/posts/') && /\.md$/i.test(file.path) && !file.path.split('/').some((part) => part.startsWith('.') || /^readme\.md$/i.test(part)));
    const posts = [];
    // Limit concurrent API reads so larger libraries remain within GitHub limits.
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(4, files.length) }, async () => {
      while (cursor < files.length) {
        const file = files[cursor++];
        const source = await client.readText(file.sha);
        try { posts.push({ ...recordFromPost(source, file.path, file.sha), source }); }
        catch (error) { posts.push({ path: file.path, title: file.path.split('/').pop(), error: errorMessage(error), baseSha: file.sha }); }
      }
    }));
    if (state.client !== client || state.locked) return;
    state.snapshot = snapshot; state.posts = posts.sort((a, b) => (b.date || '').localeCompare(a.date || '') || a.title.localeCompare(b.title, 'zh-CN')); state.remoteLoaded = true;
    $('post-count').textContent = posts.length; $('post-filter').hidden = posts.length < 5;
    $('remote-note').textContent = '来自 main 分支 · 含已撤下和 draft:true 的文章。'; renderPostList();
    if (notify) showNotice('已读取 GitHub 最新文章。本机正在编辑的正文已保留。');
  } catch (error) { $('remote-note').textContent = '远程读取失败，请重试；本机草稿可继续编辑。'; throw error; }
  finally { $('refresh-posts').disabled = state.busy; }
}

function sanitize(html) {
  // DOMPurify rejects blob: by default. Substitute only this document's known,
  // raster-validated blobs while sanitizing, then restore only IMG sources.
  const template = document.createElement('template'); template.innerHTML = html;
  const known = new Set((state.current?.images || []).map((image) => image.url));
  const replacements = new Map();
  for (const image of template.content.querySelectorAll('img')) {
    const source = image.getAttribute('src');
    if (known.has(source)) { const marker = '/admin/local-image-' + crypto.randomUUID(); replacements.set(marker, source); image.setAttribute('src', marker); }
  }
  const safe = DOMPurify.sanitize(template.innerHTML, { USE_PROFILES: { html: true }, FORBID_TAGS: ['style', 'form', 'input', 'button', 'textarea', 'select', 'video', 'audio', 'source', 'iframe', 'object', 'embed'], FORBID_ATTR: ['style', 'srcset'], ALLOW_DATA_ATTR: false });
  template.innerHTML = safe;
  for (const image of template.content.querySelectorAll('img')) if (replacements.has(image.getAttribute('src'))) image.setAttribute('src', replacements.get(image.getAttribute('src')));
  for (const anchor of template.content.querySelectorAll('a')) { anchor.target = '_blank'; anchor.rel = 'noopener noreferrer'; }
  return template.innerHTML;
}
function openPreview() {
  if (state.sourceOpen && state.sourceChanged) throw new Error('请先应用 Markdown 原文修改，再预览。');
  const record = state.current;
  $('preview-title').textContent = record.kind === 'about' ? '关于我' : record.title || '未命名文章';
  $('preview-meta').textContent = record.kind === 'post' ? [record.date, record.tags.join(' · ')].filter(Boolean).join('　/　') : '';
  $('preview-content').innerHTML = sanitize(markdown.render(displayBody(record.body, record.images)));
  $('preview-dialog').showModal();
}
function confirmAction(title, message, action, danger = false) {
  return new Promise((resolve) => {
    const dialog = $('confirm-dialog'); $('confirm-title').textContent = title; $('confirm-message').textContent = message; $('confirm-action').textContent = action; $('confirm-action').classList.toggle('danger', danger);
    let accepted = false;
    $('confirm-action').onclick = () => { accepted = true; dialog.close(); };
    $('confirm-cancel').onclick = () => dialog.close();
    dialog.addEventListener('close', () => resolve(accepted), { once: true }); dialog.showModal(); $('confirm-cancel').focus();
  });
}
async function addImage(blob, callback) {
  const record = state.current;
  if (!record || record.kind === 'settings' || state.busy) return;
  try {
    const image = await prepareImage(blob);
    if (state.current !== record) throw new Error('当前文档已切换，请重新插入图片。');
    image.url = URL.createObjectURL(blob); record.images.push(image);
    if (callback) callback(image.url, blob.name?.replace(/\.[^.]+$/, '') || '图片');
    else editor.exec('addImage', { imageUrl: image.url, altText: blob.name?.replace(/\.[^.]+$/, '') || '图片' });
    // Hooks may schedule the ProseMirror update; image blob is retained immediately.
    changed(); await saveCurrent();
  } catch (error) { showNotice(errorMessage(error), true); }
}
function openSource() {
  if (state.sourceOpen) return;
  ensureSlug(state.current);
  $('source-text').value = state.current.kind === 'post' ? serializePost(state.current, { draft: state.current.remoteDraft }) : state.current.body;
  state.sourceOpen = true; state.sourceChanged = false; $('source-panel').hidden = false; $('editor').hidden = true; $('source-text').focus();
}
function closeSource() { state.sourceOpen = false; state.sourceChanged = false; $('source-panel').hidden = true; $('editor').hidden = false; }
function applySource() {
  const record = state.current;
  if (record.kind === 'post') {
    const replacement = recordFromPost($('source-text').value, record.path, record.baseSha, record.id);
    if (record.path && replacement.slug !== record.slug) throw new Error('已有文章的地址不能更改。请保留原 slug 字段和值，以免旧链接失效。');
    Object.assign(record, replacement, { images: record.images, remoteDraft: record.remoteDraft, slug: record.path ? record.slug : replacement.slug });
  } else record.body = $('source-text').value;
  delete record.pendingSource;
  closeSource(); renderCurrent(); changed();
}
async function exportMarkdown() {
  if (state.current.kind === 'settings') {
    download('blog.config.json', new Blob([serializeSettings(state.current)], { type: 'application/json;charset=utf-8' })); return;
  }
  ensureSlug(state.current);
  const source = state.sourceOpen ? $('source-text').value : state.current.kind === 'post' ? serializePost(state.current, { draft: state.current.remoteDraft }) : state.current.body;
  download(state.current.kind === 'about' ? 'about.md' : state.current.slug + '.md', new Blob([source], { type: 'text/markdown;charset=utf-8' }));
  if (state.current.images?.length) showNotice('Markdown 已导出。尚未发布的图片保留在本机草稿中；请保留原图片文件，Markdown 文件本身不包含图片。');
}
function download(name, blob) { const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 30000); }
async function importMarkdown(file) {
  if (!file || state.busy) return;
  if (file.size > 5 * 1024 * 1024) throw new Error('Markdown 文件最多 5 MB。');
  const source = await file.text();
  if (!(await beforeSwitch())) return;
  let record = newPost();
  if (source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').replace(/^(?:[ \t]*\n)+(?=---\n)/, '').startsWith('---\n')) { const parsed = recordFromPost(source, '', null, record.id); record = { ...record, ...parsed, path: '', explicitSlug: Boolean(parsed.slug) }; }
  else { record.body = source; record.title = file.name.replace(/\.(?:md|markdown)$/i, ''); }
  await loadRecord(record, { skipSave: true }); changed();
}

async function loadSpecial(kind) {
  const navigation = ++state.navigation;
  if (!(await beforeSwitch())) return;
  const id = kind === 'about' ? 'content/about.md' : 'blog.config.json';
  const local = await store.get(id);
  if (local) { await loadRecord(local, { navigation }); return; }
  let source, sha;
  if (state.client) {
    const snapshot = await state.client.snapshot(); const file = snapshot.files.get(id); sha = file?.sha || null;
    source = file ? await state.client.readText(file.sha) : kind === 'about' ? '' : '{}';
  } else {
    if (!state.initial) throw new Error('站点初始资料尚未载入，请检查网络或先连接 GitHub。');
    source = kind === 'about' ? state.initial.about : state.initial.config; sha = kind === 'about' ? state.initial.aboutSha : state.initial.configSha;
  }
  let record;
  if (kind === 'about') record = { id, kind, path: id, baseSha: sha, body: source, images: [] };
  else { const config = JSON.parse(source); if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('站点配置不是有效 JSON 对象。'); record = { id, kind, path: id, baseSha: sha, configText: source, name: config.name || '', author: config.author || '', tagline: config.tagline || '', description: config.description || '', images: [] }; }
  await loadRecord(record, { navigation });
  if (!state.client) showNotice('正在编辑当前网站的资料快照；连接后发布会检查远程版本。');
}

async function publish({ withdraw = false } = {}) {
  if (state.busy || state.locked) return;
  if (state.sourceOpen && state.sourceChanged) throw new Error('请先应用或取消 Markdown 原文修改。');
  const record = state.current;
  ensureSlug(record);
  if (record.kind === 'post') validatePost(record, state.posts.filter((post) => !post.remoteDraft));
  if (record.kind === 'about' && !record.body.trim()) throw new Error('关于我正文为空，请先写些内容。');
  if (record.kind === 'settings') serializeSettings(record);
  if (!state.client) throw new Error('作者会话不可用，请先保存草稿，再退出并重新验证。');
  if (withdraw && !(await confirmAction('撤下这篇文章？', '将把仓库文章标记为 draft:true。部署成功后，文章将不再公开；源文件和本机草稿会保留，之后可重新发布。', '撤下文章', true))) return;
  setBusy(true);
  try {
    await saveCurrent();
    // Validate routes against the latest complete repository snapshot, then
    // require the same head in the transaction to avoid a duplicate-route race.
    if (record.kind === 'post') { await loadRemote(); validatePost(record, state.posts.filter((post) => !post.remoteDraft)); }
    const revision = state.revision;
    const snapshotRecord = { ...record, images: [...record.images] };
    const path = record.kind === 'post' ? record.path || 'content/posts/' + record.slug + '.md' : record.path;
    const body = record.kind === 'post' ? serializePost(snapshotRecord, { draft: withdraw }) : record.kind === 'settings' ? serializeSettings(record) : record.body;
    const images = record.images.filter((image) => !image.uploadedSha && body.includes('/' + image.path));
    const changes = [...images.map((image) => ({ path: image.path, expectedSha: null, content: image.blob })), { path, expectedSha: record.baseSha, content: body }];
    const result = await state.client.commitChanges(changes, (withdraw ? 'Withdraw ' : record.path && record.baseSha ? 'Update ' : 'Publish ') + (record.kind === 'post' ? record.title.trim().slice(0, 120) : record.kind === 'about' ? 'about page' : 'site profile'), { expectedHead: record.kind === 'post' ? state.snapshot.head : undefined });
    record.path = path; record.baseSha = result.files.get(path); record.remoteDraft = withdraw;
    if (record.kind === 'post') { const parsed = parsePost(body, path); record.frontMatter = parsed.frontMatter; record.explicitSlug = parsed.data.slug !== undefined; }
    const oldId = record.id; record.id = path;
    // Only files included in the atomic commit become published images.
    for (const image of images) image.uploadedSha = result.files.get(image.path);
    // Draft always remains recoverable, including changes made while the API was running.
    state.revision += 1; state.unpersisted = true;
    let draftWarning = '';
    try { await saveCurrent(); if (oldId !== record.id) await store.remove(oldId); await refreshDrafts(); } catch (error) { draftWarning = ' 本机草稿保存失败，请立即导出备份。'; saveStatus('发布已提交，本机保存失败', true); }
    if (state.revision === revision + 1) renderCurrent();
    showNotice((withdraw ? '撤下已提交 GitHub，正在部署。' : '已提交 GitHub，正在部署。') + '网站会在 Actions 成功后更新；此处尚未确认网站已更新。' + draftWarning, false, true);
    try { await loadRemote(); } catch { /* Commit succeeded; list refresh must not report a failed publish. */ }
  } finally { setBusy(false); }
}
async function deleteRemote() {
  if (state.busy || !state.current.path || state.current.kind !== 'post') return;
  if (!state.client) throw new Error('作者会话不可用，请先保存草稿，再退出并重新验证。');
  if (!(await confirmAction('永久删除仓库文章？', '将从 GitHub main 分支删除“' + state.current.title + '”的 Markdown 文件，部署后公开链接会失效。此操作保留本机草稿和已上传图片。确定要删除吗？', '删除仓库文章', true))) return;
  setBusy(true);
  try {
    await saveCurrent();
    const record = state.current;
    await state.client.commitChanges([{ path: record.path, expectedSha: record.baseSha, content: null }], 'Delete post: ' + record.title.slice(0, 120));
    const oldId = record.id; record.id = crypto.randomUUID(); record.path = ''; record.baseSha = null; record.explicitSlug = true; record.remoteDraft = false;
    changed();
    try { await saveCurrent(); await store.remove(oldId); await refreshDrafts(); } catch { saveStatus('仓库已删除，本机保存失败', true); }
    renderCurrent(); showNotice('删除已提交 GitHub，正在部署。正文仍保留在当前页面和本机草稿中。', false, true);
    try { await loadRemote(); } catch { /* Successful deletion is already recorded. */ }
  } finally { setBusy(false); }
}

async function disconnect() {
  if (state.busy || state.locked || state.exiting) return;
  setBusy(true);
  try { await saveCurrent(); }
  catch (error) {
    if (!(await confirmAction('本机草稿尚未保存', errorMessage(error) + '\n继续退出会清除此页面中的未保存内容。建议先取消，导出 Markdown 并另存原图片。', '仍然退出', true))) { setBusy(false); return; }
  }
  state.exiting = true;
  state.client?.clear(); state.client = null; state.login = ''; clearSession();
  lockWorkspace();
  window.location.replace(authorPath('signed-out'));
}
function lockWorkspace() {
  state.locked = true; state.navigation += 1; state.authGeneration += 1; clearTimeout(state.timer); releaseImages(state.current);
  editor?.destroy(); editor = null; $('editor').replaceChildren(); store.close();
  state.current = null; state.drafts = []; state.posts = []; state.snapshot = null; state.initial = null; state.editorShadow = ''; state.sourceOpen = false; state.sourceChanged = false; state.unpersisted = false; state.remoteLoaded = false; state.busy = false;
  $('workspace-shell').hidden = true; $('workspace-shell').inert = true; $('auth-wait').hidden = false; $('author-session').hidden = true; $('connection-label').textContent = '';
  $('auth-status').textContent = '正在离开写作室…';
  for (const input of document.querySelectorAll('#workspace-shell input, #workspace-shell textarea')) input.value = '';
  $('draft-list').replaceChildren(); $('post-list').replaceChildren(); $('preview-content').replaceChildren(); $('preview-title').textContent = ''; $('preview-meta').textContent = '';
  $('post-count').textContent = '—'; $('draft-count').textContent = '0'; $('post-filter').hidden = true; $('notice').replaceChildren(); $('notice').hidden = true;
  for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
  document.querySelector('.skip').href = '#auth-status'; document.querySelector('.skip').textContent = '跳到验证状态';
}
async function unlockWorkspace() {
  if (state.exiting || !state.client) return;
  const generation = state.authGeneration;
  state.locked = false; $('auth-wait').hidden = true; $('workspace-shell').hidden = false; $('workspace-shell').inert = false; $('author-session').hidden = false;
  createEditor(); await loadRecord(newPost(), { skipSave: true });
  document.querySelector('.skip').href = '#document-title'; document.querySelector('.skip').textContent = '跳到编辑区';
  if (matchMedia('(max-width: 720px)').matches) document.querySelector('.library').open = false;
  try { await store.open(); await refreshDrafts(); if (state.drafts.length) showNotice('本机保存了 ' + state.drafts.length + ' 份草稿。点击左侧草稿即可继续写作。'); }
  catch (error) { showNotice(errorMessage(error), true); }
  try {
    const response = await fetch('./initial.json', { credentials: 'omit', cache: 'no-store' });
    if (response.ok) { const initial = await response.json(); if (!state.locked && !state.exiting && generation === state.authGeneration) state.initial = initial; }
  } catch { /* GitHub reads remain available. */ }
}
function run(operation) { Promise.resolve().then(operation).catch((error) => showNotice(errorMessage(error), true)); }

function bindEvents() {
  for (const button of document.querySelectorAll('[data-close]')) button.addEventListener('click', () => $(button.dataset.close).close());
  $('new-post').addEventListener('click', () => run(() => loadRecord(newPost())));
  $('edit-about').addEventListener('click', () => run(() => loadSpecial('about')));
  $('edit-settings').addEventListener('click', () => run(() => loadSpecial('settings')));
  $('disconnect-button').addEventListener('click', () => run(disconnect));
  $('refresh-posts').addEventListener('click', () => run(() => loadRemote({ notify: true })));
  $('refresh-drafts').addEventListener('click', () => run(refreshDrafts));
  $('post-filter').addEventListener('input', renderPostList);
  $('save-button').addEventListener('click', () => run(async () => { await saveCurrent(); if (!isMeaningful(state.current)) saveStatus('先写一点内容，再保存草稿'); }));
  $('preview-button').addEventListener('click', () => run(openPreview));
  $('publish-button').addEventListener('click', () => run(publish));
  $('withdraw-button').addEventListener('click', () => run(() => publish({ withdraw: true })));
  $('delete-remote').addEventListener('click', () => run(deleteRemote));
  const postFields = { 'document-title': 'title', 'post-date': 'date', 'post-description': 'description', 'post-slug': 'slug' };
  for (const [id, key] of Object.entries(postFields)) $(id).addEventListener('input', () => { state.current[key] = $(id).value; changed(); });
  $('post-tags').addEventListener('input', () => { state.current.tags = [...new Set($('post-tags').value.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean))]; changed(); });
  for (const key of ['name', 'author', 'tagline', 'description']) $('site-' + key).addEventListener('input', () => { state.current[key] = $('site-' + key).value; changed(); });
  $('source-button').addEventListener('click', () => run(openSource));
  $('source-text').addEventListener('input', () => { state.sourceChanged = true; state.current.pendingSource = $('source-text').value; changed(); saveStatus('原文修改尚未应用'); });
  $('apply-source').addEventListener('click', () => run(applySource));
  $('cancel-source').addEventListener('click', () => { const pending = state.current.pendingSource !== undefined; delete state.current.pendingSource; closeSource(); if (pending) changed(); else saveStatus('原文修改已取消'); });
  $('export-button').addEventListener('click', () => run(exportMarkdown));
  $('import-button').addEventListener('click', () => $('import-file').click());
  $('import-file').addEventListener('change', () => run(async () => { try { await importMarkdown($('import-file').files[0]); } finally { $('import-file').value = ''; } }));
  $('insert-image').addEventListener('click', () => $('image-file').click());
  $('image-file').addEventListener('change', () => run(async () => { try { for (const file of $('image-file').files) await addImage(file); } finally { $('image-file').value = ''; } }));
  window.addEventListener('beforeunload', (event) => { if (!state.exiting && (state.unpersisted || state.busy)) { event.preventDefault(); event.returnValue = ''; } });
  window.addEventListener('pagehide', () => { state.exiting = true; state.client?.clear(); state.client = null; lockWorkspace(); });
  window.addEventListener('pageshow', (event) => { if (event.persisted) window.location.reload(); });
  document.addEventListener('visibilitychange', () => { if (!state.locked && document.visibilityState === 'hidden' && state.unpersisted) saveCurrent({ quiet: true }).catch(() => {}); });
  document.addEventListener('keydown', (event) => { if (!state.locked && (event.ctrlKey || event.metaKey) && event.key === 's') { event.preventDefault(); run(saveCurrent); } });
}

function createEditor() {
  // Never send editor analytics. The entire editor and sanitizer are bundled locally.
  editor = new Editor({ el: $('editor'), height: '560px', minHeight: '420px', initialEditType: 'wysiwyg', previewStyle: 'tab', language: 'zh-CN', placeholder: '写下你的第一句话……', usageStatistics: false, autofocus: false, linkAttributes: { target: '_blank', rel: 'noopener noreferrer' }, customHTMLSanitizer: sanitize, toolbarItems: [['heading', 'bold', 'italic', 'strike'], ['hr', 'quote'], ['ul', 'ol', 'task'], ['table', 'image', 'link'], ['code', 'codeblock']], hooks: { addImageBlobHook: (blob, callback) => { addImage(blob, callback); return false; } }, events: { change: () => {
    if (state.suppress || state.locked || state.exiting || !state.current || state.current.kind === 'settings') return;
    const value = editor.getMarkdown();
    if (value === state.editorShadow) return;
    state.editorShadow = value; state.current.body = canonicalBody(value, state.current.images); updateCount(); changed();
  } } });
}
async function init() {
  bindEvents();
  if (!readSession()) { window.location.replace(authorPath()); return; }
  const generation = ++state.authGeneration;
  const isCurrent = () => generation === state.authGeneration && !state.exiting;
  let auth;
  try { auth = await restoreAuthor({ isCurrent }); }
  catch (error) {
    if (!isCurrent()) return;
    clearSession(); window.location.replace(authorPath(error?.status === 0 || !error?.status ? 'verification-unavailable' : 'session-expired')); return;
  }
  if (!isCurrent()) { auth?.client.clear(); return; }
  if (!auth) { window.location.replace(authorPath()); return; }
  state.client = auth.client; state.login = auth.login; $('connection-label').textContent = auth.login + ' · 作者';
  await unlockWorkspace();
  if (!isCurrent() || state.locked) return;
  try { await loadRemote(); } catch (error) { if (isCurrent()) showNotice(errorMessage(error), true); }
}
init().catch((error) => { if (state.exiting) return; showNotice('写作室启动未完成：' + errorMessage(error), true); saveStatus('启动异常，请刷新', true); });
