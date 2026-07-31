// Contract tests for the checked-in bundles. dist/*.js is built from
// treebird7/toak and committed here as a binary-ish artifact — nothing in this
// repo verifies it works until an agent tries to use it. These are the cheapest
// possible guard: the artifacts parse, the CLIs answer, and the server
// registers exactly the tool set the docs promise.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  run,
  mcpHandshake,
  readText,
  DOCUMENTED_TOOLS,
  APPROVAL_AND_CHAT_TOOLS,
  DEPRECATED_TOAKLINK_TOOLS,
  LIVE_TOAKLINK_TOOLS,
  REPO_ROOT,
} from './helpers.js';

const BUNDLES = readdirSync(join(REPO_ROOT, 'dist')).filter((f) => f.endsWith('.js'));
const CLIS = ['corrwait', 'treebird-chat', 'treebird-chat-session'];

describe('bundles are loadable', () => {
  test('all four bundles ship', () => {
    assert.deepEqual(
      BUNDLES.sort(),
      ['corrwait.js', 'toak-mcp.js', 'treebird-chat-session.js', 'treebird-chat.js'],
    );
  });

  for (const bundle of BUNDLES) {
    test(`dist/${bundle} parses`, async () => {
      const { code, stderr } = await run(process.execPath, ['--check', join('dist', bundle)]);
      assert.equal(code, 0, `syntax error in dist/${bundle}:\n${stderr}`);
    });
  }
});

describe('bundled CLIs respond', () => {
  for (const cli of CLIS) {
    test(`dist/${cli}.js --help exits 0 with usage`, async () => {
      const { code, stdout } = await run(process.execPath, [join('dist', `${cli}.js`), '--help']);
      assert.equal(code, 0);
      assert.match(stdout, /usage/i, `${cli} --help should print usage`);
      assert.ok(stdout.includes(cli), `${cli} --help should name itself`);
    });
  }

  test('dist/toak-mcp.js --version reports a build stamp', async () => {
    const { code, stdout } = await run(process.execPath, [join('dist', 'toak-mcp.js'), '--version']);
    assert.equal(code, 0);
    // The stamp, not just semver, is the build identity (version-drift lesson, toak#240).
    assert.match(stdout.trim(), /^\d+\.\d+\.\d+\+src\.sha256\.[0-9a-f]{64}$/m);
  });

  test('dist/toak-mcp.js connect --help exits 0 (device-flow pairing entry point)', async () => {
    const { code, stdout } = await run(process.execPath, [join('dist', 'toak-mcp.js'), 'connect', '--help']);
    assert.equal(code, 0);
    assert.match(stdout, /device|pair/i, 'connect --help should describe device-flow pairing');
  });
});

describe('MCP server contract', () => {
  let handshake;
  const getHandshake = async () => (handshake ??= await mcpHandshake());

  test('completes the initialize handshake', async () => {
    const { initialize } = await getHandshake();
    assert.equal(initialize.result.protocolVersion, '2024-11-05');
    assert.equal(initialize.result.serverInfo.name, 'toak-mcp');
    assert.ok(initialize.result.capabilities.tools, 'server must advertise tool capability');
  });

  test('registers exactly the documented tool set', async () => {
    const { toolsList } = await getHandshake();
    const names = toolsList.result.tools.map((t) => t.name).sort();
    assert.deepEqual(
      names,
      [...DOCUMENTED_TOOLS].sort(),
      'the registered tools drifted from the set the README and skills/toak/SKILL.md promise',
    );
  });

  test('every tool carries a description and an object input schema', async () => {
    const { toolsList } = await getHandshake();
    for (const tool of toolsList.result.tools) {
      assert.ok(tool.description?.length > 10, `${tool.name} needs a usable description`);
      assert.equal(tool.inputSchema?.type, 'object', `${tool.name} needs an object inputSchema`);
    }
  });

  test('required approval arguments stay required', async () => {
    const { toolsList } = await getHandshake();
    const approval = toolsList.result.tools.find((t) => t.name === 'request_approval');
    assert.deepEqual(approval.inputSchema.required, ['action', 'context']);
  });

  test('the poll_hint loop the README documents is still advertised on chat_read', async () => {
    const { toolsList } = await getHandshake();
    const chatRead = toolsList.result.tools.find((t) => t.name === 'chat_read');
    // README's "Watching a token room" section tells agents to feed `cursor`
    // back in as `since`. If the schema loses either, that guidance is dead.
    assert.ok(chatRead.inputSchema.properties.since, 'chat_read must accept `since`');
    assert.match(chatRead.description, /cursor/i);
  });

  test('starts against the default hub when no env is configured', async () => {
    const { stderr } = await getHandshake();
    assert.match(stderr, /Hub URL: https:\/\/toak\.me/);
  });
});

describe('docs match the shipped tool set', () => {
  test('README names every registered tool', () => {
    const readme = readText('README.md');
    for (const tool of DOCUMENTED_TOOLS) {
      assert.ok(readme.includes(tool), `README.md does not mention the "${tool}" tool`);
    }
  });

  test('skills/toak/SKILL.md states the right tool count', () => {
    const skill = readText('skills/toak/SKILL.md');
    const match = /Registers \*\*(\d+) tools\*\*/.exec(skill);
    assert.ok(match, 'skills/toak/SKILL.md should state how many tools the local server registers');
    assert.equal(
      Number(match[1]),
      DOCUMENTED_TOOLS.length,
      'the skill\'s tool count drifted from what the bundle registers',
    );
  });

  test('skills/toak/SKILL.md does not describe locally-registered tools as remote-only', () => {
    const skill = readText('skills/toak/SKILL.md');
    // The architecture table used to file messages_send/messages_inbox under
    // "Remote /api/mcp" only, while the local server registers them too.
    const row = skill.split('\n').find((l) => l.includes('**Messages protocol**'));
    assert.ok(row, 'the architecture table lost its Messages protocol row');
    assert.ok(
      /Both/.test(row),
      'messages_send/messages_inbox are registered by the local server too — the table must say Both',
    );
  });
});

describe('deprecated tools are still shipped (unresolved upstream)', () => {
  // Not an aspiration — a pin on current reality. skills/toak/SKILL.md says
  // these were "removed as MCP tools 2026-07-04", yet the bundle registers them
  // and MCP clients offer them. If a future rebundle actually unregisters them,
  // this test fails and the skill's note can finally be simplified.
  test('the deprecated toaklink_* tools are still registered by the bundle', async () => {
    const { toolsList } = await mcpHandshake();
    const names = toolsList.result.tools.map((t) => t.name);
    const stillThere = DEPRECATED_TOAKLINK_TOOLS.filter((t) => names.includes(t));
    assert.deepEqual(
      stillThere.sort(),
      [...DEPRECATED_TOAKLINK_TOOLS].sort(),
      'the deprecated toaklink_* tool set changed — reconcile skills/toak/SKILL.md with the bundle',
    );
  });

  test('each carries its DEPRECATED warning in the description', async () => {
    // This is the safety property that actually matters. The tools are exposed
    // to clients, so the only thing steering an agent away from the
    // gate-bypassing path is the warning in the description an MCP client
    // renders. If a rebundle registers them without it, the path goes from
    // "advertised with a warning" to "advertised silently".
    const { toolsList } = await mcpHandshake();
    for (const name of DEPRECATED_TOAKLINK_TOOLS) {
      const tool = toolsList.result.tools.find((t) => t.name === name);
      assert.match(tool.description, /^DEPRECATED\b/, `${name} lost its DEPRECATED prefix`);
      assert.match(
        tool.description,
        /bypasses ADR-0003 delivery gates/,
        `${name} no longer warns that it bypasses the delivery gates`,
      );
    }
  });

  test('the live toaklink_* tools are not mislabelled as deprecated', async () => {
    // toaklink_collab and toaklink_agents share only the prefix — they are
    // current functionality. Grouping them with the deprecated set by name is
    // an easy mistake to make (this suite made it once).
    const { toolsList } = await mcpHandshake();
    for (const name of LIVE_TOAKLINK_TOOLS) {
      const tool = toolsList.result.tools.find((t) => t.name === name);
      assert.ok(tool, `${name} is no longer registered`);
      assert.doesNotMatch(
        tool.description,
        /DEPRECATED/,
        `${name} is now deprecated upstream — regroup it in helpers.js and update the skill`,
      );
    }
  });

  test('the approvals + chat group is complete', async () => {
    const { toolsList } = await mcpHandshake();
    const names = toolsList.result.tools.map((t) => t.name);
    for (const tool of APPROVAL_AND_CHAT_TOOLS) {
      assert.ok(names.includes(tool), `the core tool "${tool}" is no longer registered`);
    }
  });
});
