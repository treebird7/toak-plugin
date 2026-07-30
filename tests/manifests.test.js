// Packaging assertions. This repo ships the same plugin to two marketplaces
// from two hand-maintained manifests; they drifted four releases apart before
// anything noticed, and a stale version string is exactly what stops a
// marketplace from resyncing (see commit 18899ba).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { readJSON, readText, parseFrontmatter, REPO_ROOT } from './helpers.js';

const claude = readJSON('.claude-plugin/plugin.json');
const codex = readJSON('.codex-plugin/plugin.json');
const marketplace = readJSON('.claude-plugin/marketplace.json');
const app = readJSON('.app.json');

describe('manifests agree with each other', () => {
  test('both manifests advertise the same version', () => {
    assert.equal(
      codex.version,
      claude.version,
      'Codex and Claude manifests must ship the same version — a stale one blocks marketplace resync',
    );
  });

  test('version is valid semver', () => {
    assert.match(claude.version, /^\d+\.\d+\.\d+$/);
  });

  for (const field of ['name', 'repository', 'license', 'homepage']) {
    test(`both manifests agree on "${field}"`, () => {
      assert.equal(codex[field], claude[field]);
    });
  }

  test('the marketplace entry names the plugin the manifests declare', () => {
    const entry = marketplace.plugins.find((p) => p.name === claude.name);
    assert.ok(entry, `marketplace.json must list a plugin named "${claude.name}"`);
    assert.equal(entry.source, './');
  });
});

describe('manifests reference paths that exist', () => {
  const referenced = [
    ['.codex-plugin skills', codex.skills],
    ['.codex-plugin apps', codex.apps],
  ];

  for (const [label, relPath] of referenced) {
    test(`${label} -> ${relPath}`, () => {
      assert.ok(existsSync(join(REPO_ROOT, relPath)), `${label} points at a missing path: ${relPath}`);
    });
  }

  test('every launcher referenced by a manifest exists and is executable', () => {
    const commands = [
      claude.mcpServers.toak.command,
    ];
    for (const command of commands) {
      // Strip the host's plugin-root placeholder to get a repo-relative path.
      const relPath = command.replace(/^\$\{[A-Z_]+\}\//, '');
      const full = join(REPO_ROOT, relPath);
      assert.ok(existsSync(full), `${command} resolves to a missing file`);
      assert.ok(statSync(full).mode & 0o111, `${command} must be executable`);
    }
  });

  test('the app id is registered for the plugin name', () => {
    assert.ok(app.apps[claude.name], `.app.json must carry an entry for "${claude.name}"`);
    assert.match(app.apps[claude.name].id, /^asdk_app_[0-9a-f]+$/);
  });
});

describe('the local MCP server is declared to Claude Code only', () => {
  // This block used to pin BOTH placeholder forms: ${CLAUDE_PLUGIN_ROOT} in
  // .claude-plugin, ${PLUGIN_ROOT} in .mcp.json, commented "pinned so nobody
  // 'fixes' the inconsistency".
  //
  // The Codex half was asserting a string that had never started a server.
  // Probed directly against Codex 0.145.0 with an isolated CODEX_HOME and an
  // absolute-path control (treebird7/toak#231): ${CLAUDE_PLUGIN_ROOT}/…,
  // ${PLUGIN_ROOT}/… and ./… all failed with "MCP startup failed: No such file
  // or directory", while the absolute-path control spawned. Identical for both
  // manifest shapes. Codex expands neither placeholder, so the declaration was
  // unlaunchable however it was spelled — and the test was green the whole time,
  // because it asserted manifest TEXT rather than a running process.
  //
  // .mcp.json is therefore gone (treebird7/toak#234) and the assertions now
  // pin the decision instead of the dead string. Claude Code users are
  // unaffected: they use the inline declaration below.
  test('.claude-plugin uses ${CLAUDE_PLUGIN_ROOT}', () => {
    assert.equal(claude.mcpServers.toak.command, '${CLAUDE_PLUGIN_ROOT}/launch.sh');
  });

  test('no .mcp.json ships — Codex cannot launch it', () => {
    assert.equal(
      existsSync(join(REPO_ROOT, '.mcp.json')),
      false,
      'advertising an MCP server Codex cannot start is worse than advertising none',
    );
  });

  test('.codex-plugin declares no mcpServers', () => {
    assert.equal(
      codex.mcpServers,
      undefined,
      'the Codex manifest must not point at a server it cannot launch',
    );
  });
});

describe('skills are well-formed', () => {
  const skillDirs = readdirSync(join(REPO_ROOT, 'skills'), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  test('at least the three documented skills ship', () => {
    for (const name of ['toak', 'toak-connect', 'chat-join']) {
      assert.ok(skillDirs.includes(name), `missing skill directory: ${name}`);
    }
  });

  for (const dir of skillDirs) {
    describe(`skills/${dir}`, () => {
      const text = readText(join('skills', dir, 'SKILL.md'));
      const fm = parseFrontmatter(text);

      test('has parseable frontmatter', () => {
        assert.ok(fm, `skills/${dir}/SKILL.md is missing a --- frontmatter block`);
      });

      test('frontmatter name matches the directory', () => {
        assert.equal(fm.name, dir, 'a skill\'s frontmatter name must match its directory name');
      });

      test('has a non-empty description', () => {
        assert.ok(fm.description && fm.description.length > 10);
      });

      test('does not point at the retired hub.treebird.uk host', () => {
        // The Railway hub was retired 2026-06-29. skills/toak calls that out
        // explicitly, so a mention is fine only inside a block that marks it
        // dead — checked over a small context window, since those notices wrap
        // across lines.
        const lines = text.split('\n');
        const offending = lines.flatMap((line, i) => {
          if (!line.includes('hub.treebird.uk')) return [];
          const context = lines.slice(Math.max(0, i - 3), i + 4).join(' ');
          return /retired|stale|Ignore any instruction/i.test(context) ? [] : [`L${i + 1}: ${line}`];
        });
        assert.deepEqual(offending, [], 'skills must not steer agents at the retired hub');
      });
    });
  }
});
