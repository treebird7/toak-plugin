// Shared test helpers. Zero dependencies — everything here is Node stdlib so
// the suite runs on a bare `node --test` with nothing installed.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const TESTS_DIR = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(TESTS_DIR, '..');
export const FIXTURE_BIN = join(TESTS_DIR, 'fixtures', 'bin');
export const FAKE_ENVOAK = join(TESTS_DIR, 'fixtures', 'fake-envoak.js');

/**
 * The full tool set the local stdio server registers, as measured against the
 * committed bundle. The README and skills/toak/SKILL.md both claimed 7 — the
 * approvals + chat group — and omitted the messages and toaklink groups the
 * server also registers. Kept here as the single source both docs are checked
 * against.
 */
export const APPROVAL_AND_CHAT_TOOLS = [
  'health_check',
  'request_approval',
  'check_approval_status',
  'list_pending_approvals',
  'chat_join',
  'chat_read',
  'chat_send',
  // Local stdio only — the remote /api/mcp surface has no chat_watch. Arrived
  // with the 0.2.17 sync; the 0.2.13 bundle this repo shipped before did not
  // register it, which is why the count moved 14 -> 15.
  'chat_watch',
];

export const MESSAGES_TOOLS = ['messages_send', 'messages_inbox'];

/**
 * skills/toak/SKILL.md marks these "removed as MCP tools 2026-07-04 (tb-8en3)".
 * They are not removed — the bundle registers them and MCP clients offer them.
 * Upstream deprecated them in the tool *description* instead ("DEPRECATED —
 * legacy toaklink schema, bypasses ADR-0003 delivery gates"), which is what an
 * agent picking from the tool list actually reads. Pinned, together with the
 * warning text, until upstream either unregisters them or retracts the notice.
 */
export const DEPRECATED_TOAKLINK_TOOLS = [
  'toaklink_send',
  'toaklink_inbox',
  'toaklink_read',
];

/**
 * Live tools that merely share the `toaklink_` prefix — neither is deprecated
 * and neither touches the legacy messaging routes. `toaklink_collab` appends to
 * a collaboration file's session log; `toaklink_agents` lists live rooms and
 * connected principals. Grouping them with the deprecated set by prefix alone
 * is a mistake worth guarding against.
 */
export const LIVE_TOAKLINK_TOOLS = ['toaklink_collab', 'toaklink_agents'];

export const DOCUMENTED_TOOLS = [
  ...APPROVAL_AND_CHAT_TOOLS,
  ...MESSAGES_TOOLS,
  ...DEPRECATED_TOAKLINK_TOOLS,
  ...LIVE_TOAKLINK_TOOLS,
];

export function readJSON(relPath) {
  return JSON.parse(readFileSync(join(REPO_ROOT, relPath), 'utf8'));
}

export function readText(relPath) {
  return readFileSync(join(REPO_ROOT, relPath), 'utf8');
}

/**
 * Run launch.sh with a stub `node` on PATH that dumps the environment the real
 * server would have been exec'd with, instead of starting it. Keeps the
 * env-precedence assertions instant and deterministic — no server boot, no
 * timeouts, no network.
 *
 * @param {Record<string,string>} env extra env vars for the launcher
 * @returns {Promise<{env: Record<string,string>, stderr: string, argv: string[]}>}
 */
export async function launchWithStubNode(env = {}) {
  const { stdout, stderr, code } = await run(join(REPO_ROOT, 'launch.sh'), [], {
    ...env,
    PATH: `${FIXTURE_BIN}:${process.env.PATH}`,
  });
  if (code !== 0) throw new Error(`launch.sh exited ${code}\n${stderr}`);
  const line = stdout.trim().split('\n').filter(Boolean).pop();
  if (!line) throw new Error(`launch.sh produced no stub output\nstderr: ${stderr}`);
  const parsed = JSON.parse(line);
  return { env: parsed.env, argv: parsed.argv, stderr };
}

/**
 * Run launch.sh for real — boots the actual bundled server — and return the
 * banner it logs to stderr. Kills the server once the banner arrives, since
 * `serve` otherwise blocks on stdin forever.
 */
export async function launchForReal(env = {}, timeoutMs = 20000) {
  const child = spawn(join(REPO_ROOT, 'launch.sh'), [], {
    env: { ...process.env, ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stderr = '';
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`launch.sh did not start within ${timeoutMs}ms\nstderr: ${stderr}`));
    }, timeoutMs);
    const done = () => {
      clearTimeout(timer);
      child.kill('SIGKILL');
      resolve({ stderr });
    };
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
      if (stderr.includes('Toak MCP Server started')) done();
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('exit', () => {
      clearTimeout(timer);
      resolve({ stderr });
    });
  });
}

/** Run a command to completion, capturing stdout/stderr. Never rejects on nonzero exit. */
export function run(cmd, args = [], env = {}, { input, timeoutMs = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: REPO_ROOT,
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`${cmd} timed out after ${timeoutMs}ms\nstdout: ${stdout}\nstderr: ${stderr}`));
    }, timeoutMs);
    child.stdout.on('data', (c) => { stdout += c; });
    child.stderr.on('data', (c) => { stderr += c; });
    child.on('error', (err) => { clearTimeout(timer); reject(err); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ stdout, stderr, code }); });
    if (input !== undefined) child.stdin.write(input);
    child.stdin.end();
  });
}

/**
 * Speak MCP over stdio to the bundled server: initialize, notify initialized,
 * then tools/list. Resolves once the tools/list response arrives.
 */
export function mcpHandshake({ timeoutMs = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(REPO_ROOT, 'dist', 'toak-mcp.js'), 'serve'], {
      cwd: REPO_ROOT,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let buffer = '';
    let stderr = '';
    const responses = new Map();
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`MCP handshake timed out\nstdout: ${buffer}\nstderr: ${stderr}`));
    }, timeoutMs);

    child.stderr.on('data', (c) => { stderr += c; });
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        if (msg.id !== undefined) responses.set(msg.id, msg);
        if (responses.has(2)) {
          clearTimeout(timer);
          child.kill('SIGKILL');
          resolve({ initialize: responses.get(1), toolsList: responses.get(2), stderr });
          return;
        }
      }
    });
    child.on('error', (err) => { clearTimeout(timer); reject(err); });

    const send = (obj) => child.stdin.write(`${JSON.stringify(obj)}\n`);
    send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'toak-plugin-tests', version: '1' },
      },
    });
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
  });
}

/** Minimal YAML frontmatter reader — enough for the flat key: value blocks in SKILL.md. */
export function parseFrontmatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!match) return null;
  const fields = {};
  for (const line of match[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (kv) fields[kv[1]] = kv[2].trim();
  }
  return fields;
}
