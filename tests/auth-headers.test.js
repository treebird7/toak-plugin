// End-to-end guard for the toak#179 credential leak.
//
// Drives the real bundle against a local stub standing in for the Supabase
// project, with a canary `tk_` value in TOAK_API_KEY and a canary agent-key
// file on disk.
//
// The vehicle is the bundled CLI's `toak say`, not an MCP tool call. It used
// to be the `toaklink_send` tool, which 0.2.32 unregistered (tk-toy9) — but
// the leak path is not gone, only the MCP entry to it. Both entries always
// funnelled into the same SupabaseToaklinkClient.send(), the single call site
// carrying `useAgentKey: false`, and `toak say` still reaches it. That path is
// the only /functions/v1/ request the whole bundle makes. Retiring this suite
// with the tool would have left it unguarded. Both are the reusable Toak-domain credentials that
// f227c59/d07b1c2 stopped attaching to non-Toak hosts. If either shows up in a
// request to the Supabase stub, the leak is back.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { REPO_ROOT } from './helpers.js';

// Split so the literals do not themselves trip the committed-secret scanner in
// credential-gate.test.js — that scanner deliberately covers the whole repo.
const API_KEY_CANARY = `tk_${'LEAKCANARY0000000000000000000000'}`;
const AGENT_KEY_CANARY = `tk_${'AGENTFILECANARY00000000000000000'}`;
// Deliberately NOT a JWT. The send path only forwards the Supabase key as an
// explicit `apiKey` when it looks like a JWT (`startsWith("eyJ")`), and an
// explicit apiKey short-circuits the auth chain ahead of both Toak-domain
// credentials — which would make this test pass no matter what the gate does.
// A non-JWT anon key leaves the agent-key/TOAK_API_KEY branch live, so the
// assertions below can actually fail. Verified by mutation: flipping the
// toaklink/send call site to useAgentKey:true makes these tests red. That is
// the same call site the CLI reaches, so the mutation still bites.
const ANON_KEY = 'sb-anon-not-a-jwt';

let stub;
let requests;
let baseUrl;
let home;

before(async () => {
  requests = [];
  stub = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      requests.push({ url: req.url, headers: req.headers, body });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        channel_id: 'test-channel',
        message_id: 'test-message',
        timestamp: '2026-01-01T00:00:00Z',
      }));
    });
  });
  await new Promise((resolve) => stub.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${stub.address().port}`;

  // A populated ~/.toak/agent-key is the credential d07b1c2 stopped leaking.
  home = mkdtempSync(join(tmpdir(), 'toak-authtest-'));
  mkdirSync(join(home, '.toak'), { recursive: true, mode: 0o700 });
  writeFileSync(join(home, '.toak', 'agent-key'), `${AGENT_KEY_CANARY}\n`, { mode: 0o600 });
});

after(() => stub?.close());

/** Run one bundled-CLI command wired to the stub, and let it drive the requests we inspect. */
function runCli(args, { timeoutMs = 20000 } = {}) {
  // toaklink/send requests are signed; supply an inline key so the call gets
  // past signing and actually reaches the network layer we are inspecting.
  const { privateKey } = generateKeyPairSync('ed25519');
  const child = spawn(process.execPath, [join(REPO_ROOT, 'dist', 'toak-mcp.js'), ...args], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      HOME: home,
      TOAK_SUPABASE_URL: baseUrl,
      TOAK_SUPABASE_ANON_KEY: ANON_KEY,
      TOAK_API_URL: baseUrl,
      TOAK_API_KEY: API_KEY_CANARY,
      TOAK_AGENT_ID: 'leak-probe',
      TOAK_AGENT_PRIVATE_KEY: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`toak ${args.join(' ')} timed out\nstdout: ${stdout}\nstderr: ${stderr}`));
    }, timeoutMs);
    child.stdout.on('data', (c) => { stdout += c; });
    child.stderr.on('data', (c) => { stderr += c; });
    child.on('error', (err) => { clearTimeout(timer); reject(err); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
    child.stdin.end();
  });
}

describe('no Toak-domain credential reaches the Supabase domain (toak#179)', () => {
  let sent;

  before(async () => {
    requests.length = 0;
    const { code, stdout, stderr } = await runCli(['say', 'someone', 'hi']);
    assert.equal(
      code,
      0,
      `toak say exited ${code}, so the leak path was never exercised:\n${stdout}\n${stderr}`,
    );
    sent = requests.filter((r) => r.url.includes('/functions/v1/'));
    assert.ok(sent.length > 0, 'no Supabase /functions request was made — the guard tested nothing');
  });

  test('the request actually hit the Supabase functions path', () => {
    assert.match(sent[0].url, /\/functions\/v1\/toak-api\/api\/toaklink\/send/);
  });

  test('the ambient TOAK_API_KEY is not attached', () => {
    for (const req of sent) {
      const serialised = JSON.stringify(req.headers);
      assert.ok(
        !serialised.includes(API_KEY_CANARY),
        `TOAK_API_KEY leaked to the Supabase domain in ${req.url}: ${serialised}`,
      );
    }
  });

  test('the ~/.toak/agent-key device-flow key is not attached', () => {
    for (const req of sent) {
      const serialised = JSON.stringify(req.headers);
      assert.ok(
        !serialised.includes(AGENT_KEY_CANARY),
        `~/.toak/agent-key leaked to the Supabase domain in ${req.url}: ${serialised}`,
      );
    }
  });

  test('no bearer token with the reusable tk_ prefix is attached at all', () => {
    for (const req of sent) {
      const auth = req.headers.authorization ?? '';
      assert.doesNotMatch(auth, /^Bearer tk_/, `a tk_ credential reached ${req.url}`);
    }
  });

  test('the Supabase anon key is still sent, so the call remains functional', () => {
    // The fix must suppress the Toak credential without breaking legitimate
    // auth — a non-JWT key travels in the `apikey` header.
    assert.equal(
      sent[0].headers.apikey,
      ANON_KEY,
      'the Supabase anon key was dropped — the call would 401',
    );
  });

  test('no Authorization header is attached at all on this path', () => {
    // With the gate on, neither Toak credential is eligible and there is no
    // user session, so the request should carry only the Supabase apikey.
    assert.equal(
      sent[0].headers.authorization,
      undefined,
      `an unexpected Authorization header reached the Supabase domain: ${sent[0].headers.authorization}`,
    );
  });
});
