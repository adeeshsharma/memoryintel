import { readFileSync } from 'node:fs';
import { join, posix, dirname } from 'node:path';
import { decodePlanRows } from '../core/toon.js';
import { applySectionUpdate, isNearDuplicate, getSectionContent } from '../core/sectionWriter.js';
import { assertSafePath } from '../core/pathSafety.js';
import { upsertIndexEntry } from '../core/memoryIndex.js';
import { appendEvent } from '../core/eventLog.js';
import { atomicWriteFile } from '../core/atomicWrite.js';
import { withLock } from '../core/lock.js';
import { ensureDaemonRunning } from '../daemon/lifecycle.js';
import { upsertRegistryEntry } from '../daemon/registry.js';
import { resolveCheckStopMarker } from '../adapters/claudeCode.js';
import { isPathClean } from '../core/gitPorcelain.js';

interface PlanRow {
  file: string;
  action: 'append' | 'replace' | 'create-section';
  section: string;
  content: string;
  reason: string;
  kind?: string;
}

type EventType = 'memory-update' | 'compression' | 'skipped-duplicate' | 'compression-rejected';

const MENTAL_MODEL_FILE = 'context/currentMentalModel.md';

export async function runUpdate(root: string, planText: string): Promise<{ applied: string[]; skipped: string[] }> {
  try {
    ensureDaemonRunning();
    upsertRegistryEntry(dirname(root));
  } catch {
    // Dashboard visibility is best-effort — never let it break `update`.
  }

  const rows = decodePlanRows(planText) as unknown as PlanRow[];

  return withLock(join(root, '.lock'), () => {
    // Phase 1: validate every entry against current disk state, compute the writes, write nothing yet.
    const writes: { absPath: string; relFile: string; newContent: string; reason: string; skipped: boolean; eventType: EventType }[] = [];

    // Tracks each path's content as computed so far *this call*, so a second row targeting a
    // path already touched by an earlier row builds on that row's result instead of the
    // original on-disk content (which would otherwise silently discard the earlier edit).
    const workingContent = new Map<string, string>();

    for (const row of rows) {
      const absPath = assertSafePath(root, row.file);
      const currentContent = workingContent.has(absPath) ? workingContent.get(absPath)! : readFileSync(absPath, 'utf-8');
      const isCompression = row.kind === 'compress';

      // A compression row rewrites/collapses content whose only durable record, once
      // compressed, is git history — so it may only proceed once the pre-compression version
      // is already a real commit. This check is scoped to this row's own file, never the whole
      // working tree, and treats "cannot determine git status at all" as unsafe, not as clean.
      if (isCompression) {
        // git always reports porcelain paths with forward slashes, regardless of OS - path.join
        // here would produce a backslash-separated path on Windows that can never match, making
        // every file look permanently clean there. path.posix.join keeps this comparable to
        // git's own output on every platform. Caught by CI's Windows matrix job.
        const clean = isPathClean(dirname(root), posix.join('.memoryintel', row.file));
        if (clean !== true) {
          const reason = clean === null
            ? `Could not verify git status for ${row.file} — compression skipped this run.`
            : `${row.file} has uncommitted changes — commit the current state before compressing it, then retry.`;
          writes.push({ absPath, relFile: row.file, newContent: currentContent, reason, skipped: true, eventType: 'compression-rejected' });
          continue;
        }
      }

      if (row.file === MENTAL_MODEL_FILE) {
        const skipped = currentContent.trim() === row.content.trim();
        const newContent = skipped ? currentContent : row.content;
        workingContent.set(absPath, newContent);
        writes.push({
          absPath, relFile: row.file, newContent, reason: row.reason, skipped,
          eventType: skipped ? 'skipped-duplicate' : (isCompression ? 'compression' : 'memory-update')
        });
        continue;
      }

      const updated = applySectionUpdate(currentContent, row.section, row.action, row.content);
      const sectionContent = getSectionContent(currentContent, row.section);
      // The duplicate check only makes sense for additive writes. A 'replace' is an explicit,
      // full restatement of the section — narrowing "Uses Postgres 14 and Redis" down to
      // "Uses Postgres 14" must be applied, even though the new text is a substring of the old.
      // ('create-section' that degrades to an append is covered here too; on a genuinely new
      // section there is no existing content, so the check can never fire.)
      const skipped = row.action !== 'replace' && isNearDuplicate(sectionContent ?? '', row.content);
      const newContent = skipped ? currentContent : updated;
      workingContent.set(absPath, newContent);
      writes.push({
        absPath, relFile: row.file, newContent, reason: row.reason, skipped,
        eventType: skipped ? 'skipped-duplicate' : (isCompression ? 'compression' : 'memory-update')
      });
    }

    // Phase 2: apply. Every entry above already validated, so this cannot fail on content grounds.
    const applied: string[] = [];
    const skipped: string[] = [];

    for (const w of writes) {
      if (w.skipped) {
        // A dropped write is still a fact about this session — log it so `status` can show
        // that the agent proposed something and it was deduplicated (or, for compression,
        // rejected) rather than applied (spec §4).
        appendEvent(join(root, 'memory-events.jsonl'), {
          timestamp: new Date().toISOString(),
          type: w.eventType,
          summary: w.reason,
          affectedFiles: [w.relFile]
        });
        skipped.push(w.relFile);
        continue;
      }
      atomicWriteFile(w.absPath, w.newContent);
      upsertIndexEntry(join(root, 'memory-index.json'), w.relFile, w.reason);
      appendEvent(join(root, 'memory-events.jsonl'), {
        timestamp: new Date().toISOString(),
        type: w.eventType,
        summary: w.reason,
        affectedFiles: [w.relFile]
      });
      applied.push(w.relFile);
    }

    resolveCheckStopMarker(root);
    return { applied, skipped };
  });
}
