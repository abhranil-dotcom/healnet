import type { PresetId, PresetInfo, TopologySpec } from '../../../shared/types.js';
import { validateTopology, type ValidTopology } from './validateTopology.js';

interface Preset {
  id: PresetId;
  description: string;
  spec: TopologySpec;
}

const l = (a: string, b: string, latencyMs: number) => ({ a, b, latencyMs });

const PRESETS: Preset[] = [
  {
    id: 'classic',
    description: 'The original HEALNET network: primary route A → B → C, slower backup A → D → C.',
    spec: {
      name: 'Classic HEALNET',
      // Same nodes, links, link order and latencies as defaultTopology(); positions match the dashboard.
      nodes: [{ id: 'A', x: 0, y: 170 }, { id: 'B', x: 300, y: 0 }, { id: 'C', x: 600, y: 170 }, { id: 'D', x: 300, y: 340 }],
      links: [l('A', 'B', 300), l('B', 'C', 300), l('A', 'D', 400), l('D', 'C', 400)],
      source: 'A',
      destination: 'C',
    },
  },
  {
    id: 'ring',
    description: 'Six nodes in a ring: every failure leaves exactly one way around.',
    spec: {
      name: 'Ring',
      nodes: [
        { id: 'A', x: 0, y: 170 }, { id: 'B', x: 150, y: 0 }, { id: 'C', x: 450, y: 0 },
        { id: 'D', x: 600, y: 170 }, { id: 'E', x: 450, y: 340 }, { id: 'F', x: 150, y: 340 },
      ],
      links: [l('A', 'B', 200), l('B', 'C', 200), l('C', 'D', 200), l('D', 'E', 300), l('E', 'F', 300), l('F', 'A', 300)],
      source: 'A',
      destination: 'D',
    },
  },
  {
    id: 'star',
    description: 'Every path crosses hub H, a single point of failure.',
    spec: {
      name: 'Star',
      nodes: [{ id: 'A', x: 0, y: 170 }, { id: 'B', x: 300, y: 0 }, { id: 'C', x: 600, y: 170 }, { id: 'D', x: 300, y: 340 }, { id: 'H', x: 300, y: 170 }],
      links: [l('A', 'H', 250), l('B', 'H', 250), l('C', 'H', 250), l('D', 'H', 250)],
      source: 'A',
      destination: 'C',
    },
  },
  {
    id: 'mesh',
    description: '3×3 grid with many equal-cost paths, which shows deterministic tie-breaking.',
    spec: {
      name: 'Mesh 3×3',
      nodes: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'].map((id, i) => ({ id, x: (i % 3) * 300, y: Math.floor(i / 3) * 250 })),
      links: [
        l('A', 'B', 150), l('B', 'C', 150), l('D', 'E', 150), l('E', 'F', 150), l('G', 'H', 150), l('H', 'I', 150),
        l('A', 'D', 200), l('D', 'G', 200), l('B', 'E', 200), l('E', 'H', 200), l('C', 'F', 200), l('F', 'I', 200),
      ],
      source: 'A',
      destination: 'I',
    },
  },
  {
    id: 'trap',
    description: 'BFS vs Dijkstra: the fewest-hop route A → B → C (1000 ms) is slower than A → D → E → C (300 ms).',
    spec: {
      name: 'BFS vs Dijkstra',
      nodes: [{ id: 'A', x: 0, y: 170 }, { id: 'B', x: 300, y: 0 }, { id: 'C', x: 600, y: 170 }, { id: 'D', x: 150, y: 340 }, { id: 'E', x: 450, y: 340 }],
      links: [l('A', 'B', 500), l('B', 'C', 500), l('A', 'D', 100), l('D', 'E', 100), l('E', 'C', 100)],
      source: 'A',
      destination: 'C',
    },
  },
];

export function isPresetId(x: unknown): x is PresetId {
  return typeof x === 'string' && PRESETS.some((p) => p.id === x);
}

export function presetSpec(id: PresetId): TopologySpec {
  return structuredClone(PRESETS.find((p) => p.id === id)!.spec);
}

/** A preset, validated by the same rules as user topologies. */
export function loadPresetTopology(id: PresetId): ValidTopology {
  const v = validateTopology(presetSpec(id));
  if (!v.ok) throw new Error(`Preset "${id}" is invalid: ${v.error}`);
  return v;
}

export function listPresets(): PresetInfo[] {
  return PRESETS.map((p) => ({
    id: p.id,
    name: p.spec.name!,
    description: p.description,
    nodeCount: p.spec.nodes.length,
    linkCount: p.spec.links.length,
    source: p.spec.source,
    destination: p.spec.destination,
  }));
}
