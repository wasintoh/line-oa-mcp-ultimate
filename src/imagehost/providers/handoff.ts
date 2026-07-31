/**
 * handoff provider — the last link of the chain, and it NEVER fails: when no
 * automatic host is usable it writes a zip of the 5 imagemap variants to the
 * OS temp dir and returns Thai step-by-step instructions so a non-technical
 * shop owner can finish the job by hand.
 *
 * Non-obvious constraint enforced here: zip entries are named EXACTLY
 * "1040" "700" "460" "300" "240" with NO file extension — LINE's CDN requests
 * `${baseUrl}/{size}` verbatim, so a stray ".png" would 404 every rich message.
 *
 * The stepsTh strings below are the ONE sanctioned Thai spot in this folder
 * (they are shipped to the user verbatim, not translated at the tool layer).
 */

import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { IMAGEMAP_SIZES } from "../../constants.js";
import { buildZip } from "../zip-writer.js";
import { ImageHostError, type HostResult, type ImageHost, type ImageVariants } from "../types.js";

export class HandoffHost implements ImageHost {
  readonly id = "handoff" as const;
  readonly supportsImagemap = true;

  /** Always available — writing a zip to tmpdir needs nothing external. */
  async isAvailable(): Promise<boolean> {
    return true;
  }

  async put(variants: ImageVariants, key: string): Promise<HostResult> {
    // Collect the 5 size buffers; a missing variant means resize.ts broke its
    // contract — fail loudly rather than write an unusable zip.
    const entries = IMAGEMAP_SIZES.map((size) => {
      const data = variants.sizes.get(size);
      if (!data) {
        throw new ImageHostError(`handoff: missing ${size}px variant for key ${key}`, "input-invalid");
      }
      return { name: String(size), data };
    });

    // Per-user dir name: on shared Linux machines a fixed /tmp path created by
    // user A (0755) gives user B EACCES — which would make the one provider
    // that must NEVER fail, fail. uid keeps it collision-free per account.
    const uid = typeof process.getuid === "function" ? `-${process.getuid()}` : "";
    const dir = path.join(os.tmpdir(), `line-oa-imagehost${uid}`);
    mkdirSync(dir, { recursive: true });
    const zipPath = path.join(dir, `${key}.zip`);
    writeFileSync(zipPath, buildZip(entries));

    const fileNames = entries.map((e) => e.name);
    const stepsTh = buildStepsTh(zipPath);

    return {
      kind: "handoff",
      providerId: this.id,
      handoff: { zipPath, fileNames, stepsTh },
      warnings: [],
    };
  }
}

/**
 * Thai instructions offering 3 concrete routes (easiest first). Each step is
 * short, numbered, and copy-paste actionable for a non-technical shop owner.
 */
function buildStepsTh(zipPath: string): string[] {
  return [
    `ระบบ host รูปอัตโนมัติใช้ไม่ได้ในเครื่องนี้ แต่ไม่เป็นไรค่ะ — รูปทั้ง 5 ขนาดถูกแพ็กไว้ให้แล้วที่ไฟล์ ${zipPath} (ข้างในมีไฟล์ชื่อ 1040, 700, 460, 300, 240 ห้ามเปลี่ยนชื่อและห้ามเติมนามสกุล) เลือกทำตามวิธีใดวิธีหนึ่งด้านล่างได้เลย`,
    `วิธีที่ 1 (ง่ายสุด — ไม่ต้อง host เอง): เปิดเว็บ LINE OA Manager ที่ https://manager.line.biz แล้วล็อกอิน → เลือกบัญชี OA ของคุณ → เมนู Broadcast → กด "สร้าง Broadcast ใหม่" → แนบรูปจากเครื่องได้เลย ส่งจากหน้าเว็บนี้ได้ทันที ไม่ต้องใช้ไฟล์ zip`,
    `วิธีที่ 2 (Netlify Drop — ฟรี ไม่ต้องสมัครสมาชิก): ดับเบิลคลิกไฟล์ zip เพื่อแตกไฟล์ จะได้โฟลเดอร์ที่มีไฟล์ 5 ไฟล์ (1040, 700, 460, 300, 240) → เปิดเว็บ https://app.netlify.com/drop → ลาก "ทั้งโฟลเดอร์" (ไม่ใช่ลากทีละไฟล์) ไปวางกลางหน้าเว็บ → รอไม่กี่วินาที จะได้ลิงก์เช่น https://ชื่อสุ่ม.netlify.app`,
    `วิธีที่ 2 (ต่อ): คัดลอกลิงก์ที่ได้จาก Netlify มาใส่เป็น base_url แล้วเรียก line_design_imagemap อีกครั้ง เช่น base_url = "https://ชื่อสุ่ม.netlify.app" — LINE จะไปดึงรูปแต่ละขนาดจากลิงก์นี้เอง`,
    `วิธีที่ 3 (GitHub Pages — สำหรับคนที่มีบัญชี GitHub): สร้าง repository ใหม่ (Public) → กด "Add file → Upload files" อัปโหลดไฟล์ทั้ง 5 ไฟล์ไว้ที่ root ของ repo → ไปที่ Settings → Pages → เลือก branch "main" แล้วกด Save → รอ 1-2 นาที แล้วใช้ https://ชื่อผู้ใช้.github.io/ชื่อrepo เป็น base_url แล้วเรียก line_design_imagemap อีกครั้ง`,
  ];
}
