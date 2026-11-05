export const REPOSITORY = 'DongpoBreeze/dongpobreeze.github.io';
export const REPOSITORY_ID = 1444175077;
export const BRANCH = 'main';
export const ACTIONS_URL = 'https://github.com/' + REPOSITORY + '/actions';
export const TOKEN_URL = 'https://github.com/settings/personal-access-tokens/new?name=Personal+blog+editor&target_name=DongpoBreeze&expires_in=90&contents=write';

export class GitHubError extends Error {
  constructor(message, status = 0) { super(message); this.name = 'GitHubError'; this.status = status; }
}
export class ConflictError extends GitHubError {
  constructor(message = '仓库已有新改动，本次未覆盖。请保留本机草稿，重新载入远程版本后合并正文再发布。') { super(message, 409); this.name = 'ConflictError'; }
}

export function apiError(status, headers) {
  if (status === 401) return '令牌无效或已过期。请断开后使用新的 fine-grained 令牌连接。';
  if (status === 403) return headers?.get?.('x-ratelimit-remaining') === '0' ? 'GitHub 请求额度已用完，请稍后重试，本机草稿已保留。' : 'GitHub 拒绝访问。请检查令牌的 Contents 读写权限、到期时间，以及账户是否可写此仓库。';
  if (status === 404) return '找不到仓库或分支。请确认令牌只选中了 dongpobreeze.github.io，并拥有 Contents 读写权限。';
  if (status === 409 || status === 422) return '仓库状态发生冲突或提交未被接受，请刷新远程列表核对后重试，本机草稿已保留。';
  if (status === 429) return '请求过于频繁，请稍后重试。';
  return 'GitHub 暂时无法完成操作（HTTP ' + status + '），请稍后重试，本机草稿已保留。';
}

export function bytesToBase64(bytes) {
  let value = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) value += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(value);
}
export function decodeBase64Text(value) {
  return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(value.replace(/\s/g, '')), (char) => char.charCodeAt(0)));
}

export class GitHubClient {
  #token;
  #fetch;
  constructor(token, fetcher = globalThis.fetch.bind(globalThis)) { this.#token = token; this.#fetch = fetcher; }
  clear() { this.#token = ''; }
  async request(path, { method = 'GET', body } = {}) {
    if (!this.#token) throw new GitHubError('请先连接 GitHub。');
    if (!path.startsWith('/') || path.startsWith('//')) throw new Error('无效的 GitHub API 路径。');
    let response;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    try {
      response = await this.#fetch('https://api.github.com' + path, { method, headers: { Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + this.#token, 'X-GitHub-Api-Version': '2022-11-28', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error', signal: controller.signal });
    } catch {
      throw new GitHubError(method === 'PATCH' ? '网络中断，提交结果尚未确认。请刷新 GitHub 列表或查看 Actions 核对；本机草稿已保留。' : '无法连接 GitHub。请检查网络后重试；本机草稿已保留。');
    } finally { clearTimeout(timer); }
    if (!response.ok) throw new GitHubError(apiError(response.status, response.headers), response.status);
    if (response.status === 204) return null;
    try { return await response.json(); } catch { throw new GitHubError('GitHub 返回了无法读取的数据，请稍后重试。'); }
  }
  async connect() {
    const user = await this.request('/user');
    if (typeof user.login !== 'string' || user.login.toLocaleLowerCase('en-US') !== 'dongpobreeze') throw new GitHubError('这个写作室仅对作者 DongpoBreeze 开放。请使用作者账户创建的专用令牌验证。', 403);
    const repository = await this.request('/repos/' + REPOSITORY);
    if (repository.id !== REPOSITORY_ID || repository.permissions?.push !== true) throw new GitHubError('此账户没有目标仓库的写权限。请以 DongpoBreeze 账户创建令牌，并授权该仓库的 Contents 读写权限。', 403);
    return { login: user.login, repository };
  }
  async snapshot() {
    const ref = await this.request('/repos/' + REPOSITORY + '/git/ref/heads/' + BRANCH);
    const commit = await this.request('/repos/' + REPOSITORY + '/git/commits/' + ref.object.sha);
    const tree = await this.request('/repos/' + REPOSITORY + '/git/trees/' + commit.tree.sha + '?recursive=1');
    if (tree.truncated) throw new GitHubError('仓库目录过大，GitHub 未返回完整目录；为避免漏读，已停止操作。');
    return { head: ref.object.sha, tree: commit.tree.sha, files: new Map(tree.tree.filter((entry) => entry.type === 'blob').map((entry) => [entry.path, entry])) };
  }
  async readText(sha) {
    const blob = await this.request('/repos/' + REPOSITORY + '/git/blobs/' + encodeURIComponent(sha));
    if (blob.encoding !== 'base64') throw new GitHubError('暂不支持 GitHub 返回的文件编码。');
    return decodeBase64Text(blob.content);
  }
  async commitChanges(changes, message, { expectedHead } = {}) {
    if (!changes.length || new Set(changes.map((change) => change.path)).size !== changes.length) throw new Error('提交文件列表无效。');
    const latest = await this.snapshot();
    if (expectedHead && latest.head !== expectedHead) throw new ConflictError();
    for (const change of changes) {
      if (!/^(?:content\/posts\/.+\.[mM][dD]|content\/about\.md|blog\.config\.json|assets\/uploads\/[a-zA-Z0-9-]+\.(?:png|jpg|webp|gif|avif))$/.test(change.path) || change.path.split('/').some((part) => part === '..' || part === '.')) throw new Error('不允许写入此路径。');
      const actual = latest.files.get(change.path)?.sha ?? null;
      if (actual !== (change.expectedSha ?? null)) throw new ConflictError();
    }
    const entries = [];
    for (const change of changes) {
      let sha = null;
      if (change.content !== null) {
        const binary = typeof change.content !== 'string';
        const content = binary ? bytesToBase64(new Uint8Array(await change.content.arrayBuffer())) : change.content;
        const blob = await this.request('/repos/' + REPOSITORY + '/git/blobs', { method: 'POST', body: { content, encoding: binary ? 'base64' : 'utf-8' } });
        sha = blob.sha;
      }
      entries.push({ path: change.path, mode: '100644', type: 'blob', sha });
    }
    const tree = await this.request('/repos/' + REPOSITORY + '/git/trees', { method: 'POST', body: { base_tree: latest.tree, tree: entries } });
    const commit = await this.request('/repos/' + REPOSITORY + '/git/commits', { method: 'POST', body: { message, tree: tree.sha, parents: [latest.head] } });
    try { await this.request('/repos/' + REPOSITORY + '/git/refs/heads/' + BRANCH, { method: 'PATCH', body: { sha: commit.sha, force: false } }); }
    catch (error) { if ([409, 422].includes(error.status)) throw new ConflictError(); throw error; }
    return { commit: commit.sha, files: new Map(entries.map((entry) => [entry.path, entry.sha])) };
  }
}
