import { describe, it, expect } from 'vitest';
import { escapeHtml, pageShell, formatAge } from '../../../src/daemon/views/layout.js';

describe('escapeHtml', () => {
  it('escapes the five HTML-significant characters', () => {
    expect(escapeHtml(`<script>&"'</script>`)).toBe('&lt;script&gt;&amp;&quot;&#39;&lt;/script&gt;');
  });
});

describe('pageShell', () => {
  it('embeds the title and body', () => {
    const html = pageShell('Memory Intel', '<p>hello</p>');
    expect(html).toContain('<title>Memory Intel</title>');
    expect(html).toContain('<p>hello</p>');
  });

  it('is a complete, valid-looking HTML document', () => {
    const html = pageShell('T', '<p>x</p>');
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('<style>');
  });
});

// A day-only label ("0d ago") was indistinguishable for anything from just-updated up to almost
// 24h old - the exact window where an actively-worked project's files actually sit. Confirmed on
// a real project: every file touched today showed "0d ago" with no way to tell 2 minutes from 20
// hours apart.
describe('formatAge', () => {
  it('reads "just now" for under a minute', () => {
    expect(formatAge(30 * 1000)).toBe('just now');
  });

  it('shows minutes under an hour', () => {
    expect(formatAge(5 * 60 * 1000)).toBe('5m ago');
    expect(formatAge(59 * 60 * 1000)).toBe('59m ago');
  });

  it('shows hours from 1h up to just under 24h', () => {
    expect(formatAge(60 * 60 * 1000)).toBe('1h ago');
    expect(formatAge(23 * 60 * 60 * 1000 + 59 * 60 * 1000)).toBe('23h ago');
  });

  it('switches to days once 24h is crossed', () => {
    expect(formatAge(24 * 60 * 60 * 1000)).toBe('1d ago');
    expect(formatAge(3 * 24 * 60 * 60 * 1000 + 60 * 60 * 1000)).toBe('3d ago');
  });

  it('clamps negative durations (clock skew) to "just now" instead of going negative', () => {
    expect(formatAge(-1000)).toBe('just now');
  });
});
