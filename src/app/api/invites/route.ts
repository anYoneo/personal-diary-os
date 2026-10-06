import { apiHandler, json, parseBody } from "@/lib/api";
import { requireBetaAdmin } from "@/lib/guard";
import { prisma } from "@/lib/db";
import { newInviteCode, normalizeInviteCode } from "@/lib/crypto";
import { z } from "zod";

const createSchema = z.object({
  note: z.string().trim().max(120).optional(),
  maxUses: z.number().int().min(1).max(50).optional(),
  /** Days until the invite expires. Omit for "never". */
  expiresInDays: z.number().int().min(1).max(365).optional(),
});

/** List invite codes. Operator only. */
export const GET = apiHandler("invites.list", async () => {
  await requireBetaAdmin();
  const codes = await prisma.signupCode.findMany({ orderBy: { createdAt: "desc" }, take: 100 });
  return json({
    codes: codes.map((c) => ({
      id: c.id,
      code: c.code,
      note: c.note,
      maxUses: c.maxUses,
      usedCount: c.usedCount,
      expiresAt: c.expiresAt?.toISOString() ?? null,
      createdAt: c.createdAt.toISOString(),
    })),
  });
});

/** Mint a new invite code. Operator only. */
export const POST = apiHandler("invites.create", async (request: Request) => {
  const admin = await requireBetaAdmin();
  const body = await parseBody(request, createSchema);

  // Retry on the astronomically unlikely collision.
  let code = newInviteCode();
  for (let i = 0; i < 5; i++) {
    const clash = await prisma.signupCode.findUnique({ where: { code } });
    if (!clash) break;
    code = newInviteCode();
  }

  const created = await prisma.signupCode.create({
    data: {
      code,
      note: body.note ?? null,
      maxUses: body.maxUses ?? 1,
      expiresAt: body.expiresInDays
        ? new Date(Date.now() + body.expiresInDays * 86_400_000)
        : null,
      createdBy: admin.id,
    },
  });

  return json(
    {
      id: created.id,
      code: created.code,
      maxUses: created.maxUses,
      expiresAt: created.expiresAt?.toISOString() ?? null,
    },
    { status: 201 },
  );
});

/** Revoke an invite code. Operator only. */
export const DELETE = apiHandler("invites.revoke", async (request: Request) => {
  await requireBetaAdmin();
  const raw = new URL(request.url).searchParams.get("code") ?? "";
  const code = normalizeInviteCode(raw);
  if (!code) return json({ deleted: false }, { status: 400 });
  const res = await prisma.signupCode.deleteMany({ where: { code } });
  return json({ deleted: res.count > 0 });
});
