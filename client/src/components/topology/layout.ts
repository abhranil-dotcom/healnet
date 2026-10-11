import type { NodeId, NodePosition, SimSnapshot } from '../../../../shared/types';
import { circleLayout } from '../../lib/topologyDraft';

/** Node box size (positions are the top-left corner of each node in flow coordinates). */
export const NODE_SIZE = 104;

/** Original fixed diamond layout, used only if the server does not send positions (older backend). */
export const NODE_POSITIONS: Record<NodeId, NodePosition> = {
  A: { x: 0, y: 170 },
  B: { x: 300, y: 0 },
  C: { x: 600, y: 170 },
  D: { x: 300, y: 340 },
};

/** Positions for every node in the snapshot: server-provided, else the legacy layout, else a circle. */
export function snapshotPositions(s: SimSnapshot): Record<NodeId, NodePosition> {
  const ids = s.nodes.map((n) => n.id);
  const circle = circleLayout(ids);
  const server = s.topology?.positions ?? {};
  return Object.fromEntries(ids.map((id) => [id, server[id] ?? NODE_POSITIONS[id] ?? circle[id]]));
}

export function nodeCenter(positions: Record<NodeId, NodePosition>, id: NodeId) {
  const p = positions[id] ?? { x: 0, y: 0 };
  return { x: p.x + NODE_SIZE / 2, y: p.y + NODE_SIZE / 2 };
}

/**
 * Fraction (0–1) of a hop a packet has covered. A zero-latency hop
 * (arriveAt === departAt) counts as already arrived instead of dividing by zero.
 */
export function hopProgress(now: number, departAt: number, arriveAt: number): number {
  const span = arriveAt - departAt;
  if (!(span > 0)) return 1;
  return Math.min(1, Math.max(0, (now - departAt) / span));
}
