import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
process.env.LINE_CHANNEL_ACCESS_TOKEN = "test-token-baseline";
process.env.LINE_MYSHOP_API_KEY = "test-myshop-key";
const { buildServer } = await import("./dist/server.js");
const server = buildServer();
const [ct, st] = InMemoryTransport.createLinkedPair();
const client = new Client({ name: "measure", version: "1.0.0" });
await Promise.all([client.connect(ct), server.connect(st)]);
const { tools } = await client.listTools();
let totalChars = 0; const rows = [];
for (const t of tools) {
  const s = JSON.stringify(t);
  totalChars += s.length;
  rows.push([t.name, s.length, (t.description ?? "").length]);
}
rows.sort((a,b)=>b[1]-a[1]);
console.log("TOOL_COUNT=" + tools.length);
console.log("TOTAL_JSON_CHARS=" + totalChars);
console.log("EST_TOKENS(chars/4)=" + Math.round(totalChars/4));
console.log("--- top 15 heaviest (name, json chars, desc chars) ---");
for (const r of rows.slice(0,15)) console.log(r.join("  "));
const { prompts } = await client.listPrompts();
console.log("PROMPT_COUNT=" + prompts.length);
const res = await client.listResources();
console.log("RESOURCE_COUNT=" + res.resources.length);
