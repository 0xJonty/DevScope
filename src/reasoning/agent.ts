import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { z } from "zod";
import { assertAuthMode, config } from "../config.js";

export class RateLimitPause extends Error {
  constructor(detail: string) {
    super(`Claude usage limit hit — scan will pause and can resume later. Detail: ${detail}`);
    this.name = "RateLimitPause";
  }
}

export class AgentOutputError extends Error {
  constructor(detail: string) {
    super(`Agent output failed schema validation: ${detail}`);
    this.name = "AgentOutputError";
  }
}

const RATE_LIMIT_RE = /rate.?limit|usage limit|limit reached|overloaded|429|quota/i;

const IMAGE_MEDIA_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

export interface AgentRunOptions {
  model: string;
  maxTurns: number;
  jsonSchema: Record<string, unknown>;
  /** Token image attached directly as a base64 content block (vision). The
   * agent must NOT need the Read tool for it: SDK sessions previously
   * inherited the user's global hooks, and a PreToolUse gate blocked Read
   * (observed live 2026-10-05). */
  imagePath?: string | null;
  onActivity?: (message: string) => void;
}

/**
 * Scrapling MCP (SCRAPLING_MCP_COMMAND) gives agents a stealth-browser fetch
 * for link verification — the built-in WebFetch is a plain bot fetch that x.com
 * answers with HTTP 402 (pay-per-crawl) and Instagram/protected sites block.
 * `settingSources: []` strips user-level MCP config, so the server must be
 * passed explicitly here. Unconfigured degrades to WebFetch-only with one loud
 * warning; a configured-but-missing binary aborts.
 */
let warnedNoScrapling = false;
function resolveScraplingMcp(onActivity?: (message: string) => void): { type: "stdio"; command: string } | null {
  const command = config.scraplingMcpCommand;
  if (!command) {
    if (!warnedNoScrapling) {
      warnedNoScrapling = true;
      const msg =
        "SCRAPLING_MCP_COMMAND unset — agents fall back to built-in WebFetch; X/Instagram links will fail (HTTP 402 / bot-blocked)";
      console.warn(`[reasoning] ${msg}`);
      onActivity?.(msg);
    }
    return null;
  }
  if (command.startsWith("/") && !existsSync(command)) {
    throw new Error(`SCRAPLING_MCP_COMMAND points to a missing binary: ${command}`);
  }
  return { type: "stdio", command };
}

type ContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } };

async function buildPrompt(prompt: string, imagePath: string | null | undefined): Promise<string | AsyncIterable<SDKUserMessage>> {
  if (!imagePath || !existsSync(imagePath)) return prompt;
  const mediaType = IMAGE_MEDIA_TYPES[extname(imagePath).toLowerCase()] ?? "image/jpeg";
  const data = await readFile(imagePath, "base64");
  const content: ContentBlock[] = [
    { type: "text", text: prompt },
    { type: "image", source: { type: "base64", media_type: mediaType, data } },
  ];
  async function* messages(): AsyncGenerator<SDKUserMessage> {
    yield {
      type: "user",
      message: { role: "user", content },
      parent_tool_use_id: null,
    } as SDKUserMessage;
  }
  return messages();
}

/**
 * Layer B entry point (PLAN.md §8): one curated prompt in, one schema-validated
 * JSON object out. Web search + fetch enabled, plus the Scrapling MCP fetch
 * tools when configured; the token image rides along as
 * an inline content block. `settingSources: []` keeps the pipeline session
 * hermetic — no user/project settings, hooks, or CLAUDE.md leak in.
 * Subscription auth guard runs before every call.
 */
export async function runAgentJson<T>(
  prompt: string,
  zodSchema: z.ZodType<T>,
  opts: AgentRunOptions
): Promise<T> {
  assertAuthMode();

  if (opts.imagePath && !existsSync(opts.imagePath)) {
    opts.onActivity?.(`image file missing at ${opts.imagePath} — running without vision`);
  }

  const scrapling = resolveScraplingMcp(opts.onActivity);

  let structured: unknown;
  let resultText = "";
  try {
    for await (const message of query({
      prompt: await buildPrompt(prompt, opts.imagePath),
      options: {
        model: opts.model,
        maxTurns: opts.maxTurns,
        allowedTools: scrapling
          ? ["WebSearch", "WebFetch", "mcp__scrapling__get", "mcp__scrapling__stealthy_fetch"]
          : ["WebSearch", "WebFetch"],
        ...(scrapling ? { mcpServers: { scrapling } } : {}),
        permissionMode: "bypassPermissions",
        settingSources: [],
        systemPrompt:
          "You are a precise crypto-market analyst inside an automated pipeline. Follow the task exactly; output only what the schema asks for.",
        outputFormat: { type: "json_schema", schema: opts.jsonSchema },
      },
    })) {
      if (message.type === "assistant") {
        for (const block of message.message.content) {
          if (block.type === "tool_use" && opts.onActivity) {
            const input = JSON.stringify(block.input).slice(0, 120);
            opts.onActivity(`${block.name} ${input}`);
          }
        }
      }
      if (message.type === "result") {
        if (message.subtype === "success") {
          structured = (message as { structured_output?: unknown }).structured_output;
          resultText = (message as { result?: string }).result ?? "";
        } else {
          throw new Error(`agent result: ${message.subtype}`);
        }
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (RATE_LIMIT_RE.test(msg)) throw new RateLimitPause(msg);
    throw err;
  }

  const candidate = structured ?? tryParseJson(resultText);
  const parsed = zodSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new AgentOutputError(`${parsed.error.message.slice(0, 600)} — raw: ${JSON.stringify(candidate).slice(0, 300)}`);
  }
  return parsed.data;
}

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
}
