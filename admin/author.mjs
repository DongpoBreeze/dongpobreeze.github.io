import { authorReason, EDITOR_PATH, restoreAuthor, signInAuthor, STORAGE_MESSAGE } from './auth.mjs';
import { clearSession, readSession, sessionAvailable } from './session.mjs';
import { TOKEN_URL } from './github.mjs';

const $ = (id) => document.getElementById(id);
let pending = false;
let generation = 0;
let leaving = false;
let storageReady = false;

function setBusy(busy) {
  pending = busy;
  $('confirm-connect').disabled = busy || !storageReady;
  $('github-token').disabled = busy || !storageReady;
  $('confirm-connect').textContent = busy ? '正在验证…' : '验证并进入写作室';
}
function showError(message) { $('connection-error').textContent = message; $('connection-error').hidden = false; }
function checkStorage() {
  storageReady = sessionAvailable();
  $('storage-retry').hidden = storageReady;
  if (!storageReady) { showError(STORAGE_MESSAGE); $('gate-status').textContent = '请先允许浏览器保存会话登录。'; }
  setBusy(false);
  return storageReady;
}
async function authenticate({ restore = false } = {}) {
  if (pending || leaving || !checkStorage()) return;
  const attempt = ++generation;
  const isCurrent = () => attempt === generation && !leaving;
  $('connection-error').hidden = true;
  $('gate-status').textContent = restore ? '正在验证已有作者会话…' : '正在向 GitHub 验证作者身份…';
  setBusy(true);
  try {
    const auth = await (restore ? restoreAuthor({ isCurrent }) : signInAuthor($('github-token').value, { isCurrent }));
    if (!isCurrent()) return;
    if (!auth) { $('gate-status').textContent = '请输入作者令牌以进入写作室。'; return; }
    auth.client.clear();
    $('github-token').value = '';
    $('gate-status').textContent = '作者身份已验证，正在进入写作室…';
    leaving = true;
    window.location.replace(EDITOR_PATH);
  } catch (error) {
    if (!isCurrent()) return;
    clearSession();
    showError(error?.message || '验证暂未完成，请检查网络后重试。');
    $('gate-status').textContent = '验证未通过，请检查账户、令牌权限和网络后重试。';
    if (error?.name === 'SessionStorageError') checkStorage();
  } finally { if (isCurrent()) setBusy(false); }
}

$('token-link').href = TOKEN_URL;
$('gate-status').textContent = authorReason(window.location.search) || '博客对所有人开放；这里仅供作者验证并进入写作室。';
$('connect-form').addEventListener('submit', (event) => { event.preventDefault(); authenticate(); });
$('storage-retry').addEventListener('click', () => { $('connection-error').hidden = true; if (checkStorage()) { $('gate-status').textContent = '会话存储已可用，请验证作者身份。'; $('github-token').focus(); } });
window.addEventListener('pagehide', () => { leaving = true; generation += 1; $('github-token').value = ''; });
window.addEventListener('pageshow', (event) => { if (event.persisted) window.location.reload(); });
if (checkStorage() && readSession()) authenticate({ restore: true });
