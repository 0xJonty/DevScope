import { bands } from "../config.js";
import type { TokenRow } from "../db/tokens.js";
import type { Synthesis } from "../reasoning/schemas.js";
import type { Fingerprint } from "./types.js";

export interface ProfileMeta {
  wallet: string;
  alias: string | null;
  scannedAt: string;
  updatedAt: string;
  window: { n: number; from: string | null; to: string | null };
  lifetime: {
    total_deploys: number | null;
    total_graduated: number | null;
    best_ath_usd: number | null;
    best_mint: string | null;
    best_at: string | null;
  };
  tokensAnalyzed: { worked: number; mid: number; failed: number; dossier_count: number };
  bandsVersion: string;
  promptVersions: { thesis: string; synthesis: string };
  dataProviders: string[];
}

export interface ThesisForRender {
  token: TokenRow;
  classification: string;
  json: Record<string, unknown>;
}

const usd = (n: number | null | undefined) =>
  n == null ? "—" : `$${Math.round(n).toLocaleString("en-US")}`;

function fingerprintTable(fp: Fingerprint): string {
  const hours = fp.activeHoursUtc.map((c, h) => ({ h, c })).filter((x) => x.c > 0);
  const activeStr =
    hours.length === 0
      ? "—"
      : `peak ${fp.peakHourUtc}:00 UTC (${fp.inferredTimezoneGuess ?? "tz unknown"})`;
  return [
    "| Metric | Value |",
    "|---|---|",
    `| Window span | ${fp.windowDays} days |`,
    `| Deploys/day | ${fp.deploysPerDay} |`,
    `| Median gap between deploys | ${fp.medianGapMinutes == null ? "—" : Math.round(fp.medianGapMinutes) + " min"} |`,
    `| Active hours | ${activeStr} |`,
    `| Bond rate | ${(fp.bondRate * 100).toFixed(1)}% (${fp.counts.worked}/${fp.counts.total}) |`,
    `| ATH distribution | median ${usd(fp.athUsd.median)} · p90 ${usd(fp.athUsd.p90)} · max ${usd(fp.athUsd.max)} |`,
    `| Token lifespan (hours) | median ${fp.lifespanHours.median?.toFixed(1) ?? "—"} · p90 ${fp.lifespanHours.p90?.toFixed(1) ?? "—"} |`,
    `| Cashback coins | ${fp.cashbackShare == null ? "—" : (fp.cashbackShare * 100).toFixed(1) + "%"} |`,
    `| Naming patterns (hits) | ${Object.entries(fp.namingPatterns).filter(([, v]) => v > 0).map(([k, v]) => `${k}:${v}`).join(", ") || "—"} |`,
    `| Dev-buy sizes | ${fp.devBuyNote} |`,
  ].join("\n");
}

function renderThesis(t: ThesisForRender): string {
  const j = t.json;
  const head = `### ${t.token.name} ($${t.token.ticker}) — ${usd(t.token.athUsd)} ATH${t.token.bonded ? " · bonded" : ""}`;
  const links = `[pump.fun](https://pump.fun/coin/${t.token.mint}) · [solscan](https://solscan.io/token/${t.token.mint}) · \`${t.token.mint}\``;
  if (j.generation_failed) {
    return `${head}\n${links}\n\n*Thesis generation failed:* ${String(j.error ?? "unknown error")}`;
  }
  const evidence = Array.isArray(j.evidence)
    ? (j.evidence as Array<{ claim: string; source_url: string; found: boolean }>)
        .map((e) => `- ${e.found ? "✓" : "✗ (not found)"} ${e.claim}${e.source_url ? ` — ${e.source_url}` : ""}`)
        .join("\n")
    : "";
  return [
    head,
    links,
    "",
    `**${j.narrative_category}** · timing: ${j.timing} · confidence: **${j.confidence}**`,
    "",
    String(j.thesis ?? ""),
    j.image_notes ? `\n*Image:* ${j.image_notes}` : "",
    evidence ? `\n**Evidence:**\n${evidence}` : "",
    j.unknowns ? `\n*Unknowns:* ${j.unknowns}` : "",
  ]
    .filter((s) => s !== "")
    .join("\n");
}

/** Deterministic assembly of PROFILE.md (PLAN.md §9.2). Layer A owns the
 * frontmatter, fingerprint table and thesis rendering; Layer B wrote only the
 * synthesis sections. */
export function renderProfile(
  meta: ProfileMeta,
  fp: Fingerprint,
  synthesis: Synthesis,
  theses: ThesisForRender[]
): string {
  const by = (cls: string) => theses.filter((t) => t.classification === cls);
  const section = (title: string, items: ThesisForRender[]) =>
    items.length ? `# ${title}\n\n${items.map(renderThesis).join("\n\n---\n\n")}` : `# ${title}\n\n*None in this scan.*`;

  const frontmatter = [
    "---",
    `wallet: ${meta.wallet}`,
    `alias: ${meta.alias ?? "null"}`,
    `scanned_at: ${meta.scannedAt}`,
    `updated_at: ${meta.updatedAt}`,
    `window: { n: ${meta.window.n}, from: ${meta.window.from ?? "null"}, to: ${meta.window.to ?? "null"} }`,
    `lifetime: { total_deploys: ${meta.lifetime.total_deploys ?? "null"}, total_graduated: ${meta.lifetime.total_graduated ?? "null"}, best_ath_usd: ${meta.lifetime.best_ath_usd ?? "null"}, best_mint: ${meta.lifetime.best_mint ?? "null"}, best_at: ${meta.lifetime.best_at ?? "null"} }`,
    `tokens_analyzed: { worked: ${meta.tokensAnalyzed.worked}, mid: ${meta.tokensAnalyzed.mid}, failed: ${meta.tokensAnalyzed.failed}, dossier_count: ${meta.tokensAnalyzed.dossier_count} }`,
    `bands_version: ${meta.bandsVersion}`,
    `bands_mid_min_ath_usd: ${bands.mid_min_ath_usd}`,
    `prompt_version_thesis: ${meta.promptVersions.thesis}`,
    `prompt_version_synthesis: ${meta.promptVersions.synthesis}`,
    `data_providers: [${meta.dataProviders.join(", ")}]`,
    "---",
  ].join("\n");

  return [
    frontmatter,
    `# Verdict\n\n${synthesis.verdict}`,
    `# Statistical fingerprint\n\n${fingerprintTable(fp)}`,
    `# What works for them\n\n${synthesis.what_works_md}`,
    `# What fails for them\n\n${synthesis.what_fails_md}`,
    section("Top deploys — theses", by("worked").concat(by("pinned"))),
    section("Mid tier — theses", by("mid")),
    section("Representative failures — theses", by("failed")),
    `# Low-confidence notes / open questions\n\n${synthesis.open_questions_md}`,
  ].join("\n\n");
}
