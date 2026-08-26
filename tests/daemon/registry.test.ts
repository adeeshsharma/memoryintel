import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readRegistry, upsertRegistryEntry, detectToolsWired } from '../../src/daemon/registry.js';
import { writeGlobalSettings } from '../../src/daemon/settings.js';

let globalDir: string;
let projectRoot: string;

beforeEach(() => {
  globalDir = mkdtempSync(join(tmpdir(), 'mi-registry-global-'));
  process.env.MEMORYINTEL_GLOBAL_DIR = globalDir;
  projectRoot = mkdtempSync(join(tmpdir(), 'mi-registry-project-'));
});
afterEach(() => {
  rmSync(globalDir, { recursive: true, force: true });
  rmSync(projectRoot, { recursive: true, force: true });
  delete process.env.MEMORYINTEL_GLOBAL_DIR;
});

describe('detectToolsWired', () => {
  // Claude Code automation ships via this package's own plugin (hooks/hooks.json) - init never
  // writes .claude/settings.json (see src/commands/init.ts). This still-supported check is for
  // someone who wired a command by hand; it's not how a real project ends up wired.
  it('detects claude-code when settings.json references memoryintel load', () => {
    mkdirSync(join(projectRoot, '.claude'), { recursive: true });
    writeFileSync(join(projectRoot, '.claude', 'settings.json'), JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'memoryintel load' }] }] } }));
    expect(detectToolsWired(projectRoot)).toContain('claude-code');
  });

  // The real-world path: nothing ever writes .claude/settings.json, so this is the only signal
  // that actually fires for a project using the documented plugin-based setup. Confirmed on a
  // real project (distilled-docs): claude-code never appeared in the dashboard despite Claude
  // driving the entire build, because the settings.json check could never be true in practice.
  it('detects claude-code from .session-marker.json when no settings.json exists', () => {
    mkdirSync(join(projectRoot, '.memoryintel'), { recursive: true });
    writeFileSync(join(projectRoot, '.memoryintel', '.session-marker.json'), JSON.stringify({ lastFlaggedDiffSignature: null }));
    expect(detectToolsWired(projectRoot)).toContain('claude-code');
  });

  it('does not report claude-code when neither settings.json nor a session marker exists', () => {
    expect(detectToolsWired(projectRoot)).not.toContain('claude-code');
  });

  it('detects cursor when the rule file exists', () => {
    mkdirSync(join(projectRoot, '.cursor', 'rules'), { recursive: true });
    writeFileSync(join(projectRoot, '.cursor', 'rules', 'memoryintel.mdc'), '---\nalwaysApply: true\n---\n');
    expect(detectToolsWired(projectRoot)).toContain('cursor');
  });

  it('detects agents-md and gemini when the pointer marker is present', () => {
    writeFileSync(join(projectRoot, 'AGENTS.md'), '<!-- memoryintel:managed:start -->\n...\n<!-- memoryintel:managed:end -->\n');
    writeFileSync(join(projectRoot, 'GEMINI.md'), '<!-- memoryintel:managed:start -->\n...\n<!-- memoryintel:managed:end -->\n');
    const tools = detectToolsWired(projectRoot);
    expect(tools).toContain('agents-md');
    expect(tools).toContain('gemini');
  });

  it('returns an empty array when nothing is wired', () => {
    expect(detectToolsWired(projectRoot)).toEqual([]);
  });
});

describe('upsertRegistryEntry / readRegistry', () => {
  it('adds a new entry with computed toolsWired', () => {
    mkdirSync(join(projectRoot, '.cursor', 'rules'), { recursive: true });
    writeFileSync(join(projectRoot, '.cursor', 'rules', 'memoryintel.mdc'), '---\nalwaysApply: true\n---\n');
    upsertRegistryEntry(projectRoot);
    const registry = readRegistry();
    expect(registry[projectRoot].toolsWired).toEqual(['cursor']);
    expect(typeof registry[projectRoot].initializedAt).toBe('string');
  });

  it('preserves initializedAt but bumps lastSessionAt and re-detects tools on a later upsert', async () => {
    upsertRegistryEntry(projectRoot);
    const first = readRegistry()[projectRoot];

    await new Promise((r) => setTimeout(r, 5));
    mkdirSync(join(projectRoot, '.cursor', 'rules'), { recursive: true });
    writeFileSync(join(projectRoot, '.cursor', 'rules', 'memoryintel.mdc'), '---\nalwaysApply: true\n---\n');
    upsertRegistryEntry(projectRoot);

    const second = readRegistry()[projectRoot];
    expect(second.initializedAt).toBe(first.initializedAt);
    expect(second.lastSessionAt).not.toBe(first.lastSessionAt);
    expect(second.toolsWired).toEqual(['cursor']);
  });

  it('does nothing when the dashboard is globally disabled', () => {
    writeGlobalSettings({ dashboardEnabled: false });
    upsertRegistryEntry(projectRoot);
    expect(readRegistry()[projectRoot]).toBeUndefined();
  });
});
