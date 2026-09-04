import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { findMemoryIntelRoot } from '../core/discovery.js';
import { extractHeadings } from '../core/headingMatch.js';
import { encodeToonTable } from '../core/toon.js';
import { getCeilingLines, countLines } from '../core/compressionConfig.js';
import { ensureDaemonRunning } from '../daemon/lifecycle.js';
import { upsertRegistryEntry } from '../daemon/registry.js';
import { appendEvent } from '../core/eventLog.js';

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

  const files = [...ALWAYS_LOAD, ...(domain ? DOMAIN_FILES[domain as Domain] : [])];
  const sections: string[] = [];
  const manifestRows: Record<string, string>[] = [];

  for (const relFile of files) {
    const absPath = join(root, relFile);
    if (!existsSync(absPath)) continue;
    const content = readFileSync(absPath, 'utf-8');
    const lines = countLines(content);
    const ceiling = getCeilingLines(root, relFile);
    const status = lines > ceiling ? 'over' : 'under';
    sections.push(`--- FILE: ${relFile} ---\n${content}`);
    manifestRows.push({
      file: relFile,
      headings: extractHeadings(content).join('|'),
      lines: String(lines),
      ceiling: String(ceiling),
      status
    });
  }

  try {
    const totalChars = sections.reduce((sum, s) => sum + s.length, 0);
    const totalLines = manifestRows.reduce((sum, r) => sum + Number(r.lines), 0);
    appendEvent(join(root, 'memory-events.jsonl'), {
      timestamp: new Date().toISOString(),
      type: 'session-load',
      summary: `Loaded ${manifestRows.length} file(s)${domain ? ` (domain: ${domain})` : ''}`,
      affectedFiles: manifestRows.map((r) => r.file),
      domain: domain ?? null,
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
  return `root: ${root}\n${manifest}\n${sections.join('\n')}`;
}
