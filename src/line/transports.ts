/**
 * Transport picker.
 *
 * Given a normalized `target`, decide which LINE send transport to use and
 * return a small wrapper that performs the call. This keeps tool code clean:
 * the tool layer worries about message composition; this layer worries about
 * which endpoint and how to chunk recipients.
 */

import { MULTICAST_MAX_RECIPIENTS } from "../constants.js";
import { TH } from "../i18n/th.js";
import type { LineClient } from "./client.js";
import type {
  LineMessage,
  NarrowcastFilter,
  SendTarget,
  SendTransport,
} from "../types.js";

export interface PickedTransport {
  transport: SendTransport;
  /** Approximate recipient count for cost estimation (undefined for narrowcast/broadcast). */
  estimatedRecipients?: number;
  /**
   * Set when the transport cannot deliver (e.g. reply token unknown/expired).
   * Callers should surface this Thai message instead of attempting the send.
   */
  unavailableReason?: string;
  /** Closure that executes the send. */
  send: (
    messages: LineMessage[],
    options?: { retryKey?: string },
  ) => Promise<{ request_id?: string }>;
  /** Closure that runs LINE's `/validate` endpoint (no recipients consumed). */
  validate: (messages: LineMessage[]) => Promise<void>;
}

export interface PickTransportInput {
  client: LineClient;
  target: SendTarget;
  /** Pre-resolved audience id when `target` is `{ audience: name }` and we already looked up the id. */
  resolvedAudienceId?: string;
  /** Replay-protected reply token cache lookup for `target.reply_to`. */
  resolveReplyToken?: (webhookEventId: string) => string | undefined;
}

export function pickTransport(input: PickTransportInput): PickedTransport {
  const { client, target } = input;

  if ("reply_to" in target) {
    const replyToken = input.resolveReplyToken?.(target.reply_to);
    if (!replyToken) {
      // No usable reply token — a push fallback is impossible here (we only
      // have a webhookEventId, not the user id), so surface an honest error.
      return {
        transport: "reply",
        estimatedRecipients: 1,
        unavailableReason: TH.replyTokenUnavailable,
        send: async () => {
          throw new Error(TH.replyTokenUnavailable);
        },
        validate: async (messages) => {
          await client.validateReply(messages);
        },
      };
    }
    return {
      transport: "reply",
      estimatedRecipients: 1,
      send: async (messages) => {
        await client.reply(replyToken, messages);
        return {};
      },
      validate: async (messages) => {
        await client.validateReply(messages);
      },
    };
  }

  if ("user_id" in target) {
    const userId = target.user_id;
    return {
      transport: "push",
      estimatedRecipients: 1,
      send: async (messages, options) => {
        await client.push(userId, messages, options?.retryKey);
        return {};
      },
      validate: async (messages) => {
        await client.validatePush(messages);
      },
    };
  }

  if ("user_ids" in target) {
    const userIds = target.user_ids;
    return {
      transport: "multicast",
      estimatedRecipients: userIds.length,
      send: async (messages, options) => {
        // Chunk to 500 per call
        const chunks = chunk(userIds, MULTICAST_MAX_RECIPIENTS);
        for (const c of chunks) {
          await client.multicast(c, messages, options?.retryKey);
        }
        return {};
      },
      validate: async (messages) => {
        await client.validateMulticast(messages);
      },
    };
  }

  if ("audience" in target) {
    const audienceId = input.resolvedAudienceId ?? target.audience;
    return {
      transport: "narrowcast",
      estimatedRecipients: undefined,
      send: async (messages, options) => {
        const result = await client.narrowcast(
          {
            messages,
            recipient: { type: "audience", audienceGroupId: Number(audienceId) },
          },
          options?.retryKey,
        );
        return { request_id: result.requestId };
      },
      validate: async (messages) => {
        await client.validateNarrowcast({
          messages,
          recipient: { type: "audience", audienceGroupId: Number(audienceId) },
        });
      },
    };
  }

  if ("filter" in target) {
    const filter = target.filter;
    return {
      transport: "narrowcast",
      estimatedRecipients: undefined,
      send: async (messages, options) => {
        const result = await client.narrowcast(
          {
            messages,
            filter: { demographic: toDemographic(filter) },
          },
          options?.retryKey,
        );
        return { request_id: result.requestId };
      },
      validate: async (messages) => {
        await client.validateNarrowcast({
          messages,
          filter: { demographic: toDemographic(filter) },
        });
      },
    };
  }

  // everyone
  return {
    transport: "broadcast",
    estimatedRecipients: undefined,
    send: async (messages, options) => {
      await client.broadcast(messages, options?.retryKey);
      return {};
    },
    validate: async (messages) => {
      await client.validateBroadcast(messages);
    },
  };
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

function toDemographic(filter: NarrowcastFilter): Record<string, unknown> {
  // Translate the simplified MCP filter shape into LINE's nested demographic operator.
  const conditions: Record<string, unknown>[] = [];
  if (filter.genders?.length) {
    conditions.push({ type: "gender", oneOf: filter.genders });
  }
  if (filter.ages?.length) {
    conditions.push({ type: "age", oneOf: filter.ages });
  }
  if (filter.areas?.length) {
    conditions.push({ type: "area", oneOf: filter.areas });
  }
  if (filter.app_types?.length) {
    conditions.push({ type: "appType", oneOf: filter.app_types });
  }
  if (filter.subscription_periods?.length) {
    conditions.push({ type: "subscriptionPeriod", oneOf: filter.subscription_periods });
  }
  if (conditions.length === 1) return conditions[0]!;
  return { operator: { and: conditions } };
}
