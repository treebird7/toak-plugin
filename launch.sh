#!/bin/bash
# Toak plugin MCP launcher (tb-gcir) — the bare `node dist/toak-mcp.js serve`
# entry left the server with no Supabase env, so chat_send/toaklink failed
# (health_check: supabase=null). Sources an env file, vault-injects the
# Supabase service key if a vault is available, then execs the server.
# Degrades gracefully — a missing env file or unreachable vault still starts
# the server, with only the Supabase-backed tools dark.
# Identity precedence: envoak label > host-supplied TOAK_AGENT_ID (e.g. Codex
# config.toml env) > the .env file's id. The server already prefers
# ENVOAK_AGENT_LABEL; this keeps the .env from clobbering an inherited id.
# No deployment-specific path ships as a default — env file (TOAK_ENV_FILE,
# default ~/.toak/env) and the envoak binary (ENVOAK_BIN, else resolved from
# PATH) are both configuration, not hardcoded install-layout assumptions.
_inherited_id="${TOAK_AGENT_ID:-}"
TOAK_ENV_FILE="${TOAK_ENV_FILE:-$HOME/.toak/env}"
set -a
[ -f "$TOAK_ENV_FILE" ] && . "$TOAK_ENV_FILE"
set +a
[ -n "$_inherited_id" ] && export TOAK_AGENT_ID="$_inherited_id"

ENVOAK_JS="${ENVOAK_BIN:-$(command -v envoak 2>/dev/null)}"
vault_get() {
  if [ -n "$ENVOAK_JS" ] && [ -f "$ENVOAK_JS" ]; then node "$ENVOAK_JS" vault get "$@";
  elif [ -n "$ENVOAK_JS" ]; then "$ENVOAK_JS" vault get "$@";
  else return 1; fi
}

export TOAK_SUPABASE_URL="${TOAK_SUPABASE_URL:-}"
export TOAK_API_URL="${TOAK_API_URL:-$TOAK_SUPABASE_URL}"
if [ -z "${TOAK_SUPABASE_SERVICE_KEY:-}" ]; then
  if KEY="$(vault_get supabase_runtime SUPABASE_RUNTIME_SERVICE_KEY 2>/dev/null)" && [ -n "$KEY" ]; then
    export TOAK_SUPABASE_SERVICE_KEY="$KEY"
  else
    echo "toak plugin: vault get failed — starting without Supabase key (chat_send disabled)" >&2
  fi
fi

exec node "$(dirname "$0")/dist/toak-mcp.js" serve
