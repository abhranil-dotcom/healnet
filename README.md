# HEALNET — Intelligent Network Recovery Simulator

A software-only simulator that demonstrates how a communication network **detects failures with heartbeats** and **automatically recovers with BFS re-routing**, with CRC-protected packets, live animation and simulation-derived metrics.

```
        B
      /   \          primary route : A → B → C
    A       C        backup route  : A → D → C
      \   /
        D
```

## Requirements

- Node.js 20 or newer (tested with Node 24) and npm

## Local development

```bash
npm install        # installs root, server and client workspaces (run from the repo root)
npm run dev        # simulation server on :4000 + dashboard on :5173
```

Open **http://localhost:5173**. In development the dashboard connects straight to `http://localhost:4000`; no `.env` file is needed.

| Command (repo root) | What it does |
|---|---|
| `npm run dev` | Server (`tsx watch`) + Vite dev server, side by side |
| `npm test` | Vitest suite: BFS, unreachable destinations, failure detection, recovery, CRC, demo, CORS origins |
| `npm run typecheck` | TypeScript checks for server and client |
| `npm run build` then `npm start` | Single-server mode: the Express server also serves the built dashboard at **http://localhost:4000** |

### Environment variables

| Variable | Where | Default | Purpose |
|---|---|---|---|
| `VITE_API_URL` | client (build time) | `http://localhost:4000` in dev, page origin in a production build | Base URL for HTTP requests (`/health` wake-up ping) |
| `VITE_SOCKET_URL` | client (build time) | same as `VITE_API_URL` | Socket.IO server URL; `https://…` automatically uses secure WebSockets (`wss://`) |
| `PORT` | server | `4000` | Listen port (Render sets it automatically) |
| `HOST` | server | `0.0.0.0` | Listen address |
| `FRONTEND_URL` | server | — | Comma-separated frontend origins allowed by CORS / Socket.IO. `http://localhost:5173` and `:4173` are always allowed. `*` wildcards are supported, e.g. `https://healnet-*.vercel.app` |
| `MAX_SESSIONS` | server | `20` | Maximum simultaneous simulations (one per browser tab). When full, idle sessions are evicted first; otherwise new tabs are refused with a "server busy" message |
| `SESSION_IDLE_MINUTES` | server | `10` | A simulation with no open tab is deleted after this many minutes |

Templates: `client/.env.example`, `server/.env.example`. Vite embeds `VITE_*` values **at build time**, so changing them requires a rebuild/redeploy. The server reads real environment variables only; it does not load `.env` files.

Server endpoints:
- `GET /health` (also `/api/health`) → `{"ok": true, "sessions": n, "maxSessions": m, ...}`
- `GET /api/state?session=<id>` → that tab's snapshot. Without `session` it returns the initial state of a new simulation.
- `GET /api/presets` → the topology presets and validation limits.
- Socket.IO on `/socket.io`.

## Deployment (Vercel frontend + Render backend)

The repo is an npm-workspaces monorepo. Both platforms build from a subdirectory, and npm installs from the root `package-lock.json` automatically. Nothing under `shared/` is needed at runtime (type-only imports). Push the whole repository to GitHub/GitLab first: both services deploy from a Git repo.

### 1. Backend on Render (deploy this first)

Create a **Web Service** from the repo:

| Setting | Value |
|---|---|
| Language / Runtime | Node |
| Root Directory | `server` |
| Build Command | `npm ci` |
| Start Command | `npm start` |
| Health Check Path | `/health` |
| Instance count | **1** (simulation state lives in memory; do not scale out) |

Environment variables:

| Key | Value |
|---|---|
| `FRONTEND_URL` | your Vercel URL, e.g. `https://healnet.vercel.app` (add `,https://healnet-*.vercel.app` to also allow preview deployments) |
| `NODE_VERSION` *(optional)* | e.g. `22`. The `engines` field already requires Node ≥ 20 |

Do **not** set `PORT`; Render provides it. After deploy, open `https://<your-service>.onrender.com/health`; it should return `{"ok":true,...}`.

### 2. Frontend on Vercel

Import the same repo as a new project:

| Setting | Value |
|---|---|
| Framework Preset | Vite |
| Root Directory | `client` (keep "Include files outside the root directory" enabled, which is the default) |
| Build Command | `npm run build` |
| Output Directory | `dist` |
| Install Command | default (`npm install`) |

Environment variables (Production, and Preview if you use it):

| Key | Value |
|---|---|
| `VITE_API_URL` | `https://<your-service>.onrender.com` |
| `VITE_SOCKET_URL` | `https://<your-service>.onrender.com` |

No trailing slash is needed. After changing these, **redeploy**: they are baked in at build time.

### 3. Connect them

Once Vercel gives you the final URL, set `FRONTEND_URL` on Render to exactly that origin (scheme + host, no path) and let Render redeploy. If the dashboard stays on "Connecting…", the browser console usually shows a CORS error naming the origin that needs to be added.

### Production notes

- **One simulation per browser tab.** Each tab sends a random session id (kept in its `sessionStorage`), so visitors cannot affect each other and a reload returns to the same simulation. Simulations live in memory: they are lost when the server restarts or redeploys (the tab then starts a fresh one), and are limited by `MAX_SESSIONS`.
- **Render free tier sleeps** after ~15 minutes without traffic. The first visit can take up to a minute: the dashboard pings `/health` to wake it and keeps retrying the socket with backoff.
- The server uses a single guarded simulation loop. It handles Render's `SIGTERM` by stopping the loop and closing sockets before exiting. Socket.IO messages are compressed (per-message deflate).

## Using the dashboard

1. Press **Run Demo** for the full scripted scenario. The demo resets the network, delivers packets over A → B → C, fails Node B, waits for heartbeat detection, re-routes with BFS to A → D → C, resumes delivery and prints the measured result. You can stop it or reset at any time.
2. To experiment manually, press **Start**. Auto-traffic sends one DATA packet per second by default.
   - **Click a node or link** in the topology, or use the *Fault injection* panel, to fail/restore nodes and cut/reconnect links.
   - **Send 1 / Send 5** sends TEST packets from A to C. **Send corrupted packet** flips one payload bit in transit so the next node's CRC check rejects it.
   - **Detection & traffic** sets the heartbeat interval, the missed-heartbeat threshold and the auto-traffic rate.
3. The **Event log** shows every heartbeat miss, detection, BFS run (excluded elements, visit order, result), route change, delivery, loss and CRC failure, timestamped in simulated time.

## How it works

### Ground truth vs. detected state
Every node and link has two states:

- **Ground truth** (`actualUp`) is what you physically did, e.g. powering off B.
- **Detected status** (`ACTIVE / SUSPECT / FAILED`, `UP / SUSPECT / DOWN`) is what the network has *learned* from heartbeats.

Packets obey ground truth, so a dead node really drops them. **Routing only uses the detected state.** The gap between the two is the failure-detection window, so packets sent into a failed node before detection are genuinely lost. A node shows `NO ACK` while it is failed but not yet detected.

### Heartbeat failure detection (`server/src/sim/engine.ts → heartbeatRound`)
Every `heartbeatIntervalMs` a monitor probes each node, and each link's endpoints exchange a hello. A node acknowledges only if it is actually up. Each miss increments a counter: after one miss the node becomes `SUSPECT`, and after `missedThreshold` consecutive misses it is declared `FAILED`. Any change to the detected topology triggers route recomputation.

Restored nodes and links are **not trusted until they acknowledge a heartbeat**, so a restore can never silently create an invalid route. A link cut while its node was down stays `DOWN` after the node returns.

### BFS route recovery (`server/src/sim/bfs.ts`)
`buildGraph` removes `FAILED` nodes (with every link touching them) and `DOWN` links. `bfs()` then explores the remaining graph level by level from A with a FIFO queue and parent pointers, so the first path that reaches C has the fewest hops. If BFS finds no path, the dashboard shows **Communication unavailable** and packets are dropped at the source.

### CRC-16/CCITT-FALSE (`server/src/sim/crc16.ts`)
Parameters: poly `0x1021`, init `0xFFFF`, no reflection, xorout `0x0000`, check value `0x29B1` for `"123456789"`. The sender computes the CRC over `source|destination|type|seq|createdAt|payload`. **Every receiving node** recomputes it and discards the packet on a mismatch.

### Simulated time
The engine is a discrete-event simulator with no timers of its own. The server drives it from a single guarded `setInterval` (1 simulated ms = 1 real ms), and the tests drive it directly, so results are deterministic and repeatable. Link latencies are simulated: A-B and B-C are 300 ms each, A-D and D-C are 400 ms each, so the backup route is slower. Packet animation is interpolated from each hop's real departure and arrival times.

### Metrics (all simulation measurements)
| Metric | Definition |
|---|---|
| Delivery ratio | delivered ÷ (delivered + lost + CRC-rejected) |
| Packet loss | (lost + CRC-rejected) ÷ completed packets |
| Avg end-to-end delay | mean (delivery time − creation time) over delivered packets |
| Throughput | delivered packets (and payload bits) per simulated second, 5 s sliding window |
| Detection time | failure injected → failure declared by heartbeats |
| Recovery time | failure injected → new route active (detection + BFS) |
| BFS time | real wall-clock time spent inside `bfs()` (µs) |

With the default settings (1000 ms heartbeat, threshold 3), expect detection between 2 and 3 s after a failure. The exact value depends on where in the heartbeat cycle the failure happens.

## Project structure

```
shared/types.ts            Types shared by server and client (snapshot + commands)
server/src/
  index.ts                 Express + Socket.IO entry point (/health, /api/state), CORS, graceful shutdown
  origins.ts               Allowed-origin parsing for FRONTEND_URL
  sessions.ts              Per-tab sessions: limit, idle cleanup, the single real-time loop
  runner.ts                Drives one session's engine in real time + throttled snapshot broadcast
  sim/
    topology.ts            Nodes, links, latencies, weighted usable-graph builder
    validateTopology.ts    Topology validation rules and limits, automatic layout
    presets.ts             Classic, Ring, Star, Mesh 3×3, BFS-vs-Dijkstra presets
    bfs.ts                 Breadth-First Search
    dijkstra.ts            Dijkstra (minimum total latency) with deterministic ties
    routing.ts             Algorithm-neutral computeRoute + explanations
    crc16.ts               CRC-16/CCITT-FALSE
    packet.ts              Packet creation, CRC validation, corruption
    scheduler.ts           Discrete-event queue
    engine.ts              Heartbeats, detection, routing, forwarding, metrics, events
    demo.ts                Step-based one-click demo
server/tests/              Vitest tests
client/src/
  lib/config.ts            VITE_API_URL / VITE_SOCKET_URL with localhost defaults
  lib/session.ts           Per-tab simulation session id
  hooks/useSimulation.ts   Socket.IO connection (reconnect, resync) + command/ack helper
  components/              Header, summary cards, topology (React Flow), controls,
                           health panel, event log, demo progress, analytics (Recharts)
```

Communication: the server emits `state` snapshots (~10/s). The client sends `command` events (`failNode`, `sendPackets`, `runDemo`, …) and receives an `{ ok, error }` acknowledgement. Invalid operations, such as failing an already-failed node, return an error that the dashboard shows as a toast.
