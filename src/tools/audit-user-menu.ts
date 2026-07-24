/**
 * Tool: line_audit_user_menu
 *
 * Diagnose why a specific LINE user sees (or doesn't see) a particular rich
 * menu. The LINE platform priority is: per-user link > default > none. This
 * tool surfaces all three layers and explains the conclusion in Thai.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { resolveOa } from "../config/multi-oa.js";
import { LineApiError, LineClient } from "../line/client.js";
import { TH } from "../i18n/th.js";

const InputSchema = z
  .object({
    user_id: z.string().min(1).describe("LINE user ID to inspect"),
    oa: z.string().optional(),
  })
  .strict();

export function registerAuditUserMenuTool(server: McpServer): void {
  server.registerTool(
    "line_audit_user_menu",
    {
      title: "Audit user's LINE Rich Menu",
      description: `Diagnose "why is user X seeing menu Y?" — inspects the rich-menu priority chain: a per-user link (line_link_rich_menu) overrides the account-wide default, and LINE OA Manager-built menus silently override API-built ones. Pass user_id.

Returns { user_id, visible_rich_menu_id?, source:'per_user'|'default'|'none', per_user_link?, default_id?, explanation (Thai) }.`,
      inputSchema: InputSchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (raw: unknown) => {
      try {
        const params = InputSchema.parse(raw);
        const { config } = resolveOa(params.oa);
        const client = new LineClient({ channelAccessToken: config.channel_access_token });

        const [perUser, defaultMenu] = await Promise.all([
          client.getRichMenuOfUser(params.user_id),
          client.getDefaultRichMenu(),
        ]);

        let visible: string | undefined;
        let source: "per_user" | "default" | "none";
        let explanation: string;

        if (perUser) {
          visible = perUser.richMenuId;
          source = "per_user";
          explanation = `User เห็น Rich Menu \`${visible}\` เพราะมี per-user link (link/unlink ด้วย API)`;
        } else if (defaultMenu) {
          visible = defaultMenu.richMenuId;
          source = "default";
          explanation = `User เห็น default Rich Menu \`${visible}\` (account-wide). ไม่มี per-user override`;
        } else {
          source = "none";
          explanation = "❓ User ไม่เห็น Rich Menu — ไม่มี per-user link และไม่มี default menu";
        }

        const output = {
          user_id: params.user_id,
          visible_rich_menu_id: visible,
          source,
          per_user_link: perUser?.richMenuId,
          default_id: defaultMenu?.richMenuId,
          explanation,
        };

        const md: string[] = [
          `# 🔍 Rich Menu audit — user \`${params.user_id}\``,
          "",
          explanation,
          "",
          "## Layers",
          `- **Per-user link:** ${perUser?.richMenuId ?? "—"}`,
          `- **Account default:** ${defaultMenu?.richMenuId ?? "—"}`,
          "",
          "_หมายเหตุ: Rich Menu ที่สร้างผ่าน LINE OA Manager UI อาจไม่ปรากฏใน API เลย — และในทางกลับกัน_",
        ];
        return {
          content: [{ type: "text", text: md.join("\n") }],
          structuredContent: output as unknown as Record<string, unknown>,
        };
      } catch (err) {
        if (err instanceof LineApiError) {
          return { isError: true, content: [{ type: "text", text: err.message }] };
        }
        const msg = err instanceof Error ? err.message : String(err);
        return { isError: true, content: [{ type: "text", text: TH.unknownError(msg) }] };
      }
    },
  );
}
