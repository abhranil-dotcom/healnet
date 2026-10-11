import type {
  BfsTrace,
  Command,
  CommandResult,
  EventKind,
  EventLevel,
  InFlightPacket,
  LinkId,
  LinkStatus,
  MetricSample,
  Metrics,
  NodeId,
  NodeStatus,
  Packet,
  PacketRecord,
  PacketType,
  RecoveryRecord,
  RouteTrace,
  SimConfig,
  SimEvent,
  SimSnapshot,
  SystemStatus,
} from '../../../shared/types.js';
import { formatCrc } from './crc16.js';
import { DemoRunner } from './demo.js';
import { corruptPacket, createPacket, validatePacket } from './packet.js';
import { ALGORITHM_LABEL, computeRoute, isRoutingAlgorithm } from './routing.js';
import { Scheduler } from './scheduler.js';
import { buildGraph, defaultTopology, linkId, pathCost, type LinkDef, type TopologyDef } from './topology.js';

export const DEFAULT_CONFIG: SimConfig = {
  routingAlgorithm: 'BFS',
  heartbeatIntervalMs: 1000,
  missedThreshold: 3,
  trafficIntervalMs: 1000,
};

const MAX_EVENTS = 500;
const MAX_PACKET_RECORDS = 300;
const MAX_SERIES = 180;
const THROUGHPUT_WINDOW_MS = 5000;
const SAMPLE_INTERVAL_MS = 1000;
const INITIAL_DISCOVERY = 'initial route discovery';

interface NodeState {
  id: NodeId;
  actualUp: boolean; // ground truth, changed only by the user
  failedAt: number | null; // ground-truth failure time (for measuring detection)
  status: NodeStatus; // network's belief, changed only by heartbeats
  missed: number;
  lastAckAt: number | null;
}

interface LinkState {
  def: LinkDef;
  actualUp: boolean;
  failedAt: number | null;
  status: LinkStatus;
  missed: number;
  downLogged: boolean;
}

/** A failure that broke the active route and has not been recovered yet. */
interface Disruption {
  cause: string;
  componentId: string;
  failedAt: number;
  detectedAt: number | null;
  oldRoute: NodeId[];
}

interface Flight {
  packet: Packet;
  hop: number; // index into packet.path of the sending node
  corruptOnFirstHop: boolean;
  view: InFlightPacket;
}

const fmtRoute = (r: NodeId[] | null) => (r ? r.join(' → ') : 'none');
const sameRoute = (a: NodeId[] | null, b: NodeId[] | null) =>
  a === b || (a !== null && b !== null && a.join() === b.join());

/**
 * HEALNET simulation engine.
 *
 * The engine keeps two views of the network:
 *   - ground truth (`actualUp`): what the user physically did (fail a node, pull a link)
 *   - detected state (`status`): what the network has learned from heartbeats
 *
 * Packets obey ground truth (a dead node really drops packets) while routing
 * only uses the detected state. That gap is the failure-detection window that
 * heartbeats and BFS recovery are designed to close.
 *
 * The engine has no real timers. `advance(ms)` moves simulated time forward
 * and runs every scheduled event in order; the server calls it from a single
 * interval, and the tests call it directly.
 */
export class SimulationEngine {
  readonly topo: TopologyDef;
  readonly flow = { source: 'A', destination: 'C' };
  readonly primaryRoute: NodeId[] = ['A', 'B', 'C'];
  config: SimConfig;

  now = 0;
  running = false;
  activeRoute: NodeId[] | null = null;
  demo: DemoRunner | null = null;

  nodes = new Map<NodeId, NodeState>();
  links = new Map<LinkId, LinkState>();
  packets: PacketRecord[] = [];
  events: SimEvent[] = [];
  series: MetricSample[] = [];
  lastBfs: BfsTrace | null = null;
  lastRoute: RouteTrace | null = null;
  recoveries: RecoveryRecord[] = [];

  private scheduler = new Scheduler();
  private flights = new Map<number, Flight>();
  private disruption: Disruption | null = null;
  private deliveries: { at: number; bits: number; delay: number; seq: number; route: string }[] = [];
  private counters = { sent: 0, delivered: 0, lost: 0, crcRejected: 0, totalDelay: 0 };
  private nextPacketId = 1;
  private nextSeq = 1;
  private nextEventId = 1;
  private demoConfigBackup: SimConfig | null = null;

  constructor(config: Partial<SimConfig> = {}, topo: TopologyDef = defaultTopology()) {
    this.topo = topo;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.reset();
  }

  // ───────────────────────────── lifecycle ─────────────────────────────

  reset(): void {
    if (this.demoConfigBackup) this.config = this.demoConfigBackup;
    this.demoConfigBackup = null;
    this.demo = null;
    this.now = 0;
    this.running = false;
    this.scheduler = new Scheduler();
    this.flights.clear();
    this.disruption = null;
    this.packets = [];
    this.events = [];
    this.series = [];
    this.deliveries = [];
    this.recoveries = [];
    this.lastBfs = null;
    this.lastRoute = null;
    this.counters = { sent: 0, delivered: 0, lost: 0, crcRejected: 0, totalDelay: 0 };
    this.nextPacketId = 1;
    this.nextSeq = 1;
    this.activeRoute = null;

    this.nodes.clear();
    for (const id of this.topo.nodes) {
      this.nodes.set(id, { id, actualUp: true, failedAt: null, status: 'ACTIVE', missed: 0, lastAckAt: null });
    }
    this.links.clear();
    for (const def of this.topo.links) {
      this.links.set(def.id, { def, actualUp: true, failedAt: null, status: 'UP', missed: 0, downLogged: false });
    }

    this.log('INIT', 'info', `Network initialized: ${this.topo.nodes.length} nodes, ${this.topo.links.length} links`);
    this.recomputeRoute(INITIAL_DISCOVERY);

    this.scheduler.schedule(this.config.heartbeatIntervalMs, () => this.heartbeatRound());
    this.scheduler.schedule(SAMPLE_INTERVAL_MS, () => this.sampleMetrics());
    this.scheduleTraffic(this.config.trafficIntervalMs || 500);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.log('USER', 'info', 'Simulation started');
  }

  pause(): void {
    if (!this.running) return;
    this.running = false;
    this.log('USER', 'info', 'Simulation paused');
  }

  /** Advance simulated time by `ms`, running every event that falls due. */
  advance(ms: number): void {
    if (!this.running) return;
    const target = this.now + ms;
    for (let ev = this.scheduler.popDue(target); ev; ev = this.scheduler.popDue(target)) {
      this.now = ev.time;
      ev.run();
      this.demo?.update(this);
      if (!this.running) return; // paused by an event (e.g. demo finished)
    }
    this.now = target;
    this.demo?.update(this);
  }

  // ───────────────────────────── heartbeats ─────────────────────────────

  /**
   * One heartbeat round. The monitor probes every node; a node acknowledges
   * only if it is actually up. Each link endpoint pair also exchanges a hello,
   * which succeeds only if the cable and both endpoints are up. After
   * `missedThreshold` consecutive misses the component is declared failed.
   */
  private heartbeatRound(): void {
    const threshold = this.config.missedThreshold;
    let topologyChanged = false;

    for (const node of this.nodes.values()) {
      if (node.actualUp) {
        node.lastAckAt = this.now;
        node.missed = 0;
        if (node.status === 'FAILED') {
          node.status = 'ACTIVE';
          topologyChanged = true;
          this.log('NODE_RESTORED', 'success', `Node ${node.id} acknowledged heartbeat — marked ACTIVE`);
        } else {
          node.status = 'ACTIVE';
        }
        continue;
      }
      if (node.status === 'FAILED') continue;
      node.missed++;
      this.log('HEARTBEAT_MISSED', 'warn', `Heartbeat missed: Node ${node.id} (${node.missed}/${threshold})`);
      if (node.missed >= threshold) {
        node.status = 'FAILED';
        topologyChanged = true;
        const after = node.failedAt !== null ? ` ${this.now - node.failedAt} ms after failure` : '';
        this.log('NODE_FAILED', 'error', `Node failure detected: ${node.id} — ${threshold} consecutive heartbeats missed (detected${after})`);
        this.markDetected(`node:${node.id}`);
      } else {
        node.status = 'SUSPECT';
      }
    }

    const missedLinks: string[] = [];
    for (const link of this.links.values()) {
      const endpointsUp = this.nodes.get(link.def.a)!.actualUp && this.nodes.get(link.def.b)!.actualUp;
      if (link.actualUp && endpointsUp) {
        link.missed = 0;
        if (link.status === 'DOWN') {
          topologyChanged = true;
          if (link.downLogged) this.log('LINK_UP', 'success', `Link ${link.def.id} hello received — link UP`);
        }
        link.status = 'UP';
        link.downLogged = false;
        continue;
      }
      if (link.status === 'DOWN') continue;
      link.missed++;
      // A dead endpoint is already reported by its node heartbeat; only log real cable faults.
      const cableFault = !link.actualUp && endpointsUp;
      if (cableFault) missedLinks.push(link.def.id);
      if (link.missed >= threshold) {
        link.status = 'DOWN';
        topologyChanged = true;
        if (cableFault) {
          link.downLogged = true;
          this.log('LINK_DOWN', 'error', `Link failure detected: ${link.def.id} — ${threshold} consecutive hellos missed`);
          this.markDetected(`link:${link.def.id}`);
        }
      } else {
        link.status = 'SUSPECT';
      }
    }
    if (missedLinks.length > 0) {
      const counts = missedLinks.map((id) => `${id} (${this.links.get(id)!.missed}/${threshold})`).join(', ');
      this.log('HEARTBEAT_MISSED', 'warn', `Link hello missed: ${counts}`);
    }

    if (topologyChanged) this.recomputeRoute('topology change detected by heartbeats');
    this.scheduler.schedule(this.now + this.config.heartbeatIntervalMs, () => this.heartbeatRound());
  }

  private markDetected(componentId: string): void {
    if (this.disruption && this.disruption.componentId === componentId && this.disruption.detectedAt === null) {
      this.disruption.detectedAt = this.now;
    }
  }

  // ───────────────────────────── routing ─────────────────────────────

  /** Rebuild the usable graph from *detected* state and run the configured routing algorithm. */
  private recomputeRoute(reason: string): void {
    const excludedNodes = new Set([...this.nodes.values()].filter((n) => n.status === 'FAILED').map((n) => n.id));
    const excludedLinks = new Set([...this.links.values()].filter((l) => l.status === 'DOWN').map((l) => l.def.id));
    const graph = buildGraph(this.topo, excludedNodes, excludedLinks);

    const algorithm = this.config.routingAlgorithm;
    const result = computeRoute(algorithm, graph, this.flow.source, this.flow.destination);
    const trace: RouteTrace = {
      ...result,
      at: this.now,
      excludedNodes: [...excludedNodes],
      excludedLinks: [...excludedLinks],
    };
    this.lastRoute = trace;
    // Legacy field for older clients: describes the latest route computation.
    this.lastBfs = { at: trace.at, visitOrder: trace.visitOrder, path: trace.path, excludedNodes: trace.excludedNodes, excludedLinks: trace.excludedLinks };

    const excluded = [...excludedNodes, ...excludedLinks];
    if (algorithm === 'BFS') {
      this.log(
        'BFS',
        'info',
        `BFS executed (${reason}): excluded [${excluded.join(', ') || 'none'}], visit order ${result.visitOrder.join(', ') || '—'} → ` +
          (result.path ? `path ${fmtRoute(result.path)}` : 'no path'),
      );
    } else {
      const settled = (result.dijkstraSteps ?? []).map((st) => `${st.node}(${st.cost})`).join(', ') || '—';
      this.log(
        'DIJKSTRA',
        'info',
        `Dijkstra executed (${reason}): excluded [${excluded.join(', ') || 'none'}], settled ${settled} → ` +
          (result.path ? `path ${fmtRoute(result.path)}, cost ${result.cost} ms` : 'no path'),
      );
    }

    const oldRoute = this.activeRoute;
    if (sameRoute(oldRoute, result.path)) return;
    this.activeRoute = result.path;

    if (!result.path) {
      this.log('NO_ROUTE', 'error', `Communication unavailable: no path from ${this.flow.source} to ${this.flow.destination}`);
      return;
    }
    if (oldRoute === null && reason === INITIAL_DISCOVERY) {
      this.log('ROUTE_CHANGED', 'success', `Route established: ${fmtRoute(result.path)}`);
      return;
    }
    this.log('ROUTE_CHANGED', 'info', `Route changed: ${fmtRoute(oldRoute)} ⇒ ${fmtRoute(result.path)}`);

    if (this.disruption && this.disruption.detectedAt === null) {
      // The route moved for another reason (e.g. an algorithm switch) before heartbeats detected
      // the failure. That is not a recovery: keep waiting if the new route still uses the failed
      // component, otherwise the failure no longer affects the active route.
      const d = this.disruption;
      const [kind, id] = d.componentId.split(':');
      const stillAffected = kind === 'node' ? this.routeUsesNode(id) : this.routeUsesLink(id);
      if (!stillAffected) {
        this.log('ROUTE_CHANGED', 'info', `${d.cause} failure no longer on the active route (${reason}) before it was detected — not counted as a recovery`);
        this.disruption = null;
      }
      return;
    }

    if (this.disruption) {
      const d = this.disruption;
      const rec: RecoveryRecord = {
        cause: d.cause,
        failedAt: d.failedAt,
        detectedAt: d.detectedAt ?? this.now,
        recoveredAt: this.now,
        recoveryMs: this.now - d.failedAt,
        detectionMs: (d.detectedAt ?? this.now) - d.failedAt,
        algorithm,
        computeMicros: result.computeMicros,
        bfsMicros: result.computeMicros,
        oldRoute: d.oldRoute,
        newRoute: result.path,
      };
      this.recoveries.push(rec);
      this.disruption = null;
      this.log(
        'RECOVERY',
        'success',
        `Recovery completed: ${rec.cause} failure → ${fmtRoute(rec.newRoute)} in ${rec.recoveryMs} ms (detection ${rec.detectionMs} ms, ${ALGORITHM_LABEL[algorithm]} ${rec.computeMicros} µs)`,
      );
    }
  }

  private routeUsesNode(id: NodeId): boolean {
    return !!this.activeRoute?.includes(id);
  }

  private routeUsesLink(id: LinkId): boolean {
    const r = this.activeRoute;
    if (!r) return false;
    for (let i = 0; i < r.length - 1; i++) if (linkId(r[i], r[i + 1]) === id) return true;
    return false;
  }

  // ───────────────────────────── failure controls ─────────────────────────────

  failNode(id: NodeId): CommandResult {
    const node = this.nodes.get(id);
    if (!node) return { ok: false, error: `Unknown node "${id}"` };
    if (!node.actualUp) return { ok: false, error: `Node ${id} is already failed` };
    node.actualUp = false;
    node.failedAt = this.now;
    this.log('USER', 'warn', `Fault injected: Node ${id} powered off (heartbeat acks stop)`);
    if (this.routeUsesNode(id) && !this.disruption) {
      this.disruption = { cause: `Node ${id}`, componentId: `node:${id}`, failedAt: this.now, detectedAt: null, oldRoute: [...this.activeRoute!] };
    }
    return { ok: true };
  }

  restoreNode(id: NodeId): CommandResult {
    const node = this.nodes.get(id);
    if (!node) return { ok: false, error: `Unknown node "${id}"` };
    if (node.actualUp) return { ok: false, error: `Node ${id} is already running` };
    node.actualUp = true;
    node.failedAt = null;
    // The node is NOT trusted for routing until it acknowledges a heartbeat.
    this.log('USER', 'info', `Node ${id} powered on — waiting for heartbeat acknowledgement before reuse`);
    this.clearUndetectedDisruption(`node:${id}`);
    return { ok: true };
  }

  disconnectLink(id: LinkId): CommandResult {
    const link = this.links.get(id);
    if (!link) return { ok: false, error: `Unknown link "${id}"` };
    if (!link.actualUp) return { ok: false, error: `Link ${id} is already disconnected` };
    link.actualUp = false;
    link.failedAt = this.now;
    this.log('USER', 'warn', `Fault injected: Link ${id} disconnected`);
    if (this.routeUsesLink(id) && !this.disruption) {
      this.disruption = { cause: `Link ${id}`, componentId: `link:${id}`, failedAt: this.now, detectedAt: null, oldRoute: [...this.activeRoute!] };
    }
    return { ok: true };
  }

  reconnectLink(id: LinkId): CommandResult {
    const link = this.links.get(id);
    if (!link) return { ok: false, error: `Unknown link "${id}"` };
    if (link.actualUp) return { ok: false, error: `Link ${id} is already connected` };
    link.actualUp = true;
    link.failedAt = null;
    this.log('USER', 'info', `Link ${id} reconnected — waiting for hello before reuse`);
    this.clearUndetectedDisruption(`link:${id}`);
    return { ok: true };
  }

  /** A component repaired before anyone noticed it failing never caused a route change. */
  private clearUndetectedDisruption(componentId: string): void {
    if (this.disruption?.componentId === componentId && this.disruption.detectedAt === null) {
      this.log('USER', 'info', `${this.disruption.cause} repaired before the failure was detected — no reroute needed`);
      this.disruption = null;
    }
  }

  // ───────────────────────────── packets ─────────────────────────────

  sendPacket(type: PacketType = 'TEST', corrupt = false): PacketRecord {
    const seq = this.nextSeq++;
    const id = this.nextPacketId++;
    const { source, destination } = this.flow;
    const payload = corrupt ? `Corrupted test frame #${seq}` : type === 'DATA' ? `Telemetry reading #${seq}` : `Test packet #${seq}`;
    this.counters.sent++;

    const record: PacketRecord = {
      id, seq, type, state: 'IN_FLIGHT', path: this.activeRoute ? [...this.activeRoute] : [],
      createdAt: this.now, finishedAt: null, delayMs: null,
    };
    this.pushRecord(record);

    if (!this.activeRoute) {
      this.counters.lost++;
      this.finishPacket(record, 'LOST', `no route ${source} → ${destination}`);
      this.log('PACKET_LOST', 'error', `Packet #${seq} dropped at ${source}: no route to ${destination}`);
      return record;
    }

    const packet = createPacket({ id, seq, type, source, destination, payload, createdAt: this.now, path: [...this.activeRoute] });
    this.log(
      'PACKET_SENT',
      'info',
      `Packet #${seq} (${type}${corrupt ? ', will be corrupted in transit' : ''}) sent via ${fmtRoute(packet.path)} — CRC ${formatCrc(packet.crc)}`,
    );
    this.transmitHop({ packet, hop: 0, corruptOnFirstHop: corrupt, view: null! }, record);
    return record;
  }

  private transmitHop(flight: Flight, record: PacketRecord): void {
    const from = flight.packet.path[flight.hop];
    const to = flight.packet.path[flight.hop + 1];
    const link = this.links.get(linkId(from, to))!;

    if (!this.nodes.get(from)!.actualUp) return this.dropPacket(flight, record, `Node ${from} is down`);
    if (!link.actualUp) return this.dropPacket(flight, record, `link ${link.def.id} is disconnected`);

    flight.view = {
      id: flight.packet.id, seq: flight.packet.seq, type: flight.packet.type,
      from, to, departAt: this.now, arriveAt: this.now + link.def.latencyMs,
      corrupted: flight.corruptOnFirstHop && flight.hop === 0,
    };
    this.flights.set(flight.packet.id, flight);
    this.scheduler.schedule(flight.view.arriveAt, () => this.receiveHop(flight, record));
  }

  private receiveHop(flight: Flight, record: PacketRecord): void {
    this.flights.delete(flight.packet.id);
    const { from, to } = flight.view;
    const link = this.links.get(linkId(from, to))!;

    if (!link.actualUp) return this.dropPacket(flight, record, `link ${link.def.id} cut during transmission`);
    if (!this.nodes.get(to)!.actualUp) return this.dropPacket(flight, record, `next hop ${to} is down`);

    if (flight.view.corrupted) flight.packet = corruptPacket(flight.packet);

    // Every receiving node verifies the CRC before accepting the frame.
    const check = validatePacket(flight.packet);
    if (!check.valid) {
      this.counters.crcRejected++;
      this.finishPacket(record, 'REJECTED', `CRC mismatch at ${to}`);
      this.log(
        'CRC_FAILED',
        'error',
        `CRC validation failed at ${to}: packet #${flight.packet.seq} carries ${formatCrc(check.expected)}, computed ${formatCrc(check.computed)} — discarded`,
      );
      return;
    }

    if (to === flight.packet.destination) {
      const delay = this.now - flight.packet.createdAt;
      this.counters.delivered++;
      this.counters.totalDelay += delay;
      const route = flight.packet.path.join('-');
      this.deliveries.push({ at: this.now, bits: new TextEncoder().encode(flight.packet.payload).length * 8, delay, seq: flight.packet.seq, route });
      this.finishPacket(record, 'DELIVERED');
      this.log('PACKET_DELIVERED', 'success', `Packet #${flight.packet.seq} delivered to ${to} via ${fmtRoute(flight.packet.path)} in ${delay} ms — CRC OK`);
      return;
    }

    flight.hop++;
    this.transmitHop(flight, record);
  }

  private dropPacket(flight: Flight, record: PacketRecord, reason: string): void {
    this.flights.delete(flight.packet.id);
    this.counters.lost++;
    this.finishPacket(record, 'LOST', reason);
    this.log('PACKET_LOST', 'error', `Packet #${flight.packet.seq} lost: ${reason}`);
  }

  private finishPacket(record: PacketRecord, state: PacketRecord['state'], reason?: string): void {
    record.state = state;
    record.finishedAt = this.now;
    if (state === 'DELIVERED') record.delayMs = this.now - record.createdAt;
    if (reason) record.reason = reason;
  }

  private pushRecord(record: PacketRecord): void {
    this.packets.push(record);
    if (this.packets.length > MAX_PACKET_RECORDS) this.packets.shift();
  }

  private scheduleTraffic(delay: number): void {
    this.scheduler.schedule(this.now + delay, () => {
      if (this.config.trafficIntervalMs > 0) this.sendPacket('DATA');
      this.scheduleTraffic(this.config.trafficIntervalMs || 500);
    });
  }

  get inFlightCount(): number {
    return this.flights.size;
  }

  // ───────────────────────────── metrics ─────────────────────────────

  getMetrics(): Metrics {
    const { sent, delivered, lost, crcRejected, totalDelay } = this.counters;
    const completed = delivered + lost + crcRejected;
    const windowStart = this.now - THROUGHPUT_WINDOW_MS;
    const windowSec = Math.max(Math.min(this.now, THROUGHPUT_WINDOW_MS), 1) / 1000;
    const recent = this.deliveries.filter((d) => d.at > windowStart);
    return {
      sent,
      delivered,
      lost,
      crcRejected,
      inFlight: this.flights.size,
      deliveryRatio: completed ? (delivered / completed) * 100 : null,
      lossPercent: completed ? ((lost + crcRejected) / completed) * 100 : null,
      avgDelayMs: delivered ? totalDelay / delivered : null,
      throughputPps: recent.length / windowSec,
      throughputBps: recent.reduce((s, d) => s + d.bits, 0) / windowSec,
      lastRecovery: this.recoveries.at(-1) ?? null,
      recoveries: [...this.recoveries],
    };
  }

  private sampleMetrics(): void {
    const m = this.getMetrics();
    this.series.push({ t: this.now, throughputPps: m.throughputPps, delivered: m.delivered, lost: m.lost + m.crcRejected, avgDelayMs: m.avgDelayMs });
    if (this.series.length > MAX_SERIES) this.series.shift();
    if (this.deliveries.length > 1000) this.deliveries.splice(0, this.deliveries.length - 1000);
    this.scheduler.schedule(this.now + SAMPLE_INTERVAL_MS, () => this.sampleMetrics());
  }

  systemStatus(): SystemStatus {
    if (!this.activeRoute) return 'UNAVAILABLE';
    const suspect = [...this.nodes.values()].some((n) => n.status === 'SUSPECT') || [...this.links.values()].some((l) => l.status === 'SUSPECT');
    if (suspect || this.disruption) return 'DETECTING';
    const failed = [...this.nodes.values()].some((n) => n.status === 'FAILED') || [...this.links.values()].some((l) => l.status === 'DOWN');
    return failed ? 'DEGRADED' : 'OPERATIONAL';
  }

  // ───────────────────────────── commands / snapshot ─────────────────────────────

  setConfig(cfg: Partial<SimConfig>): CommandResult {
    const next = { ...this.config, ...cfg };
    if (!isRoutingAlgorithm(next.routingAlgorithm)) return { ok: false, error: 'Routing algorithm must be BFS or DIJKSTRA' };
    if (!Number.isFinite(next.heartbeatIntervalMs) || next.heartbeatIntervalMs < 200 || next.heartbeatIntervalMs > 5000)
      return { ok: false, error: 'Heartbeat interval must be between 200 and 5000 ms' };
    if (!Number.isInteger(next.missedThreshold) || next.missedThreshold < 1 || next.missedThreshold > 10)
      return { ok: false, error: 'Missed-heartbeat threshold must be an integer from 1 to 10' };
    if (!Number.isFinite(next.trafficIntervalMs) || (next.trafficIntervalMs !== 0 && (next.trafficIntervalMs < 200 || next.trafficIntervalMs > 10000)))
      return { ok: false, error: 'Traffic interval must be 0 (off) or between 200 and 10000 ms' };
    if (this.demo?.running) return { ok: false, error: 'Stop the demo before changing configuration' };
    const algorithmChanged = next.routingAlgorithm !== this.config.routingAlgorithm;
    this.config = next;
    this.log('USER', 'info', `Configuration: heartbeat ${next.heartbeatIntervalMs} ms, threshold ${next.missedThreshold}, traffic ${next.trafficIntervalMs ? next.trafficIntervalMs + ' ms' : 'off'}`);
    if (algorithmChanged) {
      this.log('USER', 'info', `Routing algorithm set to ${ALGORITHM_LABEL[next.routingAlgorithm]}`);
      this.recomputeRoute('routing algorithm changed');
    }
    return { ok: true };
  }

  runDemo(): void {
    const userConfig = this.demoConfigBackup ?? this.config;
    // The Classic demo always uses BFS. Set it before reset() so the initial route is BFS too;
    // traffic timing is switched after reset() exactly as before, keeping results identical.
    this.demoConfigBackup = null;
    this.config = { ...userConfig, routingAlgorithm: 'BFS' };
    this.reset();
    this.demoConfigBackup = userConfig;
    // Demo traffic: one DATA packet every 500 ms so the loss window is visible.
    this.config = { ...userConfig, trafficIntervalMs: 500, routingAlgorithm: 'BFS' };
    this.demo = new DemoRunner();
    this.log('DEMO', 'info', 'Demo started');
    this.start();
    this.demo.update(this);
  }

  /** Called by the demo (finish) and by the user (stop). */
  endDemo(message: string, pause: boolean): void {
    const demoAlgorithm = this.config.routingAlgorithm;
    if (this.demoConfigBackup) this.config = this.demoConfigBackup;
    this.demoConfigBackup = null;
    this.log('DEMO', 'info', message);
    if (this.config.routingAlgorithm !== demoAlgorithm) this.recomputeRoute('routing algorithm restored after demo');
    if (pause) this.pause();
  }

  execute(cmd: Command): CommandResult {
    switch (cmd.type) {
      case 'start': this.start(); return { ok: true };
      case 'pause': this.pause(); return { ok: true };
      case 'reset': this.reset(); return { ok: true };
      case 'sendPackets': {
        const count = Math.floor(Number(cmd.count));
        if (!(count >= 1 && count <= 20)) return { ok: false, error: 'Packet count must be between 1 and 20' };
        // Space a burst out by 100 ms so packets are individually visible.
        for (let i = 0; i < count; i++) this.scheduler.schedule(this.now + i * 100, () => this.sendPacket('TEST'));
        if (!this.running) this.log('USER', 'info', `${count} packet(s) queued — they will be sent when the simulation runs`);
        return { ok: true };
      }
      case 'sendCorrupted':
        this.scheduler.schedule(this.now, () => this.sendPacket('TEST', true));
        return { ok: true };
      case 'failNode': return this.failNode(cmd.nodeId);
      case 'restoreNode': return this.restoreNode(cmd.nodeId);
      case 'disconnectLink': return this.disconnectLink(cmd.linkId);
      case 'reconnectLink': return this.reconnectLink(cmd.linkId);
      case 'setConfig': return this.setConfig(cmd.config ?? {});
      case 'runDemo': this.runDemo(); return { ok: true };
      case 'stopDemo':
        if (!this.demo?.running) return { ok: false, error: 'No demo is running' };
        this.demo.stop(this);
        return { ok: true };
      default:
        return { ok: false, error: 'Unknown command' };
    }
  }

  log(kind: EventKind, level: EventLevel, message: string): void {
    this.events.push({ id: this.nextEventId++, simTime: this.now, kind, level, message });
    if (this.events.length > MAX_EVENTS) this.events.shift();
  }

  snapshot(): SimSnapshot {
    const nodeStatus = (id: NodeId) => this.nodes.get(id)!.status;
    return {
      simTime: this.now,
      running: this.running,
      systemStatus: this.systemStatus(),
      flow: { ...this.flow },
      nodes: [...this.nodes.values()].map((n) => ({ id: n.id, actualUp: n.actualUp, status: n.status, missedHeartbeats: n.missed, lastAckAt: n.lastAckAt })),
      links: [...this.links.values()].map((l) => ({
        id: l.def.id, a: l.def.a, b: l.def.b, latencyMs: l.def.latencyMs, actualUp: l.actualUp, status: l.status, missedHellos: l.missed,
        usable: l.status !== 'DOWN' && nodeStatus(l.def.a) !== 'FAILED' && nodeStatus(l.def.b) !== 'FAILED',
      })),
      activeRoute: this.activeRoute ? [...this.activeRoute] : null,
      primaryRoute: [...this.primaryRoute],
      inFlight: [...this.flights.values()].map((f) => ({ ...f.view })),
      recentPackets: this.packets.slice(-40).map((p) => ({ ...p })),
      events: this.events.slice(-150),
      metrics: this.getMetrics(),
      series: [...this.series],
      delaySamples: this.deliveries.slice(-60).map((d) => ({ seq: d.seq, delayMs: d.delay, route: d.route })),
      lastBfs: this.lastBfs,
      routing: {
        algorithm: this.config.routingAlgorithm,
        lastResult: this.lastRoute,
        activeRouteCost: this.activeRoute ? pathCost(buildGraph(this.topo), this.activeRoute) : null,
      },
      config: { ...this.config },
      demo: this.demo?.view() ?? { running: false, finished: false, steps: [], summary: null },
    };
  }
}
