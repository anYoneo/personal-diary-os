"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client";

type Notification = { status: string; count: number };

export function SettingsForm({
  initial,
  discord,
  reminders,
  outbox,
  trashCount,
}: {
  initial: {
    timezone: string;
    notifyOnEntry: boolean;
    notifyOnReminder: boolean;
    weeklyReflection: boolean;
    onThisDay: boolean;
    reflectionPrompt: boolean;
    quietHoursStart: number | null;
    quietHoursEnd: number | null;
  };
  discord: { linked: boolean; username: string | null; linkedAt: string | null };
  reminders: { id: string; text: string; remindAt: string; recurrence: string }[];
  outbox: Notification[];
  trashCount: number;
}) {
  const router = useRouter();
  const [form, setForm] = useState(initial);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const [linkCode, setLinkCode] = useState<string | null>(null);
  const [linkBusy, setLinkBusy] = useState(false);
  const [discordError, setDiscordError] = useState<string | null>(null);

  async function save(patch: Partial<typeof form>) {
    const next = { ...form, ...patch };
    setForm(next);
    setBusy(true);
    try {
      await api("/api/settings", { method: "PATCH", body: patch });
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function generateCode() {
    setLinkBusy(true);
    setDiscordError(null);
    try {
      const result = await api<{ code: string; expiresAt: string }>("/api/discord/link", {
        method: "POST",
      });
      setLinkCode(result.code);
    } catch (err) {
      setDiscordError(err instanceof Error ? err.message : "Could not generate a code.");
    } finally {
      setLinkBusy(false);
    }
  }

  async function unlink() {
    await api("/api/discord/link", { method: "DELETE" });
    setLinkCode(null);
    router.refresh();
  }

  return (
    <div className="space-y-6">
      {/* ── Notifications ──────────────────────────────────────────────── */}
      <section className="panel px-4 py-4">
        <div className="mb-3 flex items-center justify-between">
          <p className="label">Notifications</p>
          {saved ? (
            <span className="mono fade text-[10px]" style={{ color: "var(--ok)" }}>
              saved
            </span>
          ) : null}
        </div>

        <div className="space-y-2.5">
          <Toggle
            label="Notify me when an entry is saved"
            hint="Sends a Discord message with a short preview."
            checked={form.notifyOnEntry}
            onChange={(v) => void save({ notifyOnEntry: v })}
            disabled={busy}
          />
          <Toggle
            label="Reminders"
            hint="Entry reminders you set, delivered to Discord."
            checked={form.notifyOnReminder}
            onChange={(v) => void save({ notifyOnReminder: v })}
            disabled={busy}
          />
          <Toggle
            label="Weekly reflection"
            hint="Fridays from 17:00 — entry count, words and recurring tags."
            checked={form.weeklyReflection}
            onChange={(v) => void save({ weeklyReflection: v })}
            disabled={busy}
          />
          <Toggle
            label="On this day"
            hint="Evenings, only when an entry exists on today's date in a past year."
            checked={form.onThisDay}
            onChange={(v) => void save({ onThisDay: v })}
            disabled={busy}
          />
          <Toggle
            label="Daily writing prompt"
            hint="Shows a question on the home screen before you have written today."
            checked={form.reflectionPrompt}
            onChange={(v) => void save({ reflectionPrompt: v })}
            disabled={busy}
          />
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div>
            <label className="label mb-1.5 block" htmlFor="tz">
              Timezone
            </label>
            <input
              id="tz"
              value={form.timezone}
              onChange={(e) => setForm({ ...form, timezone: e.target.value })}
              onBlur={(e) => void save({ timezone: e.target.value })}
              className="input"
            />
            <p className="mono mt-1 text-[10px]" style={{ color: "var(--muted-2)" }}>
              decides which day an entry belongs to
            </p>
          </div>
          <div>
            <p className="label mb-1.5">Quiet hours</p>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                max={23}
                value={form.quietHoursStart ?? ""}
                onChange={(e) => setForm({ ...form, quietHoursStart: e.target.value === "" ? null : Number(e.target.value) })}
                onBlur={() => void save({ quietHoursStart: form.quietHoursStart })}
                placeholder="22"
                className="input !py-1.5"
              />
              <span style={{ color: "var(--muted-2)" }}>→</span>
              <input
                type="number"
                min={0}
                max={23}
                value={form.quietHoursEnd ?? ""}
                onChange={(e) => setForm({ ...form, quietHoursEnd: e.target.value === "" ? null : Number(e.target.value) })}
                onBlur={() => void save({ quietHoursEnd: form.quietHoursEnd })}
                placeholder="7"
                className="input !py-1.5"
              />
            </div>
            <p className="mono mt-1 text-[10px]" style={{ color: "var(--muted-2)" }}>
              notifications hold until morning
            </p>
          </div>
        </div>

        {outbox.length ? (
          <div className="mt-4 border-t pt-3" style={{ borderColor: "var(--line-soft)" }}>
            <p className="label mb-1.5">Delivery queue</p>
            <div className="flex flex-wrap gap-2">
              {outbox.map((row) => (
                <span key={row.status} className="chip" data-active={row.status === "pending"}>
                  {row.status}
                  <span style={{ color: "var(--muted-2)" }}>{row.count}</span>
                </span>
              ))}
            </div>
            <p className="mt-2 text-[11.5px]" style={{ color: "var(--muted-2)" }}>
              Rows marked <code className="mono">skipped</code> mean Discord is not configured — the
              app says so rather than pretending it delivered them.
            </p>
          </div>
        ) : null}
      </section>

      {/* ── Discord ────────────────────────────────────────────────────── */}
      <section className="panel px-4 py-4">
        <p className="label mb-3">Discord</p>

        {discord.linked ? (
          <>
            <p className="text-[13px]" style={{ color: "var(--fg-2)" }}>
              Linked as <strong>{discord.username ?? "your Discord account"}</strong>
              {discord.linkedAt ? ` since ${discord.linkedAt.slice(0, 10)}` : ""}.
            </p>
            <p className="mt-2 text-[12.5px] leading-relaxed" style={{ color: "var(--muted)" }}>
              DM the bot, or use <code className="mono">/write</code>, <code className="mono">/search</code>,{" "}
              <code className="mono">/random</code>, <code className="mono">/stats</code>. Messages that start
              with <code className="mono">remember</code>, <code className="mono">idea:</code>,{" "}
              <code className="mono">goal:</code> or <code className="mono">question:</code> are typed
              automatically.
            </p>
            <button type="button" onClick={() => void unlink()} className="btn btn-ghost btn-danger mt-3 !py-1 text-[12px]">
              Unlink account
            </button>
          </>
        ) : (
          <>
            <p className="text-[13px] leading-relaxed" style={{ color: "var(--muted)" }}>
              Generate a code, then run <code className="mono">/link &lt;code&gt;</code> in Discord. The
              link is explicit — the bot never guesses whose diary a DM belongs to.
            </p>

            {linkCode ? (
              <div className="fade mt-3 rounded-[8px] border px-3 py-3" style={{ borderColor: "var(--accent-line)", background: "var(--accent-soft)" }}>
                <p className="label mb-1">Your code · valid 10 minutes</p>
                <p className="mono text-[20px] tracking-[0.2em]" style={{ color: "var(--accent)" }}>
                  {linkCode}
                </p>
                <p className="mt-1.5 text-[12px]" style={{ color: "var(--fg-2)" }}>
                  In Discord: <code className="mono">/link {linkCode}</code>
                </p>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => void generateCode()}
                disabled={linkBusy}
                className="btn mt-3"
              >
                {linkBusy ? "Generating…" : "Generate link code"}
              </button>
            )}

            {discordError ? (
              <p className="fade mt-2 text-[12.5px]" style={{ color: "var(--danger)" }}>
                {discordError}
              </p>
            ) : null}
          </>
        )}
      </section>

      {/* ── Reminders ──────────────────────────────────────────────────── */}
      <section className="panel px-4 py-4">
        <p className="label mb-3">Reminders</p>
        {reminders.length ? (
          <ul className="space-y-2">
            {reminders.map((reminder) => (
              <li key={reminder.id} className="flex items-baseline justify-between gap-3">
                <span className="text-[13px]" style={{ color: "var(--fg-2)" }}>
                  {reminder.text}
                </span>
                <span className="mono shrink-0 text-[10px]" style={{ color: "var(--muted-2)" }}>
                  {new Date(reminder.remindAt).toLocaleString("en-GB", {
                    day: "2-digit",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                  {reminder.recurrence !== "none" ? ` · ${reminder.recurrence}` : ""}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[12.5px]" style={{ color: "var(--muted-2)" }}>
            No reminders. Set one from Discord with <code className="mono">/remind</code> — the worker
            delivers it.
          </p>
        )}
      </section>

      {/* ── Trash ──────────────────────────────────────────────────────── */}
      <section className="panel px-4 py-4">
        <p className="label mb-2">Trash</p>
        <p className="text-[12.5px]" style={{ color: "var(--muted)" }}>
          {trashCount === 0
            ? "Empty. Deleted entries are kept here instead of being erased."
            : `${trashCount} deleted ${trashCount === 1 ? "entry" : "entries"} waiting.`}
        </p>
        {trashCount > 0 ? (
          <Link href="/trash" className="btn mt-3 !py-1 text-[12px]">
            Open trash
          </Link>
        ) : null}
      </section>
    </div>
  );
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 accent-[var(--accent)]"
      />
      <span>
        <span className="block text-[13px]" style={{ color: "var(--fg-2)" }}>
          {label}
        </span>
        <span className="mono block text-[10.5px]" style={{ color: "var(--muted-2)" }}>
          {hint}
        </span>
      </span>
    </label>
  );
}
