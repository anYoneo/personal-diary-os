import { PrismaClient } from "@prisma/client";
import { randomBytes, scrypt as scryptCb } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb);
const prisma = new PrismaClient();

async function hash(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scrypt(password.normalize("NFKC"), salt, 64)) as Buffer;
  return `scrypt$${salt}$${derived.toString("hex")}`;
}

async function main() {
  const email = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD ?? "";
  const timezone = process.env.USER_TIMEZONE ?? "Asia/Jakarta";

  if (!email || !password) {
    throw new Error("ADMIN_EMAIL and ADMIN_PASSWORD must be set (see .env.example).");
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`User ${email} already exists — nothing to do.`);
    return;
  }

  const user = await prisma.user.create({
    data: {
      email,
      name: email.split("@")[0],
      passwordHash: await hash(password),
      timezone,
      settings: { create: { timezone } },
    },
  });

  // A few starter threads make the "life threads" view meaningful on day one.
  for (const [name, kind] of [
    ["Work", "life"],
    ["Career", "life"],
    ["Health", "life"],
    ["Money", "topic"],
  ] as const) {
    await prisma.thread.create({
      data: {
        userId: user.id,
        name,
        kind,
        slug: name.toLowerCase(),
      },
    });
  }

  console.log(`Seeded user ${email} (id ${user.id}) in ${timezone}.`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
