import {
  Background,
  BackgroundVariant,
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  getStraightPath,
  Handle,
  Position,
  ReactFlow,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeChange,
  type NodeProps,
} from '@xyflow/react';
import { useMemo } from 'react';
import { cx } from '../../lib/format';
import { FitOnResize } from '../topology/FitOnResize';
import type { Draft, DraftAction } from '../../lib/topologyDraft';
import type { DraftErrors } from '../../lib/validateDraft';

const SIZE = 84;
const centerHandle = { top: '50%', left: '50%', opacity: 0, width: 1, height: 1, minWidth: 0, minHeight: 0, border: 0 };

type DraftNodeData = { label: string; role: 'Source' | 'Destination' | 'Relay'; selected: boolean; error: boolean };
type DraftEdgeData = { label: string; selected: boolean; error: boolean };
type DraftNodeType = Node<DraftNodeData, 'draft'>;
type DraftEdgeType = Edge<DraftEdgeData, 'draft'>;

function DraftNodeView({ data }: NodeProps<DraftNodeType>) {
  return (
    <div
      style={{ width: SIZE, height: SIZE }}
      className={cx(
        'flex cursor-grab flex-col items-center justify-center gap-0.5 rounded-2xl border-2 border-dashed bg-ink-850 transition-colors',
        data.error ? 'border-rose-500/80' : data.selected ? 'border-cyan-400 shadow-[0_0_0_4px_rgba(34,211,238,0.15)]' : 'border-slate-500/50',
      )}
    >
      <Handle type="target" position={Position.Top} style={centerHandle} isConnectable={false} />
      <Handle type="source" position={Position.Top} style={centerHandle} isConnectable={false} />
      <span className="text-[9px] font-medium tracking-[0.14em] text-slate-500 uppercase">{data.role}</span>
      <span className={cx('max-w-[76px] truncate font-mono text-xl font-semibold', data.error ? 'text-rose-300' : 'text-slate-100')}>
        {data.label || '?'}
      </span>
    </div>
  );
}

function DraftEdgeView({ id, sourceX, sourceY, targetX, targetY, data }: EdgeProps<DraftEdgeType>) {
  const [path, labelX, labelY] = getStraightPath({ sourceX, sourceY, targetX, targetY });
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        interactionWidth={22}
        style={{ stroke: data!.error ? '#f43f5e' : data!.selected ? '#22d3ee' : '#4b5b72', strokeWidth: data!.selected ? 3 : 2 }}
      />
      <EdgeLabelRenderer>
        <span
          className={cx(
            'pointer-events-none absolute rounded-md border bg-ink-900/95 px-1.5 py-0.5 font-mono text-[10px] whitespace-nowrap',
            data!.error ? 'border-rose-500/50 text-rose-300' : data!.selected ? 'border-cyan-500/50 text-cyan-200' : 'border-ink-600 text-slate-400',
          )}
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
        >
          {data!.label}
        </span>
      </EdgeLabelRenderer>
    </>
  );
}

const nodeTypes = { draft: DraftNodeView };
const edgeTypes = { draft: DraftEdgeView };

/**
 * Editable view of the draft. Drag nodes to move them; click one node and then
 * another to link them; click a link to select it. Nothing is sent to the
 * server from here.
 */
export function DraftCanvas({ draft, errors, selectedNode, selectedLink, onNodeClick, onLinkClick, onPaneClick, dispatch }: {
  draft: Draft;
  errors: DraftErrors;
  selectedNode: string | null;
  selectedLink: string | null;
  onNodeClick: (key: string) => void;
  onLinkClick: (key: string) => void;
  onPaneClick: () => void;
  dispatch: (a: DraftAction) => void;
}) {
  const nodes = useMemo<DraftNodeType[]>(
    () =>
      draft.nodes.map((n) => ({
        id: n.key,
        type: 'draft',
        position: { x: n.x, y: n.y },
        data: {
          label: n.id.trim(),
          role: n.key === draft.source ? 'Source' : n.key === draft.destination ? 'Destination' : 'Relay',
          selected: n.key === selectedNode,
          error: !!errors.nodes[n.key],
        },
      })),
    [draft.nodes, draft.source, draft.destination, selectedNode, errors],
  );
  const edges = useMemo<DraftEdgeType[]>(
    () =>
      draft.links.map((l) => ({
        id: l.key,
        source: l.a,
        target: l.b,
        type: 'draft',
        data: { label: `${l.latency.trim() || '?'} ms`, selected: l.key === selectedLink, error: !!errors.links[l.key] },
      })),
    [draft.links, selectedLink, errors],
  );

  const onNodesChange = (changes: NodeChange<DraftNodeType>[]) => {
    for (const c of changes) if (c.type === 'position' && c.position) dispatch({ type: 'moveNode', key: c.id, x: c.position.x, y: c.position.y });
  };

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      colorMode="dark"
      fitView
      fitViewOptions={{ padding: 0.25 }}
      onNodesChange={onNodesChange}
      nodesConnectable={false}
      elementsSelectable={false}
      zoomOnScroll={false}
      zoomOnDoubleClick={false}
      preventScrolling={false}
      onNodeClick={(_, n) => onNodeClick(n.id)}
      onEdgeClick={(_, e) => onLinkClick(e.id)}
      onPaneClick={onPaneClick}
    >
      <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="#1f2a38" />
      {/* Zoom / fit-view buttons, so nodes added off-screen can be brought back into view. */}
      <Controls showInteractive={false} position="top-right" />
      <FitOnResize padding={0.25} />
    </ReactFlow>
  );
}
