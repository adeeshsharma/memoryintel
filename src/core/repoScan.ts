import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, extname } from 'node:path';

// Common vendor/build/cache directories across the ecosystems this scans (JS/TS, Python, Go,
// Rust). Not full .gitignore parsing - a real ignore-file parser is its own project, and this
// hardcoded list already keeps a scan quick on the repos it's meant for. Missing a project's own
// unusual output dir just means a few extra files get walked, not a correctness bug.
// `.memoryintel` is excluded deliberately, not an oversight: it's this tool's own bookkeeping
// (constantly-churning JSON/event logs, and markdown that's *output*, not source material) -
// including it here would make a scan review its own scratch state instead of the actual project.
export const IGNORED_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', '.next', '.nuxt', '.svelte-kit',
  'target', 'vendor', '__pycache__', '.venv', 'venv', 'env', 'coverage', '.cache',
  '.turbo', '.parcel-cache', '.pytest_cache', '.mypy_cache', '.idea', '.vscode', '.memoryintel'
]);

// Safety cap so a scan stays "quick" even pointed at an enormous or pathologically deep tree.
const MAX_FILES = 20000;

// Every file under targetDir, skipping IGNORED_DIRS and symlinks (symlinks risk cycles and can
// point outside the repo entirely - neither is a case worth handling for a quick scan). Returns
// absolute paths.
export function walkFiles(targetDir: string): string[] {
  const results: string[] = [];

  function visit(dir: string): void {
    if (results.length >= MAX_FILES) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (results.length >= MAX_FILES) return;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        visit(join(dir, entry.name));
      } else if (entry.isFile()) {
        results.push(join(dir, entry.name));
      }
    }
  }

  visit(targetDir);
  return results;
}

// A single level deep, not recursive - "repo/project setup" means "what's here", not a full
// tree. Directories are listed with a trailing slash so the shape is legible at a glance.
export function listTopLevel(targetDir: string): string[] {
  let entries;
  try {
    entries = readdirSync(targetDir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => !(e.isDirectory() && IGNORED_DIRS.has(e.name)))
    .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
    .sort();
}

export interface StackInfo {
  manifests: string[];
  dependencies: string[];
  scripts: Record<string, string>;
  entryPoints: string[];
}

function readJsonSafe(path: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

// Extracts every quoted string or `key =`/`key = "` entry between a section header and the next
// `[` - good enough to list dependency names out of TOML without pulling in a TOML parser
// dependency this project has none of today. Not a real TOML parser: won't handle inline
// tables or multi-line arrays split across many lines with comments in between.
function extractTomlSectionKeys(text: string, sectionHeader: string): string[] {
  const startIdx = text.indexOf(sectionHeader);
  if (startIdx === -1) return [];
  const afterHeader = text.slice(startIdx + sectionHeader.length);
  const nextSectionIdx = afterHeader.search(/\n\[/);
  const body = nextSectionIdx === -1 ? afterHeader : afterHeader.slice(0, nextSectionIdx);
  const keys: string[] = [];
  for (const line of body.split('\n')) {
    const match = /^\s*"?([\w.-]+)"?\s*=/.exec(line);
    if (match) keys.push(match[1]);
  }
  return keys;
}

function extractQuotedStrings(text: string): string[] {
  const matches = text.matchAll(/["']([^"'\s]+)["']/g);
  return [...matches].map((m) => m[1]);
}

export function detectStack(targetDir: string): StackInfo {
  const manifests: string[] = [];
  const dependencies = new Set<string>();
  const scripts: Record<string, string> = {};
  const entryPoints: string[] = [];

  const pkgPath = join(targetDir, 'package.json');
  if (existsSync(pkgPath)) {
    const pkg = readJsonSafe(pkgPath);
    if (pkg) {
      manifests.push('package.json');
      for (const dep of Object.keys((pkg.dependencies as Record<string, string>) ?? {})) dependencies.add(dep);
      for (const dep of Object.keys((pkg.devDependencies as Record<string, string>) ?? {})) dependencies.add(dep);
      Object.assign(scripts, (pkg.scripts as Record<string, string>) ?? {});
      if (typeof pkg.main === 'string') entryPoints.push(pkg.main);
      if (typeof pkg.bin === 'string') entryPoints.push(pkg.bin);
      else if (pkg.bin && typeof pkg.bin === 'object') entryPoints.push(...Object.values(pkg.bin as Record<string, string>));
    }
  }

  const reqPath = join(targetDir, 'requirements.txt');
  if (existsSync(reqPath)) {
    manifests.push('requirements.txt');
    for (const rawLine of readFileSync(reqPath, 'utf-8').split('\n')) {
      const line = rawLine.split('#')[0].trim();
      if (!line) continue;
      const name = line.split(/[=<>~!;\[]/)[0].trim();
      if (name) dependencies.add(name);
    }
  }

  const pyprojectPath = join(targetDir, 'pyproject.toml');
  if (existsSync(pyprojectPath)) {
    manifests.push('pyproject.toml');
    const text = readFileSync(pyprojectPath, 'utf-8');
    const projectDepsMatch = /dependencies\s*=\s*\[([\s\S]*?)\]/.exec(text);
    if (projectDepsMatch) {
      for (const dep of extractQuotedStrings(projectDepsMatch[1])) {
        dependencies.add(dep.split(/[=<>~!\s]/)[0]);
      }
    }
    for (const dep of extractTomlSectionKeys(text, '[tool.poetry.dependencies]')) {
      if (dep !== 'python') dependencies.add(dep);
    }
  }

  const goModPath = join(targetDir, 'go.mod');
  if (existsSync(goModPath)) {
    manifests.push('go.mod');
    const text = readFileSync(goModPath, 'utf-8');
    for (const match of text.matchAll(/^\s*([\w.\-/]+\.[\w.\-/]+)\s+v[\d.]/gm)) dependencies.add(match[1]);
  }

  const cargoPath = join(targetDir, 'Cargo.toml');
  if (existsSync(cargoPath)) {
    manifests.push('Cargo.toml');
    const text = readFileSync(cargoPath, 'utf-8');
    for (const dep of extractTomlSectionKeys(text, '[dependencies]')) dependencies.add(dep);
  }

  return { manifests, dependencies: [...dependencies], scripts, entryPoints };
}

export interface DocFile {
  path: string;
  title: string;
  content: string;
}

function extractMarkdownTitle(text: string): string {
  const h1 = /^#\s+(.+)$/m.exec(text);
  if (h1) return h1[1].trim();
  const firstLine = text.split('\n').map((l) => l.trim()).find((l) => l.length > 0);
  return firstLine ? firstLine.replace(/^#+\s*/, '').slice(0, 80) : '(untitled)';
}

function extractHtmlTitle(text: string): string {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(text);
  if (title) return title[1].replace(/<[^>]+>/g, '').trim().slice(0, 80);
  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(text);
  if (h1) return h1[1].replace(/<[^>]+>/g, '').trim().slice(0, 80);
  return '(untitled)';
}

// SPA shells (a React/Vue/etc. app's index.html) are markup with almost no prose: a mount div
// and a script tag. A real document is prose-heavy. Neither signal alone is reliable (a tiny
// real doc could dip under the text threshold; a doc-heavy landing page could avoid the mount-div
// markers) but together they cover the common cases without needing to know any framework by name.
const SPA_SHELL_MARKERS = /id=["'](root|app|__next|__nuxt)["']/i;
const MIN_DOCUMENT_TEXT_LENGTH = 150;

function visibleText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isDocumentHtml(html: string): boolean {
  if (SPA_SHELL_MARKERS.test(html)) return false;
  return visibleText(html).length >= MIN_DOCUMENT_TEXT_LENGTH;
}

// True if anything survives once every heading line is stripped out - a file that's only
// headings (a bare `init` starter section, or a title-only stub) has no actual information.
function hasMarkdownBody(content: string): boolean {
  return content
    .split('\n')
    .filter((line) => !/^#+\s/.test(line.trim()))
    .some((line) => line.trim().length > 0);
}

const DOC_EXTENSIONS = new Set(['.md', '.markdown', '.html', '.htm']);

// The genericPointer adapter (src/adapters/genericPointer.ts) upserts this managed block into
// AGENTS.md/GEMINI.md - it's memoryintel's own boilerplate, not project documentation. A file
// that already had real content keeps it and the block is just noise mixed in; a fresh stub file
// created by `init` with nothing but this block has zero real information and must not be
// imported as if it described the project (worst case: a brand-new stub's entire content is
// "this project uses Memory Intel, run `memoryintel load`", which would land in projectBrief.md
// looking like the project's own description).
const MANAGED_BLOCK_PATTERN = /<!-- memoryintel:managed:start -->[\s\S]*?<!-- memoryintel:managed:end -->/g;

// Every real document (not app markup, not memoryintel's own managed content) anywhere under
// targetDir - the general replacement for hardcoding a table of known filenames like
// memory-bank's convention. A markdown file is always a document (there's no equivalent "app
// shell" concept for markdown); an HTML file has to pass isDocumentHtml first.
export function findDocuments(targetDir: string, files: string[]): DocFile[] {
  const results: DocFile[] = [];

  for (const file of files) {
    const ext = extname(file).toLowerCase();
    if (!DOC_EXTENSIONS.has(ext)) continue;

    let content: string;
    try { content = readFileSync(file, 'utf-8'); } catch { continue; }
    content = content.replace(MANAGED_BLOCK_PATTERN, '').trim();
    if (!content) continue;

    if (ext === '.html' || ext === '.htm') {
      if (!isDocumentHtml(content)) continue;
      results.push({ path: file, title: extractHtmlTitle(content), content: visibleText(content) });
    } else if (!hasMarkdownBody(content)) {
      // A file that's nothing but a heading (a bare `init` starter section, or an AGENTS.md
      // stub reduced to just its "# Project Instructions" title once the managed block above is
      // stripped) has no real information - importing it would be pure noise, not source material.
      continue;
    } else {
      results.push({ path: file, title: extractMarkdownTitle(content), content });
    }
  }

  return results;
}
