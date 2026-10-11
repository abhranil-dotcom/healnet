import type { DemoView } from '../../../shared/types';
import { cx } from '../lib/format';
import { Panel } from './ui';

export function DemoPanel({ demo }: { demo: DemoView }) {
  const done = demo.steps.filter((s) => s.status === 'done').length;
  const pct = demo.steps.length ? (done / demo.steps.length) * 100 : 0;

  return (
    <Panel
      title="Guided demonstration"
      subtitle={demo.running ? `Step ${Math.min(done + 1, demo.steps.length)} of ${demo.steps.length}` : demo.finished ? 'Completed' : demo.steps.length ? 'Stopped' : 'Press Run Demo to start'}
    >
      <div className="p-4">
        {demo.steps.length === 0 ? (
          <p className="text-xs leading-relaxed text-slate-500">
            The demo resets the network, sends traffic on A → B → C, fails Node B, waits for heartbeat-based detection, lets BFS reroute to
            A → D → C, then resumes delivery and reports the measured recovery.
          </p>
        ) : (
          <>
            <div className="mb-3 h-1 overflow-hidden rounded-full bg-ink-800">
              <div className="h-full rounded-full bg-cyan-400 transition-all duration-500" style={{ width: `${pct}%` }} />
            </div>
            <ol className="space-y-1.5">
              {demo.steps.map((s, i) => (
                <li key={s.label} className="flex items-center gap-2.5 text-xs">
                  <span
                    className={cx(
                      'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border font-mono text-[10px]',
                      s.status === 'done' && 'border-emerald-500/50 bg-emerald-500/15 text-emerald-300',
                      s.status === 'active' && 'border-cyan-400 bg-cyan-400/15 text-cyan-200',
                      s.status === 'pending' && 'border-ink-600 text-slate-600',
                    )}
                  >
                    {s.status === 'done' ? '✓' : i + 1}
                  </span>
                  <span className={cx(s.status === 'active' ? 'text-slate-100' : s.status === 'done' ? 'text-slate-400' : 'text-slate-600')}>
                    {s.label}
                  </span>
                  {s.status === 'active' && <span className="ml-auto h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-400" />}
                </li>
              ))}
            </ol>
            {demo.summary && (
              <p
                className={cx(
                  'mt-3 rounded-lg border p-2.5 text-xs leading-relaxed',
                  demo.finished ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-200' : 'border-amber-500/30 bg-amber-500/5 text-amber-200',
                )}
              >
                {demo.summary}
              </p>
            )}
          </>
        )}
      </div>
    </Panel>
  );
}
