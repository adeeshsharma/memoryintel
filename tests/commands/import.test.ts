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
  it('reports no sources found on a project with nothing to import', async () => {
    const result = await runImport(root, projectDir);
    expect(result.sourcesFound).toEqual([]);
    expect(result.applied).toEqual([]);
  });

  it('imports every recognized memory-bank/ file into its mapped section', async () => {
    const bank = join(projectDir, 'memory-bank');
    mkdirSync(bank, { recursive: true });
    writeFileSync(join(bank, 'projectbrief.md'), 'A CLI for tracking widgets.');
    writeFileSync(join(bank, 'productContext.md'), 'Solves the problem of lost widgets.');
    writeFileSync(join(bank, 'systemPatterns.md'), 'Uses a repository pattern.');
    writeFileSync(join(bank, 'techContext.md'), 'Node.js, SQLite.');
    writeFileSync(join(bank, 'activeContext.md'), 'Currently building the export command.');
    writeFileSync(join(bank, 'progress.md'), 'Core CRUD done, export pending.');

    const result = await runImport(root, projectDir);

    expect(result.sourcesFound.sort()).toEqual([
      'memory-bank/activeContext.md',
      'memory-bank/productContext.md',
      'memory-bank/progress.md',
      'memory-bank/projectbrief.md',
      'memory-bank/systemPatterns.md',
      'memory-bank/techContext.md'
    ]);
    expect(result.applied).toContain('context/projectBrief.md');
    expect(result.applied).toContain('business/productContext.md');
    expect(result.applied).toContain('technical/patterns.md');
    expect(result.applied).toContain('technical/techContext.md');
    expect(result.applied).toContain('context/activeContext.md');
    expect(result.applied).toContain('context/progress.md');

    const brief = readFileSync(join(root, 'context', 'projectBrief.md'), 'utf-8');
    expect(brief).toContain('## Overview');
    expect(brief).toContain('A CLI for tracking widgets.');
    expect(brief).toContain('Imported verbatim from `memory-bank/projectbrief.md`');
  });

  it('finds memory-bank files regardless of casing', async () => {
    const bank = join(projectDir, 'memory-bank');
    mkdirSync(bank, { recursive: true });
    writeFileSync(join(bank, 'ProjectBrief.md'), 'Case-insensitive lookup works.');

    const result = await runImport(root, projectDir);
    expect(result.applied).toContain('context/projectBrief.md');
  });

  it('imports ARCHITECTURE.md into technical/architecture.md', async () => {
    writeFileSync(join(projectDir, 'ARCHITECTURE.md'), '# Architecture\n\nThree services behind a queue.');

    const result = await runImport(root, projectDir);
    expect(result.sourcesFound).toContain('ARCHITECTURE.md');
    expect(result.applied).toContain('technical/architecture.md');

    const content = readFileSync(join(root, 'technical', 'architecture.md'), 'utf-8');
    expect(content).toContain('Three services behind a queue.');
  });

  it('falls back to README.md\'s lede for projectBrief.md only when memory-bank/projectbrief.md is absent', async () => {
    writeFileSync(
      join(projectDir, 'README.md'),
      '# Widget Tracker\n\n[![CI](https://x)](https://y)\n\n![logo](logo.png)\n\nTracks widgets across machines, with full version history.\n\n## Install\n'
    );

    const result = await runImport(root, projectDir);
    expect(result.sourcesFound).toContain('README.md');
    expect(result.applied).toContain('context/projectBrief.md');

    const content = readFileSync(join(root, 'context', 'projectBrief.md'), 'utf-8');
    expect(content).toContain('Tracks widgets across machines, with full version history.');
  });

  it('prefers memory-bank/projectbrief.md over README.md when both exist', async () => {
    const bank = join(projectDir, 'memory-bank');
    mkdirSync(bank, { recursive: true });
    writeFileSync(join(bank, 'projectbrief.md'), 'The real brief.');
    writeFileSync(join(projectDir, 'README.md'), '# Title\n\nThe README lede, should be ignored.\n');

    const result = await runImport(root, projectDir);
    expect(result.sourcesFound).not.toContain('README.md');

    const content = readFileSync(join(root, 'context', 'projectBrief.md'), 'utf-8');
    expect(content).toContain('The real brief.');
    expect(content).not.toContain('should be ignored');
  });

  it('is idempotent: importing the same source twice does not duplicate content', async () => {
    const bank = join(projectDir, 'memory-bank');
    mkdirSync(bank, { recursive: true });
    writeFileSync(join(bank, 'activeContext.md'), 'Working on the CLI.');

    await runImport(root, projectDir);
    const second = await runImport(root, projectDir);

    expect(second.skipped).toContain('context/activeContext.md');
    const content = readFileSync(join(root, 'context', 'activeContext.md'), 'utf-8');
    expect(content.match(/Working on the CLI\./g)?.length).toBe(1);
  });
});
