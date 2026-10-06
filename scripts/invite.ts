#!/usr/bin/env node
/**
 * Mint / list / revoke invite codes from the terminal.
 *
 *   npm run invite:new                          one single-use code
 *   npm run invite:new -- --note "istri"        with a label
 *   npm run invite:new -- --uses 3 --days 7     three uses, expires in a week
 *   npm run invite:list
 *   npm run invite:revoke -- ABCD-EFGH
 *
 * Loading .env matters: without it DATABASE_URL is unset and this would touch
 * the wrong (or a missing) database.
 */
import { config as loadEnv } from "dotenv";
loadEnv({ quiet: true });

import { PrismaClient } from "@prisma/client";
import { randomBytes } from "node:crypto";

const prisma = new PrismaClient();
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function newCode(): string {
  const b = randomBytes(8);
  let s = "";
  for (let i = 0; i < 8; i++) s += ALPHABET[b[i] % ALPHABET.length];
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function has(flag: string): boolean {
  return process.argv.includes(`--${flag}`);
}

async function main() {
  const command = process.argv[2] ?? "new";

  if (command === "list") {
    const codes = await prisma.signupCode.findMany({ orderBy: { createdAt: "desc" }, take: 100 });
    if (!codes.length) {
      console.log("No invite codes yet. Create one:  npm run invite:new");
      return;
    }
    console.log("\n  CODE          USED  EXPIRES      NOTE");
    console.log("  " + "─".repeat(60));
    for (const c of codes) {
      const used = `${c.usedCount}/${c.maxUses}`;
      const exp = c.expiresAt ? c.expiresAt.toISOString().slice(0, 10) : "never";
      console.log(`  ${c.code.padEnd(13)} ${used.padEnd(5)} ${exp.padEnd(12)} ${c.note ?? ""}`);
    }
    console.log();
    return;
  }

  if (command === "revoke") {
    const raw = (arg("code") ?? process.argv[3] ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    const code = raw.length === 8 ? `${raw.slice(0, 4)}-${raw.slice(4)}` : raw;
    const res = await prisma.signupCode.deleteMany({ where: { code } });
    console.log(res.count ? `Revoked ${code}` : `No such code: ${code}`);
    return;
  }

  // new
  let code = newCode();
  for (let i = 0; i < 5; i++) {
    if (!(await prisma.signupCode.findUnique({ where: { code } }))) break;
    code = newCode();
  }
  const uses = Number(arg("uses", "1"));
  const days = arg("days");

  const created = await prisma.signupCode.create({
    data: {
      code,
      note: arg("note") ?? null,
      maxUses: Number.isFinite(uses) && uses > 0 ? Math.min(uses, 50) : 1,
      expiresAt: days ? new Date(Date.now() + Number(days) * 86_400_000) : null,
    },
  });

  console.log("");
  console.log("  Invite code:  " + created.code);
  console.log("  Uses:         " + created.maxUses);
  console.log("  Expires:      " + (created.expiresAt ? created.expiresAt.toISOString().slice(0, 10) : "never"));
  if (created.note) console.log("  Note:         " + created.note);
  console.log("");
  console.log("  Send the person this link plus the code:");
  console.log(`    ${process.env.APP_URL ?? "https://<your-app-url>"}/register`);
  console.log("");
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
