import fs from 'node:fs';
import type { Server } from 'node:http';

/**
 * The tests' server, when REQUEST_LOG names a file: every connection that opens and closes, and every request in and
 * out, a JSON line each. When a browser waits on a page that never comes (WebKit's page.goto in CI, a dozen times a
 * week), it tells whether the request ever reached the server, and on which connection. Never in production:
 * docker-compose.yml doesn't pass it.
 */
export function logRequests(server: Server, file: string) {
  const log = fs.createWriteStream(file, { flags: 'a' });
  const write = (entry: Record<string, unknown>) => log.write(`${JSON.stringify({ at: Date.now(), ...entry })}\n`);
  let opened = 0;
  server.on('connection', (socket) => {
    const connection = ++opened;
    write({ connection, port: socket.remotePort });
    socket.on('close', () => write({ closed: connection }));
  });
  server.on('upgrade', (req) => write({ upgrade: req.url, port: req.socket.remotePort }));
  server.on('request', (req, res) => {
    const start = Date.now();
    const what = `${req.method} ${req.url}`;
    const port = req.socket.remotePort;
    write({ in: what, port });
    res.on('finish', () => write({ out: what, port, status: res.statusCode, ms: Date.now() - start }));
    res.on('close', () => {
      if (!res.writableFinished) write({ aborted: what, port, ms: Date.now() - start });
    });
  });
}
