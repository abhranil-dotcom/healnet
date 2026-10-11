import type { SimSnapshot } from '../../../shared/types';
import type { ConnectionState } from '../hooks/useSimulation';
import { cx, fmtSimTime } from '../lib/format';
import { Button, systemStatusStyle } from './ui';

export function Header({ snapshot, connection, busy, onStart, onPause, onReset, onRunDemo, onStopDemo }: {
  snapshot: SimSnapshot | null;
  connection: ConnectionState;
  busy: boolean;
  onStart: () => void;
  onPause: () => void;
  onReset: () => void;
  onRunDemo: () => void;
  onStopDemo: () => void;
}) {
  const status = snapshot ? systemStatusStyle[snapshot.systemStatus] : null;
  const demoRunning = !!snapshot?.demo.running;
  const disabled = !snapshot || connection !== 'connected' || busy;

  return (
    <header className="flex flex-wrap items-center justify-between gap-4 border-b border-ink-700/60 bg-ink-900/80 px-6 py-3 backdrop-blur">
      <div className="flex items-center gap-3">
        <Logo />
        <div>
          <h1 className="text-lg leading-tight font-semibold tracking-[0.18em] text-slate-100">HEALNET</h1>
          <p className="text-[11px] text-slate-500">Intelligent Network Recovery Simulator</p>
        </div>
        {status && (
          <span className={cx('ml-3 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium', status.cls)}>
            <span className={cx('h-2 w-2 rounded-full', status.dot, snapshot?.systemStatus === 'DETECTING' && 'animate-pulse')} />
            {status.label}
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-4 font-mono text-xs text-slate-400">
          <span title="Simulated time since the network was initialized">
            <span className="text-slate-600">SIM </span>
            {snapshot ? fmtSimTime(snapshot.simTime) : '—'}
            <span className={cx('ml-2', snapshot?.running ? 'text-emerald-400' : 'text-slate-500')}>
              {snapshot?.running ? '● RUNNING' : '❚❚ PAUSED'}
            </span>
          </span>
          <span className="flex items-center gap-1.5">
            <span
              className={cx(
                'h-1.5 w-1.5 rounded-full',
                connection === 'connected' ? 'bg-emerald-400' : connection === 'connecting' ? 'bg-amber-400' : 'bg-rose-500',
              )}
            />
            {connection === 'connected' ? 'Server linked' : connection === 'connecting' ? 'Connecting…' : 'Server offline'}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {snapshot?.running ? (
            <Button onClick={onPause} disabled={disabled || demoRunning}>
              <PauseIcon /> Pause
            </Button>
          ) : (
            <Button onClick={onStart} disabled={disabled || demoRunning} variant="success">
              <PlayIcon /> Start
            </Button>
          )}
          <Button onClick={onReset} disabled={disabled}>
            <ResetIcon /> Reset
          </Button>
          {demoRunning ? (
            <Button onClick={onStopDemo} disabled={disabled} variant="danger">
              <StopIcon /> Stop demo
            </Button>
          ) : (
            <Button onClick={onRunDemo} disabled={disabled} variant="primary">
              <PlayIcon /> Run Demo
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}

function Logo() {
  return (
    <svg width="34" height="34" viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="8" fill="#111821" stroke="#243041" />
      <path d="M5 17h6l3-7 4 13 3-6h6" fill="none" stroke="#22d3ee" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const icon = 'h-3.5 w-3.5';
const PlayIcon = () => (
  <svg className={icon} viewBox="0 0 16 16" fill="currentColor"><path d="M4 2.5v11l9-5.5z" /></svg>
);
const PauseIcon = () => (
  <svg className={icon} viewBox="0 0 16 16" fill="currentColor"><path d="M4 2h3v12H4zM9 2h3v12H9z" /></svg>
);
const StopIcon = () => (
  <svg className={icon} viewBox="0 0 16 16" fill="currentColor"><rect x="3" y="3" width="10" height="10" rx="1" /></svg>
);
const ResetIcon = () => (
  <svg className={icon} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
    <path d="M2.5 8a5.5 5.5 0 1 0 1.6-3.9M2.5 2.5v3h3" />
  </svg>
);
