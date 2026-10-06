import { Shell } from "@/components/shell";
import { requireUser } from "@/lib/auth";
import { searchEntries, mentionStats } from "@/lib/services/memory";
import { prisma } from "@/lib/db";
import { ENTRY_TYPES, MOODS } from "@/lib/validation";
import Link from "next/link";
import { excerpt } from "@/lib/markdown";
import { aiConfigured } from "@/lib/config";

export const dynamic = "force-dynamic";

export default async function SearchPage({ searchParams }: PageProps<"/search">) {
  const params = await searchParams;
  const user = await requireUser();

  const str = (key: string) => (typeof params[key] === "string" ? (params[key] as string) : undefined);
  const q = str("q") ?? "";
  const tag = str("tag");
  const type = str("type");
  const mood = str("mood");
  const from = str("from");
  const to = str("to");
  const important = str("important") === "true";

  const hasQuery = Boolean(q || tag || type || mood || from || to || important);

  const result = hasQuery
    ? await searchEntries(user.id, { q, tag, type, mood, from, to, limit: 40 })
    : null;

  // Filter options come from what exists, so the UI never offers a dead filter.
  const [tags, tagsInUse, totals, importantIds, mention] = await Promise.all([
    prisma.tag.findMany({ where: { userId: user.id }, orderBy: { name: "asc" }, take: 60 }),
    prisma.entryTag.groupBy({
      by: ["tagId"],
      where: { entry: { userId: user.id, deletedAt: null } },
      _count: { _all: true },
      orderBy: { _count: { tagId: "desc" } },
      take: 12,
    }),
    prisma.entry.aggregate({
      where: { userId: user.id, deletedAt: null },
      _count: { _all: true },
      _sum: { wordCount: true },
    }),
    prisma.entry
      .findMany({
        where: { userId: user.id, deletedAt: null, isImportant: true },
        select: { id: true },
      })
      .then((rows) => new Set(rows.map((r) => r.id))),
    q ? mentionStats(user.id, q) : Promise.resolve(null),
  ]);

  const tagNames = new Map(tags.map((t) => [t.id, t.slug]));

  const shown = important
    ? (result?.hits ?? []).filter((hit) => importantIds.has(hit.id))
    : (result?.hits ?? []);

  return (
    <Shell>
      <header className="rise">
        <p className="label">Search</p>
        <h1 className="mt-2 font-serif text-[26px]" style={{ color: "var(--fg)" }}>
          Find what you were thinking.
        </h1>
        <p className="mt-1.5 text-[13px]" style={{ color: "var(--muted)" }}>
          {totals._count._all} entries · {(totals._sum.wordCount ?? 0).toLocaleString("en-US")} words in the
          archive.
        </p>
      </header>

      <form method="get" className="rise mt-6 space-y-3" style={{ animationDelay: "60ms" }}>
        <input
          name="q"
          defaultValue={q}
          placeholder="try: credit limit · oracle · career stress · money"
          className="input !py-2.5 !text-[15px]"
          autoFocus
        />

        <div className="flex flex-wrap gap-1.5">
          {type ? <input type="hidden" name="type" value={type} /> : null}
          {mood ? <input type="hidden" name="mood" value={mood} /> : null}
          {tag ? <input type="hidden" name="tag" value={tag} /> : null}
        </div>

        <details className="panel-flat px-3.5 py-3">
          <summary className="cursor-pointer text-[12px] select-none" style={{ color: "var(--muted)" }}>
            Filters {hasQuery ? <span style={{ color: "var(--accent)" }}>· active</span> : null}
          </summary>

          <div className="mt-3.5 grid gap-4 md:grid-cols-2">
            <div>
              <p className="label mb-2">Type</p>
              <div className="flex flex-wrap gap-1.5">
                {ENTRY_TYPES.map((t) => (
                  <Link
                    key={t}
                    href={buildQuery({ q, tag, mood, from, to, type: type === t ? undefined : t })}
                    className="chip"
                    data-active={type === t}
                  >
                    {t}
                  </Link>
                ))}
              </div>
            </div>

            <div>
              <p className="label mb-2">Mood</p>
              <div className="flex flex-wrap gap-1.5">
                {MOODS.map((m) => (
                  <Link
                    key={m.key}
                    href={buildQuery({ q, tag, type, from, to, mood: mood === m.key ? undefined : m.key })}
                    className="chip"
                    data-active={mood === m.key}
                    title={m.label}
                  >
                    {m.emoji} {m.label}
                  </Link>
                ))}
              </div>
            </div>

            <div>
              <p className="label mb-2">Common tags</p>
              <div className="flex flex-wrap gap-1.5">
                {tagsInUse.map((row) => {
                  const slug = tagNames.get(row.tagId);
                  if (!slug) return null;
                  return (
                    <Link
                      key={row.tagId}
                      href={buildQuery({ q, type, mood, from, to, tag: tag === slug ? undefined : slug })}
                      className="chip"
                      data-active={tag === slug}
                    >
                      #{slug}
                      <span style={{ color: "var(--muted-2)" }}>{row._count._all}</span>
                    </Link>
                  );
                })}
                {tagsInUse.length === 0 ? (
                  <span className="text-[12px]" style={{ color: "var(--muted-2)" }}>
                    No tags yet.
                  </span>
                ) : null}
              </div>
            </div>

            <div>
              <p className="label mb-2">Date range</p>
              <div className="flex items-center gap-2">
                <input type="date" name="from" defaultValue={from ?? ""} className="input !py-1.5 !text-[12px]" />
                <span style={{ color: "var(--muted-2)" }}>→</span>
                <input type="date" name="to" defaultValue={to ?? ""} className="input !py-1.5 !text-[12px]" />
              </div>
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between">
            <label className="flex items-center gap-2 text-[12px]" style={{ color: "var(--muted)" }}>
              <input
                type="checkbox"
                name="important"
                value="true"
                defaultChecked={important}
                className="accent-[var(--accent)]"
              />
              Only important
            </label>
            <div className="flex gap-2">
              {hasQuery ? (
                <Link href="/search" className="btn btn-ghost !py-1 text-[12px]">
                  Clear
                </Link>
              ) : null}
              <button type="submit" className="btn btn-accent !py-1 text-[12px]">
                Apply
              </button>
            </div>
          </div>
        </details>
      </form>

      {mention && mention.mentions > 0 ? (
        <section className="rise mt-6 rounded-[10px] border px-4 py-3" style={{ borderColor: "var(--accent-line)", background: "var(--accent-soft)" }}>
          <p className="label mb-1">Mention history · “{mention.keyword}”</p>
          <p className="text-[13px]" style={{ color: "var(--fg-2)" }}>
            {mention.mentions} {mention.mentions === 1 ? "mention" : "mentions"} · first{" "}
            <Link href={`/entry/${mention.firstMention?.id}`} className="underline">
              {mention.firstMention?.day}
            </Link>{" "}
            · last{" "}
            <Link href={`/entry/${mention.lastMention?.id}`} className="underline">
              {mention.lastMention?.day}
            </Link>
          </p>
          {mention.byMonth.length > 1 ? (
            <div className="mt-3 flex items-end gap-[3px]">
              {mention.byMonth.map((bucket) => (
                <span
                  key={bucket.month}
                  title={`${bucket.month} — ${bucket.count}`}
                  style={{
                    width: 10,
                    height: 6 + Math.min(bucket.count, 12) * 3,
                    background: "var(--accent)",
                    opacity: 0.75,
                    borderRadius: 2,
                    display: "inline-block",
                  }}
                />
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      <div className="stagger mt-7 space-y-2.5">
        {result ? (
          shown.length ? (
            shown.map((hit) => (
              <Link key={hit.id} href={`/entry/${hit.id}`} className="panel block px-4 py-3.5">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-serif text-[15.5px]" style={{ color: "var(--fg)" }}>
                    {hit.title || "(untitled)"}
                  </span>
                  <span className="mono shrink-0 text-[10px]" style={{ color: "var(--muted-2)" }}>
                    {hit.day}
                  </span>
                </div>
                <p className="mt-1 text-[13px] leading-relaxed" style={{ color: "var(--muted)" }}>
                  {hit.excerpt}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2.5">
                  <span className="mono text-[10px]" style={{ color: "var(--accent)" }}>
                    matched in {hit.matchedIn}
                  </span>
                  <span className="mono text-[10px]" style={{ color: "var(--muted-2)" }}>
                    {hit.entryType}
                  </span>
                  {hit.tags.slice(0, 3).map((t) => (
                    <span key={t} className="mono text-[10px]" style={{ color: "var(--muted-2)" }}>
                      #{t}
                    </span>
                  ))}
                </div>
              </Link>
            ))
          ) : (
            <div className="panel px-5 py-8 text-center">
              <p className="text-[13.5px]" style={{ color: "var(--muted)" }}>
                {important
                  ? "Nothing important matches those filters."
                  : `Nothing matches. ${result.total} entries exist overall.`}
              </p>
              <p className="mt-2 text-[12px]" style={{ color: "var(--muted-2)" }}>
                Search is keyword-based and searches the full text of every entry.
              </p>
            </div>
          )
        ) : (
          <div className="panel px-5 py-8 text-center">
            <p className="font-serif text-[16px]" style={{ color: "var(--fg-2)" }}>
              Search the whole archive.
            </p>
            <p className="mx-auto mt-2 max-w-sm text-[13px] leading-relaxed" style={{ color: "var(--muted)" }}>
              Everything you have written is searchable — including entries captured from Discord.
            </p>
          </div>
        )}
      </div>

      <p className="mt-6 text-[11.5px]" style={{ color: "var(--muted-2)" }}>
        {aiConfigured()
          ? "Semantic search is available under Insights."
          : "Keyword search today. Semantic search ships behind an AI provider — set AI_PROVIDER, AI_API_KEY and AI_MODEL to enable it."}
      </p>
    </Shell>
  );
}

function buildQuery(values: Record<string, string | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value) params.set(key, value);
  }
  const query = params.toString();
  return query ? `/search?${query}` : "/search";
}
