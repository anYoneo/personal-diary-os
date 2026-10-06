/**
 * A single-flight save queue.
 *
 * Why this exists: the editor has two ways to save — a 900 ms debounce after you
 * stop typing, and the Save button / Ctrl+Enter. Nothing stopped both from being
 * in flight at once, and each carried `expectedVersion` read at call time. Two
 * requests with the same version means the server rejects the second as
 * "this entry changed since you opened it" — even though both came from the same
 * person in the same tab. After that the editor latched into a conflict state
 * and every later save was refused, so the app looked broken: the first save
 * appeared to eat part of the text, and clicking Save afterwards did nothing.
 *
 * The invariant here: **at most one send in flight, and the newest payload
 * always wins.** Push while a send is running and the payload is merged and sent
 * right after, never in parallel.
 *
 * On error the queue stops and drops the payload — deliberately. The caller keeps
 * the user's text in component state and in localStorage, so nothing is lost, and
 * a retry becomes an explicit user action instead of an automatic loop that would
 * hammer the server with a request it already refused.
 */
export function createSaveQueue<T>(
  send: (payload: T) => Promise<void>,
  merge: (previous: T, next: T) => T,
) {
  let running = false;
  let pending: T | null = null;

  async function pump(): Promise<void> {
    if (running) return;
    running = true;
    try {
      while (pending !== null) {
        const payload = pending;
        // Cleared before the await: a push that arrives mid-flight becomes the
        // next iteration's payload rather than being swallowed by this one.
        pending = null;
        await send(payload);
      }
    } finally {
      running = false;
    }
  }

  return {
    /** Queue a payload. Resolves when the queue drains, or rejects on the first error. */
    push(payload: T): Promise<void> {
      pending = pending === null ? payload : merge(pending, payload);
      return pump();
    },
    /** True while a request is in flight or a payload is waiting to go. */
    isBusy(): boolean {
      return running || pending !== null;
    },
  };
}
