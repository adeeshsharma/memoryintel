import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative, extname, basename } from 'node:path';

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

const JS_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
const JS_IMPORT_PATTERN = /(?:import|export)\s+(?:[\w*${},\s]+from\s+)?['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)/g;
const PY_IMPORT_PATTERN = /^\s*from\s+(\.*[\w.]*)\s+import|^\s*import\s+([\w.]+)/gm;

// TypeScript's NodeNext/ESM resolution requires specifiers to name the *compiled* .js file even
// though the real source is .ts ('./update.js' importing from update.ts) - this project's own
// codebase does this everywhere. Without this swap, every relative import in a modern TS/ESM
// project resolves to nothing.
const COMPILED_TO_SOURCE_EXT: Record<string, string> = { '.js': '.ts', '.jsx': '.tsx', '.mjs': '.mts', '.cjs': '.cts' };

// Only relative specifiers ('./x', '../x') are resolved - a bare package name ('react',
// 'lodash/fp') is an external dependency, not part of this repo's own file graph.
function resolveJsImport(fromFile: string, specifier: string, fileSet: Set<string>): string | null {
  if (!specifier.startsWith('.')) return null;
  const base = join(dirname(fromFile), specifier);
  const specExt = extname(specifier);
  const sourceExt = COMPILED_TO_SOURCE_EXT[specExt];
  const candidates = [
    base,
    ...(sourceExt ? [base.slice(0, -specExt.length) + sourceExt] : []),
    ...JS_EXTENSIONS.map((ext) => base + ext),
    ...JS_EXTENSIONS.map((ext) => join(base, 'index' + ext))
  ];
  return candidates.find((c) => fileSet.has(c)) ?? null;
}

// Handles relative imports ('.foo', '..foo.bar') by walking up one directory per leading dot.
// Absolute intra-repo imports ('mypackage.module') are resolved only via the heuristic that
// `mypackage` is a real top-level directory containing an `__init__.py` right under targetDir -
// good enough to catch the common case without needing to understand the project's real import
// root (src layout, PYTHONPATH, etc.), which a quick scan has no reliable way to know.
function resolvePyImport(fromFile: string, targetDir: string, specifier: string, fileSet: Set<string>): string | null {
  if (!specifier) return null;

  if (specifier.startsWith('.')) {
    const leadingDots = specifier.match(/^\.+/)?.[0].length ?? 1;
    let dir = dirname(fromFile);
    for (let i = 1; i < leadingDots; i++) dir = dirname(dir);
    const rest = specifier.slice(leadingDots);
    const base = rest ? join(dir, ...rest.split('.')) : dir;
    return fileSet.has(base + '.py') ? base + '.py'
      : fileSet.has(join(base, '__init__.py')) ? join(base, '__init__.py')
      : null;
  }

  const segments = specifier.split('.');
  const topLevel = join(targetDir, segments[0]);
  if (!fileSet.has(join(topLevel, '__init__.py')) && !existsSync(join(topLevel, '__init__.py'))) return null;
  const base = join(targetDir, ...segments);
  return fileSet.has(base + '.py') ? base + '.py'
    : fileSet.has(join(base, '__init__.py')) ? join(base, '__init__.py')
    : null;
}

export interface HubFile {
  path: string;
  importedByCount: number;
}

// Ranks files by in-degree in the local import graph - "imported by the most other files" is a
// cheap, deterministic proxy for "architecturally central", without reading a single file's
// actual meaning. JS/TS and Python only for v1; a file in any other language is simply never a
// source of edges (it can still be an edge *target* if something imports it, which won't happen
// across language boundaries anyway).
export function buildImportGraph(targetDir: string, files: string[], limit = 15): HubFile[] {
  const fileSet = new Set(files);
  const inDegree = new Map<string, Set<string>>();

  const bump = (from: string, to: string): void => {
    if (!inDegree.has(to)) inDegree.set(to, new Set());
    inDegree.get(to)!.add(from);
  };

  for (const file of files) {
    const ext = extname(file);
    if (JS_EXTENSIONS.includes(ext)) {
      let text: string;
      try { text = readFileSync(file, 'utf-8'); } catch { continue; }
      for (const match of text.matchAll(JS_IMPORT_PATTERN)) {
        const specifier = match[1] ?? match[2];
        if (!specifier) continue;
        const resolved = resolveJsImport(file, specifier, fileSet);
        if (resolved && resolved !== file) bump(file, resolved);
      }
    } else if (ext === '.py') {
      let text: string;
      try { text = readFileSync(file, 'utf-8'); } catch { continue; }
      for (const match of text.matchAll(PY_IMPORT_PATTERN)) {
        const specifier = match[1] ?? match[2];
        if (!specifier) continue;
        const resolved = resolvePyImport(file, targetDir, specifier, fileSet);
        if (resolved && resolved !== file) bump(file, resolved);
      }
    }
  }

  return [...inDegree.entries()]
    .map(([path, importers]) => ({ path, importedByCount: importers.size }))
    .sort((a, b) => b.importedByCount - a.importedByCount)
    .slice(0, limit);
}

export interface DocFile {
  path: string;
  title: string;
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

const DOC_EXTENSIONS = new Set(['.md', '.markdown', '.html', '.htm']);
// import already handles these at the project root verbatim - listing them again here would
// just be noise, not a new signal.
const ALREADY_COVERED = new Set(['readme.md', 'architecture.md']);

export function findDocs(targetDir: string, files: string[], limit = 30): DocFile[] {
  const candidates = files
    .filter((f) => DOC_EXTENSIONS.has(extname(f).toLowerCase()))
    .filter((f) => {
      const rel = relative(targetDir, f);
      const isRoot = !rel.includes('/') && !rel.includes('\\');
      return !(isRoot && ALREADY_COVERED.has(basename(f).toLowerCase()));
    });

  const withMtime = candidates.map((f) => {
    let mtimeMs = 0;
    try { mtimeMs = statSync(f).mtimeMs; } catch { /* keep 0, sorts last */ }
    return { path: f, mtimeMs };
  });

  withMtime.sort((a, b) => b.mtimeMs - a.mtimeMs);

  return withMtime.slice(0, limit).map(({ path }) => {
    let text = '';
    try { text = readFileSync(path, 'utf-8'); } catch { /* leave empty, title falls back */ }
    const ext = extname(path).toLowerCase();
    const title = ext === '.html' || ext === '.htm' ? extractHtmlTitle(text) : extractMarkdownTitle(text);
    return { path: relative(targetDir, path), title };
  });
}
