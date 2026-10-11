import { ReactFlow, Background, BackgroundVariant } from '@xyflow/react';
import { useMemo, type ReactNode, type RefObject } from 'react';
import type { SimSnapshot } from '../../../../shared/types';
import type { SimClockRef } from '../../hooks/useSimulation';
import { fmtRoute, routeLinks } from '../../lib/format';
import { Panel } from '../ui';
import { NODE_POSITIONS } from './layout';
import { LinkEdge, type LinkEdgeType } from './LinkEdge';
import { NetworkNode, type NetworkNodeType } from './NetworkNode';
import { PacketLayer } from './PacketLayer';

// Defined once, outside the component, as React Flow requires.
const nodeTypes = { network: NetworkNode };
const edgeTypes = { link: LinkEdge };

export function Topology({ snapshot, clockRef, onToggleNode, onToggleLink }: {
  snapshot: SimSnapshot;
  clockRef: RefObject<SimClockRef>;
  onToggleNode: (id: string) => void;
  onToggleLink: (id: string) => void;
}) {
  const { nodes: simNodes, links, activeRoute, flow, config } = snapshot;

  const nodes = useMemo<NetworkNodeType[]>(
    () =>
      simNodes.map((n) => ({
        id: n.id,
        type: 'network',
        position: NODE_POSITIONS[n.id],
        draggable: false,
        data: {
          node: n,
          role: n.id === flow.source ? 'Source' : n.id === flow.destination ? 'Destination' : 'Relay',
          onRoute: !!activeRoute?.includes(n.id),
          threshold: config.missedThreshold,
        },
      })),
    [simNodes, activeRoute, flow, config.missedThreshold],
  );

  const edges = useMemo<LinkEdgeType[]>(() => {
    const onRoute = routeLinks(activeRoute);
    return links.map((l) => ({ id: l.id, source: l.a, target: l.b, type: 'link', data: { link: l, onRoute: onRoute.has(l.id) } }));
  }, [links, activeRoute]);

  const routeLabel = activeRoute ? fmtRoute(activeRoute) : 'COMMUNICATION UNAVAILABLE';
  const isPrimary = activeRoute?.join() === snapshot.primaryRoute.join();

  return (
    <Panel
      title="Network topology"
      subtitle="Click a node or link to inject / clear a fault"
      actions={
        <div className="flex items-center gap-2 text-xs">
          <span className="text-slate-500">Active route</span>
          <span
            className={
              activeRoute
                ? 'rounded-md border border-cyan-500/40 bg-cyan-500/10 px-2 py-0.5 font-mono text-cyan-200'
                : 'rounded-md border border-rose-500/40 bg-rose-500/10 px-2 py-0.5 font-mono text-rose-300'
            }
          >
            {routeLabel}
          </span>
          {activeRoute && <span className="text-slate-500">{isPrimary ? 'primary' : 'backup'}</span>}
        </div>
      }
    >
      <div className="relative h-[420px]">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          colorMode="dark"
          fitView
          fitViewOptions={{ padding: 0.18 }}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          zoomOnScroll={false}
          panOnDrag={false}
          zoomOnDoubleClick={false}
          preventScrolling={false}
          onNodeClick={(_, n) => onToggleNode(n.id)}
          onEdgeClick={(_, e) => onToggleLink(e.id)}
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="#1f2a38" />
          <PacketLayer packets={snapshot.inFlight} clockRef={clockRef} />
        </ReactFlow>

        <Legend />
      </div>
    </Panel>
  );
}

function Legend() {
  const item = (swatch: ReactNode, label: string) => (
    <span className="flex items-center gap-1.5">
      {swatch}
      {label}
    </span>
  );
  const line = (color: string, dashed = false) => (
    <svg width="18" height="6">
      <line x1="0" y1="3" x2="18" y2="3" stroke={color} strokeWidth="2.5" strokeDasharray={dashed ? '3 3' : undefined} />
    </svg>
  );
  const dot = (cls: string) => <span className={`h-2.5 w-2.5 rounded-full ${cls}`} />;
  return (
    <div className="pointer-events-none absolute bottom-2 left-3 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-slate-500">
      {item(line('#22d3ee'), 'Active route')}
      {item(line('#3b4a5f'), 'Standby link')}
      {item(line('#fbbf24', true), 'Suspect')}
      {item(line('#f43f5e', true), 'Unusable')}
      {item(dot('bg-cyan-400'), 'DATA')}
      {item(dot('bg-violet-400'), 'TEST')}
      {item(dot('bg-rose-500'), 'Corrupted')}
    </div>
  );
}
