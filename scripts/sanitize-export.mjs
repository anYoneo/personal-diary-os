#!/usr/bin/env node
/**
 * Rewrites this instance's private infrastructure details in an EXPORTED COPY,
 * so the published tree carries no personal footprint.
 *
 * Run it from the clean export, never in the working tree — it refuses if it
 * finds a `.git` directory (the export has none, so the check is reliable).
 *
 *   node scripts/sanitize-export.mjs [--check]
 *
 * `--check` reports what it would change and exits non-zero if anything private
 * remains, which is what the exporter uses to verify its own output.
 *
 * The values live in `.publish-redactions.json`, which is gitignored: the file
 * tells this script what to look for, so keeping the values here would defeat the
 * purpose — the script would rewrite its own defaults, and the verification pass
 * would then read the placeholders as if they were still private. Do not inline
 * them again.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join, relative, extname } from "node:path";

const CHECK_ONLY = process.argv.includes("--check");
const CONFIG_NAME = ".publish-redactions.json";

const here = process.cwd();
if (existsSync(join(here, ".git"))) {
  console.error(
    "refusing to run in the working tree (.git found).\n" +
      "Export a clean copy first: `bash scripts/export-public-repo.sh`",
  );
  process.exit(1);
}

let config;
try {
  config = JSON.parse(readFileSync(join(here, CONFIG_NAME), "utf8"));
} catch (error) {
  console.error(
    `cannot read ${CONFIG_NAME} in the export: ${String(error)}\n` +
      "The exporter copies it from the working tree; run the export script.",
  );
  process.exit(1);
}

const escape = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Longest first, so a URL is rewritten before any substring of it. */
const RULES = [
  { note: "live app URL", from: new RegExp(escape(config.appUrl), "g"), to: config.exampleUrl },
  { note: "owner email", from: new RegExp(escape(config.ownerEmail), "g"), to: "you@example.com" },
  { note: "VPS name", from: new RegExp(`\\b${escape(config.vm)}\\b`, "g"), to: "diary-vm" },
  { note: "Windows path", from: new RegExp(`[Cc]:[/\\\\]{1,2}Users[/\\\\]{1,2}${escape(config.windowsUser)}`, "g"), to: "C:/Users/you" },
  { note: "MSYS path", from: new RegExp(`/c/Users/${escape(config.windowsUser)}`, "g"), to: "/c/Users/you" },
  { note: "Discord owner id", from: new RegExp(escape(config.ownerDiscordId), "g"), to: "000000000000000000" },
];

const SKIP_DIRS = new Set(["node_modules", ".next", ".git", "dist", "build", ".turbo"]);
/** Never rewritten: the config states what to look for, so scanning it would
 *  erase the very values the next pass needs (it rewrites itself, and the
 *  verification pass then reads placeholders and reports everything as dirty). */
const SKIP_FILES = new Set([CONFIG_NAME]);
const BINARY = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".pdf",
  ".woff", ".woff2", ".ttf", ".zip", ".gz", ".mp4",
]);

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      yield* walk(full);
      continue;
    }
    if (SKIP_FILES.has(entry.name)) continue;
    if (BINARY.has(extname(entry.name).toLowerCase())) continue;
    yield full;
  }
}

const findings = [];
let changed = 0;

for await (const file of walk(here)) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  const original = text;
  for (const rule of RULES) {
    const matches = text.match(rule.from);
    if (!matches) continue;
    findings.push({ file: relative(here, file), note: rule.note, count: matches.length });
    text = text.replace(rule.from, rule.to);
  }
  if (text !== original) {
    changed++;
    if (!CHECK_ONLY) writeFileSync(file, text);
  }
}

if (!findings.length) {
  console.log("clean: no private infrastructure details found");
  process.exit(0);
}

console.log(`${CHECK_ONLY ? "would redact" : "redacted"} ${findings.length} occurrence group(s):`);
for (const f of findings.sort((a, b) => a.file.localeCompare(b.file))) {
  console.log(`  ${f.count}× ${f.note.padEnd(18)} ${f.file}`);
}

if (CHECK_ONLY) {
  console.error("\nprivate details remain — the export is not publishable");
  process.exit(1);
}
console.log("\nexport sanitised");
