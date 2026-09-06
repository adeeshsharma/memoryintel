import { readFileSync, existsSync } from 'node:fs';
import { atomicWriteFile } from './atomicWrite.js';
import { getSectionContent, applySectionUpdate } from './sectionWriter.js';

export const DETECTED_START = '<!-- memoryintel:detected:start -->';
export const DETECTED_END = '<!-- memoryintel:detected:end -->';

export type DetectedBlockResult = 'written' | 'unchanged' | 'missing-file' | 'missing-heading';

function buildBlock(lines: string[]): string {
  return [DETECTED_START, ...lines, DETECTED_END].join('\n');
}

// Inserts or refreshes a memoryintel-owned "detected facts" block at the top of `heading`'s
// section content in the markdown file at absPath - modeled on the existing pointer-block
// mechanism in adapters/genericPointer.ts, generalized to work on an arbitrary heading inside an
// arbitrary file instead of one hardcoded block in one hardcoded set of files.
//
// Never creates the file (a directory `init` hasn't touched is left alone - 'missing-file') and
// never creates the heading either (`init`'s STARTER_FILES already ship every heading this is
// ever pointed at; a project on an old template without it is simply skipped - 'missing-heading'
// - rather than this feature mutating a file's structure it was never asked to manage).
//
// Content outside the markers - including agent-authored prose elsewhere in the very same
// section, above or below the block - is preserved byte-for-byte. This is what makes it safe to
// call this on every session start without ever risking real project understanding: the block is
// fully machine-owned, and everything else in the file categorically is not.
export function upsertDetectedBlock(absPath: string, heading: string, lines: string[]): DetectedBlockResult {
  if (!existsSync(absPath)) return 'missing-file';

  const markdown = readFileSync(absPath, 'utf-8');
  const sectionContent = getSectionContent(markdown, heading);
  if (sectionContent === null) return 'missing-heading';

  const newBlock = buildBlock(lines);
  const startIdx = sectionContent.indexOf(DETECTED_START);
  const endIdx = sectionContent.indexOf(DETECTED_END);

  let newSectionContent: string;
  if (startIdx !== -1 && endIdx !== -1) {
    const before = sectionContent.slice(0, startIdx);
    const after = sectionContent.slice(endIdx + DETECTED_END.length);
    newSectionContent = `${before}${newBlock}${after}`;
  } else {
    const rest = sectionContent.trim();
    newSectionContent = rest.length > 0 ? `${newBlock}\n\n${rest}` : newBlock;
  }

  if (newSectionContent === sectionContent) return 'unchanged';

  const updated = applySectionUpdate(markdown, heading, 'replace', newSectionContent);
  atomicWriteFile(absPath, updated);
  return 'written';
}
