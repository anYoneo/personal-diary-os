import { cookies } from "next/headers";
import { apiHandler, json, parseBody, rateLimit } from "@/lib/api";
import { loginSchema } from "@/lib/validation";
import { prisma } from "@/lib/db";
import { verifyPassword, hashPassword } from "@/lib/crypto";
import { createSession, sessionCookieOptions, SESSION_COOKIE } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { audit } from "@/lib/audit";

export const POST = apiHandler("auth.login", async (request: Request) => {
  const body = await parseBody(request, loginSchema);

  const forwarded = request.headers.get("x-forwarded-for") ?? "local";
  rateLimit(`login:${forwarded}`, 10, 5 * 60_000);

  const user = await prisma.user.findUnique({ where: { email: body.email.toLowerCase() } });

  // Same message and similar cost for unknown user and wrong password.
  if (!user) {
    await hashPassword(body.password);
    throw new AppError("Email or password is incorrect.", 401, "invalid_credentials");
  }

  const ok = await verifyPassword(body.password, user.passwordHash);
  if (!ok) throw new AppError("Email or password is incorrect.", 401, "invalid_credentials");

  const token = await createSession(user.id, request.headers.get("user-agent") ?? undefined);
  const store = await cookies();
  store.set(SESSION_COOKIE, token, sessionCookieOptions);

  await audit(user.id, "user.login", "user", user.id);
  return json({ id: user.id, email: user.email });
});
