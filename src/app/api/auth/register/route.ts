import { apiHandler, json, parseBody, rateLimit } from "@/lib/api";
import { registerSchema } from "@/lib/validation";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/crypto";
import { normalizeInviteCode } from "@/lib/crypto";
import { createSession, sessionCookieOptions, SESSION_COOKIE } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { audit } from "@/lib/audit";
import { cookies } from "next/headers";

/**
 * Invite-only registration.
 *
 * There is no open sign-up: this app instance holds somebody's private diary, so
 * an unauthenticated "create account" endpoint would let any stranger who finds
 * the URL write into that server. An account can only be created with an invite
 * code minted by the operator (`npm run invite:new` or Settings → Invites).
 */
export const POST = apiHandler("auth.register", async (request: Request) => {
  const forwarded = request.headers.get("x-forwarded-for") ?? "local";
  rateLimit(`register:${forwarded}`, 5, 15 * 60_000);

  const body = await parseBody(request, registerSchema);

  const email = body.email.trim().toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    throw new AppError("That email is already registered.", 409, "email_taken");
  }

  const code = normalizeInviteCode(body.inviteCode);

  // Validate, then claim the code with a conditional update. The version bump is
  // what makes this atomic: two simultaneous sign-ups with the same single-use
  // code produce exactly one winner, because the second update matches nothing.
  const invite = await prisma.signupCode.findUnique({ where: { code } });
  if (!invite) throw new AppError("That invite code is not valid.", 400, "bad_invite");

  if (invite.expiresAt && invite.expiresAt.getTime() < Date.now()) {
    throw new AppError("That invite code has expired.", 400, "invite_expired");
  }
  if (invite.usedCount >= invite.maxUses) {
    throw new AppError("That invite code has already been used.", 400, "invite_used");
  }

  const claimed = await prisma.signupCode.updateMany({
    where: {
      id: invite.id,
      usedCount: invite.usedCount,
      expiresAt: invite.expiresAt,
    },
    data: { usedCount: { increment: 1 } },
  });
  if (claimed.count === 0) {
    throw new AppError("That invite code has already been used.", 409, "invite_race");
  }

  const timezone = body.timezone?.trim() || "Asia/Jakarta";

  const user = await prisma.user.create({
    data: {
      email,
      name: body.name?.trim().slice(0, 80) || email.split("@")[0],
      passwordHash: await hashPassword(body.password),
      timezone,
      betaCodeUsed: code,
      settings: { create: { timezone } },
    },
  });

  // The same starter threads the seeded owner gets, so a new diary isn't empty.
  for (const [name, kind] of [
    ["Work", "life"],
    ["Career", "life"],
    ["Health", "life"],
    ["Money", "topic"],
  ] as const) {
    await prisma.thread.create({
      data: { userId: user.id, name, kind, slug: name.toLowerCase() },
    });
  }

  const token = await createSession(user.id, request.headers.get("user-agent") ?? undefined);
  const store = await cookies();
  store.set(SESSION_COOKIE, token, sessionCookieOptions);

  await audit(user.id, "user.register", "user", user.id, { invite: code });
  return json({ id: user.id, email: user.email }, { status: 201 });
});
