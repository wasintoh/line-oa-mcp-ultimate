# Send images & Rich Messages with zero hosting — Image Hosting Layer (v2.2)

> For anyone who wants images and tappable Rich Messages in their customers' chats
> **without ever hearing the word "hosting"**. Thai version: [image-hosting-th.md](image-hosting-th.md)

---

## The problem this removes

LINE doesn't accept image *files* — messages carry image *URLs*, and LINE pulls the
bytes itself. A Rich Message additionally needs the artwork in **five exact widths**
(1040/700/460/300/240) served under one base URL. Before v2.2 that meant: resize five
times, find hosting, upload, paste URLs — the step where most people gave up.

## What v2.2 does instead

```
Attach a picture. Say "send this as a Rich Message". Done.
```

Behind that one sentence, `line_prepare_image` automatically:

1. **Resizes** your image into every size LINE requires.
2. **Hosts it** wherever you happen to run — your laptop, a server, anywhere.
   Nothing to sign up for; the best available route is picked for you.
3. **Verifies delivery** — every size is checked reachable *before* the tool ever
   says success. The classic "API said success but customers see a blank image"
   failure is designed out.
4. Returns a `prepared_key` that `line_design_imagemap` and `line_send_message`
   accept directly — no URLs ever travel through the conversation.

If automation isn't possible on your network, you don't get an error — you get a
ready-made zip (five correctly-named files) plus 1-minute instructions. **Nobody
dead-ends.**

## The one rule to remember

**LINE fetches the image when each recipient *first opens* the message — not at
send time.** (Live-verified 2026-07-31: an unopened message's image dies with its
host; an opened one survives host shutdown and even a device restart.)

So:

- ⏰ Keep your machine and the MCP running until your audience has opened the
  message. The built-in **24-hour keep-alive** covers a normal broadcast day.
- ✅ Once a customer has opened it, LINE serves the image from its own cache
  forever — shutting down afterwards affects nobody who already looked.
- ⚠️ Customers who first open *after* hosting ended will see "image unavailable".
- 📌 Big or long-running campaigns where you can't keep a machine on: use a
  permanent host and pass `base_url` the classic way, or deploy the MCP in HTTP
  mode on an always-on server with `MCP_PUBLIC_URL` (see below).

## Feeding the tool an image

| Input | When | Notes |
|---|---|---|
| `file_path` | The image is on the machine running the MCP | **Preferred** — fastest and safest |
| `source_url` | The image is on the public web | Google Drive / Dropbox share links are rewritten to direct-download automatically |
| `base64` | Nothing else exists (e.g. cloud AI sessions) | Last resort — long base64 carried through an LLM can corrupt silently and produce a blank image |

## Optional configuration (defaults work with zero setup)

| Env | Purpose |
|---|---|
| `MCP_PUBLIC_URL` | HTTP-mode deployments: your server's public URL (e.g. `https://line-mcp.example.com`) — images are then served by your own server, no tunnel involved |
| `LINE_MCP_TUNNEL=off` | Disable the quick-tunnel route (restrictive corporate policy) — falls straight to the manual package |
| `LINE_MCP_CLOUDFLARED_PATH` | Use your own cloudflared binary instead of the auto-downloaded, checksum-verified one |

Security posture: the auto-downloaded binary is pinned and SHA-256-verified before
it ever runs; images are served **from memory only** (never the filesystem) under
unguessable random keys.

## Troubleshooting

| Symptom | What to do |
|---|---|
| "Automatic hosting unavailable" | You already received the zip + instructions — the LINE OA Manager route needs no hosting at all |
| A size failed verification | Run `line_prepare_image` again (a fresh route is opened); check `line_image_host_status` |
| "prepared_key not found" | The MCP was restarted — keys live in memory; prepare again (takes seconds) |
| Sent image renders blank | The input arrived as corrupted base64 — re-run with `file_path` or `source_url` |
| Which providers are usable here? | `line_image_host_status` (read-only, always safe) |

## For self-hosters & automation (n8n, VPS, agencies)

Run the MCP in HTTP mode (`MCP_TRANSPORT=http`, see
[http-transport.md](http-transport.md)) and set `MCP_PUBLIC_URL` to your public
domain. Images are then served from the same always-on server that runs the MCP —
no tunnel, no keep-the-laptop-on rule, and any MCP-capable workflow engine can
drive the full prepare → design → send pipeline.

> ℹ️ The quick-tunnel route uses TryCloudflare — a free development service with no
> SLA. It only needs to survive until your audience opens the message (hours, not
> months); after that LINE's cache takes over permanently, which is exactly the
> window it's suited for.
