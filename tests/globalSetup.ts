import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// tests/cliBinary.test.ts spawns `node dist/cli.js` as a real child process. Building here
// guarantees dist/ reflects the current src/ — a stale dist/ would let those tests pass
// against code that no longer exists.
//
// Runs the real `npm run build` script, not a hand-rolled `tsc` invocation - this used to call
// tsc directly, which produced a dist/cli.js with the executable bit stripped (tsc doesn't
// preserve it), a real bug that broke the actual `memoryintel` bin symlink for real users but
// was invisible here, since `node dist/cli.js` never needed that bit and the test suite's own
// build path never matched what a real `npm run build` produces. Shelling out to the real
// script keeps this genuinely in sync with it going forward, not just for this one fix.
export default function setup(): void {
  const projectRoot = fileURLToPath(new URL('..', import.meta.url));
  // execFileSync('npm', ...) fails with ENOENT on Windows: the real executable there is
  // npm.cmd, and execFileSync (unlike a shell) doesn't apply PATHEXT resolution to find it.
  // shell: true runs the command through the platform shell (cmd.exe on Windows, /bin/sh
  // elsewhere), which resolves npm -> npm.cmd correctly. Caught by CI's Windows job.
  execFileSync('npm', ['run', 'build'], { cwd: projectRoot, stdio: 'inherit', shell: true });
}
