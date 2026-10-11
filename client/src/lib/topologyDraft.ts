import type { NodeId, NodePosition, SimSnapshot, TopologySpec } from '../../../shared/types';

/**
 * Local, editable copy of a topology. Nothing here touches the simulation:
 * the draft is only sent to the server (as a TopologySpec) when the user
 * presses Apply. Nodes have a stable `key` so links survive renaming a node.
 */
export interface DraftNode {
  key: string;
  /** Raw text of the node id, validated before applying. */
  id: string;
  x: number;
  y: number;
}

export interface DraftLink {
  key: string;
  /** Node keys (not ids). */
  a: string;
  b: string;
  /** Raw text of the latency field, validated before applying. */
  latency: string;
}

export interface Draft {
  name: string;
  nodes: DraftNode[];
  links: DraftLink[];
  /** Node keys; '' when not chosen. */
  source: string;
  destination: string;
  /** Counter for new node/link keys. */
  seq: number;
}

export type DraftAction =
  | { type: 'addNode' }
  | { type: 'removeNode'; key: string }
  | { type: 'renameNode'; key: string; id: string }
  | { type: 'moveNode'; key: string; x: number; y: number }
  | { type: 'addLink'; a: string; b: string; latency?: string }
  | { type: 'removeLink'; key: string }
  | { type: 'setLatency'; key: string; latency: string }
  | { type: 'setSource'; key: string }
  | { type: 'setDestination'; key: string }
  | { type: 'setName'; name: string };

export const DEFAULT_LATENCY = '100';
const MAX_COORD = 10_000;
const GRID = 150;

/** Snapshot → draft. Positions come from the server; missing ones fall back to a circle. */
export function draftFromSnapshot(s: SimSnapshot): Draft {
  const positions = s.topology?.positions ?? {};
  const fallback = circleLayout(s.nodes.map((n) => n.id));
  return {
    name: s.topology?.name ?? 'Custom topology',
    nodes: s.nodes.map((n) => ({ key: n.id, id: n.id, ...(positions[n.id] ?? fallback[n.id]) })),
    links: s.links.map((l) => ({ key: l.id, a: l.a, b: l.b, latency: String(l.latencyMs) })),
    source: s.flow.source,
    destination: s.flow.destination,
    seq: 1,
  };
}

/** Draft → the server's TopologySpec (ids resolved from keys, latency parsed). */
export function toSpec(d: Draft): TopologySpec {
  const idOf = (key: string) => d.nodes.find((n) => n.key === key)?.id.trim() ?? '';
  return {
    name: d.name.trim(),
    nodes: d.nodes.map((n) => ({ id: n.id.trim(), x: n.x, y: n.y })),
    links: d.links.map((l) => ({ a: idOf(l.a), b: idOf(l.b), latencyMs: Number(l.latency.trim()) })),
    source: idOf(d.source),
    destination: idOf(d.destination),
  };
}

/** Order-independent fingerprint, used to tell whether a draft differs from the live topology. */
export function topologyKey(spec: TopologySpec): string {
  const pair = (a: string, b: string) => [a, b].sort().join('-');
  return JSON.stringify({
    name: spec.name ?? '',
    nodes: [...spec.nodes].sort((p, q) => (p.id < q.id ? -1 : 1)).map((n) => [n.id, Math.round(n.x ?? 0), Math.round(n.y ?? 0)]),
    links: spec.links.map((l) => [pair(l.a, l.b), l.latencyMs]).sort((p, q) => (p[0] < q[0] ? -1 : 1)),
    flow: [spec.source, spec.destination],
  });
}

/** True when two specs differ only in source/destination (so `setFlow` is enough). */
export function onlyFlowDiffers(a: TopologySpec, b: TopologySpec): boolean {
  return topologyKey({ ...a, source: '', destination: '' }) === topologyKey({ ...b, source: '', destination: '' });
}

export function nextNodeId(nodes: DraftNode[]): NodeId {
  const used = new Set(nodes.map((n) => n.id.trim()));
  for (let c = 65; c <= 90; c++) if (!used.has(String.fromCharCode(c))) return String.fromCharCode(c);
  for (let i = 1; ; i++) if (!used.has(`N${i}`)) return `N${i}`;
}

/** First free grid cell (row by row) at least one cell away from every node. */
export function freePosition(nodes: DraftNode[]): NodePosition {
  const minX = nodes.length ? Math.min(...nodes.map((n) => n.x)) : 0;
  const minY = nodes.length ? Math.min(...nodes.map((n) => n.y)) : 0;
  for (let row = 0; ; row++) {
    for (let col = 0; col < 6; col++) {
      const p = { x: minX + col * GRID, y: minY + row * GRID };
      if (nodes.every((n) => Math.hypot(n.x - p.x, n.y - p.y) >= GRID * 0.9)) return p;
    }
  }
}

export function circleLayout(ids: NodeId[]): Record<NodeId, NodePosition> {
  const r = Math.max(170, ids.length * 40);
  return Object.fromEntries(
    ids.map((id, i) => {
      const angle = Math.PI + (2 * Math.PI * i) / Math.max(ids.length, 1);
      return [id, { x: Math.round(r + r * Math.cos(angle)), y: Math.round(r + r * Math.sin(angle)) }];
    }),
  );
}

export const linkBetween = (d: Draft, a: string, b: string) => d.links.find((l) => (l.a === a && l.b === b) || (l.a === b && l.b === a));

const clamp = (v: number) => Math.round(Math.min(MAX_COORD, Math.max(-MAX_COORD, v)));

export function draftReducer(d: Draft, action: DraftAction): Draft {
  switch (action.type) {
    case 'addNode': {
      const key = `n${d.seq}`;
      return { ...d, seq: d.seq + 1, nodes: [...d.nodes, { key, id: nextNodeId(d.nodes), ...freePosition(d.nodes) }] };
    }
    case 'removeNode':
      return {
        ...d,
        nodes: d.nodes.filter((n) => n.key !== action.key),
        links: d.links.filter((l) => l.a !== action.key && l.b !== action.key),
        source: d.source === action.key ? '' : d.source,
        destination: d.destination === action.key ? '' : d.destination,
      };
    case 'renameNode':
      return { ...d, nodes: d.nodes.map((n) => (n.key === action.key ? { ...n, id: action.id } : n)) };
    case 'moveNode':
      return { ...d, nodes: d.nodes.map((n) => (n.key === action.key ? { ...n, x: clamp(action.x), y: clamp(action.y) } : n)) };
    case 'addLink': {
      if (action.a === action.b || linkBetween(d, action.a, action.b)) return d;
      if (![action.a, action.b].every((k) => d.nodes.some((n) => n.key === k))) return d;
      const link = { key: `l${d.seq}`, a: action.a, b: action.b, latency: action.latency ?? DEFAULT_LATENCY };
      return { ...d, seq: d.seq + 1, links: [...d.links, link] };
    }
    case 'removeLink':
      return { ...d, links: d.links.filter((l) => l.key !== action.key) };
    case 'setLatency':
      return { ...d, links: d.links.map((l) => (l.key === action.key ? { ...l, latency: action.latency } : l)) };
    case 'setSource':
      return { ...d, source: action.key };
    case 'setDestination':
      return { ...d, destination: action.key };
    case 'setName':
      return { ...d, name: action.name };
  }
}
