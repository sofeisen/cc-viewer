import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AsyncWriteQueue } from '../server/lib/async-write-queue.js';

describe('AsyncWriteQueue', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'awq-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should append data to file', async () => {
    const filePath = join(tmpDir, 'test.log');
    const queue = new AsyncWriteQueue(filePath);
    queue.append('hello\n---\n');
    await queue.flush();
    const content = readFileSync(filePath, 'utf-8');
    assert.equal(content, 'hello\n---\n');
    await queue.close();
  });

  it('should batch multiple appends in one tick', async () => {
    const filePath = join(tmpDir, 'test.log');
    const queue = new AsyncWriteQueue(filePath);
    queue.append('a\n---\n');
    queue.append('b\n---\n');
    queue.append('c\n---\n');
    await queue.flush();
    const content = readFileSync(filePath, 'utf-8');
    assert.equal(content, 'a\n---\nb\n---\nc\n---\n');
    await queue.close();
  });

  it('should preserve write order across ticks', async () => {
    const filePath = join(tmpDir, 'test.log');
    const queue = new AsyncWriteQueue(filePath);
    queue.append('first\n---\n');
    await queue.flush();
    queue.append('second\n---\n');
    await queue.flush();
    const content = readFileSync(filePath, 'utf-8');
    assert.equal(content, 'first\n---\nsecond\n---\n');
    await queue.close();
  });

  it('should call onDone callbacks after write', async () => {
    const filePath = join(tmpDir, 'test.log');
    const queue = new AsyncWriteQueue(filePath);
    let callbackCalled = false;
    queue.append('data\n---\n', () => { callbackCalled = true; });
    await queue.flush();
    assert.ok(callbackCalled);
    await queue.close();
  });

  it('should support dynamic path via getter', async () => {
    const file1 = join(tmpDir, 'log1.jsonl');
    const file2 = join(tmpDir, 'log2.jsonl');
    let currentPath = file1;
    const queue = new AsyncWriteQueue(() => currentPath);
    queue.append('old-data\n---\n');
    await queue.flush();
    currentPath = file2;
    queue.append('new-data\n---\n');
    await queue.flush();
    assert.equal(readFileSync(file1, 'utf-8'), 'old-data\n---\n');
    assert.equal(readFileSync(file2, 'utf-8'), 'new-data\n---\n');
    await queue.close();
  });

  it('should use sync mode when CCV_SYNC_WRITES is set', async () => {
    const filePath = join(tmpDir, 'test.log');
    const queue = new AsyncWriteQueue(filePath, { syncMode: true });
    queue.append('sync-data\n---\n');
    // Sync mode writes immediately, no need to flush
    const content = readFileSync(filePath, 'utf-8');
    assert.equal(content, 'sync-data\n---\n');
    await queue.close();
  });

  it('should handle close with pending data', async () => {
    const filePath = join(tmpDir, 'test.log');
    const queue = new AsyncWriteQueue(filePath);
    queue.append('pending\n---\n');
    await queue.close();
    const content = readFileSync(filePath, 'utf-8');
    assert.equal(content, 'pending\n---\n');
  });

  it('should handle empty flush', async () => {
    const filePath = join(tmpDir, 'test.log');
    const queue = new AsyncWriteQueue(filePath);
    await queue.flush(); // should not throw
    await queue.close();
  });

  it('should track pendingBytes', async () => {
    const filePath = join(tmpDir, 'test.log');
    const queue = new AsyncWriteQueue(filePath);
    assert.equal(queue.pendingBytes, 0);
    queue.append('data');
    assert.ok(queue.pendingBytes > 0);
    await queue.flush();
    assert.equal(queue.pendingBytes, 0);
    await queue.close();
  });

  it('should ignore appends after close', async () => {
    const filePath = join(tmpDir, 'test.log');
    const queue = new AsyncWriteQueue(filePath);
    queue.append('before\n---\n');
    await queue.close();
    queue.append('after\n---\n');
    const content = readFileSync(filePath, 'utf-8');
    assert.equal(content, 'before\n---\n');
  });

  it('should handle concurrent flushes', async () => {
    const filePath = join(tmpDir, 'test.log');
    const queue = new AsyncWriteQueue(filePath);
    queue.append('a');
    const [r1, r2] = await Promise.all([queue.flush(), queue.flush()]);
    assert.equal(r1, undefined);
    assert.equal(r2, undefined);
    await queue.close();
  });
});
