import { describe, it, expect } from 'vitest';
import { matchKnownFacts } from '../../src/core/knownFacts.js';

describe('matchKnownFacts', () => {
  it('matches a framework dependency into techContext', () => {
    const result = matchKnownFacts(['next', 'react', 'some-unknown-pkg']);
    expect(result.techContext.some((f) => f.includes('Next.js') && f.includes('`next`'))).toBe(true);
  });

  it('matches a scoped package dependency into integrations', () => {
    const result = matchKnownFacts(['@sanity/client']);
    expect(result.integrations.some((f) => f.includes('Sanity') && f.includes('@sanity/client'))).toBe(true);
  });

  it('matches whichever alias is present when match is an array', () => {
    const viaAlias = matchKnownFacts(['sanity']);
    expect(viaAlias.integrations.some((f) => f.includes('Sanity') && f.includes('`sanity`'))).toBe(true);
  });

  it('returns empty arrays when nothing matches', () => {
    const result = matchKnownFacts(['some-random-unrelated-package']);
    expect(result.techContext).toEqual([]);
    expect(result.integrations).toEqual([]);
  });

  it('never duplicates a fact when both alias names are present', () => {
    const result = matchKnownFacts(['@sanity/client', 'sanity']);
    const sanityMatches = result.integrations.filter((f) => f.includes('Sanity'));
    expect(sanityMatches.length).toBe(1);
  });
});
