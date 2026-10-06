/**
 * A keyed mutex for critical sections.
 *
 * Why this exists: this app's optimistic-concurrency guard ("only apply the save
 * if the version still matches") is not enough on its own. Measured on the real
 * service: two simultaneous updates both carrying version 1 both succeeded and
 * the row ended up at version 3. The guard lives inside a transaction, but two
 * concurrent Prisma interactive transactions against SQLite each evaluated
 * `WHERE version = 1` against their own snapshot, so neither saw the other.
 *
 * Serialising the read-check-write in-process closes that window completely for
 * this deployment: there is exactly one web process serving requests, so two
 * saves for the same entry genuinely cannot interleave. The database-level guard
 * stays as the backstop for the worker/bot processes, which do not share this
 * mutex.
 *
 * Keyed by entry id, so saving one entry never blocks a different one.
 */
const chains = new Map<string, Promise<unknown>>();

function ignore(): void {
  /* settled: the caller already handled the outcome */
}

export function withLock<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = chains.get(key) ?? Promise.resolve();
  // Chain onto the previous holder regardless of whether it resolved or rejected:
  // one failed save must not deadlock every later save for this entry.
  const run = previous.then(task, task);

  // The next holder waits on a promise that can never reject, so a refused save
  // (404/409 are ordinary control flow here) is never mistaken for a crashed
  // lock. Attaching both handlers — rather than `void run.finally(...)`, which
  // forwards the rejection to a promise nobody holds — is what keeps Node from
  // reporting an unhandled rejection for every expected refusal.
  const settled = run.then(ignore, ignore);
  chains.set(key, settled);
  // Forget the key once nobody is queued behind us, so the map cannot grow
  // forever. The identity check makes this safe: if a new holder already
  // replaced the entry, it is not ours to delete.
  void settled.then(() => {
    if (chains.get(key) === settled) chains.delete(key);
  });
  return run;
}
