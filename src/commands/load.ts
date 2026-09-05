import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { findMemoryIntelRoot } from '../core/discovery.js';
import { extractHeadings } from '../core/headingMatch.js';
import { encodeToonTable } from '../core/toon.js';
import { getCeilingChars, countLines } from '../core/compressionConfig.js';
import { ensureDaemonRunning } from '../daemon/lifecycle.js';
import { upsertRegistryEntry } from '../daemon/registry.js';
import { appendEvent } from '../core/eventLog.js';
import { readIndex } from '../core/memoryIndex.js';

const ALWAYS_LOAD = ['context/currentMentalModel.md', 'context/activeContext.md'];

export type Domain = 'technical' | 'business' | 'research';

const DOMAIN_FILES: Record<Domain, string[]> = {
  technical: ['technical/architecture.md', 'technical/techContext.md', 'technical/patterns.md'],
  business: ['business/productContext.md', 'business/roadmap.md', 'business/stakeholders.md'],
  research: ['research/findings.md', 'research/hypotheses.md']
};

export class UnknownDomainError extends Error {
  constructor(public domain: string) {
    super(`Unknown domain "${domain}". Valid domains are: ${Object.keys(DOMAIN_FILES).join(', ')}.`);
    this.name = 'UnknownDomainError';
  }
}

function assertKnownDomain(domain: string): asserts domain is Domain {
  if (!Object.prototype.hasOwnProperty.call(DOMAIN_FILES, domain)) {
    throw new UnknownDomainError(domain);
  }
}

function domainOf(relFile: string): Domain | null {
  const segment = relFile.split('/')[0];
  return Object.prototype.hasOwnProperty.call(DOMAIN_FILES, segment) ? (segment as Domain) : null;
}

// A heading-only index of unloaded domain files is a nudge, not a guarantee - nothing forces an
// agent to notice it and pass --domain. Carrying forward whichever domain the *previous* session
// actually wrote to removes the agent's judgment from the common case entirely: if last session's
// work touched business/roadmap.md, this session's bare `load` (no --domain given, which is all
// the SessionStart hook ever passes) already includes that domain, because it's the domain most
// likely still relevant. Only switching to a domain untouched in the most recent write still
// depends on the agent reading the "Other memory available" index below and acting on it.
function inferRecentDomain(eventsPath: string): Domain | null {
  if (!existsSync(eventsPath)) return null;
  let lines: string[];
  try {
    lines = readFileSync(eventsPath, 'utf-8').trim().split('\n').filter(Boolean);
  } catch {
    return null;
  }
  for (let i = lines.length - 1; i >= 0; i--) {
    let event: unknown;
    try {
      event = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    if (!event || typeof event !== 'object') continue;
    const { type, affectedFiles } = event as { type?: unknown; affectedFiles?: unknown };
    if (type !== 'memory-update' || !Array.isArray(affectedFiles)) continue;
    const domain = typeof affectedFiles[0] === 'string' ? domainOf(affectedFiles[0]) : null;
    if (domain) return domain;
  }
  return null;
}

export function runLoad(cwd: string, domain?: string): string {
  // Validate before touching disk so a bad --domain always produces a clear, named error
  // rather than spreading `undefined` out of DOMAIN_FILES.
  if (domain !== undefined) assertKnownDomain(domain);

  const root = findMemoryIntelRoot(cwd);
  if (!root) return '';

  try {
    ensureDaemonRunning();
    upsertRegistryEntry(dirname(root));
  } catch {
    // Dashboard visibility is best-effort — never let it break `load`.
  }

  // An explicit --domain always wins. Only when the caller (in practice: the SessionStart hook,
  // which never passes --domain) leaves it unset do we fall back to the last-touched domain.
  let effectiveDomain = domain as Domain | undefined;
  let domainSource: 'explicit' | 'auto' | null = domain ? 'explicit' : null;
  if (effectiveDomain === undefined) {
    const inferred = inferRecentDomain(join(root, 'memory-events.jsonl'));
    if (inferred) {
      effectiveDomain = inferred;
      domainSource = 'auto';
    }
  }

  const files = [...ALWAYS_LOAD, ...(effectiveDomain ? DOMAIN_FILES[effectiveDomain] : [])];
  const loadedSet = new Set(files);
  const sections: string[] = [];
  const manifestRows: Record<string, string>[] = [];
  // `status` already surfaces lastUpdated from this same index - `load` is the one command
  // instructions.md tells every session to run FIRST, though, and previously gave zero signal
  // for "just updated" vs. "nobody has touched this in months" without a separate `status`
  // call nothing prompts an agent to make.
  const index = readIndex(join(root, 'memory-index.json'));

  for (const relFile of files) {
    const absPath = join(root, relFile);
    if (!existsSync(absPath)) continue;
    const content = readFileSync(absPath, 'utf-8');
    const lines = countLines(content);
    const ceiling = getCeilingChars(root, relFile);
    const status = content.length > ceiling ? 'over' : 'under';
    sections.push(`--- FILE: ${relFile} ---\n${content}`);
    manifestRows.push({
      file: relFile,
      headings: extractHeadings(content).join('|'),
      lines: String(lines),
      chars: String(content.length),
      ceiling: String(ceiling),
      status,
      lastUpdated: index[relFile]?.lastUpdated ?? 'never'
    });
  }

  // Domain files exist only to be pulled in via `load --domain <d>`, which nothing prompts an
  // agent to do proactively - in practice this leaves them written by `update()` but never read
  // back. A heading-only index (no content, so this costs tens of tokens rather than the
  // hundreds/thousands a full domain would) at least makes their existence and topic visible on
  // every load, so an agent can decide to pull one in instead of the content silently going
  // stale and unread.
  const domainIndexRows: Record<string, string>[] = [];
  for (const [domainName, domainFiles] of Object.entries(DOMAIN_FILES)) {
    for (const relFile of domainFiles) {
      if (loadedSet.has(relFile)) continue;
      const absPath = join(root, relFile);
      if (!existsSync(absPath)) continue;
      const content = readFileSync(absPath, 'utf-8');
      domainIndexRows.push({
        domain: domainName,
        file: relFile,
        headings: extractHeadings(content).join('|'),
        lines: String(countLines(content))
      });
    }
  }
  const domainIndex = domainIndexRows.length > 0
    ? `\nOther memory available (not loaded — run \`memoryintel load --domain <domain>\` to include):\n${encodeToonTable(domainIndexRows)}`
    : '';

  try {
    const totalChars = sections.reduce((sum, s) => sum + s.length, 0);
    const totalLines = manifestRows.reduce((sum, r) => sum + Number(r.lines), 0);
    const domainLabel = effectiveDomain
      ? ` (domain: ${effectiveDomain}${domainSource === 'auto' ? ', auto-carried from last update' : ''})`
      : '';
    appendEvent(join(root, 'memory-events.jsonl'), {
      timestamp: new Date().toISOString(),
      type: 'session-load',
      summary: `Loaded ${manifestRows.length} file(s)${domainLabel}`,
      affectedFiles: manifestRows.map((r) => r.file),
      domain: effectiveDomain ?? null,
      domainSource,
      totalChars,
      totalLines
    });
  } catch {
    // KPI telemetry is best-effort - never let logging a load break the load itself.
  }

  const manifest = encodeToonTable(manifestRows);
  // A leading, plainly-labeled root line - silently loading the wrong project's (or wrong
  // worktree/branch's) memory has happened in practice: findMemoryIntelRoot() walks up from
  // cwd with no built-in visibility into which root it actually found, so confidently-wrong
  // content came back with nothing to flag it. This is always the first thing printed,
  // whether or not --domain is given.
  return `root: ${root}\n${manifest}${domainIndex}\n${sections.join('\n')}`;
}
