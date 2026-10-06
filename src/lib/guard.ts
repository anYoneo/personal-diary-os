import { forbidden } from "./errors";
import { requireUser, type SessionUser } from "./auth";
import { isInstanceOperator } from "./notify";

/**
 * Who is allowed to mint invite codes on this instance.
 *
 * Invite codes are the only path to a new account, so minting them is an
 * operator action. Rather than introduce a `role` column and a second concept
 * of privilege, the operator is simply the email in BETA_ADMIN_EMAIL (which
 * config.ts falls back to ADMIN_EMAIL, the seeded owner). One instance, one
 * operator.
 *
 * The predicate itself lives in lib/notify.ts — the same question ("is this the
 * operator?") decides who may mint codes and who may receive Discord messages,
 * and two copies of it would eventually disagree.
 */
export async function requireBetaAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (!isInstanceOperator(user)) {
    throw forbidden("Only the instance operator can manage invite codes.");
  }
  return user;
}

export function isBetaAdmin(user: { email: string }): boolean {
  return isInstanceOperator(user);
}
