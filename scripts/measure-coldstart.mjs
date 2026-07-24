import { spawn } from "node:child_process";
const N = 5; const times = [];
for (let i = 0; i < N; i++) {
  const t0 = process.hrtime.bigint();
  const p = spawn("node", ["dist/index.js"], { env: { ...process.env, LINE_CHANNEL_ACCESS_TOKEN: "t", MCP_TRANSPORT: "stdio" } });
  await new Promise((resolve) => {
    p.stderr.on("data", (d) => { if (String(d).includes("Ready")) resolve(); });
  });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  times.push(ms); p.kill();
}
times.sort((a,b)=>a-b);
console.log("cold-start ms (5 runs, sorted):", times.map(t=>t.toFixed(0)).join(", "), "| median:", times[2].toFixed(0));
