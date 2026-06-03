/**
 * Template message builder (LINE OA Manager calls these "Card Message").
 *
 * Pure functions — no I/O — unit-testable. Emits a valid `type:"template"`
 * object for the four LINE template subtypes (buttons / confirm / carousel /
 * image_carousel) with all LINE limits validated up front.
 */

import {
  TEMPLATE_BUTTONS_MAX_ACTIONS,
  TEMPLATE_CONFIRM_ACTIONS,
  TEMPLATE_CAROUSEL_MAX_COLUMNS,
  TEMPLATE_CAROUSEL_MAX_ACTIONS_PER_COLUMN,
  TEMPLATE_IMAGE_CAROUSEL_MAX_COLUMNS,
} from "../constants.js";
import type { LineAction, LineTemplateMessage } from "../types.js";

export type TemplateActionInput =
  | { type: "uri"; label: string; uri: string }
  | { type: "message"; label: string; text: string }
  | { type: "postback"; label: string; data: string; displayText?: string };

function toAction(a: TemplateActionInput, where: string): LineAction {
  if (!a.label || a.label.length === 0) {
    throw new Error(`${where}: action.label จำเป็น`);
  }
  if (a.label.length > 20) {
    throw new Error(`${where}: action.label ยาวเกิน 20 ตัวอักษร`);
  }
  switch (a.type) {
    case "uri":
      if (!a.uri || !/^https?:\/\/|^tel:|^line:/i.test(a.uri)) {
        throw new Error(`${where}: action uri ไม่ถูกต้อง`);
      }
      return { type: "uri", label: a.label, uri: a.uri };
    case "message":
      if (!a.text) throw new Error(`${where}: action text จำเป็น`);
      return { type: "message", label: a.label, text: a.text };
    case "postback":
      if (!a.data) throw new Error(`${where}: action data จำเป็น`);
      return {
        type: "postback",
        label: a.label,
        data: a.data,
        ...(a.displayText ? { displayText: a.displayText } : {}),
      };
  }
}

export interface ButtonsTemplateInput {
  kind: "buttons";
  alt_text: string;
  title?: string;
  text: string;
  thumbnail_image_url?: string;
  actions: TemplateActionInput[];
}

export interface ConfirmTemplateInput {
  kind: "confirm";
  alt_text: string;
  text: string;
  actions: TemplateActionInput[];
}

export interface CarouselColumnInput {
  title?: string;
  text: string;
  thumbnail_image_url?: string;
  default_action?: TemplateActionInput;
  actions: TemplateActionInput[];
}

export interface CarouselTemplateInput {
  kind: "carousel";
  alt_text: string;
  columns: CarouselColumnInput[];
}

export interface ImageCarouselColumnInput {
  image_url: string;
  action: TemplateActionInput;
}

export interface ImageCarouselTemplateInput {
  kind: "image_carousel";
  alt_text: string;
  columns: ImageCarouselColumnInput[];
}

export type TemplateInput =
  | ButtonsTemplateInput
  | ConfirmTemplateInput
  | CarouselTemplateInput
  | ImageCarouselTemplateInput;

/** Build + validate a LINE template message. Throws Thai-friendly errors. */
export function buildTemplateMessage(input: TemplateInput): LineTemplateMessage {
  if (!input.alt_text || input.alt_text.length === 0) {
    throw new Error("alt_text จำเป็น (ข้อความที่แสดงใน push notification + chat list)");
  }
  if (input.alt_text.length > 400) {
    throw new Error("alt_text ยาวเกิน 400 ตัวอักษร");
  }

  let template: Record<string, unknown>;

  switch (input.kind) {
    case "buttons": {
      if (!input.text) throw new Error("buttons: ต้องมี text");
      if (!input.actions || input.actions.length === 0) {
        throw new Error("buttons: ต้องมี actions อย่างน้อย 1 ปุ่ม");
      }
      if (input.actions.length > TEMPLATE_BUTTONS_MAX_ACTIONS) {
        throw new Error(`buttons: มีได้สูงสุด ${TEMPLATE_BUTTONS_MAX_ACTIONS} ปุ่ม (มี ${input.actions.length})`);
      }
      const textLimit = input.title || input.thumbnail_image_url ? 60 : 160;
      if (input.text.length > textLimit) {
        throw new Error(`buttons: text ยาวเกิน ${textLimit} ตัวอักษร (มี title/รูป = 60, ไม่มี = 160)`);
      }
      template = {
        type: "buttons",
        text: input.text,
        ...(input.title ? { title: input.title } : {}),
        ...(input.thumbnail_image_url ? { thumbnailImageUrl: input.thumbnail_image_url } : {}),
        actions: input.actions.map((a, i) => toAction(a, `buttons.actions[${i}]`)),
      };
      break;
    }

    case "confirm": {
      if (!input.text) throw new Error("confirm: ต้องมี text");
      if (!input.actions || input.actions.length !== TEMPLATE_CONFIRM_ACTIONS) {
        throw new Error(`confirm: ต้องมี ${TEMPLATE_CONFIRM_ACTIONS} ปุ่มเป๊ะ`);
      }
      template = {
        type: "confirm",
        text: input.text,
        actions: input.actions.map((a, i) => toAction(a, `confirm.actions[${i}]`)),
      };
      break;
    }

    case "carousel": {
      if (!input.columns || input.columns.length === 0) {
        throw new Error("carousel: ต้องมีอย่างน้อย 1 column");
      }
      if (input.columns.length > TEMPLATE_CAROUSEL_MAX_COLUMNS) {
        throw new Error(`carousel: มีได้สูงสุด ${TEMPLATE_CAROUSEL_MAX_COLUMNS} columns (มี ${input.columns.length})`);
      }
      // LINE requires every column to have the same number of actions.
      const actionCount = input.columns[0]?.actions?.length ?? 0;
      template = {
        type: "carousel",
        columns: input.columns.map((c, i) => {
          if (!c.text) throw new Error(`carousel.column[${i}]: ต้องมี text`);
          if (!c.actions || c.actions.length === 0) {
            throw new Error(`carousel.column[${i}]: ต้องมี actions`);
          }
          if (c.actions.length > TEMPLATE_CAROUSEL_MAX_ACTIONS_PER_COLUMN) {
            throw new Error(
              `carousel.column[${i}]: มี action ได้สูงสุด ${TEMPLATE_CAROUSEL_MAX_ACTIONS_PER_COLUMN}`,
            );
          }
          if (c.actions.length !== actionCount) {
            throw new Error("carousel: ทุก column ต้องมีจำนวน action เท่ากัน (ข้อกำหนด LINE)");
          }
          const textLimit = c.title || c.thumbnail_image_url ? 60 : 120;
          if (c.text.length > textLimit) {
            throw new Error(`carousel.column[${i}]: text ยาวเกิน ${textLimit} ตัวอักษร`);
          }
          return {
            text: c.text,
            ...(c.title ? { title: c.title } : {}),
            ...(c.thumbnail_image_url ? { thumbnailImageUrl: c.thumbnail_image_url } : {}),
            ...(c.default_action ? { defaultAction: toAction(c.default_action, `carousel.column[${i}].default_action`) } : {}),
            actions: c.actions.map((a, j) => toAction(a, `carousel.column[${i}].actions[${j}]`)),
          };
        }),
      };
      break;
    }

    case "image_carousel": {
      if (!input.columns || input.columns.length === 0) {
        throw new Error("image_carousel: ต้องมีอย่างน้อย 1 column");
      }
      if (input.columns.length > TEMPLATE_IMAGE_CAROUSEL_MAX_COLUMNS) {
        throw new Error(
          `image_carousel: มีได้สูงสุด ${TEMPLATE_IMAGE_CAROUSEL_MAX_COLUMNS} columns (มี ${input.columns.length})`,
        );
      }
      template = {
        type: "image_carousel",
        columns: input.columns.map((c, i) => {
          if (!c.image_url || !/^https:\/\//i.test(c.image_url)) {
            throw new Error(`image_carousel.column[${i}]: image_url ต้องเป็น HTTPS URL`);
          }
          return {
            imageUrl: c.image_url,
            action: toAction(c.action, `image_carousel.column[${i}].action`),
          };
        }),
      };
      break;
    }
  }

  return { type: "template", altText: input.alt_text, template };
}
