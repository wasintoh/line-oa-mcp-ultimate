/**
 * Imagemap message builder (LINE OA Manager calls these "Rich Message").
 *
 * Pure functions — no I/O, no network — so they can be unit-tested directly.
 * Takes friendly snake_case inputs and emits a valid `type:"imagemap"` object,
 * validating the 1040px base-width contract and area bounds before send.
 *
 * IMPORTANT: LINE has NO imagemap-image upload API. The user must pre-host the
 * image at `base_url`; LINE then requests `${base_url}/1040`, `/700`, `/460`,
 * `/300`, `/240`. The tool layer coaches the user about this.
 */

import { IMAGEMAP_BASE_WIDTH } from "../constants.js";
import type { LineImagemapAction, LineImagemapMessage } from "../types.js";

export interface ImagemapAreaInput {
  bounds: { x: number; y: number; width: number; height: number };
  action:
    | { type: "uri"; uri: string; label?: string }
    | { type: "message"; text: string; label?: string };
}

export interface ImagemapVideoInput {
  original_content_url: string;
  preview_image_url: string;
  area: { x: number; y: number; width: number; height: number };
  external_link?: { uri: string; label: string };
}

export interface ImagemapInput {
  /** Base URL of the hosted image set (HTTPS, ≤1000 chars). LINE appends /1040 etc. */
  base_url: string;
  alt_text: string;
  /** Image height when the width is 1040px. */
  base_height: number;
  areas: ImagemapAreaInput[];
  video?: ImagemapVideoInput;
}

function assertArea(
  area: { x: number; y: number; width: number; height: number },
  baseHeight: number,
  label: string,
): void {
  const { x, y, width, height } = area;
  if (![x, y, width, height].every((n) => Number.isInteger(n))) {
    throw new Error(`${label}: ค่า x/y/width/height ต้องเป็นจำนวนเต็ม (พิกเซลบนฐานกว้าง ${IMAGEMAP_BASE_WIDTH})`);
  }
  if (x < 0 || y < 0 || width <= 0 || height <= 0) {
    throw new Error(`${label}: x,y ต้อง ≥ 0 และ width,height ต้อง > 0`);
  }
  if (x + width > IMAGEMAP_BASE_WIDTH || y + height > baseHeight) {
    throw new Error(
      `${label}: พื้นที่เกินขอบรูป ${IMAGEMAP_BASE_WIDTH}x${baseHeight} (x+width=${x + width}, y+height=${y + height})`,
    );
  }
}

/** Build + validate a LINE imagemap message from friendly inputs. Throws Thai-friendly errors. */
export function buildImagemapMessage(input: ImagemapInput): LineImagemapMessage {
  if (!input.base_url || !/^https:\/\//i.test(input.base_url)) {
    throw new Error(
      "base_url ต้องเป็น HTTPS URL — LINE จะดึงรูปขนาด /1040 /700 /460 /300 /240 จาก URL นี้ (ต้อง host รูปเอง ไม่มี upload API)",
    );
  }
  if (input.base_url.length > 1000) {
    throw new Error("base_url ยาวเกิน 1000 ตัวอักษร");
  }
  if (!input.alt_text || input.alt_text.length === 0) {
    throw new Error("alt_text จำเป็น (ข้อความสำรองเมื่อแสดงรูปไม่ได้)");
  }
  if (input.alt_text.length > 400) {
    throw new Error("alt_text ยาวเกิน 400 ตัวอักษร");
  }
  if (!Number.isInteger(input.base_height) || input.base_height <= 0) {
    throw new Error("base_height ต้องเป็นจำนวนเต็มบวก (ความสูงของรูปเมื่อกว้าง 1040px)");
  }
  if (!input.areas || input.areas.length === 0) {
    throw new Error("ต้องมี areas อย่างน้อย 1 พื้นที่ที่กดได้");
  }

  const baseSize = { width: IMAGEMAP_BASE_WIDTH, height: input.base_height };

  const actions: LineImagemapAction[] = input.areas.map((a, i) => {
    assertArea(a.bounds, baseSize.height, `area[${i}]`);
    const area = {
      x: a.bounds.x,
      y: a.bounds.y,
      width: a.bounds.width,
      height: a.bounds.height,
    };
    if (a.action.type === "uri") {
      if (!a.action.uri || !/^https:\/\//i.test(a.action.uri)) {
        throw new Error(`area[${i}] action uri ต้องเป็น HTTPS URL (LINE ปฏิเสธ http://)`);
      }
      return {
        type: "uri",
        linkUri: a.action.uri,
        ...(a.action.label ? { label: a.action.label } : {}),
        area,
      };
    }
    if (!a.action.text || a.action.text.length === 0) {
      throw new Error(`area[${i}] action text จำเป็นสำหรับ type='message'`);
    }
    return {
      type: "message",
      text: a.action.text,
      ...(a.action.label ? { label: a.action.label } : {}),
      area,
    };
  });

  const message: LineImagemapMessage = {
    type: "imagemap",
    baseUrl: input.base_url,
    altText: input.alt_text,
    baseSize,
    actions,
  };

  if (input.video) {
    if (!/^https:\/\//i.test(input.video.original_content_url)) {
      throw new Error("video.original_content_url ต้องเป็น HTTPS (mp4 ≤1นาที ≤10MB)");
    }
    if (!/^https:\/\//i.test(input.video.preview_image_url)) {
      throw new Error("video.preview_image_url ต้องเป็น HTTPS");
    }
    assertArea(input.video.area, baseSize.height, "video.area");
    message.video = {
      originalContentUrl: input.video.original_content_url,
      previewImageUrl: input.video.preview_image_url,
      area: input.video.area,
      ...(input.video.external_link
        ? {
            externalLink: {
              linkUri: input.video.external_link.uri,
              label: input.video.external_link.label,
            },
          }
        : {}),
    };
  }

  return message;
}
