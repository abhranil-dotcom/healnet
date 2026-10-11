import { describe, expect, it } from 'vitest';
import { isOriginAllowed, parseAllowedOrigins } from '../src/origins.js';

describe('CORS origins', () => {
  it('always allows the local Vite dev server', () => {
    const allowed = parseAllowedOrigins(undefined);
    expect(isOriginAllowed('http://localhost:5173', allowed)).toBe(true);
    expect(isOriginAllowed('https://evil.example', allowed)).toBe(false);
  });

  it('reads a comma-separated FRONTEND_URL and ignores trailing slashes / case', () => {
    const allowed = parseAllowedOrigins(' https://healnet.vercel.app/ , https://Demo.example.com');
    expect(isOriginAllowed('https://healnet.vercel.app', allowed)).toBe(true);
    expect(isOriginAllowed('https://demo.example.com', allowed)).toBe(true);
    expect(isOriginAllowed('https://healnet.vercel.app.evil.com', allowed)).toBe(false);
  });

  it('supports wildcard entries for Vercel preview URLs', () => {
    const allowed = parseAllowedOrigins('https://healnet-*.vercel.app');
    expect(isOriginAllowed('https://healnet-git-main-abc123.vercel.app', allowed)).toBe(true);
    expect(isOriginAllowed('https://other.vercel.app', allowed)).toBe(false);
    expect(isOriginAllowed('https://healnet-x.vercel.app.evil.com', allowed)).toBe(false);
  });

  it('treats requests without an Origin header as allowed (health checks, curl)', () => {
    expect(isOriginAllowed(undefined, parseAllowedOrigins(''))).toBe(true);
  });
});
