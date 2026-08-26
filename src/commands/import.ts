import { relative, sep } from 'node:path';
import { runUpdate } from './update.js';
import { encodeToonTable } from '../core/toon.js';
import { walkFiles, findDocuments, type DocFile } from '../core/repoScan.js';

// relative() returns backslash-separated paths on Windows. These labels get baked into
// permanent memory content (the `reason` field, the annotate() header) alongside every other
// file reference in this project, which is always forward-slash (e.g. `technical/architecture.md`)
// - a Windows-only backslash would be a visible, permanent inconsistency in stored memory, not
// just a display quirk. Same class of bug already hit and fixed elsewhere in this codebase
// (assertSafePath, the compression git-clean check) - normalize once, right at the source.
function toPosixRelative(targetDir: string, absPath: string): string {
  return relative(targetDir, absPath).split(sep).join('/');
}

export interface ImportResult {
  applied: string[];
  skipped: string[];
  sourcesFound: string[];
}

// Ordered, first-match-wins keyword -> target mapping. Deliberately just keyword matching on a
// document's filename + extracted title, not any real understanding of its content - the general
// replacement for hardcoding a table of known filenames (memory-bank's convention happens to
// fall out of this for free: "productContext.md" matches "product", "systemPatterns.md" matches
// "pattern", with no special-casing needed), generalized to any document anywhere in the repo,
// under any naming convention.
const ROUTES: { keywords: string[]; file: string; section: string }[] = [
  { keywords: ['architecture', 'design'], file: 'technical/architecture.md', section: 'Overview' },
  { keywords: ['pattern'], file: 'technical/patterns.md', section: 'Design Patterns' },
  { keywords: ['tech', 'stack'], file: 'technical/techContext.md', section: 'Stack' },
  { keywords: ['integration'], file: 'technical/integrations.md', section: 'External Services' },
  { keywords: ['infra', 'deploy'], file: 'technical/infrastructure.md', section: 'Deployment' },
  { keywords: ['product'], file: 'business/productContext.md', section: 'Product Overview' },
  { keywords: ['roadmap'], file: 'business/roadmap.md', section: 'Now' },
  { keywords: ['stakeholder', 'team'], file: 'business/stakeholders.md', section: 'Team' },
  { keywords: ['market'], file: 'business/marketContext.md', section: 'Market Overview' },
  { keywords: ['progress', 'status'], file: 'context/progress.md', section: 'Status' },
  { keywords: ['active', 'focus', 'current'], file: 'context/activeContext.md', section: 'Current Focus' },
  { keywords: ['decision'], file: 'context/decisions.md', section: 'Decisions Log' },
  { keywords: ['learn'], file: 'context/learnings.md', section: 'Learnings' },
  { keywords: ['objective', 'goal'], file: 'context/objectives.md', section: 'Objectives' },
  { keywords: ['hypothes'], file: 'research/hypotheses.md', section: 'Open Hypotheses' },
  { keywords: ['finding', 'research'], file: 'research/findings.md', section: 'Key Findings' },
  { keywords: ['reference'], file: 'research/references.md', section: 'Sources' },
  { keywords: ['readme', 'brief', 'overview'], file: 'context/projectBrief.md', section: 'Overview' }
];
// Anything matching no keyword still lands somewhere a human/agent will see it, rather than
// being silently dropped for not fitting a known bucket.
const DEFAULT_ROUTE = { file: 'context/projectBrief.md', section: 'Overview' };

function route(doc: DocFile, targetDir: string): { file: string; section: string } {
  const haystack = `${toPosixRelative(targetDir, doc.path)} ${doc.title}`.toLowerCase();
  for (const r of ROUTES) {
    if (r.keywords.some((k) => haystack.includes(k))) return { file: r.file, section: r.section };
  }
  return DEFAULT_ROUTE;
}

function annotate(content: string, sourceLabel: string): string {
  const today = new Date().toISOString().slice(0, 10);
  return `_Imported verbatim from \`${sourceLabel}\` on ${today} — not yet re-filed into per-section structure; treat as raw source material for the next real update._\n\n${content.trim()}`;
}

export async function runImport(root: string, targetDir: string): Promise<ImportResult> {
  const files = walkFiles(targetDir);
  const docs = findDocuments(targetDir, files);

  if (docs.length === 0) {
    return { applied: [], skipped: [], sourcesFound: [] };
  }

  const sourcesFound = docs.map((d) => toPosixRelative(targetDir, d.path));
  const candidates = docs.map((doc) => {
    const target = route(doc, targetDir);
    const label = toPosixRelative(targetDir, doc.path);
    return {
      file: target.file,
      action: 'append',
      section: target.section,
      content: annotate(doc.content, label),
      reason: `Brownfield import from ${label}`
    };
  });

  const planText = encodeToonTable(candidates);
  const { applied, skipped } = await runUpdate(root, planText);
  return { applied, skipped, sourcesFound };
}
