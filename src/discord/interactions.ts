import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import { logError } from "@/lib/errors";

/**
 * Discord interaction (webhook) mode. Only used when DISCORD_PUBLIC_KEY is set
 * and the app is exposed over HTTPS; otherwise the gateway bot (src/discord/bot.ts)
 * handles commands. Signature verification uses Node's crypto with the raw body
 * bytes, which is the only correct way to check Ed25519 here.
 */

type Interaction = {
  id: string;
  type: number;
  data?: { name?: string; options?: { name: string; value: string | number | boolean }[] };
  member?: { user?: { id: string; username: string } };
  user?: { id: string; username: string };
  guild_id?: string;
};

export const INTERACTION_PING = 1;
export const INTERACTION_COMMAND = 2;

export async function verifySignature(
  rawBody: string,
  signature: string,
  timestamp: string,
): Promise<boolean> {
  const publicKey = config.discord.publicKey;
  if (!publicKey) return false;

  const { createPublicKey, verify } = await import("node:crypto");
  try {
    // Discord supplies a raw hex Ed25519 key; wrap it in SPKI DER for Node.
    const der = Buffer.concat([
      Buffer.from("302a300506032b6570032100", "hex"),
      Buffer.from(publicKey, "hex"),
    ]);
    const key = createPublicKey({ key: der, format: "der", type: "spki" });
    return verify(null, Buffer.from(timestamp + rawBody), key, Buffer.from(signature, "hex"));
  } catch (error) {
    logError("discord.verify", error);
    return false;
  }
}

export async function handleInteraction(
  rawBody: string,
  signature: string,
  timestamp: string,
): Promise<Response> {
  if (!config.discord.publicKey) {
    return NextResponse.json(
      { error: "Discord public key not configured. Use the gateway bot instead." },
      { status: 503 },
    );
  }

  const valid = await verifySignature(rawBody, signature, timestamp);
  if (!valid) return NextResponse.json({ error: "invalid signature" }, { status: 401 });

  let interaction: Interaction;
  try {
    interaction = JSON.parse(rawBody) as Interaction;
  } catch {
    return NextResponse.json({ error: "bad payload" }, { status: 400 });
  }

  if (interaction.type === INTERACTION_PING) {
    return NextResponse.json({ type: 1 });
  }

  if (interaction.type === INTERACTION_COMMAND) {
    const { runCommand } = await import("./commands");
    const discordUserId = interaction.member?.user?.id ?? interaction.user?.id;
    const username = interaction.member?.user?.username ?? interaction.user?.username ?? null;
    if (!discordUserId) {
      return NextResponse.json({ type: 4, data: { content: "Could not identify your account." } });
    }

    const reply = await runCommand({
      name: interaction.data?.name ?? "",
      options: Object.fromEntries(
        (interaction.data?.options ?? []).map((o) => [o.name, String(o.value)]),
      ),
      discordUserId,
      username,
      guildId: interaction.guild_id ?? null,
    });

    // Deferred: the diary work happens behind an edit, keeping us inside the 3s ack.
    return NextResponse.json(reply);
  }

  return NextResponse.json({ type: 4, data: { content: "Unsupported interaction." } });
}
