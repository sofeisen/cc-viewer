// Async Write Queue — 非阻塞追加写入，替代 appendFileSync
// 单写者模式保证写入顺序，进程退出时回退同步写入保证不丢数据

import { appendFile } from 'node:fs/promises';
import { appendFileSync } from 'node:fs';

const HIGH_WATER_MARK = 50 * 1024 * 1024; // 50MB — 超过此值降级为同步写入

export class AsyncWriteQueue {
  /**
   * @param {string|(() => string)} pathOrGetter - 文件路径或返回路径的函数（支持动态路径）
   * @param {object} [opts]
   * @param {boolean} [opts.syncMode] - 强制同步模式
   */
  constructor(pathOrGetter, opts = {}) {
    this._pathOrGetter = pathOrGetter;
    this._queue = [];          // { path: string, data: string, onDone?: Function }[]
    this._pendingBytes = 0;
    this._draining = false;
    this._drainPromise = null;
    this._closed = false;
    this._flushResolvers = []; // resolve() callbacks waiting for flush()
    this._syncMode = opts.syncMode || !!process.env.CCV_SYNC_WRITES;
  }

  _getPath() {
    return typeof this._pathOrGetter === 'function' ? this._pathOrGetter() : this._pathOrGetter;
  }

  get filePath() { return this._getPath(); }
  get pendingBytes() { return this._pendingBytes; }

  append(data, onDone) {
    if (this._closed) return;
    const path = this._getPath();
    if (!path) {
      if (onDone) try { onDone(); } catch {}
      return;
    }

    if (this._syncMode || this._pendingBytes >= HIGH_WATER_MARK) {
      try { appendFileSync(path, data); } catch {}
      if (onDone) try { onDone(); } catch {}
      return;
    }

    const byteLen = Buffer.byteLength(data);
    this._queue.push({ path, data, onDone });
    this._pendingBytes += byteLen;
    this._scheduleDrain();
  }

  async flush() {
    if (this._queue.length === 0 && !this._draining) return;
    return new Promise(resolve => {
      this._flushResolvers.push(resolve);
      this._scheduleDrain();
    });
  }

  async close() {
    this._closed = true;
    // 等待 in-flight 异步 drain 完成，防止退出时丢失正在写入的数据
    if (this._drainPromise) {
      try { await this._drainPromise; } catch {}
    }
    // 同步兜底：排空 drain 完成后可能新入队的剩余项
    this._drainSync();
  }

  // Synchronous drain for process exit — guarantees no data loss
  _drainSync() {
    while (this._queue.length > 0) {
      const item = this._queue.shift();
      try {
        appendFileSync(item.path, item.data);
        if (item.onDone) item.onDone();
      } catch {}
    }
    this._pendingBytes = 0;
    for (const resolve of this._flushResolvers) resolve();
    this._flushResolvers.length = 0;
  }

  _scheduleDrain() {
    if (this._draining) return;
    this._draining = true;
    // queueMicrotask 批量收集同 tick 的 append 调用
    queueMicrotask(() => { this._drainPromise = this._drain(); });
  }

  async _drain() {
    while (this._queue.length > 0) {
      // Group by path — entries for the same file are batched together
      const batch = this._queue.splice(0);
      const byPath = new Map();
      for (const item of batch) {
        if (!byPath.has(item.path)) byPath.set(item.path, []);
        byPath.get(item.path).push(item);
      }

      for (const [path, items] of byPath) {
        const callbacks = [];
        let combined = '';
        for (const item of items) {
          combined += item.data;
          if (item.onDone) callbacks.push(item.onDone);
        }

        try {
          await appendFile(path, combined);
        } catch {}
        for (const cb of callbacks) {
          try { cb(); } catch {}
        }
      }

      let totalBytes = 0;
      for (const [, items] of byPath) {
        for (const item of items) totalBytes += Buffer.byteLength(item.data);
      }
      this._pendingBytes -= totalBytes;
      if (this._pendingBytes < 0) this._pendingBytes = 0;
    }

    this._draining = false;

    for (const resolve of this._flushResolvers) resolve();
    this._flushResolvers.length = 0;
  }
}
