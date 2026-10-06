/**
 * pm2 process definitions for the Oracle Cloud host (no Docker).
 *
 *   pm2 start scripts/ecosystem.config.cjs
 *   pm2 save && pm2 startup      # survive reboot
 *
 * Three long-lived processes instead of one: the web app, the notification
 * worker, and the Discord bot. pm2 restarts any of them if it dies.
 *
 * DATABASE_URL points at a file under DIARY_DATA_DIR so the diary lives outside
 * the app directory and survives `git pull` / redeploys.
 */
// CommonJS (.cjs) because pm2 loads this file itself, and `__dirname` is
// available natively here — no `require` needed.
const dataDir = process.env.DIARY_DATA_DIR || "/home/ubuntu/diary-data";

/**
 * One connection per process and a 30 s socket timeout.
 *
 * Three processes (web, worker, bot) share one SQLite file. With Prisma's
 * default 5 s timeout the background process fails every cycle with "Socket
 * timeout (the database failed to respond to a query within the configured
 * timeout)". WAL is not the fix — Prisma already enables WAL — the connection
 * limit and the longer wait are.
 *
 * These parameters MUST live here and not only in .env. pm2 sets this value in
 * the process environment, and dotenv does not overwrite variables that are
 * already set — so an env value without the parameters silently wins over the
 * correct one in .env, and the fix appears to have "stopped working" after any
 * pm2 restart.
 */
const databaseUrl = `file:${dataDir.replace(/\/$/, "")}/diary.db?connection_limit=1&socket_timeout=30`;

/** Shared by all three processes. */
const common = {
  cwd: __dirname.replace(/[\\/]scripts$/, ""),
  env: {
    NODE_ENV: "production",
    DATABASE_URL: databaseUrl,
    DIARY_DATA_DIR: dataDir,
    // APP_URL is the public address of this instance. The keepalive process
    // uses it to find the tunnel it must keep warm; it is also the canonical
    // URL in notification email/Discord links.
    ...(process.env.APP_URL ? { APP_URL: process.env.APP_URL } : {}),
    // WEB_HOST/WEB_PORT are set by dalang-deploy.sh; pass them through so the
    // web process binds where the host expects (dalang.io: 0.0.0.0:80).
    ...(process.env.WEB_PORT ? { WEB_PORT: process.env.WEB_PORT } : {}),
    ...(process.env.WEB_HOST ? { WEB_HOST: process.env.WEB_HOST } : {}),
  },
  // Diary content must never end up in a restart-looping error log.
  max_restarts: 10,
  restart_delay: 4000,
  time: true,
};

module.exports = {
  apps: [
    {
      ...common,
      name: "diary-web",
      script: "node_modules/next/dist/bin/next",
      // WEB_HOST/WEB_PORT let a host that proxies to a fixed port work without
      // editing this file, e.g. dalang.io's free subdomain → port 80:
      //   WEB_HOST=0.0.0.0 WEB_PORT=80
      // Default is loopback-only: public traffic should arrive via a tunnel.
      args: `start -p ${process.env.WEB_PORT || 3111} -H ${process.env.WEB_HOST || "127.0.0.1"}`,
      env: { ...common.env, PORT: process.env.WEB_PORT || "3111" },
    },
    {
      ...common,
      name: "diary-worker",
      script: "node_modules/tsx/dist/cli.mjs",
      args: "src/worker/index.ts",
    },
    {
      ...common,
      name: "diary-bot",
      script: "node_modules/tsx/dist/cli.mjs",
      args: "src/discord/bot.ts",
    },
    {
      /**
       * Keeps the public tunnel from going cold.
       *
       * Measured on this host: a request 5 s after the previous one takes
       * 0.14 s, the same request 10 s later takes 6.85 s, while the app itself
       * answers in 0.016 s on loopback. The Cloudflare → VM path is dropped
       * after ~10 s of quiet; dalang.io exposes no keep-alive setting, so the
       * instance keeps it warm with a request every 5 s. Costs a few hundred
       * bytes of bandwidth; removes a ~7 s stall from the first click.
       * See scripts/keepalive.mjs.
       */
      ...common,
      name: "diary-keepalive",
      script: "scripts/keepalive.mjs",
      max_restarts: 5,
      restart_delay: 10_000,
    },
  ],
};
