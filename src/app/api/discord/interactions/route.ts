import { NextResponse } from "next/server";
import { apiHandler, json } from "@/lib/api";
import { logError } from "@/lib/errors";
import { handleInteraction } from "@/discord/interactions";

/**
 * Discord interactions endpoint (HTTP mode). Signatures are verified against the
 * app's Ed25519 public key inside handleInteraction; an unsigned or tampered
 * request is rejected before any diary code runs.
 */
export const POST = apiHandler("discord.interactions", async (request: Request) => {
  const signature = request.headers.get("x-signature-ed25519");
  const timestamp = request.headers.get("x-signature-timestamp");
  const raw = await request.text();

  if (!signature || !timestamp) {
    return NextResponse.json({ error: "missing signature" }, { status: 401 });
  }

  const response = await handleInteraction(raw, signature, timestamp);
  if (response.status === 401) {
    logError("discord.interactions", new Error("signature rejected"));
  }
  return response;
});

export const GET = apiHandler("discord.interactions.probe", async () =>
  json({ ok: true, hint: "This endpoint only accepts signed Discord interactions." }),
);
