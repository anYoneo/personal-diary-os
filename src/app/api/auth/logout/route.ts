import { cookies } from "next/headers";
import { apiHandler, json } from "@/lib/api";
import { destroySession, getCurrentUser, SESSION_COOKIE } from "@/lib/auth";
import { audit } from "@/lib/audit";

export const POST = apiHandler("auth.logout", async () => {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  const user = await getCurrentUser();

  if (token) await destroySession(token);
  if (user) await audit(user.id, "user.logout", "user", user.id);

  store.delete(SESSION_COOKIE);
  return json({ ok: true });
});
