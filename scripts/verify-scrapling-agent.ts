/**
 * Live check: a Layer B agent can open an x.com post through the Scrapling MCP
 * (the SDK's built-in WebFetch gets HTTP 402 there). Burns one small Layer B
 * call — run manually after touching agent tooling.
 *
 *   npx tsx scripts/verify-scrapling-agent.ts [x-post-url]
 */
import { z } from "zod";
import { runAgentJson } from "../src/reasoning/agent.js";

const url = process.argv[2] ?? "https://x.com/jessepollak/status/2107603720875958511";

const schema = z.object({
  opened: z.boolean(),
  tool_used: z.string(),
  post_text: z.string(),
});

const result = await runAgentJson(
  `Open this X post and report its exact text: ${url}
Use mcp__scrapling__stealthy_fetch (markdown extraction). Set opened=true only if you actually read the post content from the page; tool_used = the tool that worked; post_text = the post's text verbatim.`,
  schema,
  {
    model: "sonnet",
    maxTurns: 6,
    jsonSchema: {
      type: "object",
      properties: {
        opened: { type: "boolean" },
        tool_used: { type: "string" },
        post_text: { type: "string" },
      },
      required: ["opened", "tool_used", "post_text"],
      additionalProperties: false,
    },
    onActivity: (m) => console.log("  [agent]", m),
  }
);

console.log(JSON.stringify(result, null, 2));
if (!result.opened) {
  console.error("FAIL: agent could not open the post");
  process.exit(1);
}
console.log("PASS");
