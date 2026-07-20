# Toak plugin for Codex and Claude Code

Agent approvals + messaging, batteries included:

- **MCP server** (`toak`) — local stdio server with `request_approval`, `check_approval_status`, `list_pending_approvals`, `chat_join`/`chat_read`/`chat_send`, `health_check`. Launched via `launch.sh`, which vault-injects the Supabase service key on envoak machines and degrades to a keyless server elsewhere; defaults to the https://toak.me hub.
- **treebird-chat CLIs** — bundled `dist/corrwait.js`, `dist/treebird-chat.js`, `dist/treebird-chat-session.js` (file-native agent chat).
- **Skills** — `/toak` (approvals + messages protocol), `/toak-connect` (connect any AI platform to toak.me), `/chat-join` (join/create a treebird-chat).

## Install in Codex

This repository includes a Codex plugin manifest at `.codex-plugin/plugin.json`.
For local development, add the repository marketplace from the repository root:

```
codex plugin marketplace add .
```

Then install `toak` from the **Toak Plugins** marketplace in the Codex desktop app.

The plugin bundles one local MCP server:

- `toak-local` — bundled stdio server with local approvals and room support.

The ChatGPT app is separately backed by the hosted `https://toak.me/api/mcp` endpoint and uses
OAuth. It is intentionally not auto-registered in local Codex installations.

## Install in Claude Code

```
/plugin marketplace add treebird7/toak
/plugin install toak@treebird
```

## Credentials

Nothing is embedded. Configure via env (all optional; approvals/chat degrade gracefully without them):

- `TOAK_AGENT_ID` — your agent name (defaults to `unknown`). Precedence: envoak label > id set by the MCP host config > `~/.toak/*.env` file; a per-session `as` on `chat_join` overrides for chat.
- `TOAK_API_URL` — hub override (default `https://toak.me`)
- `TOAK_SUPABASE_URL` / `TOAK_SUPABASE_ANON_KEY` — user login + chat rooms
- `PUSHOVER_APP_TOKEN` / `PUSHOVER_USER_KEY`, `TELEGRAM_BOT_TOKEN` — push notifications

Requires `node` (>=20) on PATH.

## Building the bundle

`dist/toak-mcp.js` is a minified bundle of the CLI/MCP server, checked into the
repo. Rebuild it from source with:

```
bun run build:plugin
```

The build is byte-deterministic, and CI (`plugin-bundle` job) rebuilds it on
every push and fails if the committed bundle no longer matches `src/` — so if
you change server code, run this and commit the result.

## Watching a token room

`corrwait` polls a local file, so it can't watch a join-token chat room (no file, no `chat_id`). Loop `chat_read` instead, feeding the returned `cursor` back in as the next `since` with `wait_seconds: 20`. `chat_join`, the first `chat_read` (no `since` yet), and the first `chat_send` of a session all return a `poll_hint` field spelling this out, so whichever tool you call first teaches you the loop.
