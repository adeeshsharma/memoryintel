export function normalizeHeading(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function extractHeadings(markdown: string): string[] {
  const headings: string[] = [];
  for (const line of markdown.split('\n')) {
    const match = /^##[ \t]+(.+?)\s*$/.exec(line);
    if (match) headings.push(match[1].trim());
  }
  return headings;
}

export function findHeadingMatch(headings: string[], target: string): string | null {
  const normalizedTarget = normalizeHeading(target);
  return headings.find((h) => normalizeHeading(h) === normalizedTarget) ?? null;
}

// Token-overlap similarity: fraction of the smaller token set contained in the larger one,
// plus a prefix-containment bonus so "Auth" vs "Authentication" scores well.
function similarity(a: string, b: string): number {
  const na = normalizeHeading(a);
  const nb = normalizeHeading(b);
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.85;

  const tokensA = new Set(na.split(' '));
  const tokensB = new Set(nb.split(' '));
  const [small, large] = tokensA.size <= tokensB.size ? [tokensA, tokensB] : [tokensB, tokensA];
  let shared = 0;
  for (const t of small) if (large.has(t)) shared++;
  return small.size === 0 ? 0 : shared / small.size;
}

const SUGGESTION_THRESHOLD = 0.6;

export function suggestHeading(headings: string[], target: string): string | null {
  let best: { heading: string; score: number } | null = null;
  for (const h of headings) {
    const score = similarity(h, target);
    if (!best || score > best.score) best = { heading: h, score };
  }
  return best && best.score >= SUGGESTION_THRESHOLD ? best.heading : null;
}
