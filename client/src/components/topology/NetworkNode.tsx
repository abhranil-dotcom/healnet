import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import type { NodeView } from '../../../../shared/types';
import { cx } from '../../lib/format';
import { Badge, nodeStatusStyle } from '../ui';
import { NODE_SIZE } from './layout';

export type NetworkNodeData = {
  node: NodeView;
  role: 'Source' | 'Destination' | 'Relay';
  onRoute: boolean;
  threshold: number;
};
export type NetworkNodeType = Node<NetworkNodeData, 'network'>;

const ring = {
  ACTIVE: 'border-emerald-500/60',
  SUSPECT: 'border-amber-400/80',
  FAILED: 'border-rose-500/70',
} as const;

/** Handles sit invisibly in the centre so links run centre-to-centre. */
const centerHandle = { top: '50%', left: '50%', opacity: 0, width: 1, height: 1, minWidth: 0, minHeight: 0, border: 0 };

export function NetworkNode({ data }: NodeProps<NetworkNodeType>) {
  const { node, role, onRoute, threshold } = data;
  const undetectedFault = !node.actualUp && node.status !== 'FAILED';

  return (
    <div
      style={{ width: NODE_SIZE, height: NODE_SIZE }}
      title={node.actualUp ? `Click to fail Node ${node.id}` : `Click to restore Node ${node.id}`}
      className={cx(
        'relative flex cursor-pointer flex-col items-center justify-center gap-1 rounded-2xl border-2 bg-ink-850 transition-colors duration-300',
        ring[node.status],
        onRoute && node.status === 'ACTIVE' && 'border-cyan-400 shadow-[0_0_0_4px_rgba(34,211,238,0.12)]',
        node.status === 'FAILED' && 'bg-rose-950/30',
      )}
    >
      <Handle type="target" position={Position.Top} style={centerHandle} isConnectable={false} />
      <Handle type="source" position={Position.Top} style={centerHandle} isConnectable={false} />

      <span className="text-[9px] font-medium tracking-[0.14em] text-slate-500 uppercase">{role}</span>
      <span className={cx('font-mono text-3xl leading-none font-semibold', node.status === 'FAILED' ? 'text-rose-300' : 'text-slate-100')}>
        {node.id}
      </span>
      <Badge className={nodeStatusStyle[node.status]}>{node.status}</Badge>

      {/* Missed-heartbeat counter: one pip per allowed miss */}
      <div className="flex gap-0.5" aria-label={`${node.missedHeartbeats} of ${threshold} heartbeats missed`}>
        {Array.from({ length: threshold }, (_, i) => (
          <span key={i} className={cx('h-1 w-2 rounded-full', i < node.missedHeartbeats ? 'bg-amber-400' : 'bg-ink-600')} />
        ))}
      </div>

      {undetectedFault && (
        <span className="absolute -top-2.5 rounded bg-amber-500 px-1.5 py-px text-[9px] font-bold text-ink-950">NO ACK</span>
      )}
      {!node.actualUp && node.status === 'FAILED' && (
        <span className="absolute -top-2.5 rounded bg-rose-500 px-1.5 py-px text-[9px] font-bold text-ink-950">DOWN</span>
      )}
    </div>
  );
}
