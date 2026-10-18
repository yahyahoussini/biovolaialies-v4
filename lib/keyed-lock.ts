/**
 * Serialises async work per key within one server instance: two requests drawing on the same
 * stock (an egg lot, a hatch cycle, a product) run one after the other, so "check balance,
 * then write" cannot be beaten by a double submit. Across several instances this is not
 * enough on its own — the balance is re-checked inside the lock, and a multi-instance
 * deployment should move these checks into conditional SQL. Documented in BVU_TECH.md.
 */
const tails = new Map<string, Promise<unknown>>();

export async function withLock<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = tails.get(key) ?? Promise.resolve();
  const run = previous.then(task, task);
  const tail = run.catch(() => undefined);
  tails.set(key, tail);
  try {
    return await run;
  } finally {
    if (tails.get(key) === tail) tails.delete(key);
  }
}
