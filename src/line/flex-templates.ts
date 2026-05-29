/**
 * Thai-localized Flex Message templates.
 *
 * V1 ships a small curated set — the highest-leverage templates for Thai SMBs.
 * Each template is a pure function that takes typed data and returns a Flex
 * bubble (or carousel) ready to send. We add more templates as we see demand.
 *
 * Templates use only documented Flex features; output is pre-validated against
 * LINE's 30KB bubble limit at build time by the `design_flex` tool.
 */

import type { LineFlexMessage } from "../types.js";

// ---- template registry ----

export const FLEX_TEMPLATE_NAMES = [
  "receipt",
  "voucher",
  "shipping_update",
  "order_confirm",
  "appointment_reminder",
  "promo_simple",
  "course_cert",
  "thank_you",
] as const;
export type FlexTemplateName = (typeof FLEX_TEMPLATE_NAMES)[number];

export interface FlexTemplateInfo {
  name: FlexTemplateName;
  description_th: string;
  fields: string[];
}

export const FLEX_TEMPLATE_CATALOG: FlexTemplateInfo[] = [
  { name: "receipt", description_th: "ใบเสร็จรับเงิน (รายการสินค้า + ยอดรวม)", fields: ["shop_name", "items", "total", "order_id"] },
  { name: "voucher", description_th: "คูปองส่วนลด (รหัส + เงื่อนไข + วันหมดอายุ)", fields: ["title", "code", "discount", "valid_until", "terms_url?"] },
  { name: "shipping_update", description_th: "แจ้งจัดส่งสินค้า (เลขพัสดุ + วันที่)", fields: ["order_id", "tracking_no", "carrier", "estimated_arrival"] },
  { name: "order_confirm", description_th: "ยืนยันคำสั่งซื้อ", fields: ["order_id", "items", "total", "payment_url?"] },
  { name: "appointment_reminder", description_th: "เตือนนัด (วัน-เวลา-สถานที่)", fields: ["customer_name", "service", "datetime", "location"] },
  { name: "promo_simple", description_th: "โปรโมชั่นรูปเดียว + ปุ่ม CTA", fields: ["title", "subtitle", "image_url", "cta_label", "cta_url"] },
  { name: "course_cert", description_th: "ใบประกาศนียบัตรหลักสูตร", fields: ["course_name", "student_name", "date", "cert_url?"] },
  { name: "thank_you", description_th: "ขอบคุณลูกค้า (พร้อม sticker-feel)", fields: ["customer_name?", "message"] },
];

// ---- rendering ----

export function renderTemplate(
  name: FlexTemplateName,
  data: Record<string, unknown>,
): LineFlexMessage {
  switch (name) {
    case "promo_simple":
      return promoSimple(data);
    case "thank_you":
      return thankYou(data);
    case "voucher":
      return voucher(data);
    case "shipping_update":
      return shippingUpdate(data);
    // Remaining templates fall back to a generic single-line bubble in V1 —
    // they will be filled in iteratively as we curate visual designs.
    default:
      return genericPlaceholder(name, data);
  }
}

// ---- template implementations (Thai-first, minimal but production-shaped) ----

function promoSimple(data: Record<string, unknown>): LineFlexMessage {
  const title = str(data.title, "โปรพิเศษ");
  const subtitle = str(data.subtitle, "อย่าพลาด!");
  const imageUrl = str(data.image_url, "https://via.placeholder.com/1040x520?text=Promo");
  const ctaLabel = str(data.cta_label, "ดูรายละเอียด");
  const ctaUrl = str(data.cta_url, "https://line.me");

  return {
    type: "flex",
    altText: `${title} — ${subtitle}`,
    contents: {
      type: "bubble",
      size: "mega",
      hero: { type: "image", url: imageUrl, size: "full", aspectRatio: "2:1", aspectMode: "cover" },
      body: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        contents: [
          { type: "text", text: title, weight: "bold", size: "xl", wrap: true },
          { type: "text", text: subtitle, size: "md", color: "#666666", wrap: true },
        ],
      },
      footer: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "button",
            style: "primary",
            color: "#06C755",
            action: { type: "uri", label: ctaLabel, uri: ctaUrl },
          },
        ],
      },
    },
  };
}

function thankYou(data: Record<string, unknown>): LineFlexMessage {
  const customerName = optStr(data.customer_name);
  const message = str(data.message, "ขอบคุณมากค่ะ 🙏");
  const greeting = customerName ? `ขอบคุณคุณ${customerName}` : "ขอบคุณค่ะ";
  return {
    type: "flex",
    altText: greeting,
    contents: {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        contents: [
          { type: "text", text: greeting, weight: "bold", size: "xl", color: "#06C755" },
          { type: "text", text: message, size: "md", wrap: true, color: "#333333" },
        ],
      },
    },
  };
}

function voucher(data: Record<string, unknown>): LineFlexMessage {
  const title = str(data.title, "คูปองส่วนลด");
  const code = str(data.code, "SAVE10");
  const discount = str(data.discount, "ส่วนลด 10%");
  const validUntil = str(data.valid_until, "วันที่หมดอายุ");
  const termsUrl = optStr(data.terms_url);
  return {
    type: "flex",
    altText: `${title} — ${discount} (รหัส ${code})`,
    contents: {
      type: "bubble",
      header: {
        type: "box",
        layout: "vertical",
        backgroundColor: "#06C755",
        paddingAll: "16px",
        contents: [
          { type: "text", text: "🎟️ " + title, weight: "bold", color: "#FFFFFF", size: "lg" },
        ],
      },
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        contents: [
          { type: "text", text: discount, size: "xxl", weight: "bold", color: "#06C755", align: "center" },
          {
            type: "box",
            layout: "vertical",
            margin: "md",
            backgroundColor: "#F0F0F0",
            paddingAll: "12px",
            cornerRadius: "8px",
            contents: [
              { type: "text", text: "รหัสคูปอง", size: "xs", color: "#888888", align: "center" },
              { type: "text", text: code, size: "xl", weight: "bold", align: "center" },
            ],
            action: { type: "clipboard", label: "Copy", clipboardText: code },
          },
          { type: "separator", margin: "md" },
          { type: "text", text: `หมดอายุ ${validUntil}`, size: "xs", color: "#888888" },
        ],
      },
      ...(termsUrl
        ? {
            footer: {
              type: "box",
              layout: "vertical",
              contents: [
                {
                  type: "button",
                  style: "link",
                  action: { type: "uri", label: "เงื่อนไขการใช้", uri: termsUrl },
                },
              ],
            },
          }
        : {}),
    },
  };
}

function shippingUpdate(data: Record<string, unknown>): LineFlexMessage {
  const orderId = str(data.order_id, "-");
  const trackingNo = str(data.tracking_no, "-");
  const carrier = str(data.carrier, "ไปรษณีย์ไทย");
  const eta = str(data.estimated_arrival, "ภายใน 2-3 วันทำการ");
  return {
    type: "flex",
    altText: `แจ้งจัดส่งออเดอร์ ${orderId}`,
    contents: {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        contents: [
          { type: "text", text: "📦 แจ้งจัดส่งสินค้า", weight: "bold", size: "lg" },
          { type: "separator" },
          row("ออเดอร์", orderId),
          row("เลขพัสดุ", trackingNo),
          row("ขนส่ง", carrier),
          row("คาดถึง", eta),
        ],
      },
    },
  };
}

function genericPlaceholder(name: string, _data: Record<string, unknown>): LineFlexMessage {
  return {
    type: "flex",
    altText: `Template '${name}' (placeholder)`,
    contents: {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        contents: [
          { type: "text", text: `Template: ${name}`, weight: "bold" },
          {
            type: "text",
            text: "ยังไม่ได้สร้าง bubble design — โปรดใช้ template อื่นใน V1 หรือ pass flex_json ตรงๆ",
            wrap: true,
            size: "sm",
            color: "#888888",
          },
        ],
      },
    },
  };
}

// ---- small helpers ----

function row(label: string, value: string): Record<string, unknown> {
  return {
    type: "box",
    layout: "baseline",
    spacing: "sm",
    contents: [
      { type: "text", text: label, size: "sm", color: "#888888", flex: 2 },
      { type: "text", text: value, size: "sm", color: "#111111", flex: 5, wrap: true },
    ],
  };
}

function str(v: unknown, fallback: string): string {
  return typeof v === "string" && v.length > 0 ? v : fallback;
}

function optStr(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}
