import { prisma } from "./db";

/**
 * Append-only trail of destructive/security-relevant operations. Metadata only
 * (ids, action names) — never diary text.
 */
export async function audit(
  userId: string,
  action: string,
  entity: string,
  entityId?: string | null,
  meta?: Record<string, string | number | boolean | null>,
): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId,
        action,
        entity,
        entityId: entityId ?? null,
        meta: meta ? JSON.stringify(meta) : null,
      },
    });
  } catch {
    // Auditing must never break a user-facing operation.
  }
}
