/**
 * CORS origin handling shared by Express and Socket.IO.
 *
 * Allowed origins = local development frontends + everything listed in
 * FRONTEND_URL (comma-separated). An entry may contain `*` as a wildcard,
 * e.g. `https://healnet-*.vercel.app` to also allow Vercel preview deployments.
 */
export const DEV_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:4173', 'http://127.0.0.1:4173'];

const normalize = (origin: string) => origin.trim().replace(/\/+$/, '').toLowerCase();

export function parseAllowedOrigins(frontendUrl: string | undefined): string[] {
  const configured = (frontendUrl ?? '').split(',').map(normalize).filter(Boolean);
  return [...new Set([...DEV_ORIGINS, ...configured])];
}

export function isOriginAllowed(origin: string | undefined, allowed: string[]): boolean {
  // Requests without an Origin header (curl, Render health checks, same-origin) are not CORS requests.
  if (!origin) return true;
  const o = normalize(origin);
  return allowed.some((entry) => {
    if (!entry.includes('*')) return entry === o;
    const pattern = entry.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[a-z0-9-]*');
    return new RegExp(`^${pattern}$`).test(o);
  });
}
