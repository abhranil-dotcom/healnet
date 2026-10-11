import { useCallback, useEffect, useState } from 'react';
import type { PresetInfo, TopologyLimits } from '../../../shared/types';
import { API_URL } from '../lib/config';
import { DEFAULT_LIMITS } from '../lib/validateDraft';

export type PresetsState =
  | { status: 'loading'; presets: PresetInfo[]; limits: TopologyLimits }
  | { status: 'ready'; presets: PresetInfo[]; limits: TopologyLimits }
  | { status: 'error'; presets: PresetInfo[]; limits: TopologyLimits; error: string };

/** Preset list and validation limits served by GET /api/presets. Retries when `retryKey` changes (e.g. on reconnect). */
export function usePresets(retryKey: unknown) {
  const [state, setState] = useState<PresetsState>({ status: 'loading', presets: [], limits: DEFAULT_LIMITS });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState((s) => (s.status === 'ready' ? s : { status: 'loading', presets: s.presets, limits: s.limits }));
    fetch(`${API_URL}/api/presets`)
      .then(async (res) => {
        if (!res.ok) throw new Error(res.status === 404 ? 'This server does not support topology presets yet' : `Server returned ${res.status}`);
        const body = (await res.json()) as { presets: PresetInfo[]; limits: TopologyLimits };
        if (!cancelled) setState({ status: 'ready', presets: body.presets, limits: { ...DEFAULT_LIMITS, ...body.limits } });
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setState((s) => ({ status: 'error', presets: s.presets, limits: s.limits, error: err instanceof Error ? err.message : 'Could not load presets' }));
      });
    return () => {
      cancelled = true;
    };
  }, [retryKey, attempt]);

  const retry = useCallback(() => setAttempt((a) => a + 1), []);
  return { ...state, retry };
}
