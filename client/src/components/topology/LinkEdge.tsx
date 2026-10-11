import { BaseEdge, EdgeLabelRenderer, getStraightPath, type Edge, type EdgeProps } from '@xyflow/react';
import type { LinkView } from '../../../../shared/types';
import { cx } from '../../lib/format';

export type LinkEdgeData = { link: LinkView; onRoute: boolean };
export type LinkEdgeType = Edge<LinkEdgeData, 'link'>;

export function LinkEdge({ id, sourceX, sourceY, targetX, targetY, data }: EdgeProps<LinkEdgeType>) {
  const [path, labelX, labelY] = getStraightPath({ sourceX, sourceY, targetX, targetY });
  const link = data!.link;
  const onRoute = data!.onRoute;

  let stroke = '#3b4a5f';
  let width = 2;
  let dash: string | undefined;
  let tag = 'standby';
  if (onRoute) {
    stroke = '#22d3ee';
    width = 3.5;
    tag = 'active route';
  }
  if (link.status === 'SUSPECT') {
    stroke = '#fbbf24';
    dash = '6 6';
    tag = `hello missed ${link.missedHellos}`;
  }
  if (!link.usable) {
    stroke = '#f43f5e';
    width = 2;
    dash = '4 6';
    tag = link.status === 'DOWN' ? 'link down' : 'endpoint failed';
  }
  if (!link.actualUp && link.status !== 'DOWN') tag = 'cable cut · undetected';

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        interactionWidth={24}
        className={cx(onRoute && link.usable && link.status === 'UP' && 'route-active')}
        style={{ stroke, strokeWidth: width, strokeDasharray: dash, opacity: link.usable ? 1 : 0.7, transition: 'stroke 0.3s' }}
      />
      <EdgeLabelRenderer>
        <div
          className="nodrag nopan pointer-events-none absolute flex flex-col items-center"
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
        >
          <span
            className={cx(
              'rounded-md border bg-ink-900/95 px-1.5 py-0.5 font-mono text-[10px] whitespace-nowrap',
              onRoute && link.usable ? 'border-cyan-500/40 text-cyan-200' : link.usable ? 'border-ink-600 text-slate-400' : 'border-rose-500/40 text-rose-300',
            )}
          >
            {link.id} · {link.latencyMs} ms
          </span>
          <span className="mt-0.5 text-[9px] tracking-wide text-slate-500 uppercase">{tag}</span>
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
