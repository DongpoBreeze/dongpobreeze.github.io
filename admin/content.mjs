import { parseDocument } from 'yaml';

export const POST_ROOT = 'content/posts/';
const reserved = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
export const byteLength = (value) => new TextEncoder().encode(value).length;

export function isRealDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return year > 0 && date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function validateSlug(slug) {
  if (typeof slug !== 'string' || !/^[\p{L}\p{N}][\p{L}\p{N}_-]*$/u.test(slug) || reserved.test(slug) || byteLength(slug) > 200) {
    throw new Error('文章地址须以字母或数字开头，只能包含字母、数字、横线和下划线，最多 200 个 UTF-8 字节，且不能使用 Windows 保留名。');
  }
  return slug;
}

export function defaultSlug(path) {
  return path.replace(/^content\/posts\//, '').replace(/\.md$/i, '').normalize('NFC').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').toLocaleLowerCase('en-US');
}

export function parsePost(source, path = '') {
  const normalized = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').replace(/^(?:[ \t]*\n)+(?=---\n)/, '');
  if (!normalized.startsWith('---\n')) throw new Error('文章需要以 --- 开始的 YAML 资料区。导入普通 Markdown 时可选择仅导入正文。');
  const closing = /^---[ \t]*$/gm;
  closing.lastIndex = 4;
  const end = closing.exec(normalized);
  if (!end) throw new Error('YAML 资料区缺少结尾的 ---。');
  const frontMatter = normalized.slice(4, end.index);
  const doc = parseDocument(frontMatter, { uniqueKeys: true });
  if (doc.errors.length) throw new Error('YAML 格式有误：' + doc.errors[0].message);
  const data = doc.toJS({ maxAliasCount: 50 });
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('YAML 资料区须为键值映射。');
  return { frontMatter, body: normalized.slice(end.index + end[0].length).replace(/^\n/, ''), data, slug: typeof data.slug === 'string' ? data.slug.trim().normalize('NFC') : data.slug ?? defaultSlug(path), path };
}

export function serializePost(record, { draft = false } = {}) {
  const doc = parseDocument(record.frontMatter || '{}', { uniqueKeys: true });
  if (doc.errors.length) throw new Error('YAML 资料区有误，请检查 Markdown 原文。');
  for (const [key, value] of Object.entries({ title: record.title.trim(), date: record.date, description: record.description || '', tags: record.tags || [], draft })) {
    const previous = doc.get(key, true);
    const current = doc.createNode(value);
    // Map.set may retain a raw JS array rather than a YAMLSeq; create a node
    // explicitly so anchors still resolve when unknown fields reference it.
    for (const property of ['anchor', 'comment', 'commentBefore', 'spaceBefore', 'type', 'flow']) if (previous?.[property] !== undefined) current[property] = previous[property];
    doc.set(key, current);
  }
  // Existing implicit slugs remain implicit; file paths never change on update.
  if (record.explicitSlug || !record.path) doc.set('slug', record.slug);
  return '---\n' + doc.toString({ lineWidth: 0 }).trimEnd() + '\n---\n' + record.body;
}

export function validatePost(record, posts = []) {
  if (!record.title?.trim()) throw new Error('请先填写文章标题。');
  if (!record.body?.trim()) throw new Error('正文为空，不能发布。');
  if (!isRealDate(record.date)) throw new Error('日期必须是真实的 YYYY-MM-DD 日期。');
  validateSlug(record.slug);
  if (record.tags?.some((tag) => typeof tag !== 'string' || !tag.trim())) throw new Error('主题必须是非空文字。');
  const key = record.slug.normalize('NFC').toLocaleLowerCase('en-US');
  if (posts.some((post) => post.path !== record.path && post.slug?.normalize('NFC').toLocaleLowerCase('en-US') === key)) throw new Error('此文章地址已被另一篇文章使用，请换一个地址。');
}

export function recordFromPost(source, path, sha, id = path) {
  const parsed = parsePost(source, path);
  const { data } = parsed;
  if ((data.title !== undefined && typeof data.title !== 'string') || (data.date !== undefined && typeof data.date !== 'string') || (data.description !== undefined && typeof data.description !== 'string') || (data.tags !== undefined && (!Array.isArray(data.tags) || data.tags.some((tag) => typeof tag !== 'string'))) || (data.draft !== undefined && typeof data.draft !== 'boolean') || (data.slug !== undefined && typeof data.slug !== 'string')) throw new Error('文章资料类型不符合博客约定，请先在仓库中修正。');
  return { id, kind: 'post', path, baseSha: sha, frontMatter: parsed.frontMatter, body: parsed.body, title: data.title || '', date: data.date || '', description: data.description || '', tags: data.tags || [], slug: parsed.slug, explicitSlug: data.slug !== undefined, remoteDraft: data.draft === true, images: [] };
}

export function serializeSettings(record) {
  const data = JSON.parse(record.configText);
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('站点配置必须是 JSON 对象。');
  for (const key of ['name', 'author', 'tagline', 'description']) {
    if (typeof record[key] !== 'string' || !record[key].trim()) throw new Error('请完整填写站点名称、作者、短句和介绍。');
    data[key] = record[key].trim();
  }
  return JSON.stringify(data, null, 2) + '\n';
}

export function canonicalBody(body, images = []) {
  for (const image of images) if (image.url) body = body.split(image.url).join('/' + image.path);
  return body;
}

export function displayBody(body, images = []) {
  for (const image of images) if (image.url) body = body.split('/' + image.path).join(image.url);
  return body;
}

const imageTypes = new Map([['image/png', 'png'], ['image/jpeg', 'jpg'], ['image/webp', 'webp'], ['image/gif', 'gif'], ['image/avif', 'avif']]);
export async function prepareImage(blob, uuid = crypto.randomUUID()) {
  const extension = imageTypes.get(blob.type);
  if (!extension) throw new Error('只接受 PNG、JPEG、WebP、GIF、AVIF 图片；不接受 SVG、HTML。');
  if (blob.size > 10 * 1024 * 1024) throw new Error('每张图片最多 10 MB，请压缩后重试。');
  if (!blob.size) throw new Error('图片文件为空。');
  const bytes = new Uint8Array(await blob.slice(0, 32).arrayBuffer());
  const ascii = (start, length) => String.fromCharCode(...bytes.slice(start, start + length));
  const matches = extension === 'png' ? bytes.slice(0, 8).join(',') === '137,80,78,71,13,10,26,10'
    : extension === 'jpg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
    : extension === 'gif' ? ['GIF87a', 'GIF89a'].includes(ascii(0, 6))
    : extension === 'webp' ? ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP'
    : ascii(4, 4) === 'ftyp' && /(?:avif|avis)/.test(ascii(8, 24));
  if (!matches) throw new Error('图片实际格式与文件类型不符，请重新导出为常见图片格式。');
  return { path: 'assets/uploads/' + uuid + '.' + extension, blob };
}

// Explicit allow-list keeps credentials and transient object URLs out of IndexedDB.
export function draftRecord(record) {
  const keys = ['id', 'kind', 'path', 'baseSha', 'frontMatter', 'body', 'title', 'date', 'description', 'tags', 'slug', 'explicitSlug', 'remoteDraft', 'configText', 'name', 'author', 'tagline', 'pendingSource'];
  const result = Object.fromEntries(keys.filter((key) => record[key] !== undefined).map((key) => [key, structuredClone(record[key])]));
  result.images = (record.images || []).map(({ path, blob, uploadedSha }) => ({ path, blob, ...(uploadedSha ? { uploadedSha } : {}) }));
  result.updatedAt = Date.now();
  return result;
}
