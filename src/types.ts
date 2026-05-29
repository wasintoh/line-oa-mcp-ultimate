/**
 * Shared TypeScript types for the LINE MCP Server.
 */

// ---- Response format (every list/read tool supports this) ----
export const RESPONSE_FORMATS = ["markdown", "json"] as const;
export type ResponseFormat = (typeof RESPONSE_FORMATS)[number];

// ---- OA config ----
export interface OaConfig {
  channel_access_token: string;
  channel_secret?: string;
  display_name?: string;
  is_premium?: boolean;
  region?: "TH" | "JP" | "TW" | "ID" | "OTHER";
}

export interface MultiOaConfig {
  default_oa: string;
  oas: Record<string, OaConfig>;
}

// ---- Send-message types ----
export type SendMode = "send_now" | "draft" | "dry_run";

export type SendTarget =
  | { reply_to: string } // webhookEventId — we cache the reply_token
  | { user_id: string } // single user (push)
  | { user_ids: string[] } // 2..500 users (multicast, auto-chunked beyond)
  | { audience: string } // audience name OR id (narrowcast)
  | { filter: NarrowcastFilter } // demographic filter (narrowcast)
  | { everyone: true }; // broadcast

export interface NarrowcastFilter {
  ages?: string[]; // e.g., ["age_20", "age_25"]
  genders?: ("male" | "female")[];
  areas?: string[]; // Thai-region codes
  app_types?: ("ios" | "android")[];
  subscription_periods?: string[];
}

export type SendTransport = "reply" | "push" | "multicast" | "narrowcast" | "broadcast";

// ---- LINE message payload ----
export interface LineTextMessage {
  type: "text";
  text: string;
  sender?: { name?: string; iconUrl?: string };
  quickReply?: { items: LineQuickReplyItem[] };
}

export interface LineStickerMessage {
  type: "sticker";
  packageId: string;
  stickerId: string;
}

export interface LineImageMessage {
  type: "image";
  originalContentUrl: string;
  previewImageUrl: string;
}

export interface LineFlexMessage {
  type: "flex";
  altText: string;
  contents: Record<string, unknown>;
}

export type LineMessage =
  | LineTextMessage
  | LineStickerMessage
  | LineImageMessage
  | LineFlexMessage;

export interface LineQuickReplyItem {
  type: "action";
  imageUrl?: string;
  action: LineAction;
}

export type LineAction =
  | { type: "message"; label: string; text: string }
  | { type: "postback"; label: string; data: string; displayText?: string }
  | { type: "uri"; label: string; uri: string }
  | { type: "datetimepicker"; label: string; data: string; mode: "date" | "time" | "datetime" }
  | { type: "richmenuswitch"; label?: string; richMenuAliasId: string; data: string }
  | { type: "clipboard"; label: string; clipboardText: string };

// ---- Quota response from LINE ----
export interface LineQuota {
  type: "limited" | "none";
  value?: number; // monthly send limit; undefined if none/unlimited
}

export interface LineQuotaConsumption {
  totalUsage: number;
}

export interface QuotaSnapshot {
  used: number;
  total: number | "unlimited";
  remaining: number | "unlimited";
  percentage_used: number; // 0..100
}

// ---- Tool output envelope (used by all send-style tools) ----
export interface SendResultOutput {
  success: boolean;
  transport: SendTransport;
  request_id?: string;
  recipient_count_estimated?: number;
  recipient_count_actual?: number;
  quota?: QuotaSnapshot;
  warnings: string[];
  next_steps?: string;
}

export interface DraftResultOutput {
  draft: true;
  oa_manager_url: string;
  audience_summary?: { id: string; name: string; size?: number; status?: string };
  flex_json_pretty?: string;
  flex_preview_url?: string;
  copy_paste_steps: string[];
  estimated_recipients?: number;
  estimated_cost_messages?: number;
  notes: string;
}

export interface DryRunOutput {
  dry_run: true;
  transport: SendTransport;
  validated: boolean;
  projected_recipients?: number;
  projected_cost_messages?: number;
  quota: QuotaSnapshot;
  warnings: string[];
}

// ---- OA status output ----
export interface OaStatusOutput {
  oa: {
    id: string;
    display_name: string;
    picture_url?: string;
  };
  friends?: number;
  quota: QuotaSnapshot;
  webhook?: {
    active: boolean;
    url?: string;
  };
  default_rich_menu?: { id: string; name?: string };
  region?: string;
  health: "OK" | "WARNING" | "ERROR";
  warnings: string[];
}

// ---- Error helper ----
export interface ToolError {
  is_error: true;
  code: string;
  message_th: string; // user-facing
  message_en?: string; // technical
  suggestion?: string;
}
