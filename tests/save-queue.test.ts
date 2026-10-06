import { describe, expect, it } from "vitest";
import { createSaveQueue } from "@/lib/save-queue";

/**
 * The save queue exists because of a real data-loss report: while writing an
 * entry, two saves were in flight at once — the 900 ms debounce and the Save
 * button — and both carried the same `expectedVersion`. The server refused the
 * second with "this entry changed since you opened it", the editor latched the
 * conflict, and every later save was rejected too. The writer saw part of their
 * text disappear and the Save button stop working.
 *
 * So the properties under test are the ones that failure violated:
 *   1. never two sends at once;
 *   2. the last payload the user produced is the one that lands;
 *   3. a failure stops the queue and is reported, rather than looping.
 */
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const later = (_previous: string, next: string) => next;

describe("save queue", () => {
  it("never runs two sends at once, even when pushed in the same tick", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const gate = deferred();
    const seen: string[] = [];

    const queue = createSaveQueue<string>(async (payload) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      seen.push(payload);
      // The first send blocks, exactly like a slow network round trip.
      if (seen.length === 1) await gate.promise;
      inFlight -= 1;
    }, later);

    const first = queue.push("first");
    const second = queue.push("second");
    gate.resolve();
    await Promise.all([first, second]);

    expect(maxInFlight).toBe(1);
    expect(seen).toEqual(["first", "second"]);
  });

  it("collapses a burst into first + newest (the debounce/button race)", async () => {
    const gate = deferred();
    const seen: string[] = [];
    let call = 0;

    const queue = createSaveQueue<string>(async (payload) => {
      call += 1;
      seen.push(payload);
      if (call === 1) await gate.promise;
    }, later);

    const inflight = queue.push("clicked-save");
    queue.push("typing-1");
    queue.push("typing-2");
    queue.push("typing-3");
    gate.resolve();
    await inflight;

    // The intermediate keystrokes are dropped on purpose: they are older states of
    // the same text, and the newest payload supersedes them.
    expect(seen).toEqual(["clicked-save", "typing-3"]);
  });

  it("sends the newest state when the user saves during an in-flight request", async () => {
    const gate = deferred();
    const seen: string[] = [];

    const queue = createSaveQueue<string>(async (payload) => {
      seen.push(payload);
      if (seen.length === 1) await gate.promise;
    }, later);

    const first = queue.push("a");
    queue.push("ab");
    queue.push("abc");
    gate.resolve();
    await first;

    expect(seen[seen.length - 1]).toBe("abc");
  });

  it("reports a failure once and stops instead of retrying forever", async () => {
    let attempts = 0;
    const queue = createSaveQueue<string>(async () => {
      attempts += 1;
      throw new Error("409 changed since you opened it");
    }, later);

    await expect(queue.push("boom")).rejects.toThrow(/changed since/);
    // A second push must not silently hammer the server with the same rejected
    // request; the user retries explicitly.
    await expect(queue.push("again")).rejects.toThrow(/changed since/);
    expect(attempts).toBe(2);
  });

  it("drains the queue after a failure so later saves still work", async () => {
    const seen: string[] = [];
    let failNext = true;
    const queue = createSaveQueue<string>(async (payload) => {
      if (failNext) {
        failNext = false;
        throw new Error("network");
      }
      seen.push(payload);
    }, later);

    await expect(queue.push("first")).rejects.toThrow();
    await queue.push("second");
    expect(seen).toEqual(["second"]);
  });

  it("reports busy state while a send is queued or running", async () => {
    const gate = deferred();
    const queue = createSaveQueue<string>(async () => {
      await gate.promise;
    }, later);

    expect(queue.isBusy()).toBe(false);
    const running = queue.push("x");
    expect(queue.isBusy()).toBe(true);
    gate.resolve();
    await running;
    expect(queue.isBusy()).toBe(false);
  });
});
