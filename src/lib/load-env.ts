/**
 * Loads .env for the non-Next entry points (worker, bot, command registration,
 * seed scripts).
 *
 * Why: `next dev` loads .env automatically, but `tsx src/worker/index.ts` does
 * NOT. Without this, every long-lived process started by npm run worker / bot
 * silently behaved as if no Discord token existed — notifications were marked
 * `skipped` and the bot refused to start, even though .env was correct.
 *
 * Import this FIRST in any process that is not started by Next.
 */
import { config as loadEnv } from "dotenv";
import path from "node:path";

let loaded = false;

export function loadProcessEnv(): void {
  if (loaded) return;
  loaded = true;
  // .env in the project root; quiet so a missing file isn't noisy.
  loadEnv({ path: path.join(process.cwd(), ".env"), quiet: true });
}
