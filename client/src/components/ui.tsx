import type { ButtonHTMLAttributes, ReactNode } from 'react';
import type { LinkStatus, NodeStatus, SystemStatus } from '../../../shared/types';
import { cx } from '../lib/format';

export function Panel({ title, subtitle, actions, children, className }: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cx('flex flex-col rounded-xl border border-ink-700/70 bg-ink-900', className)}>
      <header className="flex items-center justify-between gap-3 border-b border-ink-700/60 px-4 py-2.5">
        <div className="min-w-0">
          <h2 className="text-[11px] font-semibold tracking-[0.12em] text-slate-400 uppercase">{title}</h2>
          {subtitle && <p className="truncate text-xs text-slate-500">{subtitle}</p>}
        </div>
        {actions}
      </header>
      <div className="min-h-0 flex-1">{children}</div>
    </section>
  );
}

type Variant = 'primary' | 'default' | 'danger' | 'success' | 'ghost';
const variants: Record<Variant, string> = {
  primary: 'bg-cyan-500 text-ink-950 hover:bg-cyan-400 border-cyan-400',
  default: 'bg-ink-800 text-slate-200 hover:bg-ink-700 border-ink-600',
  danger: 'bg-rose-500/10 text-rose-300 hover:bg-rose-500/20 border-rose-500/40',
  success: 'bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 border-emerald-500/40',
  ghost: 'bg-transparent text-slate-400 hover:text-slate-200 hover:bg-ink-800 border-transparent',
};

export function Button({ variant = 'default', size = 'md', className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: 'sm' | 'md';
}) {
  return (
    <button
      {...props}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-lg border font-medium transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-cyan-400',
        size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3.5 py-1.5 text-sm',
        variants[variant],
        className,
      )}
    />
  );
}

export const nodeStatusStyle: Record<NodeStatus, string> = {
  ACTIVE: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30',
  SUSPECT: 'text-amber-300 bg-amber-500/10 border-amber-500/30',
  FAILED: 'text-rose-300 bg-rose-500/10 border-rose-500/30',
};

export const linkStatusStyle: Record<LinkStatus, string> = {
  UP: nodeStatusStyle.ACTIVE,
  SUSPECT: nodeStatusStyle.SUSPECT,
  DOWN: nodeStatusStyle.FAILED,
};

export const systemStatusStyle: Record<SystemStatus, { label: string; cls: string; dot: string }> = {
  OPERATIONAL: { label: 'Operational', cls: 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10', dot: 'bg-emerald-400' },
  DETECTING: { label: 'Detecting fault', cls: 'text-amber-300 border-amber-500/30 bg-amber-500/10', dot: 'bg-amber-400' },
  DEGRADED: { label: 'Degraded · rerouted', cls: 'text-sky-300 border-sky-500/30 bg-sky-500/10', dot: 'bg-sky-400' },
  UNAVAILABLE: { label: 'Communication unavailable', cls: 'text-rose-300 border-rose-500/30 bg-rose-500/10', dot: 'bg-rose-400' },
};

export function Badge({ className, children }: { className: string; children: ReactNode }) {
  return (
    <span className={cx('inline-flex items-center rounded-md border px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-wide', className)}>
      {children}
    </span>
  );
}
