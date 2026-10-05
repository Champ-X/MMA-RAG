/** One authenticated host pipe, one Pi run, no filesystem/shell/discovered tools. */
import { createInterface } from 'node:readline';
import { createRuntime } from './runtime.mjs';

const pending = new Map();
let counter = 0;
let runtime;
let launched = false;
let output = Promise.resolve();

function write(value) {
  // Honor pipe backpressure and preserve events even when the browser is disconnected.
  output = output.then(() => new Promise((resolve, reject) => {
    process.stdout.write(JSON.stringify(value) + '\n', (error) => error ? reject(error) : resolve());
  }));
  return output;
}

function callHost(method, params, signal) {
  if (signal?.aborted) return Promise.reject(new Error('任务已取消'));
  const id = String(++counter);
  return new Promise((resolve, reject) => {
    const abort = () => { pending.delete(id); reject(new Error('任务已取消')); };
    signal?.addEventListener('abort', abort, { once: true });
    pending.set(id, {
      resolve: (value) => { signal?.removeEventListener('abort', abort); resolve(value); },
      reject: (error) => { signal?.removeEventListener('abort', abort); reject(error); },
    });
    write({ type: 'request', id, method, params }).catch((error) => {
      pending.get(id)?.reject(error);
      pending.delete(id);
    });
  });
}

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on('line', (line) => {
  try {
    if (line.length > 16 * 1024 * 1024) throw new Error('host_message_too_large');
    const message = JSON.parse(line);
    if (message.type === 'response') {
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      if (message.error) request.reject(new Error(message.error));
      else request.resolve(message.result);
    } else if (message.type === 'cancel') {
      runtime?.abort();
    } else if (message.type === 'start' && !launched) {
      launched = true;
      runtime = createRuntime(message.config, {
        callHost, emit: (eventType, data) => write({ type: 'event', event_type: eventType, data }),
      });
      runtime.run().then(async (result) => {
        await write({ type: 'settled', result });
        lines.close();
        process.stdin.destroy();
      }).catch(async (error) => {
        await write({ type: 'settled', result: { terminal: 'failed', code: 'worker_error', message: String(error.message).slice(0, 2000) } });
        lines.close();
        process.stdin.destroy();
      });
    }
  } catch {
    runtime?.abort();
    process.exitCode = 1;
    lines.close();
    process.stdin.destroy();
  }
});
lines.on('close', () => {
  runtime?.abort();
  for (const request of pending.values()) request.reject(new Error('宿主连接已关闭'));
  pending.clear();
});
process.on('SIGTERM', () => { runtime?.abort(); lines.close(); process.stdin.destroy(); });
