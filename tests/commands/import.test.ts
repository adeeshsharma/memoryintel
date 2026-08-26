import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInit } from '../../src/commands/init.js';
import { runImport } from '../../src/commands/import.js';

let projectDir: string;
let root: string;

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), 'mi-import-'));
  runInit(projectDir);
  root = join(projectDir, '.memoryintel');
});

afterEach(() => rmSync(projectDir, { recursive: true, force: true }));

describe('runImport', () => {
  it('reports no sources found on a project with no documents at all', async () => {
    writeFileSync(join(projectDir, 'index.ts'), 'export {}\n');
    const result = await runImport(root, projectDir);
    expect(result.sourcesFound).toEqual([]);
    expect(result.applied).toEqual([]);
  });

  it('routes documents anywhere in the tree by filename/title keyword, not a fixed memory-bank convention', async () => {
    mkdirSync(join(projectDir, 'docs'), { recursive: true });
    writeFileSync(join(projectDir, 'docs', 'ARCHITECTURE.md'), '# Architecture\nThree services behind a queue.');
    writeFileSync(join(projectDir, 'docs', 'system-patterns.md'), '# System Patterns\nUses a repository pattern.');
    writeFileSync(join(projectDir, 'ROADMAP.md'), '# Roadmap\nShip v2 next quarter.');

    const result = await runImport(root, projectDir);

    expect(result.sourcesFound.sort()).toEqual(['ROADMAP.md', 'docs/ARCHITECTURE.md', 'docs/system-patterns.md'].sort());
    expect(result.applied).toContain('technical/architecture.md');
    expect(result.applied).toContain('technical/patterns.md');
    expect(result.applied).toContain('business/roadmap.md');

    const arch = readFileSync(join(root, 'technical', 'architecture.md'), 'utf-8');
    expect(arch).toContain('Three services behind a queue.');
    expect(arch).toContain('Imported verbatim from `docs/ARCHITECTURE.md`');
  });

  it('falls back to context/projectBrief.md for a document matching no keyword', async () => {
    writeFileSync(join(projectDir, 'NOTES.md'), '# Random Notes\nMiscellaneous project trivia.');
    const result = await runImport(root, projectDir);
    expect(result.applied).toContain('context/projectBrief.md');
  });

  it('imports a real HTML document but skips an SPA shell', async () => {
    writeFileSync(
      join(projectDir, 'architecture.html'),
      `<html><head><title>Architecture Overview</title></head><body><p>${'This system has several layers. '.repeat(6)}</p></body></html>`
    );
    writeFileSync(
      join(projectDir, 'index.html'),
      '<html><body><div id="root"></div><script src="/bundle.js"></script></body></html>'
    );

    const result = await runImport(root, projectDir);
    expect(result.sourcesFound).toContain('architecture.html');
    expect(result.sourcesFound).not.toContain('index.html');
    expect(result.applied).toContain('technical/architecture.md');
  });

  it('is idempotent: importing the same source twice does not duplicate content', async () => {
    writeFileSync(join(projectDir, 'ACTIVE.md'), '# Active\nWorking on the CLI.');

    await runImport(root, projectDir);
    const second = await runImport(root, projectDir);

    expect(second.skipped).toContain('context/activeContext.md');
    const content = readFileSync(join(root, 'context', 'activeContext.md'), 'utf-8');
    expect(content.match(/Working on the CLI\./g)?.length).toBe(1);
  });

  it('never imports its own .memoryintel/ files', async () => {
    const result = await runImport(root, projectDir);
    expect(result.sourcesFound.some((s) => s.includes('.memoryintel'))).toBe(false);
  });
});
