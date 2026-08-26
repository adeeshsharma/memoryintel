#!/usr/bin/env node
import { readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findMemoryIntelRoot } from './core/discovery.js';
import { runUpdate } from './commands/update.js';
import { runLoad } from './commands/load.js';
import { runStatus } from './commands/status.js';
import { runInit } from './commands/init.js';
import { runCheckStop } from './adapters/claudeCode.js';
import { runDashboardEnable, runDashboardDisable } from './commands/dashboardToggle.js';
import { runDaemonStart } from './commands/daemonStart.js';

export interface DispatchResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export const USAGE = `Usage: memoryintel <command> [options]

Commands:
  init [path]              Initialize .memoryintel/ in the current or given directory
  load [--domain <d>]      Print resolved memory context to stdout
  update <plan.toon|->     Apply an update-plan (file path, or - for stdin)
  status                   Print a human-readable summary of current memory state
  check-stop               Stop-hook check: emit a JSON allow/block decision
  dashboard <enable|disable>  Turn the shared local dashboard on or off
  daemon start             Run the dashboard daemon in the foreground (usually auto-started)

An update-plan row may set kind=compress to compact an oversized section; update() only applies
such a row when its target file is currently git-clean.
`;

export function dispatch(argv: string[]): DispatchResult {
  const [command] = argv;

  if (!command) {
    return { exitCode: 0, stdout: USAGE, stderr: '' };
  }

  switch (command) {
    case 'init': {
      const target = argv[1] ? join(process.cwd(), argv[1]) : process.cwd();
      runInit(target);
      return { exitCode: 0, stdout: `Initialized Memory Intel in ${join(target, '.memoryintel')}\n`, stderr: '' };
    }
    case 'load': {
      const domainFlagIndex = argv.indexOf('--domain');
      const domain = domainFlagIndex !== -1 ? argv[domainFlagIndex + 1] : undefined;
      const output = runLoad(process.cwd(), domain);
      return { exitCode: 0, stdout: output, stderr: '' };
    }
    case 'status': {
      const root = findMemoryIntelRoot(process.cwd());
      if (!root) return { exitCode: 1, stdout: '', stderr: 'No .memoryintel/ found.\n' };
      return { exitCode: 0, stdout: runStatus(root), stderr: '' };
    }
    case 'check-stop': {
      const root = findMemoryIntelRoot(process.cwd());
      if (!root) return { exitCode: 0, stdout: '', stderr: '' };
      const result = runCheckStop(root);
      return { exitCode: 0, stdout: JSON.stringify(result) + '\n', stderr: '' };
    }
    case 'dashboard': {
      const sub = argv[1];
      if (sub === 'enable') {
        runDashboardEnable();
        return { exitCode: 0, stdout: 'Dashboard enabled. It will start on the next `load` or `update` call.\n', stderr: '' };
      }
      if (sub === 'disable') {
        const result = runDashboardDisable();
        return {
          exitCode: 0,
          stdout: `Dashboard disabled${result.stopped ? ' and stopped' : ''}. This affects the shared dashboard for every Memory Intel project on this machine.\n`,
          stderr: ''
        };
      }
      return { exitCode: 1, stdout: '', stderr: 'Usage: memoryintel dashboard <enable|disable>\n' };
    }
    default:
      return { exitCode: 1, stdout: USAGE, stderr: `Unknown command: ${command}\n` };
  }
}

// Real process entrypoint — exercised by tests/cliBinary.test.ts, which spawns the built bin.
//
// Never call process.exit() here. Writes to a pipe (which is how Claude Code invokes the
// SessionStart hook) are asynchronous, and process.exit() tears the process down without
// flushing them — truncating output at the pipe buffer size (64 KB on Linux). Setting
// process.exitCode and returning lets the event loop drain stdout first.
async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const [command] = argv;

  try {
    if (command === 'daemon' && argv[1] === 'start') {
      await runDaemonStart();
      // Intentionally never resolves further — this process IS the daemon, kept alive by the
      // listening HTTP server, until `memoryintel dashboard disable` sends it SIGTERM.
      return;
    }

    if (command === 'update') {
      const root = findMemoryIntelRoot(process.cwd());
      if (!root) {
        process.stderr.write('No .memoryintel/ found.\n');
        process.exitCode = 1;
        return;
      }
      const source = argv[1] ?? '-';
      const planText = source === '-' ? readFileSync(0, 'utf-8') : readFileSync(source, 'utf-8');
      // Caught live: an agent ran bare `memoryintel update` (no plan-file argument, no piped
      // stdin) as a one-shot Bash tool call. `source` defaulted to '-' (read stdin), stdin was
      // immediately EOF, and the resulting empty planText fell through to decodeToonTable's
      // generic "Malformed TOON table header" error - true, but useless for figuring out what
      // actually went wrong. This is the one case worth naming explicitly before it gets there.
      if (planText.trim().length === 0) {
        process.stderr.write('memoryintel: No update-plan given. Pass a TOON plan file (`memoryintel update <path>`) or pipe TOON content via stdin. See .memoryintel/instructions.md for the update-plan format.\n');
        process.exitCode = 1;
        return;
      }
      const result = await runUpdate(root, planText);
      process.stdout.write(`Applied: ${result.applied.join(', ') || '(none)'}\nSkipped: ${result.skipped.join(', ') || '(none)'}\n`);
      process.exitCode = 0;
      return;
    }

    const result = dispatch(argv);
    process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    process.exitCode = result.exitCode;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`memoryintel: ${message.split('\n')[0]}\n`);
    process.exitCode = 1;
  }
}

function isDirectInvocation(): boolean {
  if (!process.argv[1]) return false;
  try {
    // process.argv[1] is the path used to invoke this file, which may be a symlink
    // (npm link, a global install's bin shim). Resolve it before comparing against
    // import.meta.url — otherwise this check silently never matches when run through any
    // linked/global binary name.
    //
    // Both sides are resolved through realpathSync, not just the argv[1] side: Node's own
    // import.meta.url for the entry script and a realpath()'d process.argv[1] aren't
    // guaranteed to agree on drive-letter casing on Windows (the entry URL doesn't necessarily
    // go through the same filesystem-canonicalization pass argv[1] gets here), and NTFS is
    // case-insensitive besides — an exact === comparison silently and permanently failed there,
    // meaning main() never ran for a process spawned this way (e.g. the daemon's own child
    // process, started via `node dist/cli.js daemon start`): no server ever bound, no error
    // either, since nothing was left to keep the event loop alive. Caught live via a real CI
    // Windows job: the daemon-spawn test found a live pid that then did nothing at all.
    const invoked = realpathSync(process.argv[1]);
    const self = realpathSync(fileURLToPath(import.meta.url));
    return process.platform === 'win32' ? invoked.toLowerCase() === self.toLowerCase() : invoked === self;
  } catch {
    return false;
  }
}

if (isDirectInvocation()) {
  main();
}
