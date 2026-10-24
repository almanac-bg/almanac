import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { BRAND } from '@quiz/shared';
import express from 'express';
import { config } from './config';
import { db } from './db';
import { startMaintenance } from './maintenance';
import { questionBank } from './questions';
import { createRealtime } from './realtime';
import { api } from './routes/api';
import { securityHeaders } from './security';

questionBank(); // fail fast on a broken question file

const app = express();
app.disable('x-powered-by');
// Behind a reverse proxy (Caddy in Docker) this must trust it, or every visitor shares the proxy's IP.
app.set('trust proxy', config.trustProxy);
app.use(securityHeaders);
app.use(express.json({ limit: '20kb' }));
// For uptime monitors: answers only if the database does too.
app.get('/api/health', (_req, res) => {
  try {
    db.prepare('SELECT 1').get();
    res.json({ ok: true });
  } catch {
    res.status(503).json({ ok: false });
  }
});
app.use('/api', api);

// In production the server also hosts the built web app.
if (fs.existsSync(config.webDist)) {
  const indexHtml = path.join(config.webDist, 'index.html');
  // Build files carry a content hash in their name, so they can be cached for good. A missing one is a 404,
  // never the page (a tab from an older deploy then reloads instead of running HTML as JavaScript).
  app.use(
    '/assets',
    express.static(path.join(config.webDist, 'assets'), { index: false, maxAge: '1y', immutable: true, fallthrough: false }),
  );
  app.use(express.static(config.webDist, { index: false, maxAge: '1h' }));
  app.use((req, res, next) => {
    // HEAD too: uptime monitors often check with it.
    if (!['GET', 'HEAD'].includes(req.method) || req.path.startsWith('/api') || req.path.startsWith('/socket.io')) return next();
    // The page itself always revalidates, so a new deploy is picked up on the next visit.
    res.setHeader('cache-control', 'no-cache');
    res.sendFile(indexHtml);
  });
}

const server = http.createServer(app);
const io = createRealtime(server);
startMaintenance();

server.listen(config.port, () => {
  console.log(`⚡ ${BRAND.name} server on http://localhost:${config.port}`);
});

function shutdown() {
  io.close();
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
