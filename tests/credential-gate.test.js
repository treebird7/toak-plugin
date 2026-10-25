// Structural canaries over the committed bundle.
//
// These are static checks. Until 0.2.44 an end-to-end test (auth-headers.test.js)
// also drove the one call site that sent Toak headers to the Supabase domain;
// that call site was deleted with toaklink, so only these canaries remain. They
// cover the hardening on paths this repo cannot drive (device-flow key writes)
// and fail loudly if a rebundle drops them. That is exactly how the toak#179 leak got
// in — dist/toak-mcp.js was committed here with no source in the diff and no
// check that could see it.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { readText, REPO_ROOT } from './helpers.js';

const bundle = readText('dist/toak-mcp.js');

describe('agent-key credential gate (toak#179)', () => {
  test('the gate is still expressed as an opt-out flag', () => {
    assert.ok(
      bundle.includes('useAgentKey'),
      'buildAuthHeaders lost its useAgentKey gate — the fix from f227c59 is gone',
    );
  });

  test('the gate defaults to on, so every call site must opt out explicitly', () => {
    // `X.useAgentKey !== false`, minified. Documented here because it is the
    // reason the canary below matters: a new call site inherits key-attaching
    // behaviour silently.
    assert.match(
      bundle,
      /useAgentKey!==!1|useAgentKey!==false/,
      'the gate expression changed shape — re-verify which call sites attach credentials',
    );
  });

  // The leak toak#179 closed rode SupabaseToaklinkClient.send(), the one call
  // site that sent Toak auth headers to a Supabase /functions/v1/ path (via
  // `toak say`). 0.2.44 deleted that client with the rest of toaklink, so the
  // end-to-end suite that drove it (auth-headers.test.js) had no vehicle left.
  // What still stands: the gate above and below, for any future caller, and
  // this check that the retired path has not come back.
  test('the retired toak-api send path stays gone', () => {
    assert.doesNotMatch(
      bundle,
      /toak-api\/api\/toaklink|toaklink\/send/,
      'a toaklink send path is back in the bundle — re-audit it against toak#179 and restore an end-to-end guard',
    );
  });

  test('suppression covers the ambient env key, not just the key file', () => {
    // The 0.2.12 fix only suppressed the ~/.toak/agent-key FILE; 0.2.13 also
    // had to gate the ambient TOAK_API_KEY env var. Both must stay behind the
    // same flag.
    // [\w$]: minifiers use `$` as an identifier (0.2.51's bundle names the
    // options param `$`), which \w alone does not match.
    const gate = /[\w$]+=[\w$]+\.useAgentKey!==!1,[\w$]+=[\w$]+\?[\w$]+\("TOAK_API_KEY"\):void 0/;
    assert.match(
      bundle,
      gate,
      'the ambient TOAK_API_KEY read is no longer gated on useAgentKey — residual leak from toak#179',
    );
  });
});

describe('agent-key file write hardening (toak#179)', () => {
  // The bundle has two `.tmp-` writers: the user-session file (predictable
  // `${process.pid}` name, plain writeFile) and the agent-key file. Only the
  // latter got the toak#179 hardening, so select it by its O_EXCL open.
  const saveFn = (() => {
    for (const m of bundle.matchAll(/\.tmp-/g)) {
      const region = bundle.slice(Math.max(0, m.index - 300), m.index + 300);
      if (region.includes('"wx"')) return region;
    }
    return '';
  })();

  test('the save path is present', () => {
    assert.notEqual(saveFn, '', 'saveAgentKey temp-file write vanished from the bundle');
  });

  test('creates the temp file with O_EXCL', () => {
    // "wx" == O_CREAT|O_EXCL. Without it the symlink race d07b1c2 closed reopens.
    assert.match(saveFn, /"wx"/, 'agent-key temp file no longer created with O_EXCL');
  });

  test('the temp file name is randomised', () => {
    assert.match(saveFn, /\.tmp-\$\{\w+\(8\)\.toString\("hex"\)\}/, 'temp file name is predictable again');
  });

  test('the key directory is created 0700 and the key file 0600', () => {
    assert.match(saveFn, /mode:448/, '~/.toak must be created with mode 0700');
    assert.match(saveFn, /"wx",384/, 'the agent key file must be created with mode 0600');
  });
});

describe('no credentials are committed', () => {
  // The repo history includes a "leak-cleaned plugin tree" commit; keep it clean.
  const SECRET_PATTERNS = [
    [/\btk_[A-Za-z0-9_-]{24,}/, 'a Toak tk_ API key'],
    [/\bsbp_[A-Za-z0-9]{32,}/, 'a Supabase personal access token'],
    [/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/, 'a JWT (Supabase service/anon key)'],
    [/\bxox[baprs]-[A-Za-z0-9-]{20,}/, 'a Slack token'],
  ];

  const files = [];
  const walk = (dir, rel = '') => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      const full = join(dir, entry.name);
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(full, relPath);
      else if (statSync(full).size < 5 * 1024 * 1024) files.push([relPath, full]);
    }
  };
  walk(REPO_ROOT);

  for (const [pattern, label] of SECRET_PATTERNS) {
    test(`no file contains ${label}`, () => {
      const hits = files.filter(([, full]) => pattern.test(readFileSync(full, 'utf8')));
      assert.deepEqual(hits.map(([rel]) => rel), [], `${label} appears to be committed`);
    });
  }
});
