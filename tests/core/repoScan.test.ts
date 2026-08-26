import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { walkFiles, detectStack, buildImportGraph, findDocs } from '../../src/core/repoScan.js';

let dir: string;

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mi-scan-')); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('walkFiles', () => {
  it('skips ignored directories, including .memoryintel', () => {
    mkdirSync(join(dir, 'node_modules', 'x'), { recursive: true });
    writeFileSync(join(dir, 'node_modules', 'x', 'index.js'), '');
    mkdirSync(join(dir, '.memoryintel', 'context'), { recursive: true });
    writeFileSync(join(dir, '.memoryintel', 'context', 'progress.md'), '');
    writeFileSync(join(dir, 'real.ts'), '');

    const files = walkFiles(dir);
    expect(files.some((f) => f.includes('node_modules'))).toBe(false);
    expect(files.some((f) => f.includes('.memoryintel'))).toBe(false);
    expect(files.some((f) => f.endsWith('real.ts'))).toBe(true);
  });
});

describe('detectStack', () => {
  it('reads dependencies, scripts, and entry points from package.json', () => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({
      dependencies: { express: '^4.0.0' },
      devDependencies: { vitest: '^2.0.0' },
      scripts: { build: 'tsc' },
      main: 'dist/index.js'
    }));

    const stack = detectStack(dir);
    expect(stack.manifests).toEqual(['package.json']);
    expect(stack.dependencies).toEqual(expect.arrayContaining(['express', 'vitest']));
    expect(stack.scripts.build).toBe('tsc');
    expect(stack.entryPoints).toContain('dist/index.js');
  });

  it('reads requirements.txt, stripping version specifiers', () => {
    writeFileSync(join(dir, 'requirements.txt'), 'flask==2.0.1\n# a comment\nrequests>=2.0\n');
    const stack = detectStack(dir);
    expect(stack.dependencies).toEqual(['flask', 'requests']);
  });

  it('reads pyproject.toml PEP 621 dependencies', () => {
    writeFileSync(join(dir, 'pyproject.toml'), 'dependencies = [\n  "flask>=2.0",\n  "requests"\n]\n');
    const stack = detectStack(dir);
    expect(stack.dependencies).toEqual(expect.arrayContaining(['flask', 'requests']));
  });

  it('reads Cargo.toml [dependencies] keys', () => {
    writeFileSync(join(dir, 'Cargo.toml'), '[package]\nname = "x"\n\n[dependencies]\nserde = "1.0"\ntokio = "1.0"\n');
    const stack = detectStack(dir);
    expect(stack.dependencies).toEqual(expect.arrayContaining(['serde', 'tokio']));
  });

  it('returns empty manifests when nothing recognized is present', () => {
    const stack = detectStack(dir);
    expect(stack.manifests).toEqual([]);
    expect(stack.dependencies).toEqual([]);
  });
});

describe('buildImportGraph', () => {
  it('ranks files by how many other files import them', () => {
    writeFileSync(join(dir, 'shared.ts'), 'export const x = 1;\n');
    writeFileSync(join(dir, 'a.ts'), "import { x } from './shared.js';\n");
    writeFileSync(join(dir, 'b.ts'), "import { x } from './shared.js';\n");
    const files = walkFiles(dir);

    const hubs = buildImportGraph(dir, files);
    expect(hubs[0].path.endsWith('shared.ts')).toBe(true);
    expect(hubs[0].importedByCount).toBe(2);
  });

  it('resolves a .js specifier to a .ts source file (TS/ESM NodeNext convention)', () => {
    writeFileSync(join(dir, 'util.ts'), 'export const y = 1;\n');
    writeFileSync(join(dir, 'main.ts'), "import { y } from './util.js';\n");
    const files = walkFiles(dir);

    const hubs = buildImportGraph(dir, files);
    expect(hubs.some((h) => h.path.endsWith('util.ts') && h.importedByCount === 1)).toBe(true);
  });

  it('ignores bare package specifiers (external dependencies, not part of this graph)', () => {
    writeFileSync(join(dir, 'main.ts'), "import express from 'express';\n");
    const files = walkFiles(dir);
    const hubs = buildImportGraph(dir, files);
    expect(hubs).toEqual([]);
  });

  it('resolves Python relative imports', () => {
    mkdirSync(join(dir, 'pkg'), { recursive: true });
    writeFileSync(join(dir, 'pkg', 'helper.py'), 'X = 1\n');
    writeFileSync(join(dir, 'pkg', 'main.py'), 'from .helper import X\n');
    const files = walkFiles(dir);

    const hubs = buildImportGraph(dir, files);
    expect(hubs.some((h) => h.path.endsWith('helper.py') && h.importedByCount === 1)).toBe(true);
  });
});

describe('findDocs', () => {
  it('excludes root README.md and ARCHITECTURE.md (already covered by import)', () => {
    writeFileSync(join(dir, 'README.md'), '# Title\n');
    writeFileSync(join(dir, 'ARCHITECTURE.md'), '# Arch\n');
    writeFileSync(join(dir, 'NOTES.md'), '# Notes\nSomething worth knowing.\n');
    const files = walkFiles(dir);

    const docs = findDocs(dir, files);
    expect(docs.map((d) => d.path)).toEqual(['NOTES.md']);
  });

  it('extracts the H1 as title when present, falling back to the first line', () => {
    writeFileSync(join(dir, 'a.md'), '# Real Title\n\nbody\n');
    writeFileSync(join(dir, 'b.md'), 'Just a plain first line\n');
    const files = walkFiles(dir);

    const docs = findDocs(dir, files);
    const a = docs.find((d) => d.path === 'a.md');
    const b = docs.find((d) => d.path === 'b.md');
    expect(a?.title).toBe('Real Title');
    expect(b?.title).toBe('Just a plain first line');
  });

  it('extracts an HTML <title> tag', () => {
    writeFileSync(join(dir, 'page.html'), '<html><head><title>My Page</title></head></html>');
    const files = walkFiles(dir);
    const docs = findDocs(dir, files);
    expect(docs[0].title).toBe('My Page');
  });
});

describe('walkFiles + git churn integration (sanity, not a unit test of git itself)', () => {
  it('a real git repo can be scanned without throwing', () => {
    execFileSync('git', ['init'], { cwd: dir });
    execFileSync('git', ['config', 'user.email', 'a@b.c'], { cwd: dir });
    execFileSync('git', ['config', 'user.name', 'a'], { cwd: dir });
    writeFileSync(join(dir, 'x.ts'), 'export {}\n');
    execFileSync('git', ['add', '.'], { cwd: dir });
    execFileSync('git', ['commit', '-m', 'init'], { cwd: dir });

    expect(() => walkFiles(dir)).not.toThrow();
  });
});
