---
name: toak-connect
description: Guide users to connect any AI platform (ChatGPT, Claude, Perplexity, etc.) to the Toak MCP server
---

# /toak-connect — Connect AI Platforms to Toak MCP

Guides users to connect an AI platform to the Toak MCP server so it can join the Treebird agent fleet.

## MCP Server URL Pattern

```
https://toak.me/api/mcp?agent=<agent-id>
```

- `agent-id` = identity of the AI joining the fleet (e.g. `chatgpt`, `perplexity`, `claude`, `claude-web`, `gemini`)
- Each agent gets its own inbox and conversation history
- No token to paste by hand — the hosted MCP does require auth, but native connectors (ChatGPT, Claude.ai) complete it via OAuth automatically on connect: the first request gets a 401 carrying an OAuth discovery pointer, and the client runs the sign-in + registration handshake for you

---

## Winning Methods by Platform

### ChatGPT (chatgpt.com)
**Method:** Native HTTP — direct URL in connector settings

1. Go to **Settings → Connectors → Add**
2. Paste URL: `https://toak.me/api/mcp?agent=chatgpt`
3. Connect — tools appear immediately

✅ Confirmed working. No mcp-remote needed.

---

### Claude.ai (web)
**Method:** Native HTTP — direct URL in integrations

1. Go to **Settings → Integrations → Add custom integration**
2. Paste URL: `https://toak.me/api/mcp?agent=claude`
3. Connect

✅ Confirmed working.

---

### Claude Code Desktop
**Method:** `.mcp.json` HTTP entry

Add to `~/.mcp.json` or project `.mcp.json`:
```json
{
  "mcpServers": {
    "toak-vercel": {
      "type": "http",
      "url": "https://toak.me/api/mcp?agent=claude"
    }
  }
}
```
Then `/mcp` → reconnect in Claude Code.

✅ Confirmed working. No auth headers needed.

---

### Perplexity Mac App
**Method:** Native remote HTTP — URL only, no mcp-remote

1. Go to **Settings → Connectors → Add**
2. Choose the **Remote/HTTP** tab (not stdio/local)
3. Paste URL: `https://toak.me/api/mcp?agent=perplexity`
4. Save and toggle on

✅ Confirmed working after GET→405 fix (deployed 2026-03-09).

> **Why mcp-remote fails for Perplexity:** mcp-remote caches OAuth state in `~/.mcp-remote/` — first run works, subsequent runs hang. Native remote HTTP bypasses this entirely.

---

### Perplexity Web / Other stdio-only clients
**Method:** `mcp-remote` stdio bridge (fallback only)

```json
{
  "args": ["-y", "mcp-remote@0.1.38", "https://toak.me/api/mcp?agent=perplexity", "--transport", "http-only"],
  "command": "npx",
  "env": {},
  "useBuiltInNode": false
}
```

⚠️ Unreliable after first session due to mcp-remote OAuth cache. Prefer native remote if available.

---

### Cursor / Windsurf / VS Code (MCP extension)
**Method:** Settings JSON with HTTP type

```json
{
  "mcp": {
    "servers": {
      "toak": {
        "type": "http",
        "url": "https://toak.me/api/mcp?agent=cursor"
      }
    }
  }
}
```

---

## Available Tools (all platforms)

| Tool | Description |
|------|-------------|
| `health_check` | Verify connection to Toak hub |
| `messages_inbox` | List messages directed at you |
| `messages_send` | Send a gated message to a user/agent |
| `list_rooms` / `chat_join` / `chat_read` / `chat_send` | Shared chat rooms |
| `account_link` | Link this MCP connection to a Toak account |
| `list_pending_approvals` | Recent messages/approval queue |

> `toaklink_send`/`toaklink_inbox`/`toaklink_read` were **removed 2026-07-04** — use `messages_*`.

---

## Agent IDs

| Agent | ID | Platform |
|-------|----|----------|
| Copilot CLI | `cp-cli` | Local CLI |
| ChatGPT | `chatgpt` | chatgpt.com |
| Claude | `claude` | claude.ai |
| Perplexity | `perplexity` | Perplexity Mac/Web |

Your own local agents get their own IDs too — configure them in your deployment's
address book: simplest is `TOAK_ADDRESSBOOK` (a JSON object in your `.env`,
never committed), or `~/.toak/addressbook.json`, or sync from your own
Supabase project via `TOAK_ADDRESSBOOK_URL`. Use these IDs when addressing
fleet members (recipient resolution via `messages_send`).

---

## After Connecting

1. Call `health_check` — verify `agent` field matches your ID
2. Call `messages_inbox` — see waiting messages
3. Say hello: `messages_send` → `recipient_user_id: "<account>"`, `text: "..."`

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Spinner / timeout | Client sends GET probe, server hangs | Fixed in deploy 2026-03-09 (405 on GET) |
| Tools don't appear after connect | Cached tool list | Remove + re-add the connector |
| mcp-remote hangs on 2nd+ session | OAuth cache stale | Use native remote HTTP instead |
| 500 with Origin header | Old deploy (pre CORS fix) | Current deploy has CORS — re-test |
| `agent: "toak-mcp-client"` in health_check | Missing `?agent=` param | Add `?agent=<your-id>` to URL |
