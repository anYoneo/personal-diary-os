/**
 * Per-test-file environment. Must run before any module imports the Prisma
 * client, so the DATABASE_URL here is what the client actually reads.
 *
 * The schema itself is pushed once per run by tests/global-setup.ts.
 */
process.env.DATABASE_URL = "file:./test.db";
process.env.USER_TIMEZONE = "Asia/Jakarta";
process.env.APP_URL = "http://localhost:3111";
process.env.SESSION_SECRET = "test-secret";
process.env.DISCORD_BOT_TOKEN = "";
process.env.AI_BASE_URL = "";
