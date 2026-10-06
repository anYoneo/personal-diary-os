import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { envFile, pushSchema } from "./helpers";
import { discordDeliveryEnabled, isInstanceOperator } from "@/lib/notify";
import { config } from "@/lib/config";
import { createEntry } from "@/lib/services/entries";
import { enqueueEntryCreated } from "@/lib/services/notifications";
import { prisma } from "@/lib/db";

/**
 * The Discord-delivery gate.
 *
 * DISCORD_NOTIFY_CHANNEL_ID is one value for the whole server — on a personal
 * instance, the operator's own DM. Before this gate, a second account's entry
 * excerpt was queued for that channel, so their writing was pushed into someone
 * else's inbox while /register promised per-account privacy. These assertions
 * pin the fix: an invitee's diary text never reaches the outbox at all.
 *
 * The predicate is tested directly (not through the worker loop) because the
 * worker needs a live Discord client; the property that matters is that no row
 * containing their text is created in the first place.
 */
const TZ = "Asia/Jakarta";
const OPERATOR = "operator@example.com";
const INVITEE = "invitee@example.com";

let opId = "";
let invitId = "";

async function wipe() {
  await prisma.notificationOutbox.deleteMany();
  await prisma.entry.deleteMany();
  await prisma.userSettings.deleteMany();
  await prisma.session.deleteMany();
  await prisma.user.deleteMany();
}

async function user(email: string) {
  return prisma.user.create({
    data: {
      email,
      name: "T",
      passwordHash: "scrypt$deadbeef$00",
      timezone: TZ,
      settings: { create: { timezone: TZ } },
    },
  });
}

beforeAll(async () => {
  envFile();
  pushSchema();
  // `config` is read once at import time and .env wins over a late process.env
  // write, so the operator is set on the object — same probe used below. In
  // production this value comes from BETA_ADMIN_EMAIL at boot.
  (config as { betaAdminEmail: string }).betaAdminEmail = OPERATOR;
  await wipe();
  opId = (await user(OPERATOR)).id;
  invitId = (await user(INVITEE)).id;
});

afterAll(async () => {
  await wipe();
  await prisma.$disconnect();
});

describe("who is allowed to receive Discord notifications", () => {
  it("treats the configured operator as the only recipient", () => {
    expect(isInstanceOperator({ email: OPERATOR })).toBe(true);
    expect(discordDeliveryEnabled({ email: OPERATOR })).toBe(true);

    expect(isInstanceOperator({ email: INVITEE })).toBe(false);
    expect(discordDeliveryEnabled({ email: INVITEE })).toBe(false);
  });

  it("compares email case-insensitively", () => {
    expect(isInstanceOperator({ email: OPERATOR.toUpperCase() })).toBe(true);
  });

  it("fails closed when no operator is configured", () => {
    const saved = config.betaAdminEmail;
    (config as { betaAdminEmail: string }).betaAdminEmail = "";
    try {
      expect(isInstanceOperator({ email: OPERATOR })).toBe(false);
      expect(isInstanceOperator({ email: "" })).toBe(false);
    } finally {
      (config as { betaAdminEmail: string }).betaAdminEmail = saved;
    }
  });
});

describe("an invitee's diary text never reaches the outbox", () => {
  it("queues a notification for the operator", async () => {
    const entry = await createEntry(opId, TZ, { content: "operator writes about the audit trail." });
    const rows = await prisma.notificationOutbox.findMany({ where: { userId: opId } });
    expect(rows.length).toBe(1);
    expect(JSON.parse(rows[0].payload).preview).toContain("audit trail");
    expect(entry.id).toBeTruthy();
  });

  it("queues nothing for the invitee — not even with the secret phrase in it", async () => {
    await createEntry(invitId, TZ, {
      content: "invitee writes SECRET-PHRASE-9911 that must not be pushed anywhere.",
    });

    const rows = await prisma.notificationOutbox.findMany({ where: { userId: invitId } });
    expect(rows.length).toBe(0);

    // Belt and braces: the phrase must not exist anywhere in the outbox, whatever
    // the user id — the failure mode being guarded is delivery to the wrong inbox.
    const anywhere = await prisma.notificationOutbox.findMany();
    const leaked = anywhere.filter((r) => r.payload.includes("SECRET-PHRASE-9911"));
    expect(leaked.length).toBe(0);
  });

  it("does not queue for an invitee even when called directly", async () => {
    await enqueueEntryCreated(
      invitId,
      {
        id: "probe",
        day: "2026-10-05",
        title: null,
        content: "direct call SECRET-PHRASE-9911",
        wordCount: 4,
      },
      { email: INVITEE },
    );
    expect(await prisma.notificationOutbox.count({ where: { userId: invitId } })).toBe(0);
  });

  it("still queues for the operator on the same code path", async () => {
    const before = await prisma.notificationOutbox.count({ where: { userId: opId } });
    // Through createEntry — the same path the web route and Discord capture use.
    await createEntry(opId, TZ, { content: "a second operator entry, queue me." });
    expect(await prisma.notificationOutbox.count({ where: { userId: opId } })).toBe(before + 1);
  });
});
