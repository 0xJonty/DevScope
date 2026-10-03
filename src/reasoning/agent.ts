import { query } from "@anthropic-ai/claude-agent-sdk";
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

export interface AgentRunOptions {
  model: string;
  maxTurns: number;
  jsonSchema: Record<string, unknown>;
  /** Directories the agent may Read from (token images). */
  readDirs?: string[];
  onActivity?: (message: string) => void;
}

/**
 * Layer B entry point (PLAN.md §8): one curated prompt in, one schema-validated
 * JSON object out. Web search + fetch enabled; Read enabled for image vision.
 * Subscription auth guard runs before every call — a stray ANTHROPIC_API_KEY
 * in subscription mode aborts rather than silently billing.
 */
export async function runAgentJson<T>(
  prompt: string,
  zodSchema: z.ZodType<T>,
  opts: AgentRunOptions
): Promise<T> {
  assertAuthMode();

  let structured: unknown;
  let resultText = "";
  try {
    for await (const message of query({
      prompt,
      options: {
        model: opts.model,
        maxTurns: opts.maxTurns,
        allowedTools: ["WebSearch", "WebFetch", "Read"],
        permissionMode: "bypassPermissions",
        additionalDirectories: opts.readDirs ?? [config.dataDir],
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
