#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSkillMarkdown } from '../dist/skill.js';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const outPath = join(projectRoot, 'skills', 'memoryintel', 'SKILL.md');
const content = createSkillMarkdown();
const checkMode = process.argv.includes('--check');

if (checkMode) {
  const existing = existsSync(outPath) ? readFileSync(outPath, 'utf-8') : null;
  if (existing !== content) {
    console.error('skills/memoryintel/SKILL.md is out of date. Run `npm run build:skill` to regenerate it.');
    process.exit(1);
  }
  console.log('skills/memoryintel/SKILL.md is up to date.');
} else {
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, content);
  console.log(`Wrote ${outPath}`);
}
