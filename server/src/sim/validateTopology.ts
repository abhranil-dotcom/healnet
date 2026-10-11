import type { NodeId, NodePosition, TopologyLimits } from '../../../shared/types.js';
import { linkId, type LinkDef, type TopologyDef } from './topology.js';

export const TOPOLOGY_LIMITS: TopologyLimits = {
  minNodes: 2,
  maxNodes: 20,
  maxLinks: 60,
  minLatencyMs: 0,
  maxLatencyMs: 5000,
  maxNameLength: 40,
  maxCoordinate: 10_000,
  // No "-" (link ids join node ids with "-") and no ":" (used in internal component ids).
  nodeIdPattern: '^[A-Za-z0-9_]{1,12}$',
};

const NODE_ID = new RegExp(TOPOLOGY_LIMITS.nodeIdPattern);

export interface ValidTopology {
  ok: true;
  name: string;
  topo: TopologyDef;
  flow: { source: NodeId; destination: NodeId };
}

export type TopologyValidation = ValidTopology | { ok: false; error: string };

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const fail = (error: string): TopologyValidation => ({ ok: false, error });

/** Evenly spaced positions on a circle, starting at the left (where the source usually sits). */
export function autoLayout(nodes: NodeId[]): Record<NodeId, NodePosition> {
  const r = Math.max(170, nodes.length * 40);
  const out: Record<NodeId, NodePosition> = {};
  nodes.forEach((id, i) => {
    const angle = Math.PI + (2 * Math.PI * i) / nodes.length;
    out[id] = { x: Math.round(r + r * Math.cos(angle)), y: Math.round(r + r * Math.sin(angle)) };
  });
  return out;
}

/**
 * Validate an untrusted topology (from a client command or a preset) and turn
 * it into the engine's TopologyDef. Returns the first rule that is broken.
 */
export function validateTopology(input: unknown): TopologyValidation {
  const L = TOPOLOGY_LIMITS;
  if (!isObject(input)) return fail('Topology must be an object');

  let name = 'Custom topology';
  if (input.name !== undefined) {
    if (typeof input.name !== 'string' || input.name.trim().length === 0 || input.name.trim().length > L.maxNameLength)
      return fail(`Topology name must be 1–${L.maxNameLength} characters`);
    name = input.name.trim();
  }

  if (!Array.isArray(input.nodes)) return fail('Topology needs a "nodes" array');
  if (input.nodes.length < L.minNodes) return fail(`A topology needs at least ${L.minNodes} nodes`);
  if (input.nodes.length > L.maxNodes) return fail(`At most ${L.maxNodes} nodes are allowed`);

  const nodes: NodeId[] = [];
  const given: Record<NodeId, NodePosition> = {};
  for (const n of input.nodes) {
    if (!isObject(n) || typeof n.id !== 'string' || !NODE_ID.test(n.id))
      return fail(`Invalid node id ${JSON.stringify(isObject(n) ? n.id : n)}: use 1–12 letters, digits or _`);
    if (nodes.includes(n.id)) return fail(`Duplicate node "${n.id}"`);
    nodes.push(n.id);
    if (n.x !== undefined || n.y !== undefined) {
      const ok = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= L.maxCoordinate;
      if (!ok(n.x) || !ok(n.y)) return fail(`Node ${n.id} has an invalid position (x and y must be numbers within ±${L.maxCoordinate})`);
      given[n.id] = { x: n.x as number, y: n.y as number };
    }
  }

  if (!Array.isArray(input.links)) return fail('Topology needs a "links" array');
  if (input.links.length > L.maxLinks) return fail(`At most ${L.maxLinks} links are allowed`);

  const links: LinkDef[] = [];
  for (const l of input.links) {
    if (!isObject(l) || typeof l.a !== 'string' || typeof l.b !== 'string') return fail('Every link needs string endpoints "a" and "b"');
    const label = `${l.a}-${l.b}`;
    for (const end of [l.a, l.b]) if (!nodes.includes(end)) return fail(`Link ${label} references unknown node "${end}"`);
    if (l.a === l.b) return fail(`Link ${label} connects node ${l.a} to itself`);
    const id = linkId(l.a, l.b);
    if (links.some((x) => x.id === id)) return fail(`Duplicate link ${id}`);
    const w = l.latencyMs;
    if (typeof w !== 'number' || !Number.isInteger(w) || w < L.minLatencyMs || w > L.maxLatencyMs)
      return fail(`Link ${id} latency must be an integer from ${L.minLatencyMs} to ${L.maxLatencyMs} ms`);
    links.push({ id, a: l.a, b: l.b, latencyMs: w });
  }

  const { source, destination } = input;
  if (typeof source !== 'string' || !nodes.includes(source)) return fail(`Source node ${JSON.stringify(source)} does not exist`);
  if (typeof destination !== 'string' || !nodes.includes(destination)) return fail(`Destination node ${JSON.stringify(destination)} does not exist`);
  if (source === destination) return fail('Source and destination must be different nodes');

  return { ok: true, name, topo: { nodes, links, positions: { ...autoLayout(nodes), ...given } }, flow: { source, destination } };
}
