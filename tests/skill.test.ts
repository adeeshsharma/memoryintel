import { describe, it, expect } from 'vitest';
import { createSkillMarkdown } from '../src/skill.js';
import { USAGE } from '../src/cli.js';

describe('createSkillMarkdown', () => {
  it('starts with YAML frontmatter naming the skill', () => {
    const md = createSkillMarkdown();
    expect(md.startsWith('---\n')).toBe(true);
    expect(md).toContain('name: memoryintel');
  });

  it('includes a description mentioning both trigger conditions', () => {
    const md = createSkillMarkdown();
    expect(md).toMatch(/description:.*persistent project memory/i);
    expect(md).toMatch(/description:.*\.memoryintel/);
  });

  it('tells the agent how to bootstrap a fresh project', () => {
    const md = createSkillMarkdown();
    expect(md).toContain('memoryintel init');
  });

  it('points to instructions.md as the per-project authority once initialized', () => {
    const md = createSkillMarkdown();
    expect(md).toContain('.memoryintel/instructions.md');
  });

  it('embeds the real CLI USAGE text verbatim, so the two can never drift apart', () => {
    const md = createSkillMarkdown();
    expect(md).toContain(USAGE);
  });

  it('documents a sandboxed-environment fallback that does not assume npx/global install', () => {
    const md = createSkillMarkdown();
    expect(md).toMatch(/node .*dist\/cli\.js/);
  });
});
