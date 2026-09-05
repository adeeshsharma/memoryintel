import { describe, it, expect } from 'vitest';
import { applySectionUpdate, isNearDuplicate, getSectionContent, SectionRejectedError } from '../../src/core/sectionWriter.js';

describe('applySectionUpdate', () => {
  it('appends content to the end of an existing section, before the next heading', () => {
    const md = `## Overview\nold line\n## Components\nother\n`;
    const result = applySectionUpdate(md, 'Overview', 'append', 'new line');
    expect(result).toBe(`## Overview\nold line\nnew line\n## Components\nother\n`);
  });

  it('replaces the entire content of an existing section', () => {
    const md = `## Status\nold status\n## Next\nplan\n`;
    const result = applySectionUpdate(md, 'Status', 'replace', 'new status');
    expect(result).toBe(`## Status\nnew status\n## Next\nplan\n`);
  });

  it('creates a new heading at the end of the file when action is create-section', () => {
    const md = `## Overview\nold line\n`;
    const result = applySectionUpdate(md, 'Risks', 'create-section', 'a new risk');
    expect(result).toBe(`## Overview\nold line\n## Risks\na new risk\n`);
  });

  it('degrades create-section to append when the (normalized) heading already exists', () => {
    const md = `## Overview\nold line\n`;
    const result = applySectionUpdate(md, '  overview ', 'create-section', 'more');
    expect(result).toBe(`## Overview\nold line\nmore\n`);
  });

  it('never lets a deeper heading (###) be treated as a section boundary', () => {
    const md = `## Overview\nintro\n### Detail\ndetail text\nmore intro\n## Next\n`;
    const result = applySectionUpdate(md, 'Overview', 'append', 'appended');
    expect(result).toBe(`## Overview\nintro\n### Detail\ndetail text\nmore intro\nappended\n## Next\n`);
  });

  it('preserves interior blank lines (paragraph separation) when appending', () => {
    const md = `## Overview\nparagraph 1\n\nparagraph 2\n## Next\n`;
    const result = applySectionUpdate(md, 'Overview', 'append', 'appended');
    expect(result).toBe(`## Overview\nparagraph 1\n\nparagraph 2\nappended\n## Next\n`);
  });

  it('rejects append when the target section does not exist, with a suggestion', () => {
    const md = `## Authentication\ntext\n`;
    expect(() => applySectionUpdate(md, 'Auth', 'append', 'x')).toThrow(SectionRejectedError);
    try {
      applySectionUpdate(md, 'Auth', 'append', 'x');
    } catch (e) {
      expect((e as SectionRejectedError).suggestion).toBe('Authentication');
    }
  });

  it('rejects replace when the target section does not exist', () => {
    const md = `## Overview\ntext\n`;
    expect(() => applySectionUpdate(md, 'Nonexistent Thing', 'replace', 'x')).toThrow(SectionRejectedError);
  });

  it('rejects an unrecognized action instead of silently treating it as append', () => {
    const md = `## Overview\nold line\n`;
    expect(() => applySectionUpdate(md, 'Overview', 'appendd' as never, 'x'))
      .toThrow(/Unknown action "appendd"/);
    expect(() => applySectionUpdate(md, 'Overview', 'delete-section' as never, 'x'))
      .toThrow(/Expected one of: append, replace, create-section/);
  });
});

describe('getSectionContent', () => {
  it('returns just the matched section content block, not the whole file', () => {
    const md = `## Overview\nintro text\n## Components\ncomponent text\n`;
    expect(getSectionContent(md, 'Overview')).toBe('intro text');
    expect(getSectionContent(md, 'Components')).toBe('component text');
  });

  it('returns null when the section does not exist', () => {
    const md = `## Overview\nintro text\n`;
    expect(getSectionContent(md, 'Nonexistent')).toBeNull();
  });
});

describe('isNearDuplicate', () => {
  it('treats whitespace-only differences as duplicates', () => {
    expect(isNearDuplicate('some text here', '  some   text here  ')).toBe(true);
  });

  it('treats substantively different content as not duplicate', () => {
    expect(isNearDuplicate('the old status', 'a completely different update')).toBe(false);
  });

  it('catches a reworded restatement of the same fact via token overlap, not just literal substring', () => {
    const existing = 'Auth service issues JWTs and rotates refresh tokens';
    const reworded = 'rotates refresh tokens and issues JWTs auth service';
    expect(isNearDuplicate(existing, reworded)).toBe(true);
  });

  it('does not flag short additions as duplicate just because a couple words overlap', () => {
    expect(isNearDuplicate('Uses Postgres 14 and Redis for caching', 'Added Redis')).toBe(false);
  });

  it('does not flag a genuinely new fact that happens to share the subject noun', () => {
    const existing = 'Auth service issues JWTs and rotates refresh tokens every 15 minutes';
    const unrelated = 'Auth service now also logs failed login attempts to a separate audit table';
    expect(isNearDuplicate(existing, unrelated)).toBe(false);
  });
});
