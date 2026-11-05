import { GitHubClient } from './github.mjs';
import { clearSession, readSession, saveSession, sessionAvailable } from './session.mjs';

export const EDITOR_PATH = '/admin/';
const reasons = Object.freeze({
  'session-expired': '上次作者登录已失效。请使用有效的 GitHub 专用令牌重新验证。',
  'verification-unavailable': '暂时无法向 GitHub 验证作者身份。请检查网络后重新验证。',
  'signed-out': '已退出写作室并清除登录令牌。再次验证后可以恢复本机草稿。'
});
export const STORAGE_MESSAGE = '此浏览器无法保存当前会话登录。请允许此站点使用会话存储，或换用普通浏览窗口，再重新验证。';
export class SessionStorageError extends Error {
  constructor() { super(STORAGE_MESSAGE); this.name = 'SessionStorageError'; }
}

export function authorPath(reason) { return '/author/' + (Object.hasOwn(reasons, reason) ? '?reason=' + reason : ''); }
export function authorReason(search) { return reasons[new URLSearchParams(search).get('reason')] || ''; }

const createDefaultClient = (token) => new GitHubClient(token);

export async function signInAuthor(token, { storage, createClient = createDefaultClient, isCurrent = () => true } = {}) {
  if (!sessionAvailable(storage)) throw new SessionStorageError();
  if (typeof token !== 'string' || !token.trim()) throw new Error('请粘贴作者账户的 GitHub 专用令牌。');
  const client = createClient(token.trim());
  try {
    const { login } = await client.connect();
    if (!isCurrent()) { client.clear(); return null; }
    if (!saveSession(token.trim(), storage)) throw new SessionStorageError();
    return { client, login };
  } catch (error) {
    client.clear();
    if (!isCurrent()) return null;
    clearSession(storage);
    throw error;
  }
}

export async function restoreAuthor({ storage, createClient = createDefaultClient, isCurrent = () => true } = {}) {
  const token = readSession(storage);
  if (!token) return null;
  const client = createClient(token);
  try {
    const { login } = await client.connect();
    if (!isCurrent()) { client.clear(); return null; }
    return { client, login };
  } catch (error) {
    client.clear();
    if (!isCurrent()) return null;
    clearSession(storage);
    throw error;
  }
}
