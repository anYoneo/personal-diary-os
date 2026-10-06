import { apiHandler, json, rateLimit } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { randomBytes } from "node:crypto";
import { audit } from "@/lib/audit";

/**
 * Webapp side of Discord account linking. The user generates a short code here,
 * then runs /link <code> in Discord. Nothing is linked implicitly.
 */
export const POST = apiHandler("discord.link-code", async () => {
  const user = await requireUser();
  rateLimit(`linkcode:${user.id}`, 5, 10 * 60_000);

  const code = randomBytes(4).toString("hex").toUpperCase(); // 8 hex chars
  const expiresAt = new Date(Date.now() + 10 * 60_000);

  // Invalidate any previous unused codes so only the newest works.
  await prisma.linkCode.updateMany({
    where: { userId: user.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  await prisma.linkCode.create({ data: { userId: user.id, code, expiresAt } });

  await audit(user.id, "discord.link_code_issued", "user", user.id);
  return json({ code, expiresAt: expiresAt.toISOString() });
});

export const GET = apiHandler("discord.link-status", async () => {
  const user = await requireUser();
  const link = await prisma.discordLink.findUnique({ where: { userId: user.id } });
  const code = await prisma.linkCode.findFirst({
    where: { userId: user.id, usedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  return json({
    linked: Boolean(link),
    username: link?.username ?? null,
    linkedAt: link?.linkedAt.toISOString() ?? null,
    pendingCode: code?.code ?? null,
    pendingCodeExpiresAt: code?.expiresAt.toISOString() ?? null,
  });
});

export const DELETE = apiHandler("discord.unlink", async () => {
  const user = await requireUser();
  await prisma.discordLink.deleteMany({ where: { userId: user.id } });
  await audit(user.id, "discord.unlink", "user", user.id);
  return json({ unlinked: true });
});
