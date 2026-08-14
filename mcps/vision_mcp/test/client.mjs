// Minimal end-to-end test: spawns the built vision-mcp server over stdio,
// lists its tools, then calls read_image on a fixture image and asserts
// the vision model actually answered.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverPath = resolve(__dirname, "../dist/index.js");
const imagePath = resolve(__dirname, "fixtures/test-image.png");

const transport = new StdioClientTransport({
  command: "node",
  args: [serverPath],
  stderr: "pipe",
  env: process.env,
});

const client = new Client({ name: "vision-mcp-test", version: "1.0.0" });
await client.connect(transport);

try {
  // 1. tools/list
  const tools = await client.listTools();
  const names = tools.tools.map((t) => t.name);
  console.log("tools/list ->", names.join(", "));
  if (!names.includes("read_image")) throw new Error("read_image tool missing");

  // 2. tools/call read_image with the fixture
  console.log("calling read_image on", imagePath);
  const res = await client.callTool({
    name: "read_image",
    arguments: {
      path: imagePath,
      prompt: "Describe this image in ONE short sentence.",
    },
  });

  const text = res.content
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("\n");
  console.log("--- model output ---");
  console.log(text);
  console.log("--- end ---");

  if (!text || text.length === 0) throw new Error("empty model output");
  if (res.isError) throw new Error("tool returned isError: " + text);
  console.log("\nPASS ✓ read_image works end-to-end");
} finally {
  await client.close();
  transport.close();
}
