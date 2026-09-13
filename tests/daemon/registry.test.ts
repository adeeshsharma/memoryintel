import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readRegistry, upsertRegistryEntry, detectToolsWired, pruneRegistry, pruneRegistryFile } from '../../src/daemon/registry.js';
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
  // Claude Code automation ships via this package's own plugin (hooks/hooks.json), never by
  // writing to a project's .claude/settings.json - init never touches that file. The Stop hook's
  // .session-marker.json existing is real evidence the plugin has actually fired for this
  // project, which is the only signal detectToolsWired uses.
  it('detects claude-code from .session-marker.json', () => {
    mkdirSync(join(projectRoot, '.memoryintel'), { recursive: true });
    writeFileSync(join(projectRoot, '.memoryintel', '.session-marker.json'), JSON.stringify({ lastFlaggedDiffSignature: null }));
    expect(detectToolsWired(projectRoot)).toContain('claude-code');
  });

  it('does not report claude-code when no session marker exists', () => {
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
    mkdirSync(join(projectRoot, '.memoryintel'), { recursive: true });
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

  it('prunes a stale entry (its .memoryintel is gone) as a side effect of any upsert', () => {
    const staleProject = mkdtempSync(join(tmpdir(), 'mi-registry-stale-'));
    mkdirSync(join(staleProject, '.memoryintel'), { recursive: true });
    upsertRegistryEntry(staleProject);
    rmSync(staleProject, { recursive: true, force: true });

    upsertRegistryEntry(projectRoot);

    const registry = readRegistry();
    expect(registry[staleProject]).toBeUndefined();
    expect(registry[projectRoot]).toBeDefined();
  });
});

describe('pruneRegistry', () => {
  it('keeps only entries whose path still has a .memoryintel directory', () => {
    mkdirSync(join(projectRoot, '.memoryintel'), { recursive: true });
    const dead = join(tmpdir(), 'mi-registry-never-existed-xyz');
    const registry = {
      [projectRoot]: { path: projectRoot, initializedAt: 'x', lastSessionAt: 'x', toolsWired: [] },
      [dead]: { path: dead, initializedAt: 'x', lastSessionAt: 'x', toolsWired: [] }
    };
    expect(Object.keys(pruneRegistry(registry))).toEqual([projectRoot]);
  });
});

describe('pruneRegistryFile', () => {
  it('removes stale entries from disk and returns their paths', () => {
    const staleProject = mkdtempSync(join(tmpdir(), 'mi-registry-stale2-'));
    mkdirSync(join(staleProject, '.memoryintel'), { recursive: true });
    upsertRegistryEntry(staleProject);
    rmSync(staleProject, { recursive: true, force: true });

    const removed = pruneRegistryFile();

    expect(removed).toEqual([staleProject]);
    expect(readRegistry()[staleProject]).toBeUndefined();
  });

  it('returns an empty array and leaves the registry untouched when nothing is stale', () => {
    mkdirSync(join(projectRoot, '.memoryintel'), { recursive: true });
    upsertRegistryEntry(projectRoot);
    expect(pruneRegistryFile()).toEqual([]);
    expect(readRegistry()[projectRoot]).toBeDefined();
  });
});
