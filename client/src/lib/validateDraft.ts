import type { TopologyLimits } from '../../../shared/types';
import type { Draft } from './topologyDraft';

/** Same values as the server's TOPOLOGY_LIMITS; replaced by GET /api/presets when available. */
export const DEFAULT_LIMITS: TopologyLimits = {
  minNodes: 2,
  maxNodes: 20,
  maxLinks: 60,
  minLatencyMs: 0,
  maxLatencyMs: 5000,
  maxNameLength: 40,
  maxCoordinate: 10_000,
  nodeIdPattern: '^[A-Za-z0-9_]{1,12}$',
};

export interface DraftErrors {
  name?: string;
  /** By node key. */
  nodes: Record<string, string>;
  /** By link key. */
  links: Record<string, string>;
  source?: string;
  destination?: string;
  /** Errors not tied to one field (node/link counts). */
  general: string[];
}

export const hasErrors = (e: DraftErrors) =>
  !!(e.name || e.source || e.destination || e.general.length || Object.keys(e.nodes).length || Object.keys(e.links).length);

export const errorCount = (e: DraftErrors) =>
  (e.name ? 1 : 0) + (e.source ? 1 : 0) + (e.destination ? 1 : 0) + e.general.length + Object.keys(e.nodes).length + Object.keys(e.links).length;

/**
 * Field-level validation of a draft, mirroring the server's validateTopology
 * rules so problems are shown next to the field before anything is sent.
 * The server still validates again and has the final word.
 */
export function validateDraft(d: Draft, limits: TopologyLimits = DEFAULT_LIMITS): DraftErrors {
  const e: DraftErrors = { nodes: {}, links: {}, general: [] };
  const idPattern = new RegExp(limits.nodeIdPattern);

  const name = d.name.trim();
  if (name.length === 0 || name.length > limits.maxNameLength) e.name = `Name must be 1–${limits.maxNameLength} characters`;

  if (d.nodes.length < limits.minNodes) e.general.push(`A topology needs at least ${limits.minNodes} nodes`);
  if (d.nodes.length > limits.maxNodes) e.general.push(`At most ${limits.maxNodes} nodes are allowed (${d.nodes.length} now)`);
  if (d.links.length > limits.maxLinks) e.general.push(`At most ${limits.maxLinks} links are allowed (${d.links.length} now)`);

  const counts = new Map<string, number>();
  for (const n of d.nodes) counts.set(n.id.trim(), (counts.get(n.id.trim()) ?? 0) + 1);
  for (const n of d.nodes) {
    const id = n.id.trim();
    if (!idPattern.test(id)) e.nodes[n.key] = 'Use 1–12 letters, digits or _';
    else if (counts.get(id)! > 1) e.nodes[n.key] = `Duplicate id "${id}"`;
    else if (![n.x, n.y].every((v) => Number.isFinite(v) && Math.abs(v) <= limits.maxCoordinate)) e.nodes[n.key] = 'Position out of range';
  }

  const keys = new Set(d.nodes.map((n) => n.key));
  const seen = new Set<string>();
  for (const l of d.links) {
    const pair = [l.a, l.b].sort().join('|');
    const text = l.latency.trim();
    const w = Number(text);
    if (!keys.has(l.a) || !keys.has(l.b)) e.links[l.key] = 'Endpoint no longer exists';
    else if (l.a === l.b) e.links[l.key] = 'A link cannot connect a node to itself';
    else if (seen.has(pair)) e.links[l.key] = 'Duplicate link';
    else if (!/^\d+$/.test(text) || w < limits.minLatencyMs || w > limits.maxLatencyMs)
      e.links[l.key] = `Latency must be a whole number from ${limits.minLatencyMs} to ${limits.maxLatencyMs} ms`;
    seen.add(pair);
  }

  if (!d.source || !keys.has(d.source)) e.source = 'Choose a source node';
  if (!d.destination || !keys.has(d.destination)) e.destination = 'Choose a destination node';
  else if (d.source === d.destination) e.destination = 'Destination must differ from the source';

  return e;
}
