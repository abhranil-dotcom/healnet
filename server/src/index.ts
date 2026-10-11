import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server } from 'socket.io';
import type { Command, CommandResult } from '../../shared/types.js';
import { isOriginAllowed, parseAllowedOrigins } from './origins.js';
import { SimulationRunner } from './runner.js';

const PORT = Number(process.env.PORT ?? 4000);
const HOST = process.env.HOST ?? '0.0.0.0';
const allowedOrigins = parseAllowedOrigins(process.env.FRONTEND_URL);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: (origin, cb) => cb(null, isOriginAllowed(origin, allowedOrigins)),
    methods: ['GET', 'POST'],
  },
  // Snapshots are JSON; compressing them cuts bandwidth substantially.
  perMessageDeflate: { threshold: 1024 },
  httpCompression: { threshold: 1024 },
});

const runner = new SimulationRunner((snapshot) => io.emit('state', snapshot));

// Minimal CORS for the HTTP API (the dashboard itself uses Socket.IO).
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && isOriginAllowed(origin, allowedOrigins)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
  if (req.method === 'OPTIONS') {
    res.sendStatus(origin && isOriginAllowed(origin, allowedOrigins) ? 204 : 403);
    return;
  }
  next();
});

const health = (_req: express.Request, res: express.Response) => {
  res.json({ ok: true, service: 'healnet-server', uptimeSec: Math.round(process.uptime()), simTime: runner.engine.now, running: runner.engine.running });
};
app.get('/health', health);
app.get('/api/health', health);
app.get('/api/state', (_req, res) => {
  res.json(runner.engine.snapshot());
});

// Single-server mode (`npm run build && npm start`): also serve the dashboard if it was built.
const clientDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist');
if (existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get(/^(?!\/api|\/socket\.io|\/health).*/, (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
}

io.on('connection', (socket) => {
  socket.emit('state', runner.engine.snapshot());

  socket.on('command', (cmd: Command, ack?: (r: CommandResult) => void) => {
    let result: CommandResult;
    try {
      result = cmd && typeof cmd === 'object' ? runner.engine.execute(cmd) : { ok: false, error: 'Malformed command' };
    } catch (err) {
      console.error('Command failed', cmd, err);
      result = { ok: false, error: 'Internal error while executing command' };
    }
    runner.changed();
    if (typeof ack === 'function') ack(result);
  });
});

runner.start();
httpServer.listen(PORT, HOST, () => {
  console.log(`HEALNET simulation server listening on http://${HOST}:${PORT}`);
  console.log(`Allowed frontend origins: ${allowedOrigins.join(', ')}`);
});

// Render sends SIGTERM on every deploy/restart: stop the simulation loop and close sockets cleanly.
let shuttingDown = false;
const shutdown = (signal: string) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received, shutting down`);
  runner.stop();
  io.close(() => process.exit(0)); // also closes the HTTP server
  setTimeout(() => process.exit(0), 5000).unref();
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
