import { createServer, type IncomingMessage, type Server } from 'node:http';
import { readRegistry } from './registry.js';
import { renderRegistryPage } from './views/registryPage.js';
import { renderProjectPage } from './views/projectPage.js';
import { pageShell } from './views/layout.js';
import { pickFreePort, writeDaemonHandle, clearDaemonHandle } from './daemonHandle.js';
import { readGlobalSettings, writeGlobalSettings } from './settings.js';

// Loopback binding alone isn't enough for a mutating route: any browser tab already open on
// this machine can still address 127.0.0.1:<port> regardless of which site served that tab (the
// DNS-rebinding class of attack) - only a page's own JS can be forced to send a real Origin
// header, a CLI caller like curl simply never sets one. Block only when Origin is present and
// doesn't match, never on its absence alone - that would reject every legitimate non-browser
// caller over a header browsers alone are trusted to set honestly.
const ALLOWED_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

function isSameOriginRequest(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const originUrl = new URL(origin);
    if (!ALLOWED_HOSTNAMES.has(originUrl.hostname)) return false;
    return originUrl.host === req.headers.host;
  } catch {
    return false;
  }
}

function renderStoppedPage(): string {
  return pageShell('Memory Intel — dashboard stopped', `
<div class="eyebrow">Memory Intel</div>
<h1>Dashboard stopped</h1>
<p>The shared dashboard is stopped and disabled for every Memory Intel project on this machine. Run <code>memoryintel dashboard enable</code> to turn it back on, or run any <code>memoryintel</code> command and it starts itself again the next time a project needs it.</p>
`);
}

export function createRequestHandler(server?: Server) {
  return (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://localhost');

    if (req.method === 'POST' && url.pathname === '/stop') {
      if (!isSameOriginRequest(req)) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('Forbidden: Origin does not match this server');
        return;
      }
      writeGlobalSettings({ ...readGlobalSettings(), dashboardEnabled: false });
      clearDaemonHandle();
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(renderStoppedPage(), () => {
        // Closing here, not process.exit(): this lets the response above actually finish
        // flushing to the client first, and a process.exit() call would be untestable in-process
        // (the daemon in a real deployment has nothing else keeping the event loop alive, so it
        // exits on its own once the server stops accepting connections and this request
        // completes - no explicit exit needed, and nothing abruptly drops the in-flight response
        // the way process.exit() would).
        server?.close();
      });
      return;
    }

    if (url.pathname === '/') {
      const html = renderRegistryPage(readRegistry());
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }

    if (url.pathname === '/project') {
      const path = url.searchParams.get('path');
      if (!path) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('Missing ?path=');
        return;
      }
      const typeFilter = url.searchParams.get('type') ?? undefined;
      const html = renderProjectPage(path, { typeFilter });
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  };
}

export async function startDaemon(preferredPort = 4390): Promise<{ port: number; server: Server }> {
  const port = await pickFreePort(preferredPort);
  const server = createServer();
  server.on('request', createRequestHandler(server));

  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  writeDaemonHandle({ port, pid: process.pid });

  const cleanup = () => { clearDaemonHandle(); process.exit(0); };
  process.on('SIGTERM', cleanup);
  process.on('SIGINT', cleanup);

  return { port, server };
}
