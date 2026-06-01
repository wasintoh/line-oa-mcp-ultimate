# Release Notes — v1.0.3

**Release date:** 2026-06-01
**Type:** Patch (no breaking changes)

## 🐛 Fixes

- **Version reporting** — `SERVER_VERSION` in `src/constants.ts` was hard-pinned to `1.0.0`, so every published build (1.0.0 → 1.0.2) reported `v1.0.0` in its startup banner and `/health` response regardless of the real package version. It is now synced to the package version, so the banner and `/health` endpoint report the correct version again.

## 📝 Documentation

- **Install method** — `docs/quickstart-th.md`, `docs/multi-oa-setup-th.md`, and `docs/http-transport.md` now use the published npm package via `npx -y line-oa-mcp-ultimate`. Removed the old local-development steps (repo clone, `npm run build`, and hard-coded `/Users/...` paths) that only worked on the author's machine.
- **Multi-OA setup** — rewritten around the auto-discovered `~/.line-mcp/config.json` (plus `LINE_MCP_CONFIG` for a custom path), since users installing via `npx` don't have a local repo folder. Switched from a personal/dev voice to general public-facing docs.
- **HTTP transport** — corrected the server name (was `@line-mcp/server` / `line-mcp-server`) to `line-oa-mcp-ultimate`, updated the version strings, and added an `npx`-based run command alongside the repo script.
- **README** — the package description and intro now highlight multi-OA / agency support; the Multi-OA section no longer assumes a cloned repo and links to the full Thai walkthrough.

## 🔁 Consistency

- Version is now `1.0.3` across `package.json`, `package-lock.json`, `src/constants.ts`, `README.md`, and every doc.

---

> Previous notes: [`RELEASE_NOTES_v1.0.1.md`](RELEASE_NOTES_v1.0.1.md)
