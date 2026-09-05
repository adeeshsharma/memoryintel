import { extractHeadings, findHeadingMatch, suggestHeading, normalizeHeading } from './headingMatch.js';

export type SectionAction = 'append' | 'replace' | 'create-section';

export class SectionRejectedError extends Error {
  constructor(public section: string, public suggestion: string | null) {
    super(
      suggestion
        ? `Section "${section}" not found. Did you mean "${suggestion}"?`
        : `Section "${section}" not found and no similar heading exists.`
    );
  }
}

// Returns [startLine, endLine) of the section's content, and [headingLine] index.
function findSectionBounds(lines: string[], headingText: string): { headingLine: number; contentStart: number; contentEnd: number } | null {
  const target = normalizeHeading(headingText);
  for (let i = 0; i < lines.length; i++) {
    const match = /^##[ \t]+(.+?)\s*$/.exec(lines[i]);
    if (match && normalizeHeading(match[1].trim()) === target) {
      let end = lines.length;
      for (let j = i + 1; j < lines.length; j++) {
        if (/^##[ \t]+.+/.test(lines[j])) { end = j; break; }
      }
      return { headingLine: i, contentStart: i + 1, contentEnd: end };
    }
  }
  return null;
}

// Returns just the matched section's content block (the lines between its heading and the
// next ## heading, or end of file), or null if no heading matches `section`.
export function getSectionContent(markdown: string, section: string): string | null {
  const lines = markdown.split('\n');
  const headings = extractHeadings(markdown);
  const existingHeading = findHeadingMatch(headings, section);
  if (!existingHeading) return null;

  const bounds = findSectionBounds(lines, existingHeading);
  if (!bounds) return null;

  // Strip the trailing empty-string artifact produced by split('\n') when the section's content
  // (or the file itself, for the last section) ends with a newline — mirrors the same stripping
  // applySectionUpdate does when building on top of existing content for 'append'.
  const contentLines = lines.slice(bounds.contentStart, bounds.contentEnd);
  if (contentLines.length > 0 && contentLines[contentLines.length - 1] === '') {
    contentLines.pop();
  }
  return contentLines.join('\n');
}

const VALID_ACTIONS: readonly string[] = ['append', 'replace', 'create-section'];

export function applySectionUpdate(markdown: string, section: string, action: SectionAction, content: string): string {
  // Anything that is not exactly one of the three known actions used to fall through to the
  // append branch, so a typo'd (or hostile) action string silently wrote content anyway.
  if (!VALID_ACTIONS.includes(action)) {
    throw new Error(`Unknown action "${action}". Expected one of: ${VALID_ACTIONS.join(', ')}.`);
  }

  const lines = markdown.split('\n');
  const headings = extractHeadings(markdown);
  const existingHeading = findHeadingMatch(headings, section);

  if (action === 'create-section' && !existingHeading) {
    const needsTrailingNewline = lines.length > 0 && lines[lines.length - 1] !== '';
    const prefix = needsTrailingNewline ? lines.join('\n') + '\n' : lines.join('\n');
    return `${prefix}## ${section}\n${content}\n`;
  }

  // create-section on an existing heading degrades to append; append/replace require an existing match.
  if (!existingHeading) {
    const suggestion = suggestHeading(headings, section);
    throw new SectionRejectedError(section, suggestion);
  }

  const bounds = findSectionBounds(lines, existingHeading)!;
  const before = lines.slice(0, bounds.contentStart);
  const existingContentLines = lines.slice(bounds.contentStart, bounds.contentEnd);
  const after = lines.slice(bounds.contentEnd);

  const newContentLines = action === 'replace'
    ? [content]
    : (() => {
        // Preserve all interior blank lines; only strip the trailing empty string
        // artifact produced by split('\n') when content ends with \n.
        const filtered = existingContentLines.slice();
        if (filtered.length > 0 && filtered[filtered.length - 1] === '') {
          filtered.pop();
        }
        return [...filtered, content];
      })();

  const result = [...before, ...newContentLines, ...after].join('\n');
  return result.endsWith('\n') ? result : result + '\n';
}

const DUPLICATE_STOPWORDS = new Set([
  'the', 'and', 'for', 'are', 'was', 'were', 'with', 'this', 'that', 'from', 'have', 'has'
]);

// Words under 3 chars and common connectors are dropped before comparing - otherwise two
// sentences sharing only "the", "and", "is" would register as near-duplicates of each other.
function meaningfulTokens(s: string): string[] {
  return normalizeHeading(s)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !DUPLICATE_STOPWORDS.has(t));
}

const TOKEN_OVERLAP_THRESHOLD = 0.85;

export function isNearDuplicate(existingBlock: string, newContent: string): boolean {
  // Fast path: catches whitespace-only diffs and literal restatements.
  if (normalizeHeading(existingBlock).includes(normalizeHeading(newContent))) return true;

  // Reordered/lightly-reworded restatements of the same fact aren't a literal substring of the
  // existing block, so the check above misses them - which is exactly how the same fact
  // re-enters memory in slightly different words each session, quietly working against
  // self-compression. Below a handful of meaningful words, overlap ratios get noisy on trivial
  // content, so short additions fall back to the literal check above only.
  const newTokens = meaningfulTokens(newContent);
  if (newTokens.length < 3) return false;

  const existingTokens = new Set(meaningfulTokens(existingBlock));
  const overlap = newTokens.filter((t) => existingTokens.has(t)).length;
  return overlap / newTokens.length >= TOKEN_OVERLAP_THRESHOLD;
}
