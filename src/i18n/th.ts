/**
 * Thai user-facing strings.
 *
 * Tool descriptions remain in English (for the LLM), but every message that
 * eventually reaches a human (warnings, error explanations, suggestions) goes
 * through this module so we can localize centrally.
 */

export const TH = {
  // ---- Quota Guardian ----
  quotaWarning: (projected: number, remaining: number, percent: number) =>
    `⚠️ คาดว่าจะส่ง ${projected.toLocaleString()} ข้อความ จาก quota เหลือ ${remaining.toLocaleString()} (${percent}%). ตั้งค่า confirm=true เพื่อยืนยันส่ง หรือลด audience ลง`,

  quotaExceeded: (projected: number, remaining: number) =>
    `🛑 ส่งไม่ได้: คาดว่าจะใช้ ${projected.toLocaleString()} ข้อความ แต่เหลือ quota แค่ ${remaining.toLocaleString()}. ปรับ audience ให้เล็กลงหรือรอ quota รอบใหม่`,

  // ---- Quiet hours ----
  quietHoursWarning: (bkkHour: number) =>
    `🌙 ตอนนี้ ${bkkHour}:00 BKK — เป็นช่วง quiet hours (22:00-08:00) ลูกค้าไทยส่วนใหญ่ไม่ชอบถูกปลุก. ตั้งค่า force=true เพื่อส่งต่อ หรือใช้ mode='draft' เพื่อ schedule ใน LINE OA Manager UI`,

  // ---- Reply token ----
  replyTokenExpiredFallback:
    "💡 Reply token หมดอายุ (มีอายุ ~1 นาที) — ส่งเป็น push message แทนอัตโนมัติ (ใช้ quota +1)",

  // ---- Narrowcast / Audience ----
  audienceBelowMinimum: (size: number) =>
    `❌ Narrowcast ต้องการ audience อย่างน้อย 50 คน (ปัจจุบันมี ${size} คน). LINE จะ reject. ลองใช้ multicast (user_ids[]) หรือเพิ่ม audience`,

  audienceNotReady: (name: string, status: string) =>
    `⏳ Audience "${name}" ยังไม่พร้อม (status: ${status}). รอ ~10 นาทีหลังสร้าง แล้วลองใหม่`,

  // ---- Validation ----
  flexTooLarge: (bytes: number, maxBytes: number) =>
    `📏 Flex JSON ใหญ่เกินไป: ${bytes.toLocaleString()} bytes (max ${maxBytes.toLocaleString()}). ลดจำนวน components หรือ split เป็น carousel`,

  textTooLong: (chars: number) =>
    `📝 Text message ยาว ${chars.toLocaleString()} ตัวอักษร เกิน 5,000 limit. ตัดสั้นลงหรือแบ่งเป็นหลายข้อความ`,

  // ---- Auth / Config ----
  missingToken:
    "🔑 ไม่พบ LINE_CHANNEL_ACCESS_TOKEN. ตั้งค่าใน env หรือสร้าง ~/.line-mcp/config.json. ดู .env.example",

  oaNotFound: (oaId: string) =>
    `❓ ไม่พบ OA "${oaId}" ใน config. ใช้ line_list_oas ดู OAs ที่มี หรือเพิ่มใน ~/.line-mcp/config.json`,

  // ---- API errors ----
  rateLimited:
    "🚦 LINE rate limit (429). รอ 1-2 นาทีแล้วลองใหม่. ถ้าเกิดบ่อย — ลดความถี่ส่งหรืออัปเกรด LINE plan",

  unauthorized:
    "🔐 LINE 401 — Token ไม่ถูกต้องหรือหมดอายุ. ตรวจสอบ LINE_CHANNEL_ACCESS_TOKEN ใน LINE Developers Console",

  forbidden:
    "🚫 LINE 403 — ไม่มีสิทธิ์ทำ operation นี้. บาง feature ใช้ได้เฉพาะ Premium OA หรือ region ที่กำหนด (TH/JP/TW)",

  // ---- Generic ----
  unknownError: (message: string) =>
    `❌ เกิดข้อผิดพลาดที่ไม่คาดคิด: ${message}. ลองอีกครั้ง หรือเช็ค LINE Developers Console`,

  // ---- Success ----
  sentSuccessfully: (transport: string, recipients?: number) =>
    `✅ ส่งสำเร็จผ่าน ${transport}${recipients ? ` (${recipients.toLocaleString()} คน)` : ""}`,

  // ---- Draft mode ----
  draftReadyForOaManager: (audienceName?: string) =>
    `📋 เตรียมพร้อมแล้ว! ${audienceName ? `Audience "${audienceName}" — ` : ""}เปิด LINE OA Manager แล้วทำตาม 6 ขั้นด้านล่าง`,
} as const;
