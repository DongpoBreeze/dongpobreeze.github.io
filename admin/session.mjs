const AUTH_KEY = 'dongpo-blog-editor-session';

// Resolve the browser getter inside try: privacy settings can throw before
// getItem is reached. This module has no editor or IndexedDB dependencies.
export function readSession(storage) {
  try { return (storage ?? globalThis.sessionStorage).getItem(AUTH_KEY) || ''; } catch { return ''; }
}
export function saveSession(token, storage) {
  try {
    const target = storage ?? globalThis.sessionStorage;
    target.setItem(AUTH_KEY, token);
    return target.getItem(AUTH_KEY) === token;
  } catch { return false; }
}
export function clearSession(storage) {
  try { (storage ?? globalThis.sessionStorage).removeItem(AUTH_KEY); } catch { /* memory is still cleared on exit */ }
}
export function sessionAvailable(storage) {
  const key = AUTH_KEY + '-probe';
  try {
    const target = storage ?? globalThis.sessionStorage;
    target.setItem(key, 'available');
    const available = target.getItem(key) === 'available';
    target.removeItem(key);
    return available;
  } catch { return false; }
}
