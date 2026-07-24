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

  replyTokenUnavailable:
    '⏱️ ใช้ reply token ไม่ได้ (หมดอายุภายใน ~1 นาที หรือไม่พบ event นี้) — ส่งใหม่ด้วย target { user_id: "U..." } แทน (ใช้ quota +1 ข้อความ)',

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

  // ---- v2.0 LINE Shopping (MyShop) ----
  missingMyShopKey:
    "🛍️ OA นี้ยังไม่ได้ตั้ง MyShop API key. ไปที่ oaplus.line.biz → Settings → API keys (ต้องเป็น Admin) → Generate แล้วใส่ใน `myshop_api_key` ของ OA (ใน ~/.line-mcp/config.json) หรือ env LINE_MYSHOP_API_KEY",

  myShopUnauthorized:
    "🔐 MyShop 401 — API key ไม่ถูกต้องหรือถูกเพิกถอน. สร้าง key ใหม่ที่ oaplus.line.biz → Settings → API keys",

  myShopForbidden:
    "🚫 MyShop 403 — ไม่มีสิทธิ์ทำรายการนี้. ตรวจสอบว่า key มาจากร้านที่ถูกต้อง และร้านเปิด MyShop/LINE Shopping แล้ว",

  myShopNotFound:
    "🔍 MyShop 404 — ไม่พบรายการที่ระบุ (สินค้า/ออเดอร์/เลขที่). ตรวจสอบ id หรือ order number อีกครั้ง",

  myShopRateLimited:
    "🚦 MyShop rate limit (429) — เกิน 50 req/วินาที หรือ 1,000 req/นาที. รอสักครู่แล้วลองใหม่",

  confirmRequired: (action: string) =>
    `⚠️ การ${action}เป็นการกระทำที่กู้คืนไม่ได้ — ตั้งค่า confirm=true เพื่อยืนยัน`,

  // ---- v2.1 Security (Workstream B strings go here) ----

  // HTTP transport auth
  httpAuthRequired:
    "🔐 ต้องส่ง header Authorization: Bearer <MCP_HTTP_TOKEN> ที่ถูกต้องก่อนใช้งาน MCP endpoint นี้",

  httpPublicBindNeedsToken: (host: string) =>
    `🛑 ปฏิเสธการเปิด HTTP server บน "${host}" — การ bind นอก loopback (127.0.0.1 / ::1 / localhost) โดยไม่ตั้ง MCP_HTTP_TOKEN จะเปิดให้ทุกคนในเครือข่ายสั่ง broadcast ในนามร้านได้ทันที. ตั้ง env MCP_HTTP_TOKEN แล้วเริ่มใหม่ หรือ bind ที่ 127.0.0.1 แล้ววาง reverse proxy (TLS + auth) ไว้ข้างหน้า`,

  // Config file permissions
  configFilePermissionWarning: (path: string) =>
    `⚠️ ไฟล์ config ${path} เปิดสิทธิ์ให้ผู้ใช้อื่นบนเครื่องอ่านได้ — ข้างในมี channel access token ที่ใช้ส่งข้อความหาลูกค้าทุกคนของร้านได้. แนะนำรัน: chmod 600 ${path}`,

  // SSRF guard (user-supplied URLs fetched server-side)
  ssrfInvalidUrl: (url: string) => `❌ URL ไม่ถูกต้อง: ${url}`,

  ssrfHttpsOnly: "🔒 อนุญาตเฉพาะ https:// เท่านั้น (ความปลอดภัย)",

  ssrfPrivateAddress: (host: string) =>
    `🚫 ไม่อนุญาตให้ดึงข้อมูลจาก internal address (${host})`,

  ssrfInternalHost: (host: string) =>
    `🚫 ไม่อนุญาตให้ดึงข้อมูลจาก internal host (${host})`,

  ssrfResolvedPrivate: (host: string, address: string) =>
    `🚫 Host "${host}" ชี้ไปยัง internal address (${address}) — ไม่อนุญาต`,

  ssrfResolveFailed: (host: string) =>
    `❌ Resolve host "${host}" ไม่ได้ — ตรวจสอบ URL อีกครั้ง`,

  ssrfDownloadFailed: (host: string, message: string) =>
    `❌ ดาวน์โหลดจาก ${host} ไม่สำเร็จ: ${message}`,

  ssrfHttpError: (status: number, host: string) =>
    `❌ ดาวน์โหลดไม่สำเร็จ (HTTP ${status}) จาก ${host}`,

  ssrfTooManyRedirects: "🚫 Redirect เกินจำนวนที่อนุญาต",

  ssrfFileTooLarge: (maxMb: string) =>
    `📏 ไฟล์ใหญ่เกิน ${maxMb}MB — ย่อไฟล์ก่อนแล้วลองใหม่`,

  ssrfNoBody: "❌ ไม่สามารถอ่าน response body ได้",

  // ---- v2.1 Rich Menu Studio (Workstream D strings go here) ----

  rmTemplateSizeMismatch: (template: string, requested: string, expected: string) =>
    `❌ Template "${template}" ใช้ขนาด ${expected} เท่านั้น (ระบุมา ${requested}). ลบ parameter size ออก หรือเลือก template ที่ตรงขนาด`,

  rmCellCountMismatch: (template: string, expected: number, got: number) =>
    `❌ Template "${template}" ต้องมี ${expected} cells แต่ส่งมา ${got}. ปรับจำนวน cells ให้ตรงกับ layout`,

  rmDeployConfigRequired:
    `❌ mode="deploy" ต้องระบุ deploy: { name, set_default?, alias? } ด้วย. แนะนำ: preview ก่อนเสมอ แล้วค่อย deploy`,

  rmDeployNeedsActions: (cellIndexes: number[]) =>
    `❌ Deploy ไม่ได้: cell ที่ ${cellIndexes.map((i) => i + 1).join(", ")} ยังไม่มี action. ทุก cell ต้องมี action (uri / message / postback) ก่อนขึ้นเมนูจริง`,

  rmImageTooLarge: (kb: number) =>
    `📏 PNG ขนาด ${kb.toLocaleString()}KB เกิน limit 1,000KB ของ LINE. ลองใช้ style="solid", ลดจำนวนสี หรือเอารูปภาพพื้นหลังออก แล้ว deploy ใหม่`,

  rmRerenderedSolid:
    `⚠️ PNG แรกเกิน 1MB — ระบบเรนเดอร์ใหม่เป็นแบบสีพื้น (solid) ให้อัตโนมัติเพื่อให้ผ่าน limit ของ LINE`,

  rmDeployCleanedUp: (step: string, message: string) =>
    `❌ Deploy ล้มเหลวตอน${step}: ${message}\n🧹 ลบ Rich Menu ที่สร้างค้างไว้ให้เรียบร้อยแล้ว — ไม่มีเมนูกำพร้าตกค้าง แก้ปัญหาแล้วลองใหม่ได้เลย`,

  rmDeployCleanupFailed: (richMenuId: string, message: string) =>
    `⚠️ ลบเมนูที่ค้างไม่สำเร็จ (${richMenuId}): ${message} — ใช้ line_delete_rich_menu ลบเองอีกครั้ง`,

  rmFontFallback: (reason: string) =>
    `⚠️ โหลดฟอนต์ LINE Seed จาก seed.line.me ไม่สำเร็จ (${reason}) — ใช้ฟอนต์ Prompt แทน`,

  rmFontPathUnreadable: (path: string) =>
    `❌ อ่านไฟล์ฟอนต์ไม่ได้: ${path} — ตรวจสอบว่าเป็น path แบบเต็มไปยังไฟล์ .ttf/.otf ที่มีอยู่จริง`,

  rmEmojiSkipped: (emoji: string) =>
    `⚠️ โหลดรูป emoji "${emoji}" ไม่สำเร็จ — ข้าม icon นี้ไป (ตัวเมนูยังเรนเดอร์ปกติ)`,

  rmImageFetchFailed: (url: string, message: string) =>
    `⚠️ โหลดรูปจาก ${url} ไม่สำเร็จ: ${message} — เรนเดอร์ต่อโดยไม่ใช้รูปนี้`,

  rmPreviewReady: (template: string, width: number, height: number, kb: number, font: string) =>
    `🖼️ Preview พร้อมแล้ว — template ${template} ขนาด ${width}×${height}px (${kb.toLocaleString()}KB, ฟอนต์ ${font})\n👀 ตรวจภาพก่อน: ตัวอักษรไทยครบ อ่านง่าย สีตรง brand แล้วค่อยสั่ง mode="deploy"`,

  rmSaved: (path: string, kb: number) =>
    `💾 บันทึกรูป Rich Menu แล้วที่ ${path} (${kb.toLocaleString()}KB)`,

  rmDeployed: (richMenuId: string, areas: number, setDefault: boolean, alias?: string) =>
    `✅ Rich Menu ขึ้นระบบแล้ว\n- ID: \`${richMenuId}\`\n- พื้นที่กด: ${areas} จุด (ตรงกับภาพ 100%)${
      setDefault ? "\n- ตั้งเป็นเมนู default ของ OA แล้ว" : "\n- ยังไม่ตั้งเป็น default (ใช้ line_set_default_rich_menu ได้ทีหลัง)"
    }${alias ? `\n- Alias: ${alias}` : ""}`,
} as const;
