import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from './test/app.ts';
import { testEnv } from './test/env.ts';

// A fake `apps/web/dist`, built in a temporary folder.
let root: string;
let dist: string;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'tasks-static-'));
  dist = path.join(root, 'dist');
  await mkdir(path.join(dist, 'assets'), { recursive: true });
  await writeFile(path.join(dist, 'index.html'), '<!doctype html><title>Tasks</title>');
  await writeFile(path.join(dist, 'assets', 'index-3f9a1c.js'), 'console.log("app")');
  await writeFile(path.join(dist, 'sw.js'), 'self.addEventListener("fetch", () => {})');
  await writeFile(path.join(dist, 'manifest.webmanifest'), '{"name":"Tasks"}');
  // Outside dist: must never be reachable.
  await writeFile(path.join(root, 'secret.txt'), 'top secret');
});
afterAll(() => rm(root, { recursive: true, force: true }));

function siteApp() {
  return createTestApp({ env: testEnv({ STATIC_DIR: dist }) }).app;
}

describe('serving the PWA from STATIC_DIR', () => {
  it('serves index.html at / and asks the browser to revalidate it', async () => {
    const response = await siteApp().request('/');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toMatch(/^text\/html/);
    expect(response.headers.get('cache-control')).toBe('no-cache');
    expect(await response.text()).toContain('<title>Tasks</title>');
  });

  it('caches hashed assets for a year', async () => {
    const response = await siteApp().request('/assets/index-3f9a1c.js');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toMatch(/javascript/);
    expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
  });

  it.each([
    ['/sw.js', /javascript/],
    ['/manifest.webmanifest', /^application\/manifest\+json/],
  ])('never lets %s go stale', async (file, type) => {
    const response = await siteApp().request(file);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toMatch(type);
    expect(response.headers.get('cache-control')).toBe('no-cache');
  });

  it('answers app routes such as /settings with index.html', async () => {
    const response = await siteApp().request('/settings/profile');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-cache');
    expect(await response.text()).toContain('<title>Tasks</title>');
  });

  it('answers a missing hashed asset with a 404, not index.html', async () => {
    const response = await siteApp().request('/assets/gone-123.js');
    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toBe('application/problem+json');
    expect(response.headers.get('cache-control')).toBeNull();
  });

  it.each(['/api/v1/me', '/api/v1/unknown', '/api'])(
    'never answers %s with index.html',
    async (apiPath) => {
      const response = await siteApp().request(apiPath);
      expect(response.status).toBe(401);
      expect(response.headers.get('content-type')).toBe('application/problem+json');
    },
  );

  it('still answers /healthz with JSON', async () => {
    const response = await siteApp().request('/healthz');
    expect(response.headers.get('content-type')).toMatch(/^application\/json/);
  });

  it('never serves files from outside the folder', async () => {
    for (const attempt of ['/../secret.txt', '/%2e%2e/secret.txt', '/..%2fsecret.txt']) {
      const response = await siteApp().request(attempt);
      expect(await response.text()).not.toContain('top secret');
    }
  });

  it('adds the security headers to static files too', async () => {
    const response = await siteApp().request('/');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  });
});

describe('without STATIC_DIR (development)', () => {
  it('serves no files: Vite does that', async () => {
    const response = await createTestApp().app.request('/');
    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toBe('application/problem+json');
  });
});
