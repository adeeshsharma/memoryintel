import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInit } from '../../src/commands/init.js';
import { runDoctor } from '../../src/commands/doctor.js';
import { setGeneratedFileHash, getGeneratedFileHash, hashContent } from '../../src/core/generatedFileHashes.js';
import { INSTRUCTIONS_TEMPLATE } from '../../src/commands/init.js';

let projectDir: string;
let root: string;
beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), 'mi-doctor-'));
  root = join(projectDir, '.memoryintel');
});
afterEach(() => rmSync(projectDir, { recursive: true, force: true }));

describe('runDoctor - instructions.md', () => {
  it('reports up to date and writes nothing right after a fresh init', () => {
    runInit(projectDir);
    const before = readFileSync(join(root, 'instructions.md'), 'utf-8');
    const report = runDoctor(root);
    expect(report).toContain('instructions.md: up to date');
    expect(readFileSync(join(root, 'instructions.md'), 'utf-8')).toBe(before);
  });

  it('safely refreshes when disk matches the recorded hash but the template has moved on', () => {
    runInit(projectDir);
    const staleContent = '# Old instructions\nSome old content.\n';
    writeFileSync(join(root, 'instructions.md'), staleContent);
    setGeneratedFileHash(root, 'instructions.md', hashContent(staleContent));

    const report = runDoctor(root);

    expect(report).toContain('instructions.md: refreshed');
    expect(readFileSync(join(root, 'instructions.md'), 'utf-8')).toBe(INSTRUCTIONS_TEMPLATE);
    expect(getGeneratedFileHash(root, 'instructions.md')).toBe(hashContent(INSTRUCTIONS_TEMPLATE));
  });

  it('refuses and writes instructions.md.new when the file diverges with no matching recorded hash', () => {
    runInit(projectDir);
    writeFileSync(join(root, 'instructions.md'), '# Hand-edited\nSomething the user wrote.\n');
    // No setGeneratedFileHash call - simulates either a real hand-edit or a pre-existing
    // project with nothing recorded at all.

    const report = runDoctor(root);

    expect(report).toContain('instructions.md');
    expect(report).toContain('--force');
    expect(readFileSync(join(root, 'instructions.md'), 'utf-8')).toBe('# Hand-edited\nSomething the user wrote.\n');
    expect(existsSync(join(root, 'instructions.md.new'))).toBe(true);
    expect(readFileSync(join(root, 'instructions.md.new'), 'utf-8')).toBe(INSTRUCTIONS_TEMPLATE);
  });

  it('a project with no generatedFileHashes key at all, but content already pristine, reports up to date', () => {
    runInit(projectDir);
    writeFileSync(join(root, 'memory-config.json'), JSON.stringify({ initializedAt: 'x', version: '0.1.0' }));
    // instructions.md is still exactly INSTRUCTIONS_TEMPLATE from runInit above.

    const report = runDoctor(root);

    expect(report).toContain('instructions.md: up to date');
    expect(existsSync(join(root, 'instructions.md.new'))).toBe(false);
  });

  it('--force overwrites even with no recorded hash and content that genuinely differs', () => {
    runInit(projectDir);
    writeFileSync(join(root, 'instructions.md'), '# Hand-edited\nSomething the user wrote.\n');

    const report = runDoctor(root, { force: true });

    expect(report).toContain('instructions.md: refreshed');
    expect(readFileSync(join(root, 'instructions.md'), 'utf-8')).toBe(INSTRUCTIONS_TEMPLATE);
    expect(existsSync(join(root, 'instructions.md.new'))).toBe(false);
    expect(getGeneratedFileHash(root, 'instructions.md')).toBe(hashContent(INSTRUCTIONS_TEMPLATE));
  });

  it('is idempotent: a second run right after a safe refresh reports up to date and writes nothing further', () => {
    runInit(projectDir);
    const staleContent = '# Old\n';
    writeFileSync(join(root, 'instructions.md'), staleContent);
    setGeneratedFileHash(root, 'instructions.md', hashContent(staleContent));

    runDoctor(root);
    const afterFirstRun = readFileSync(join(root, 'instructions.md'), 'utf-8');
    const secondReport = runDoctor(root);

    expect(secondReport).toContain('instructions.md: up to date');
    expect(readFileSync(join(root, 'instructions.md'), 'utf-8')).toBe(afterFirstRun);
  });

  it('is idempotent after a forced refresh too: a subsequent plain run reports up to date', () => {
    runInit(projectDir);
    writeFileSync(join(root, 'instructions.md'), '# Hand-edited\n');

    runDoctor(root, { force: true });
    const afterForce = readFileSync(join(root, 'instructions.md'), 'utf-8');
    const secondReport = runDoctor(root); // no --force this time

    expect(secondReport).toContain('instructions.md: up to date');
    expect(readFileSync(join(root, 'instructions.md'), 'utf-8')).toBe(afterForce);
  });
});

describe('runDoctor - pointer blocks', () => {
  it('reports pointer blocks as up to date right after init, with no writes', () => {
    runInit(projectDir);
    const agentsPath = join(projectDir, 'AGENTS.md');
    const before = readFileSync(agentsPath, 'utf-8');

    const report = runDoctor(root);

    expect(report).toContain('AGENTS.md: pointer block up to date.');
    expect(readFileSync(agentsPath, 'utf-8')).toBe(before);
  });

  it('reports a refreshed pointer block and leaves the rest of AGENTS.md untouched', () => {
    runInit(projectDir);
    const agentsPath = join(projectDir, 'AGENTS.md');
    const original = readFileSync(agentsPath, 'utf-8');
    writeFileSync(agentsPath, original.replace('Two hard requirements', 'TAMPERED'));

    const report = runDoctor(root);

    expect(report).toContain('AGENTS.md');
    expect(report).toContain('refreshed');
    expect(readFileSync(agentsPath, 'utf-8')).toBe(original);
  });

  it('does not reinsert a pointer block a user removed entirely', () => {
    runInit(projectDir);
    const agentsPath = join(projectDir, 'AGENTS.md');
    writeFileSync(agentsPath, '# Just my own project notes now\n');

    runDoctor(root);

    expect(readFileSync(agentsPath, 'utf-8')).toBe('# Just my own project notes now\n');
  });

  it('never touches anything under context/, business/, or technical/', () => {
    runInit(projectDir);
    const mentalModelPath = join(root, 'context', 'currentMentalModel.md');
    const before = readFileSync(mentalModelPath, 'utf-8');
    runDoctor(root, { force: true });
    expect(readFileSync(mentalModelPath, 'utf-8')).toBe(before);
  });
});
