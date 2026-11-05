import { draftRecord } from './content.mjs';

export class DraftStore {
  #db;
  #generation = 0;
  close() { this.#generation += 1; this.#db?.close(); this.#db = undefined; }
  async open() {
    if (this.#db) return this;
    if (!globalThis.indexedDB) throw new Error('此浏览器不支持本机草稿。请使用最新版浏览器，并先导出 Markdown 备份。');
    const generation = this.#generation;
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('dongpo-blog-editor', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('drafts', { keyPath: 'id' });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error('无法打开本机草稿存储。请检查浏览器是否禁用了站点存储，并导出 Markdown 备份。'));
      request.onblocked = () => reject(new Error('本机草稿存储被另一标签页占用，请关闭旧标签页后重试。'));
    });
    if (generation !== this.#generation) { db.close(); throw new Error('当前写作会话已结束。'); }
    this.#db = db;
    return this;
  }
  async #transaction(mode, operation) {
    await this.open();
    return new Promise((resolve, reject) => {
      const transaction = this.#db.transaction('drafts', mode);
      const request = operation(transaction.objectStore('drafts'));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = transaction.onabort = () => reject(new Error('本机草稿保存失败，可能是存储空间不足或浏览器限制。请保留页面并导出 Markdown；包含图片时也请另存原图片。'));
    });
  }
  save(record) { return this.#transaction('readwrite', (store) => store.put(draftRecord(record))); }
  all() { return this.#transaction('readonly', (store) => store.getAll()); }
  get(id) { return this.#transaction('readonly', (store) => store.get(id)); }
  remove(id) { return this.#transaction('readwrite', (store) => store.delete(id)); }
}

export { readSession, saveSession, clearSession } from './session.mjs';
