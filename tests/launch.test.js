// launch.sh is the sole entry point for both hosts and holds the trickiest
// logic in the repo (env sourcing, identity precedence, vault injection).
// These tests exist because it shipped a defect that repointed the hub off
// toak.me for anyone whose env file set TOAK_SUPABASE_URL.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchWithStubNode, launchForReal, FAKE_ENVOAK, REPO_ROOT } from './helpers.js';

const NO_VAULT = { ENVOAK_BIN: '/nonexistent/envoak' };

function envFile(contents, { dirName = 'toak-env' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'toak-test-'));
  const sub = join(dir, dirName);
  mkdirSync(sub, { recursive: true });
  const file = join(sub, 'env');
  writeFileSync(file, contents);
  return file;
}

describe('launch.sh — hub URL', () => {
  test('leaves TOAK_API_URL unset so the server applies its https://toak.me default', async () => {
    const { env } = await launchWithStubNode({
      TOAK_ENV_FILE: envFile('TOAK_SUPABASE_URL=https://project.supabase.co\n'),
      ...NO_VAULT,
    });
    // Regression: this used to be `${TOAK_API_URL:-$TOAK_SUPABASE_URL}`, which
    // silently pointed approvals at the Supabase domain.
    assert.equal(env.TOAK_API_URL, '__UNSET__');
    assert.equal(env.TOAK_SUPABASE_URL, 'https://project.supabase.co');
  });

  test('an explicit TOAK_API_URL is still honoured', async () => {
    const { env } = await launchWithStubNode({
      TOAK_API_URL: 'https://staging.toak.me',
      TOAK_ENV_FILE: envFile('TOAK_SUPABASE_URL=https://project.supabase.co\n'),
      ...NO_VAULT,
    });
    assert.equal(env.TOAK_API_URL, 'https://staging.toak.me');
  });

  test('an env-file TOAK_API_URL is still honoured', async () => {
    const { env } = await launchWithStubNode({
      TOAK_ENV_FILE: envFile(
        'TOAK_SUPABASE_URL=https://project.supabase.co\nTOAK_API_URL=https://self-hosted.example\n',
      ),
      ...NO_VAULT,
    });
    assert.equal(env.TOAK_API_URL, 'https://self-hosted.example');
  });

  test('the real server reports the toak.me hub when only Supabase is configured', async () => {
    const { stderr } = await launchForReal({
      TOAK_ENV_FILE: envFile('TOAK_SUPABASE_URL=https://project.supabase.co\n'),
      TOAK_API_URL: '',
      HUB_URL: '',
      ...NO_VAULT,
    });
    assert.match(stderr, /Hub URL: https:\/\/toak\.me/);
    assert.doesNotMatch(stderr, /Hub URL: https:\/\/project\.supabase\.co/);
  });
});

describe('launch.sh — identity precedence', () => {
  // Documented order: envoak label > host-supplied TOAK_AGENT_ID > env file.
  test('a host-supplied TOAK_AGENT_ID beats the env file', async () => {
    const { env } = await launchWithStubNode({
      TOAK_AGENT_ID: 'host-supplied',
      TOAK_ENV_FILE: envFile('TOAK_AGENT_ID=from-env-file\n'),
      ...NO_VAULT,
    });
    assert.equal(env.TOAK_AGENT_ID, 'host-supplied');
  });

  test('the env file supplies the id when the host does not', async () => {
    const { env } = await launchWithStubNode({
      TOAK_AGENT_ID: '',
      TOAK_ENV_FILE: envFile('TOAK_AGENT_ID=from-env-file\n'),
      ...NO_VAULT,
    });
    assert.equal(env.TOAK_AGENT_ID, 'from-env-file');
  });
});

describe('launch.sh — graceful degradation', () => {
  test('a missing env file still starts the server', async () => {
    const { env, argv } = await launchWithStubNode({
      TOAK_ENV_FILE: join(tmpdir(), 'toak-does-not-exist', 'env'),
      ...NO_VAULT,
    });
    assert.deepEqual(argv, ['serve']);
    assert.equal(env.TOAK_API_URL, '__UNSET__');
  });

  test('an unreachable vault still starts the server, with the documented warning', async () => {
    const { env, stderr } = await launchWithStubNode({
      TOAK_ENV_FILE: envFile(''),
      ...NO_VAULT,
    });
    // Assert what the warning must TELL you, not its exact prose: the
    // coordinate it tried (so you can fix the right thing), that the server
    // started anyway, and which tools are dark. Pinning the sentence made this
    // test fail on a deliberate message improvement (toak#260) while the
    // behaviour was unchanged.
    // The coordinate here is toak/SUPABASE_SERVICE_KEY, NOT the old
    // supabase_runtime/SUPABASE_RUNTIME_SERVICE_KEY: that named a vault project
    // which does not exist, so the fetch always failed and every server started
    // keyless (toak#279). This test previously asserted the broken value, which
    // meant CI stayed green precisely because the launcher was wrong.
    assert.match(stderr, /toak\/SUPABASE_SERVICE_KEY/);
    assert.match(stderr, /WITHOUT a Supabase key/);
    assert.match(stderr, /chat_send/);
    assert.equal(env.TOAK_SUPABASE_SERVICE_KEY, '__UNSET__');
  });

  test('the vault coordinate is overridable, and the warning names the one it tried', async () => {
    const { stderr } = await launchWithStubNode({
      TOAK_ENV_FILE: envFile(''),
      ...NO_VAULT,
      TOAK_VAULT_PROJECT: 'other_project',
      TOAK_VAULT_SECRET: 'OTHER_SECRET',
    });
    // An installer outside the flock has no vault at Treebird's layout. If the
    // override silently fell back to the default, the warning would send them
    // to a coordinate they never configured.
    assert.match(stderr, /other_project\/OTHER_SECRET/);
    // Must name the CURRENT default, not the retired one. Left as
    // /supabase_runtime/ this assertion became vacuous the moment the default
    // changed — nothing emits that string any more, so it passed without
    // testing the fallback it exists to rule out.
    assert.doesNotMatch(stderr, /toak\/SUPABASE_SERVICE_KEY/);
  });

  test('a working vault injects the Supabase service key and warns nothing', async () => {
    const { env, stderr } = await launchWithStubNode({
      TOAK_ENV_FILE: envFile(''),
      ENVOAK_BIN: FAKE_ENVOAK,
    });
    assert.equal(env.TOAK_SUPABASE_SERVICE_KEY, 'vault-injected-service-key');
    assert.doesNotMatch(stderr, /could not read/);
  });

  test('an already-set service key is not overwritten by the vault', async () => {
    const { env } = await launchWithStubNode({
      TOAK_ENV_FILE: envFile(''),
      TOAK_SUPABASE_SERVICE_KEY: 'preset-key',
      ENVOAK_BIN: FAKE_ENVOAK,
    });
    assert.equal(env.TOAK_SUPABASE_SERVICE_KEY, 'preset-key');
  });

  test('an env-file path containing spaces is sourced correctly', async () => {
    const { env } = await launchWithStubNode({
      TOAK_ENV_FILE: envFile('TOAK_AGENT_ID=spaced-path-agent\n', { dirName: 'dir with spaces' }),
      TOAK_AGENT_ID: '',
      ...NO_VAULT,
    });
    assert.equal(env.TOAK_AGENT_ID, 'spaced-path-agent');
  });
});

describe('launch.sh — packaging', () => {
  test('is executable', () => {
    const mode = statSync(join(REPO_ROOT, 'launch.sh')).mode;
    assert.ok(mode & 0o111, 'launch.sh must carry the executable bit for MCP hosts to run it');
  });

  test('execs the server with the serve subcommand', async () => {
    const { argv } = await launchWithStubNode({ TOAK_ENV_FILE: envFile(''), ...NO_VAULT });
    assert.deepEqual(argv, ['serve']);
  });
});
