// Types shared between the simulation server and the dashboard client.
// Everything the client renders comes from a `SimSnapshot` produced by the server.

export type NodeId = string;
export type LinkId = string;

/** What the network *believes* about a node (decided by heartbeats). */
export type NodeStatus = 'ACTIVE' | 'SUSPECT' | 'FAILED';
/** What the network *believes* about a link (decided by link hellos). */
export type LinkStatus = 'UP' | 'SUSPECT' | 'DOWN';

export interface NodeView {
  id: NodeId;
  /** Ground truth: is the node actually powered/working? (set by the user) */
  actualUp: boolean;
  /** Network's view, driven only by heartbeat acknowledgements. */
  status: NodeStatus;
  missedHeartbeats: number;
  lastAckAt: number | null;
}

export interface LinkView {
  id: LinkId;
  a: NodeId;
  b: NodeId;
  /** Simulated one-way latency of the link in ms. */
  latencyMs: number;
  /** Ground truth: is the cable actually connected? */
  actualUp: boolean;
  /** Network's view, driven only by link hello acknowledgements. */
  status: LinkStatus;
  missedHellos: number;
  /** True when the routing layer may use this link (link UP/SUSPECT and both ends not FAILED). */
  usable: boolean;
}

export type PacketType = 'DATA' | 'TEST';
export type PacketState = 'IN_FLIGHT' | 'DELIVERED' | 'LOST' | 'REJECTED';

export interface Packet {
  id: number;
  seq: number;
  type: PacketType;
  source: NodeId;
  destination: NodeId;
  payload: string;
  createdAt: number;
  /** CRC-16/CCITT-FALSE computed by the sender over the header + payload. */
  crc: number;
  /** Source route fixed when the packet was sent. */
  path: NodeId[];
}

export interface InFlightPacket {
  id: number;
  seq: number;
  type: PacketType;
  from: NodeId;
  to: NodeId;
  departAt: number;
  arriveAt: number;
  corrupted: boolean;
}

export interface PacketRecord {
  id: number;
  seq: number;
  type: PacketType;
  state: PacketState;
  path: NodeId[];
  createdAt: number;
  finishedAt: number | null;
  delayMs: number | null;
  reason?: string;
}

export type EventLevel = 'info' | 'success' | 'warn' | 'error';
export type EventKind =
  | 'INIT'
  | 'PACKET_SENT'
  | 'PACKET_DELIVERED'
  | 'PACKET_LOST'
  | 'CRC_FAILED'
  | 'HEARTBEAT_MISSED'
  | 'NODE_FAILED'
  | 'NODE_RESTORED'
  | 'LINK_DOWN'
  | 'LINK_UP'
  | 'BFS'
  | 'DIJKSTRA'
  | 'ROUTE_CHANGED'
  | 'RECOVERY'
  | 'NO_ROUTE'
  | 'USER'
  | 'DEMO';

export interface SimEvent {
  id: number;
  simTime: number;
  kind: EventKind;
  level: EventLevel;
  message: string;
}

export interface RecoveryRecord {
  /** Component whose failure disrupted the route, e.g. "Node B" */
  cause: string;
  failedAt: number;
  detectedAt: number;
  recoveredAt: number;
  /** Failure occurrence → new route active (simulated ms). */
  recoveryMs: number;
  /** Failure occurrence → failure declared by heartbeats (simulated ms). */
  detectionMs: number;
  /** Routing algorithm that computed the new route. */
  algorithm: RoutingAlgorithm;
  /** Real wall-clock time spent inside the routing function (microseconds). */
  computeMicros: number;
  /** @deprecated Same value as `computeMicros` (kept for older clients). */
  bfsMicros: number;
  oldRoute: NodeId[] | null;
  newRoute: NodeId[];
}

export interface Metrics {
  sent: number;
  delivered: number;
  lost: number;
  crcRejected: number;
  inFlight: number;
  /** delivered / (delivered + lost + rejected), in %, null until a packet completes */
  deliveryRatio: number | null;
  lossPercent: number | null;
  avgDelayMs: number | null;
  /** Delivered packets per simulated second over the last 5 s window */
  throughputPps: number;
  /** Delivered payload bits per simulated second over the last 5 s window */
  throughputBps: number;
  lastRecovery: RecoveryRecord | null;
  recoveries: RecoveryRecord[];
}

export interface MetricSample {
  t: number;
  throughputPps: number;
  delivered: number;
  lost: number;
  avgDelayMs: number | null;
}

export interface BfsTrace {
  at: number;
  visitOrder: NodeId[];
  path: NodeId[] | null;
  excludedNodes: NodeId[];
  excludedLinks: LinkId[];
}

export type RoutingAlgorithm = 'BFS' | 'DIJKSTRA';

/** One settle step of Dijkstra's algorithm. */
export interface DijkstraStep {
  node: NodeId;
  cost: number;
  hops: number;
  via: NodeId | null;
}

/** Final row of Dijkstra's table for one node (null cost = unreachable / ∞). */
export interface DijkstraTableRow {
  node: NodeId;
  cost: number | null;
  hops: number | null;
  via: NodeId | null;
  settled: boolean;
}

/** Algorithm-neutral record of one route computation, used to explain the choice. */
export interface RouteTrace {
  algorithm: RoutingAlgorithm;
  /** Simulated time of the computation. */
  at: number;
  source: NodeId;
  destination: NodeId;
  path: NodeId[] | null;
  hops: number | null;
  /** Sum of link latencies along `path` (ms), whichever algorithm chose it. */
  cost: number | null;
  /** BFS: dequeue order. Dijkstra: settle order. */
  visitOrder: NodeId[];
  excludedNodes: NodeId[];
  excludedLinks: LinkId[];
  /** BFS only: hop level of every discovered node. */
  bfsLevels?: Record<NodeId, number>;
  /** Dijkstra only: settle steps and final table. */
  dijkstraSteps?: DijkstraStep[];
  dijkstraTable?: DijkstraTableRow[];
  /** Ties resolved by the deterministic tie-breaking rule. */
  tieBreaks: string[];
  /** Plain-language explanation generated from the actual result. */
  explanation: string;
  /** Real wall-clock time spent in the algorithm (microseconds). */
  computeMicros: number;
}

export interface SimConfig {
  /** Routing algorithm used for route discovery. Default: BFS. */
  routingAlgorithm: RoutingAlgorithm;
  heartbeatIntervalMs: number;
  missedThreshold: number;
  /** Auto traffic: 0 disables, otherwise one DATA packet every N ms while running. */
  trafficIntervalMs: number;
}

export type DemoStepStatus = 'pending' | 'active' | 'done';
export interface DemoStepView {
  label: string;
  status: DemoStepStatus;
}
export interface DemoView {
  running: boolean;
  finished: boolean;
  steps: DemoStepView[];
  summary: string | null;
}

export type SystemStatus = 'OPERATIONAL' | 'DETECTING' | 'DEGRADED' | 'UNAVAILABLE';

/** Display position of a node: top-left corner in dashboard flow coordinates. Ignored by the engine. */
export interface NodePosition {
  x: number;
  y: number;
}

/** Topology as supplied by a client or a preset. Link ids are derived by the server. */
export interface TopologySpec {
  name?: string;
  /** Positions are optional; missing ones are laid out automatically. */
  nodes: { id: NodeId; x?: number; y?: number }[];
  links: { a: NodeId; b: NodeId; latencyMs: number }[];
  source: NodeId;
  destination: NodeId;
}

export type PresetId = 'classic' | 'ring' | 'star' | 'mesh' | 'trap';

export interface PresetInfo {
  id: PresetId;
  name: string;
  description: string;
  nodeCount: number;
  linkCount: number;
  source: NodeId;
  destination: NodeId;
}

/** Validation limits applied to every topology (served at GET /api/presets). */
export interface TopologyLimits {
  minNodes: number;
  maxNodes: number;
  maxLinks: number;
  minLatencyMs: number;
  maxLatencyMs: number;
  maxNameLength: number;
  maxCoordinate: number;
  nodeIdPattern: string;
}

export interface TopologyView {
  name: string;
  /** Preset the topology came from, or null for a custom topology. */
  presetId: PresetId | null;
  positions: Record<NodeId, NodePosition>;
}

export interface SimSnapshot {
  simTime: number;
  running: boolean;
  systemStatus: SystemStatus;
  flow: { source: NodeId; destination: NodeId };
  nodes: NodeView[];
  links: LinkView[];
  activeRoute: NodeId[] | null;
  primaryRoute: NodeId[];
  inFlight: InFlightPacket[];
  recentPackets: PacketRecord[];
  events: SimEvent[];
  metrics: Metrics;
  series: MetricSample[];
  /** End-to-end delay of recently delivered packets, for the delay chart. */
  delaySamples: { seq: number; delayMs: number; route: string }[];
  /** Last route computation, kept for older clients (filled whichever algorithm ran). */
  lastBfs: BfsTrace | null;
  routing: {
    algorithm: RoutingAlgorithm;
    /** Latest route computation with its full explanation trace. */
    lastResult: RouteTrace | null;
    /** Total latency of the active route (ms), null when there is no route. */
    activeRouteCost: number | null;
  };
  config: SimConfig;
  demo: DemoView;
  topology: TopologyView;
}

/** Commands the client can send to the server (socket event "command"). */
export type Command =
  | { type: 'start' }
  | { type: 'pause' }
  | { type: 'reset' }
  | { type: 'sendPackets'; count: number }
  | { type: 'sendCorrupted' }
  | { type: 'failNode'; nodeId: NodeId }
  | { type: 'restoreNode'; nodeId: NodeId }
  | { type: 'disconnectLink'; linkId: LinkId }
  | { type: 'reconnectLink'; linkId: LinkId }
  | { type: 'setConfig'; config: Partial<SimConfig> }
  | { type: 'runDemo' }
  | { type: 'stopDemo' }
  // Structural changes: each one resets the simulation.
  | { type: 'loadPreset'; presetId: PresetId }
  | { type: 'loadTopology'; topology: TopologySpec }
  | { type: 'setFlow'; source: NodeId; destination: NodeId };

export interface CommandResult {
  ok: boolean;
  error?: string;
}
