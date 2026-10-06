import { aiConfigured, config } from "../config";
import { prisma } from "../db";

/**
 * AI layer. It is deliberately a seam, not a feature: with no provider configured
 * every call returns `{ available: false }` and the UI says so. Nothing is faked,
 * and no AI output is ever written into an entry's original text — insights land
 * in AiInsight rows and are rendered in their own visually distinct block.
 */
export type AiResult<T> = { available: false; reason: string } | { available: true; value: T };

const NOT_CONFIGURED: AiResult<never> = {
  available: false,
  reason: "No AI provider configured. Set AI_BASE_URL, AI_API_KEY and AI_MODEL in .env.",
};

export type AiTask =
  | "summary"
  | "tags"
  | "entities"
  | "reflection"
  | "similar"
  | "pattern"
  | "contradiction";

const SYSTEM = `You help one person with their private diary.
Rules you must never break:
- Never rewrite or paraphrase the user's original entry text as if it were the entry.
- Only use the facts present in the supplied entries. If something is not in the entries, say you don't know.
- Clearly mark interpretation as interpretation.
- Be brief. No flattery, no filler.`;

export type AiRequest = {
  task: AiTask;
  /** Verbatim entry text supplied as evidence. */
  entries: { id: string; day: string; text: string }[];
  question?: string;
  /** Bounded so a month of writing cannot blow up the request. */
  maxChars?: number;
};

/**
 * Single entry point for model calls. Returns the model's text plus the ids it
 * was given, so callers can always show "based on these entries".
 */
export async function runAi(
  request: AiRequest,
): Promise<AiResult<{ text: string; sourceEntryIds: string[]; model: string }>> {
  if (!aiConfigured()) return NOT_CONFIGURED;

  const budget = request.maxChars ?? 12_000;
  let used = 0;
  const sources: string[] = [];
  const blocks: string[] = [];

  for (const entry of request.entries) {
    const chunk = entry.text.slice(0, Math.max(0, budget - used));
    if (!chunk) break;
    used += chunk.length;
    sources.push(entry.id);
    blocks.push(`<entry id="${entry.id}" day="${entry.day}">\n${chunk}\n</entry>`);
  }

  if (!blocks.length) return { available: false, reason: "No entries to analyse yet." };

  const prompt = [
    `Task: ${request.task}.`,
    request.question ? `Question: ${request.question}` : "",
    "",
    "Entries (verbatim, private):",
    blocks.join("\n\n"),
    "",
    "Answer in markdown, at most 200 words. Cite entry days, not ids.",
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const response = await fetch(endpoint(), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.ai.apiKey}`,
      },
      body: JSON.stringify({
        model: config.ai.model,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: prompt },
        ],
        temperature: 0.3,
      }),
      signal: AbortSignal.timeout(60_000),
    });

    if (!response.ok) {
      // Never echo the provider body — it can contain the prompt.
      return { available: false, reason: `Provider returned ${response.status}.` };
    }

    const payload = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
      content?: { text?: string }[];
    };
    const text =
      payload.choices?.[0]?.message?.content?.trim() ?? payload.content?.[0]?.text?.trim() ?? "";

    if (!text) return { available: false, reason: "Provider returned an empty response." };
    return { available: true, value: { text, sourceEntryIds: sources, model: config.ai.model } };
  } catch (error) {
    return {
      available: false,
      reason: `AI request failed: ${error instanceof Error ? error.message : "unknown error"}`,
    };
  }
}

function endpoint(): string {
  const base = config.ai.baseUrl.toLowerCase().replace(/\/$/, "");
  if (base === "openai") return "https://api.openai.com/v1/chat/completions";
  if (base === "openrouter") return "https://openrouter.ai/api/v1/chat/completions";
  if (base === "groq") return "https://api.groq.com/openai/v1/chat/completions";
  if (base === "deepseek") return "https://api.deepseek.com/chat/completions";
  // Anything else is a URL the user supplied. If it is a bare host, assume the
  // OpenAI-compatible path on it.
  if (/^https?:\/\//.test(base)) {
    return base.endsWith("/chat/completions") ? base : `${base}/chat/completions`;
  }
  return `https://${base}/v1/chat/completions`;
}

/** Persist an insight. Original entry text is never touched. */
export async function saveInsight(params: {
  userId: string;
  subjectType: string;
  subjectId?: string | null;
  kind: AiTask;
  model: string;
  content: unknown;
  entryId?: string | null;
}): Promise<void> {
  await prisma.aiInsight.create({
    data: {
      userId: params.userId,
      subjectType: params.subjectType,
      subjectId: params.subjectId ?? null,
      kind: params.kind,
      model: params.model,
      content: JSON.stringify(params.content),
      entryId: params.entryId ?? null,
    },
  });
}

export async function insightsFor(userId: string, subjectType: string, subjectId?: string) {
  return prisma.aiInsight.findMany({
    where: { userId, subjectType, ...(subjectId ? { subjectId } : {}) },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
}

export const aiStatus = () => ({
  configured: aiConfigured(),
  provider: aiConfigured() ? config.ai.baseUrl : null,
  model: aiConfigured() ? config.ai.model : null,
});
