/**
 * Rich Menu Studio demo — renders three real menus to OUT_DIR (default
 * /home/claude/outputs) for visual review:
 *   1. rm-cafe-line-seed.png — Thai café loyalty grid_6, LINE green gradient,
 *      font "line-seed" (falls back to Prompt automatically when seed.line.me
 *      is unreachable — the script reports which font was actually used)
 *   2. rm-cafe-prompt.png    — the SAME menu with font "prompt" (proves switching)
 *   3. rm-shop-compact.png   — compact_3 e-commerce menu
 *
 * Usage: npm run build && node scripts/demo-rich-menu.mjs
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUT_DIR = process.env.OUT_DIR ?? "/home/claude/outputs";

const { renderRichMenuPng } = await import("../dist/richmenu/renderer.js");
const { getTemplate } = await import("../dist/richmenu/templates.js");

mkdirSync(OUT_DIR, { recursive: true });

const cafeCells = [
  { label: "สั่งเครื่องดื่ม", sublabel: "โปรโมชั่นพิเศษวันนี้", icon_emoji: "☕" },
  { label: "สะสมแต้ม", sublabel: "ครบ 10 แก้วฟรี 1", icon_emoji: "⭐" },
  { label: "เมนูน้ำดื่มเย็นๆ", sublabel: "ชา กาแฟ สมูทตี้", icon_emoji: "🧋" },
  { label: "สั่งซื้อ / จัดส่ง", sublabel: "ส่งฟรีเมื่อครบ 300.-", icon_emoji: "🛵" },
  { label: "ที่อยู่ร้าน", sublabel: "เปิดทุกวัน 07:00-18:00", icon_emoji: "📍" },
  { label: "คุยกับพนักงาน", sublabel: "ตอบไวใน 5 นาที", icon_emoji: "💬" },
];

async function demo(name, opts) {
  const t0 = Date.now();
  const result = await renderRichMenuPng(opts);
  const path = join(OUT_DIR, name);
  writeFileSync(path, result.png);
  console.error(
    `${name}: ${result.width}x${result.height}, ${(result.bytes / 1024).toFixed(0)}KB, ` +
      `font=${result.fontUsed}, ${Date.now() - t0}ms` +
      (result.warnings.length ? `\n  warnings: ${result.warnings.join(" | ")}` : ""),
  );
}

// 1 — café loyalty, LINE green gradient, LINE Seed
await demo("rm-cafe-line-seed.png", {
  template: getTemplate("grid_6"),
  cells: cafeCells,
  brand: { primary: "#06C755", style: "gradient", font: "line-seed" },
});

// 2 — same menu, font switched to Prompt
await demo("rm-cafe-prompt.png", {
  template: getTemplate("grid_6"),
  cells: cafeCells,
  brand: { primary: "#06C755", style: "gradient", font: "prompt" },
});

// 3 — e-commerce compact_3
await demo("rm-shop-compact.png", {
  template: getTemplate("compact_3"),
  cells: [
    { label: "สินค้าใหม่", sublabel: "อัปเดตทุกสัปดาห์", icon_emoji: "🛍️" },
    { label: "สั่งซื้อ", sublabel: "จ่ายผ่าน LINE ได้เลย", icon_emoji: "🛒" },
    { label: "แจ้งส่งของ", sublabel: "เช็คสถานะพัสดุ", icon_emoji: "📦" },
  ],
  brand: { primary: "#12355B", accent: "#FFC24B", style: "glass", font: "line-seed" },
});

console.error(`done → ${OUT_DIR}`);
