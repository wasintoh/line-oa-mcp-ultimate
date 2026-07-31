/**
 * Shared constants for the LINE MCP Server.
 *
 * NOTE: All comments and identifiers are in English (for LLMs reading the code).
 * User-facing strings — error messages, examples, suggestions — are in Thai
 * because the audience is Thai LINE OA operators.
 */

// ---- LINE API endpoints ----
export const LINE_API_BASE = "https://api.line.me";
export const LINE_API_DATA_BASE = "https://api-data.line.me"; // for content / audience file upload / rich menu image

// ---- Server identity ----
export const SERVER_NAME = "line-oa-mcp-ultimate";
export const SERVER_VERSION = "2.2.0";

// ---- Response sizing ----
export const CHARACTER_LIMIT = 25_000; // truncate responses beyond this size
export const DEFAULT_PAGE_LIMIT = 20;
export const MAX_PAGE_LIMIT = 100;

// ---- Reply token mechanics (research-03 §7) ----
// LINE docs say "~1 minute" but operationally 30s is the ceiling.
// We use 25s as our conservative budget before flipping to push.
export const REPLY_TOKEN_TTL_MS = 25_000;

// ---- Quota Guardian thresholds ----
// Block sends projected to consume more than this fraction of remaining quota
// unless `confirm: true` is set by the caller.
export const QUOTA_WARN_THRESHOLD = 0.95;

// ---- Thai-business quiet hours (BKK) ----
// Sends during these hours produce a warning unless `force: true`.
// 22:00 - 08:00 Bangkok local time.
export const QUIET_HOURS_START_HOUR_BKK = 22;
export const QUIET_HOURS_END_HOUR_BKK = 8;
export const BKK_TIMEZONE_OFFSET_MIN = 7 * 60; // UTC+7

// ---- Send transport rate-limit hints (research-01 §0.2) ----
// These are LINE's published bucket limits; we surface them so agents reason about pace.
export const RATE_LIMITS = {
  push_per_sec: 2000,
  multicast_per_sec: 200,
  narrowcast_per_hour: 60,
  broadcast_per_hour: 60,
  reply_per_sec: 2000,
} as const;

// ---- Audience constraints (research-01 §4) ----
export const AUDIENCE_MIN_USERS_FOR_NARROWCAST = 50; // LINE rejects narrowcast targeting <50 users
export const AUDIENCE_MAX_IDS_PER_REQUEST = 10_000;
export const AUDIENCE_MAX_FILE_SIZE_BYTES = 1_500_000; // ~1.5M IDs per CSV per upload

// ---- Multicast batching ----
// LINE multicast accepts max 500 recipients per call; we auto-chunk.
export const MULTICAST_MAX_RECIPIENTS = 500;

// ---- Message payload limits (research-01 §2) ----
export const TEXT_MESSAGE_MAX_CHARS = 5000;
export const FLEX_BUBBLE_MAX_JSON_BYTES = 30_000;
export const FLEX_CARROUSEL_MAX_BUBBLES = 12;
export const QUICK_REPLY_MAX_ITEMS = 13;

// ---- Rich menu (research-02) ----
export const RICH_MENU_IMAGE_MIN_WIDTH = 800;
export const RICH_MENU_IMAGE_MAX_WIDTH = 2500;
export const RICH_MENU_IMAGE_MIN_ASPECT = 1.45;
export const RICH_MENU_IMAGE_MAX_BYTES = 1_000_000;

// ---- Insight privacy floor ----
// LINE returns null on demographic/insight queries below this threshold.
export const INSIGHT_PRIVACY_FLOOR_USERS = 20;

// ---- v2: Rich menu per-user ops ----
// LINE bulk link/unlink accepts max 500 user IDs per request; we auto-chunk.
export const RICHMENU_BULK_MAX_USERS = 500;

// ---- v2: Imagemap message (OA Manager "Rich Message") ----
// baseSize.width must be exactly 1040; LINE serves /1040 /700 /460 /300 /240 from baseUrl.
export const IMAGEMAP_BASE_WIDTH = 1040;
export const IMAGEMAP_VIDEO_MAX_BYTES = 10_000_000; // 10MB, ≤1min mp4

// ---- v2: Template message (OA Manager "Card Message") ----
export const TEMPLATE_BUTTONS_MAX_ACTIONS = 4;
export const TEMPLATE_CONFIRM_ACTIONS = 2;
export const TEMPLATE_CAROUSEL_MAX_COLUMNS = 10;
export const TEMPLATE_CAROUSEL_MAX_ACTIONS_PER_COLUMN = 3;
export const TEMPLATE_IMAGE_CAROUSEL_MAX_COLUMNS = 10;

// ============================================================================
// v2.0 — LINE Shopping (MyShop Open API)
// Verified against the live Swagger (Redoc 1.0.0) on 2026-06-03.
// Separate product from the Messaging API: different base host + X-API-KEY auth.
// ============================================================================
export const MYSHOP_API_BASE = "https://developers-oaplus.line.biz";
export const MYSHOP_DEFAULT_PER_PAGE = 25;
export const MYSHOP_MAX_PER_PAGE = 100;
export const MYSHOP_INVENTORY_MAX = 100_000; // amount must be 1..100,000
export const MYSHOP_CHECKOUT_MAX_ITEMS = 15; // orderItems: 1..15
export const MYSHOP_TRACKING_MAX_LEN = 50; // trackingNumber ≤ 50 chars
// Published rate limit per API resource (exceeding → 429). Surfaced so agents pace themselves.
export const MYSHOP_RATE_LIMIT = { per_sec: 50, per_min: 1000 } as const;

// ============================================================================
// v2.2 — Image Hosting Layer (line_prepare_image)
// LINE is pull-model: message images live on public HTTPS and LINE fetches
// them when each recipient FIRST VIEWS the message (verified live 2026-07-31;
// once viewed, LINE's cache serves them permanently). These constants govern
// the resize pipeline, the in-memory store, and hosting lifecycles.
// ============================================================================
/** Imagemap width variants LINE requests from baseUrl (no file extension). */
export const IMAGEMAP_SIZES = [1040, 700, 460, 300, 240] as const;
/** Max input image size for file_path / source_url inputs. */
export const IMAGE_INPUT_MAX_BYTES = 10 * 1024 * 1024; // 10MB
/**
 * Pixel-bomb guards (QC finding, reproduced live): a sub-1MB PNG can DECLARE
 * e.g. 18000×18000 px — 5 synchronous resvg renders of that froze the event
 * loop for ~26s (and taller ones SIGABRT). Dimensions are read from the
 * header, so these caps reject hostile images before any native decode.
 */
export const IMAGE_MAX_DIMENSION = 12_000; // px per side
export const IMAGE_MAX_PIXELS = 60_000_000; // ~60MP total
/** Max height of any rendered variant (skinny-image guard: 100×600k src passes 60MP but H at 1040 → 6.2M px). */
export const IMAGE_MAX_VARIANT_HEIGHT = 5_200; // 5× the 1040 base width — beyond any real Rich Message
/** Max base64 payload length (chars). ~3MB decoded — base64 rides the LLM context, keep it tight. */
export const IMAGE_BASE64_MAX_CHARS = 4_200_000;
/** Total in-memory image store budget across all prepared keys. */
export const IMAGEHOST_STORE_MAX_BYTES = 128 * 1024 * 1024; // 128MB
/** Default hosting keep-alive after prepare (best-effort under stdio — process death ends it). */
export const IMAGEHOST_DEFAULT_KEEPALIVE_S = 86_400; // 24h — must cover recipients' FIRST-VIEW window (LINE fetches on first view, verified live 2026-07-31)
/** Per-URL timeout for the post-host verification pass (HEAD each size). */
export const IMAGEHOST_VERIFY_TIMEOUT_MS = 10_000;
/** How long we wait for cloudflared to print its public URL before falling back. */
export const TUNNEL_START_TIMEOUT_MS = 30_000;
