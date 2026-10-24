import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { BRAND } from '@quiz/shared';
import express from 'express';
import { config } from './config';
import { db } from './db';
import { questionBank } from './questions';
import { startMaintenance } from './maintenance';
import { createRealtime } from './realtime';
import { api } from './routes/api';

questionBank(); // fail fast on a broken question file

const app = express();
app.disable('x-powered-by');
// Behind a reverse proxy (Caddy in Docker) this must trust it, or every visitor shares the proxy's IP.
app.set('trust proxy', config.trustProxy);
app.use(express.json({ limit: '20kb' }));
app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});
app.use('/api', api);

// In production the server also hosts the built web app.
if (fs.existsSync(config.webDist)) {
  const indexHtml = path.join(config.webDist, 'index.html');
  app.use(express.static(config.webDist, { index: false, maxAge: '1h' }));
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api') || req.path.startsWith('/socket.io')) return next();
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
