import { ViewportPortal } from '@xyflow/react';
import { useEffect, useState, type RefObject } from 'react';
import type { InFlightPacket } from '../../../../shared/types';
import { estimateSimTime, type SimClockRef } from '../../hooks/useSimulation';
import { cx } from '../../lib/format';
import { nodeCenter } from './layout';

/**
 * Draws packets that are actually in flight in the engine. Each packet's
 * position is derived from its real hop departure/arrival times and the
 * interpolated simulation clock — it is never a decorative animation.
 */
export function PacketLayer({ packets, clockRef }: { packets: InFlightPacket[]; clockRef: RefObject<SimClockRef> }) {
  const [, setFrame] = useState(0);

  useEffect(() => {
    if (packets.length === 0) return;
    let raf = 0;
    const loop = () => {
      setFrame((f) => (f + 1) % 1_000_000);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [packets.length]);

  const now = estimateSimTime(clockRef.current);

  return (
    <ViewportPortal>
      {packets.map((p) => {
        const a = nodeCenter(p.from);
        const b = nodeCenter(p.to);
        const t = Math.min(1, Math.max(0, (now - p.departAt) / (p.arriveAt - p.departAt)));
        const x = a.x + (b.x - a.x) * t;
        const y = a.y + (b.y - a.y) * t;
        return (
          <div
            key={p.id}
            className="pointer-events-none absolute flex items-center gap-1"
            style={{ transform: `translate(${x - 7}px, ${y - 7}px)`, zIndex: 10 }}
          >
            <span
              className={cx(
                'block h-3.5 w-3.5 rounded-full border-2',
                p.corrupted ? 'border-rose-200 bg-rose-500' : p.type === 'TEST' ? 'border-white/80 bg-violet-400' : 'border-white/80 bg-cyan-400',
              )}
            />
            <span className="rounded bg-ink-950/80 px-1 font-mono text-[9px] text-slate-300">#{p.seq}</span>
          </div>
        );
      })}
    </ViewportPortal>
  );
}
