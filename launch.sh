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
# default ~/.toak/env), the envoak binary (ENVOAK_BIN, else resolved from
# PATH) and the vault coordinate (TOAK_VAULT_PROJECT/TOAK_VAULT_SECRET) are all
# configuration, not hardcoded install-layout assumptions.
_inherited_id="${TOAK_AGENT_ID:-}"
TOAK_ENV_FILE="${TOAK_ENV_FILE:-$HOME/.toak/env}"
set -a
# shellcheck source=/dev/null  # path is user configuration, not a fixed file
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
# TOAK_API_URL is the toak.me hub, NOT the Supabase project URL — they are
# different services. Defaulting it to $TOAK_SUPABASE_URL silently repointed
# approvals at the Supabase domain for anyone whose env file set the Supabase
# URL but not the hub, sending the agent key to the wrong host. Leave it unset
# instead, so the server applies its own `TOAK_API_URL || HUB_URL ||
# https://toak.me` fallback. Fixed in treebird7/toak-plugin#2; this ports it
# back to the monorepo, which had kept the vulnerable form.
if [ -n "${TOAK_API_URL:-}" ]; then export TOAK_API_URL; fi
# Where the service key lives in a vault is CONFIGURATION, same as TOAK_ENV_FILE
# and ENVOAK_BIN above — not something this script gets to assume (#260). The
# defaults are Treebird's coordinate, so nothing changes for the fleet; an
# external installer with a different vault layout (or a different secret name
# after a rename) sets these instead of patching a published script.
# The old default (supabase_runtime/SUPABASE_RUNTIME_SERVICE_KEY) named a vault
# project that does not exist, so the fetch ALWAYS failed and every server
# started keyless — #260's actual cause, which the improved message above
# reported without fixing. The real coordinate sits with toak's other Supabase
# config (toak/TOAK_SUPABASE_URL, toak/TOAK_SUPABASE_ANON_KEY).
#
# ⚠️ Do NOT "fix" a broken coordinate by reaching for the nearest similar name:
# spidersan/SUPABASE_RUNTIME_KEY and supabase/KEY both hold the PUBLISHABLE key
# despite service-sounding names. Pointing here at one of those starts the
# server WITH a key, keeps health_check green, and still fails every privileged
# call — the same silent failure wearing a different mask. Cheap discriminator:
# sb_secret_ values are 41 chars, sb_publishable_ are 46.
#
# The coordinate is toak/SUPABASE_SERVICE_KEY — no TOAK_ prefix on the secret
# name, despite the env var it populates being TOAK_SUPABASE_SERVICE_KEY. That
# is the coordinate carrying the agent-key grants (9 keys, inject-only, three
# agents across three machines); an otherwise-identical entry without them
# resolves fine under a human vault session and returns nothing when a server
# resolves via its agent key. "It works on my machine" is exactly the failure
# a human-session test cannot see.
TOAK_VAULT_PROJECT="${TOAK_VAULT_PROJECT:-toak}"
TOAK_VAULT_SECRET="${TOAK_VAULT_SECRET:-SUPABASE_SERVICE_KEY}"
if [ -z "${TOAK_SUPABASE_SERVICE_KEY:-}" ]; then
  if KEY="$(vault_get "$TOAK_VAULT_PROJECT" "$TOAK_VAULT_SECRET" 2>/dev/null)" && [ -n "$KEY" ]; then
    export TOAK_SUPABASE_SERVICE_KEY="$KEY"
  else
    # Name the coordinate that failed. "vault get failed" sends you looking for
    # a broken vault; the actual cause today is a coordinate that resolves
    # nowhere (#260), and the old message could not tell those apart. The
    # server still starts — Supabase-backed tools going dark is a degradation,
    # not a reason to deny the caller approvals and hub tools too.
    echo "toak plugin: could not read ${TOAK_VAULT_PROJECT}/${TOAK_VAULT_SECRET} from the vault." >&2
    echo "toak plugin: starting WITHOUT a Supabase key — chat_send and toaklink_* will be unavailable." >&2
    echo "toak plugin: set TOAK_SUPABASE_SERVICE_KEY directly, or point TOAK_VAULT_PROJECT/TOAK_VAULT_SECRET at the right coordinate." >&2
  fi
fi

exec node "$(dirname "$0")/dist/toak-mcp.js" serve
