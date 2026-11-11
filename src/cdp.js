// Chromium's DevTools protocol over the pipe it opens with --remote-debugging-pipe: it reads commands
// on its fd 3 and writes answers and events on its fd 4, each message JSON ending in a NUL byte. The
// server takes pictures of the designs this way, in the browser it opens out of sight (see pictures.js).

/** How long a command has to be answered */
const COMMAND_MS = 30000;

/**
 * A connection to the browser over `input` (its fd 3, which it reads) and `output` (its fd 4):
 * `send(method, params, sessionId)` answers with the command's result, `on(listener)` hears its
 * events, and `close()` gives up on what is still unanswered.
 */
export function connectPipe(input, output) {
  let next = 0;
  let closed = false;
  const waiting = new Map(); // id → { resolve, reject, timer }
  const listeners = new Set();
  let pending = [];

  const fail = (error) => {
    closed = true;
    for (const { reject, timer } of waiting.values()) {
      clearTimeout(timer);
      reject(error);
    }
    waiting.clear();
  };

  output.on('data', (chunk) => {
    let start = 0;
    for (let end = chunk.indexOf(0); end >= 0; end = chunk.indexOf(0, start)) {
      pending.push(chunk.subarray(start, end));
      const text = Buffer.concat(pending).toString('utf8');
      pending = [];
      start = end + 1;
      let message;
      try {
        message = JSON.parse(text);
      } catch {
        continue;
      }
      if (message.id !== undefined && waiting.has(message.id)) {
        const { resolve, reject, timer } = waiting.get(message.id);
        clearTimeout(timer);
        waiting.delete(message.id);
        if (message.error) reject(new Error(`${message.error.message || 'CDP error'}${message.error.data ? ` (${message.error.data})` : ''}`));
        else resolve(message.result || {});
      } else if (message.method) {
        for (const listener of listeners) listener(message);
      }
    }
    if (start < chunk.length) pending.push(chunk.subarray(start));
  });
  output.on('close', () => fail(new Error('the browser closed its pipe')));
  output.on('error', () => {});
  input.on('error', () => {});

  return {
    send(method, params = {}, sessionId) {
      if (closed) return Promise.reject(new Error('the browser closed its pipe'));
      const id = ++next;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          waiting.delete(id);
          reject(new Error(`${method} took more than ${COMMAND_MS / 1000} s`));
        }, COMMAND_MS);
        waiting.set(id, { resolve, reject, timer });
        input.write(`${JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })}\0`);
      });
    },
    on(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close() {
      fail(new Error('closed'));
    },
  };
}
