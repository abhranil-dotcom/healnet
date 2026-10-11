/**
 * Backend location, set at build time through Vite env variables.
 *
 *   VITE_API_URL     base URL for HTTP requests  (e.g. https://healnet-server.onrender.com)
 *   VITE_SOCKET_URL  Socket.IO server URL         (usually the same as VITE_API_URL)
 *
 * Defaults: in development (`npm run dev`) the local server at http://localhost:4000.
 * In a production build without these variables, the page's own origin is used,
 * which is correct when the Express server serves the built dashboard itself.
 */
const DEV_SERVER = 'http://localhost:4000';

const clean = (url: string | undefined) => url?.trim().replace(/\/+$/, '') || undefined;
const fallback = import.meta.env.DEV ? DEV_SERVER : window.location.origin;

export const API_URL = clean(import.meta.env.VITE_API_URL) ?? fallback;
export const SOCKET_URL = clean(import.meta.env.VITE_SOCKET_URL) ?? clean(import.meta.env.VITE_API_URL) ?? fallback;
