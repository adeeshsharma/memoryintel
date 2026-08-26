import { describe, it, expect } from 'vitest';
import { normalizeHeading, extractHeadings, findHeadingMatch, suggestHeading } from '../../src/core/headingMatch.js';

describe('normalizeHeading', () => {
  it('trims, lowercases, and collapses whitespace', () => {
    expect(normalizeHeading('  Authentication   Flow  ')).toBe('authentication flow');
  });
});

describe('extractHeadings', () => {
  it('extracts only level-2 headings, ignoring deeper levels', () => {
    const md = `## Overview\nsome text\n### Sub detail\nmore text\n## Components\n`;
    expect(extractHeadings(md)).toEqual(['Overview', 'Components']);
  });

  it('returns an empty array for markdown with no headings', () => {
    expect(extractHeadings('just some prose')).toEqual([]);
  });
});

describe('findHeadingMatch', () => {
  it('matches case-insensitively and ignores whitespace differences', () => {
    const headings = ['Overview', 'Authentication'];
    expect(findHeadingMatch(headings, '  authentication ')).toBe('Authentication');
  });

  it('returns null when no heading matches', () => {
    expect(findHeadingMatch(['Overview'], 'Authentication')).toBeNull();
  });
});

describe('suggestHeading', () => {
  it('suggests the closest existing heading above the similarity threshold', () => {
    expect(suggestHeading(['Authentication', 'Overview'], 'Auth')).toBe('Authentication');
  });

  it('returns null when nothing is close enough', () => {
    expect(suggestHeading(['Overview', 'Roadmap'], 'Zzzqqq')).toBeNull();
  });
});
