import type { NodeId } from '../../../../shared/types';

/** Fixed diamond layout (top-left corner of each node in flow coordinates). */
export const NODE_SIZE = 104;
export const NODE_POSITIONS: Record<NodeId, { x: number; y: number }> = {
  A: { x: 0, y: 170 },
  B: { x: 300, y: 0 },
  C: { x: 600, y: 170 },
  D: { x: 300, y: 340 },
};

export function nodeCenter(id: NodeId) {
  const p = NODE_POSITIONS[id] ?? { x: 0, y: 0 };
  return { x: p.x + NODE_SIZE / 2, y: p.y + NODE_SIZE / 2 };
}
