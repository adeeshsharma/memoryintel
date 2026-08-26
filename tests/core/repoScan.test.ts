import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { walkFiles, listTopLevel, detectStack, findDocuments, isDocumentHtml } from '../../src/core/repoScan.js';

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

describe('listTopLevel', () => {
  it('lists immediate children only, marking directories with a trailing slash', () => {
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'src', 'nested.ts'), '');
    writeFileSync(join(dir, 'README.md'), '');

    const top = listTopLevel(dir);
    expect(top).toEqual(['README.md', 'src/']);
  });

  it('excludes ignored directories', () => {
    mkdirSync(join(dir, 'node_modules'));
    mkdirSync(join(dir, '.memoryintel'));
    writeFileSync(join(dir, 'package.json'), '{}');

    expect(listTopLevel(dir)).toEqual(['package.json']);
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

describe('isDocumentHtml', () => {
  it('rejects an SPA shell (mount div + script, no prose)', () => {
    const shell = '<html><body><div id="root"></div><script src="/bundle.js"></script></body></html>';
    expect(isDocumentHtml(shell)).toBe(false);
  });

  it('rejects HTML with little visible text even without a known mount-div id', () => {
    expect(isDocumentHtml('<html><body><div class="app"></div></body></html>')).toBe(false);
  });

  it('accepts a real prose-heavy document', () => {
    const doc = `<html><head><title>Architecture</title></head><body><h1>Architecture</h1><p>${'This system is composed of several services communicating over a queue. '.repeat(5)}</p></body></html>`;
    expect(isDocumentHtml(doc)).toBe(true);
  });
});

describe('findDocuments', () => {
  it('treats every markdown file as a document, no app-vs-doc distinction needed', () => {
    writeFileSync(join(dir, 'NOTES.md'), '# Notes\nSomething worth knowing.\n');
    const docs = findDocuments(dir, walkFiles(dir));
    expect(docs).toHaveLength(1);
    expect(docs[0].title).toBe('Notes');
  });

  it('excludes an HTML file that looks like an app shell', () => {
    writeFileSync(join(dir, 'index.html'), '<html><body><div id="root"></div><script src="/main.js"></script></body></html>');
    const docs = findDocuments(dir, walkFiles(dir));
    expect(docs).toHaveLength(0);
  });

  it('includes an HTML file that is a real document', () => {
    const doc = `<html><head><title>Internals</title></head><body><p>${'A long explanation of how this works. '.repeat(6)}</p></body></html>`;
    writeFileSync(join(dir, 'internals.html'), doc);
    const docs = findDocuments(dir, walkFiles(dir));
    expect(docs).toHaveLength(1);
    expect(docs[0].title).toBe('Internals');
  });

  it('finds documents anywhere in the tree, not just root or a memory-bank/ convention', () => {
    mkdirSync(join(dir, 'docs', 'deep'), { recursive: true });
    writeFileSync(join(dir, 'docs', 'deep', 'auth-flow.md'), '# Auth Flow\nHow login works.\n');
    const docs = findDocuments(dir, walkFiles(dir));
    expect(docs.some((d) => d.path.endsWith('auth-flow.md'))).toBe(true);
  });
});
