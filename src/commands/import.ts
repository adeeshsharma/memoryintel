import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { runUpdate } from './update.js';
import { encodeToonTable } from '../core/toon.js';

interface Candidate {
  file: string;
  section: string;
  content: string;
  sourceLabel: string;
}

export interface ImportResult {
  applied: string[];
  skipped: string[];
  sourcesFound: string[];
}

// Cline/Roo/Kilo-Code's memory-bank/ convention (also the exact shape docmanager-axi and
// reactive-axi's own AGENTS.md files use) - the single highest-confidence brownfield source,
// because it's already hand-organized project understanding, not raw code to re-derive from.
const MEMORY_BANK_MAP: { relFile: string; section: string; sourceName: string }[] = [
  { relFile: 'context/projectBrief.md', section: 'Overview', sourceName: 'projectbrief.md' },
  { relFile: 'business/productContext.md', section: 'Product Overview', sourceName: 'productContext.md' },
  { relFile: 'technical/patterns.md', section: 'Design Patterns', sourceName: 'systemPatterns.md' },
  { relFile: 'technical/techContext.md', section: 'Stack', sourceName: 'techContext.md' },
  { relFile: 'context/activeContext.md', section: 'Current Focus', sourceName: 'activeContext.md' },
  { relFile: 'context/progress.md', section: 'Status', sourceName: 'progress.md' }
];

function findCaseInsensitive(dir: string, name: string): string | null {
  if (!existsSync(dir)) return null;
  const lower = name.toLowerCase();
  const match = readdirSync(dir).find((f) => f.toLowerCase() === lower);
  return match ? join(dir, match) : null;
}

// Deliberately verbatim, not summarized or re-split into finer sections - this command is a
// mechanical transcription step, not a judgment step. Splitting productContext.md's prose across
// "Users"/"Value Proposition" would require actually reading and interpreting it, which is
// exactly the per-project judgment call this command exists to avoid paying for up front.
function annotate(content: string, sourceLabel: string): string {
  const today = new Date().toISOString().slice(0, 10);
  return `_Imported verbatim from \`${sourceLabel}\` on ${today} — not yet re-filed into per-section structure; treat as raw source material for the next real update._\n\n${content}`;
}

// Skips headings, badges, and image lines to find the README's actual opening description -
// only used as a fallback when memory-bank/projectbrief.md doesn't already cover this ground.
function firstParagraph(markdown: string): string | null {
  const paragraphs: string[] = [];
  let current: string[] = [];
  for (const rawLine of markdown.split('\n')) {
    const line = rawLine.trim();
    if (line === '') {
      if (current.length > 0) { paragraphs.push(current.join(' ')); current = []; }
      continue;
    }
    if (/^#/.test(line) || /^!?\[/.test(line)) continue;
    current.push(line);
  }
  if (current.length > 0) paragraphs.push(current.join(' '));
  return paragraphs.find((p) => p.length > 20) ?? null;
}

export async function runImport(root: string, targetDir: string): Promise<ImportResult> {
  const candidates: Candidate[] = [];
  const sourcesFound: string[] = [];
  const memoryBankDir = join(targetDir, 'memory-bank');
  let sawProjectBrief = false;

  for (const entry of MEMORY_BANK_MAP) {
    const found = findCaseInsensitive(memoryBankDir, entry.sourceName);
    if (!found) continue;
    const content = readFileSync(found, 'utf-8').trim();
    if (!content) continue;
    const label = `memory-bank/${entry.sourceName}`;
    sourcesFound.push(label);
    candidates.push({ file: entry.relFile, section: entry.section, content: annotate(content, label), sourceLabel: label });
    if (entry.relFile === 'context/projectBrief.md') sawProjectBrief = true;
  }

  const archPath = findCaseInsensitive(targetDir, 'ARCHITECTURE.md');
  if (archPath) {
    const content = readFileSync(archPath, 'utf-8').trim();
    if (content) {
      sourcesFound.push('ARCHITECTURE.md');
      candidates.push({ file: 'technical/architecture.md', section: 'Overview', content: annotate(content, 'ARCHITECTURE.md'), sourceLabel: 'ARCHITECTURE.md' });
    }
  }

  if (!sawProjectBrief) {
    const readmePath = findCaseInsensitive(targetDir, 'README.md');
    if (readmePath) {
      const lede = firstParagraph(readFileSync(readmePath, 'utf-8'));
      if (lede) {
        sourcesFound.push('README.md');
        candidates.push({ file: 'context/projectBrief.md', section: 'Overview', content: annotate(lede, 'README.md'), sourceLabel: 'README.md' });
      }
    }
  }

  if (candidates.length === 0) {
    return { applied: [], skipped: [], sourcesFound: [] };
  }

  const planText = encodeToonTable(candidates.map((c) => ({
    file: c.file,
    action: 'append',
    section: c.section,
    content: c.content,
    reason: `Brownfield import from ${c.sourceLabel}`
  })));

  const { applied, skipped } = await runUpdate(root, planText);
  return { applied, skipped, sourcesFound };
}
