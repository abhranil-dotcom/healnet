import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server } from 'socket.io';
import type { Command, CommandResult } from '../../shared/types.js';
import { isOriginAllowed, parseAllowedOrigins } from './origins.js';
import { SessionManager } from './sessions.js';
import { SimulationEngine } from './sim/engine.js';
import { listPresets } from './sim/presets.js';
import { TOPOLOGY_LIMITS } from './sim/validateTopology.js';

const PORT = Number(process.env.PORT ?? 4000);
const HOST = process.env.HOST ?? '0.0.0.0';
const allowedOrigins = parseAllowedOrigins(process.env.FRONTEND_URL);
const positiveInt = (v: string | undefined, fallback: number) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : fallback;
};
const MAX_SESSIONS = positiveInt(process.env.MAX_SESSIONS, 20);
const SESSION_IDLE_MS = positiveInt(process.env.SESSION_IDLE_MINUTES, 10) * 60_000;

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

// Each browser tab gets its own simulation; snapshots go only to that session's sockets.
const room = (sessionId: string) => `session:${sessionId}`;
const sessions = new SessionManager((id, snapshot) => io.to(room(id)).emit('state', snapshot), {
  maxSessions: MAX_SESSIONS,
  idleTtlMs: SESSION_IDLE_MS,
});

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
  res.json({ ok: true, service: 'healnet-server', uptimeSec: Math.round(process.uptime()), sessions: sessions.size, maxSessions: sessions.maxSessions });
};
app.get('/health', health);
app.get('/api/health', health);
// Initial state of a new simulation, served when no session is named.
const initialSnapshot = new SimulationEngine().snapshot();
app.get('/api/state', (req, res) => {
  const id = req.query.session;
  if (id === undefined) return void res.json(initialSnapshot);
  const session = typeof id === 'string' ? sessions.get(id) : undefined;
  if (!session) return void res.status(404).json({ error: 'Unknown session' });
  res.json(session.runner.engine.snapshot());
});
app.get('/api/presets', (_req, res) => {
  res.json({ presets: listPresets(), limits: TOPOLOGY_LIMITS });
});

// Single-server mode (`npm run build && npm start`): also serve the dashboard if it was built.
const clientDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist');
if (existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get(/^(?!\/api|\/socket\.io|\/health).*/, (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
}

// Attach every connection to its tab's session (or refuse it when the server is full).
io.use((socket, next) => {
  const result = sessions.acquire(socket.handshake.auth?.sessionId);
  if (!result.ok) return next(new Error(result.error));
  socket.data.sessionId = result.session.id;
  next();
});

io.on('connection', (socket) => {
  const sessionId: string = socket.data.sessionId;
  void socket.join(room(sessionId));
  socket.emit('session', { id: sessionId });
  const session = sessions.get(sessionId);
  if (session) socket.emit('state', session.runner.engine.snapshot());

  socket.on('command', (cmd: Command, ack?: (r: CommandResult) => void) => {
    const s = sessions.get(sessionId);
    let result: CommandResult;
    try {
      if (!s) result = { ok: false, error: 'Session expired — reload the page' };
      else result = cmd && typeof cmd === 'object' ? s.runner.engine.execute(cmd) : { ok: false, error: 'Malformed command' };
    } catch (err) {
      console.error('Command failed', cmd, err);
      result = { ok: false, error: 'Internal error while executing command' };
    }
    sessions.changed(sessionId);
    if (typeof ack === 'function') ack(result);
  });

  socket.on('disconnect', () => sessions.release(sessionId));
});

sessions.start();
httpServer.listen(PORT, HOST, () => {
  console.log(`HEALNET simulation server listening on http://${HOST}:${PORT}`);
  console.log(`Allowed frontend origins: ${allowedOrigins.join(', ')}`);
  console.log(`Simulation sessions: max ${MAX_SESSIONS}, idle timeout ${SESSION_IDLE_MS / 60_000} min`);
});

// Render sends SIGTERM on every deploy/restart: stop the simulation loop and close sockets cleanly.
let shuttingDown = false;
const shutdown = (signal: string) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received, shutting down`);
  sessions.stop();
  io.close(() => process.exit(0)); // also closes the HTTP server
  setTimeout(() => process.exit(0), 5000).unref();
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
