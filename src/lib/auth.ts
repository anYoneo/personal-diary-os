import { cookies } from "next/headers";
import { cache } from "react";
import { config } from "./config";
import { prisma } from "./db";
import { hashToken, newSessionToken } from "./crypto";
import { unauthorized } from "./errors";

export const SESSION_COOKIE = "diary_session";
const SESSION_DAYS = 30;

export type SessionUser = {
  id: string;
  email: string;
  name: string | null;
  timezone: string;
};

/** Create a session row and return the raw token to place in the cookie. */
export async function createSession(userId: string, userAgent?: string): Promise<string> {
  const { token, tokenHash } = newSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await prisma.session.create({
    data: { userId, tokenHash, expiresAt, userAgent: userAgent?.slice(0, 200) },
  });
  return token;
}

export async function destroySession(token: string): Promise<void> {
  await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
}

/**
 * Resolve the signed-in user from the session cookie. `cache` + React request
 * memoization means one query per request even if called from many components.
 */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { include: { settings: true } } },
  });
  if (!session) return null;

  if (session.expiresAt.getTime() < Date.now()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }

  const { user } = session;
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    timezone: user.settings?.timezone ?? user.timezone,
  };
});

export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) throw unauthorized();
  return user;
}

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  // Browsers refuse to store a `secure` cookie over plain HTTP, which makes
  // login look successful while silently never persisting — an endless bounce
  // back to /login. Hosts that serve the app over HTTP (e.g. a free subdomain
  // mapped to port 80) must set COOKIE_SECURE="false".
  secure: config.cookieSecure,
  maxAge: SESSION_DAYS * 86_400,
};
