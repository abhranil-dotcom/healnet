import type { PresetId } from '../../../../shared/types';
import type { PresetsState } from '../../hooks/usePresets';
import { cx } from '../../lib/format';
import { Button } from '../ui';

export function PresetPicker({ presets, loadedId, disabled, disabledReason, onLoad, onRetry }: {
  presets: PresetsState;
  loadedId: PresetId | null;
  disabled: boolean;
  disabledReason?: string;
  onLoad: (id: PresetId) => void;
  onRetry: () => void;
}) {
  if (presets.presets.length === 0) {
    return presets.status === 'error' ? (
      <div className="flex flex-wrap items-center gap-3 p-4 text-xs text-rose-300" role="alert">
        Could not load presets: {presets.error}
        <Button size="sm" onClick={onRetry}>Retry</Button>
      </div>
    ) : (
      <p className="p-4 text-xs text-slate-500">Loading presets…</p>
    );
  }

  return (
    <div className="p-4">
      {disabled && disabledReason && <p className="mb-3 text-[11px] text-amber-300/80">{disabledReason}</p>}
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
        {presets.presets.map((p) => {
          const loaded = p.id === loadedId;
          return (
            <li
              key={p.id}
              data-testid={`preset-${p.id}`}
              className={cx(
                'flex flex-col gap-2 rounded-lg border bg-ink-950/50 p-3',
                loaded ? 'border-cyan-500/50 shadow-[0_0_0_3px_rgba(34,211,238,0.08)]' : 'border-ink-700/70',
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-medium text-slate-100">{p.name}</h3>
                {loaded && <span className="rounded-md border border-cyan-500/40 bg-cyan-500/10 px-1.5 py-px text-[10px] text-cyan-200">Loaded</span>}
              </div>
              <p className="flex-1 text-xs leading-relaxed text-slate-400">{p.description}</p>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono text-[10px] whitespace-nowrap text-slate-500">
                  {p.nodeCount} nodes · {p.linkCount} links · {p.source} → {p.destination}
                </span>
                <Button size="sm" variant={loaded ? 'default' : 'primary'} disabled={disabled} onClick={() => onLoad(p.id)} aria-label={`Load ${p.name}`}>
                  {loaded ? 'Reload' : 'Load'}
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
