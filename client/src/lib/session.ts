const KEY = 'healnet.sessionId';

function randomId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
}

/**
 * Per-tab simulation session id. sessionStorage is scoped to one tab, so every
 * tab gets its own simulation on the server while a reload keeps the same one.
 */
export function getTabSessionId(): string {
  try {
    const existing = sessionStorage.getItem(KEY);
    if (existing && /^[A-Za-z0-9_-]{8,64}$/.test(existing)) return existing;
    const id = randomId();
    sessionStorage.setItem(KEY, id);
    return id;
  } catch {
    // Storage unavailable (e.g. blocked): still isolated, but a reload starts a new simulation.
    return randomId();
  }
}
