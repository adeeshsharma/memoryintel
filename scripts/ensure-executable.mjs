#!/usr/bin/env node
// tsc doesn't preserve the executable bit on its compiled output, and Windows' cmd.exe has no
// native `chmod` command at all - a raw shell `chmod +x` in package.json's build script works on
// macOS/Linux and fails outright on Windows CI. Windows doesn't need this anyway: npm link /
// npm install -g create a .cmd shim there instead of relying on a shebang + the executable bit,
// so this is a real no-op on win32, not a skipped fix.
import { chmodSync } from 'node:fs';
import { platform } from 'node:os';
import { fileURLToPath } from 'node:url';

if (platform() !== 'win32') {
  const cliPath = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
  chmodSync(cliPath, 0o755);
}
