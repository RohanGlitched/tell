// Copyright (C) 2026 Rohan Borade
// SPDX-License-Identifier: Apache-2.0
//
// The scan API's answers: 400 for a body that is not a contract or a repository, 413 for one too
// large, 404 for a repository that does not exist, 422 for a contract that does not compile (with
// the compiler's message), 200 for a scan. Runs against the same server as site.spec.ts.

import { expect, test, type APIRequestContext } from '@playwright/test';
import samples from '../data/samples.json' with { type: 'json' };

const leaky = samples.find((s) => s.id === 'ballot-leaky')!;
// Parses, but `nope` is not defined: the compiler rejects it.
const BROKEN = 'pragma language_version >= 0.16;\n\nexport circuit broken(): Field {\n  return nope;\n}\n';

const scan = (request: APIRequestContext, data: unknown, raw = false) =>
  request.post('/api/scan', raw ? { data: data as string, headers: { 'content-type': 'application/json' } } : { data });

test.describe('POST /api/scan', () => {
  test('an empty body is a 400', async ({ request }) => {
    const r = await request.post('/api/scan');
    expect(r.status()).toBe(400);
    expect((await r.json()).error).toMatch(/Send JSON/);
  });

  test('a body that is not JSON, or not an object, is a 400', async ({ request }) => {
    for (const body of ['{"source": ', 'null', '[]', '"pragma language_version >= 0.16;"', '42']) {
      const r = await scan(request, body, true);
      expect(r.status(), body).toBe(400);
      expect((await r.json()).error, body).toMatch(/Send JSON/);
    }
  });

  test('a source or repository of the wrong type is a 400', async ({ request }) => {
    for (const body of [{}, { source: 42 }, { source: ['pragma'] }, { repo: 7 }, { repo: '' }, { name: 'x.compact' }]) {
      const r = await scan(request, body);
      expect(r.status(), JSON.stringify(body)).toBe(400);
      expect((await r.json()).error).toMatch(/Send a contract/);
    }
  });

  test('text that is not a Compact contract, or one that includes files, is a 400', async ({ request }) => {
    let r = await scan(request, { source: 'hello' });
    expect(r.status()).toBe(400);
    expect((await r.json()).error).toMatch(/pragma language_version/);
    r = await scan(request, { source: 'pragma language_version >= 0.16;\ninclude "../../etc/passwd";\n' });
    expect(r.status()).toBe(400);
    expect((await r.json()).error).toMatch(/cannot include or import/);
  });

  test('a malformed repository name is a 400', async ({ request }) => {
    const r = await scan(request, { repo: 'not a repository!' });
    expect(r.status()).toBe(400);
    expect((await r.json()).error).toMatch(/public GitHub repository/);
  });

  test('an oversized contract is a 413', async ({ request }) => {
    const r = await scan(request, { source: `pragma language_version >= 0.16;\n// ${'x'.repeat(200_001)}\n` });
    expect(r.status()).toBe(413);
    expect((await r.json()).error).toMatch(/the limit is 200 kB/);
  });

  test('a contract that does not compile is a 422 with the compiler’s message', async ({ request }) => {
    const r = await scan(request, { source: BROKEN, name: 'broken.compact' });
    expect(r.status()).toBe(422);
    const j = await r.json();
    expect(j.error).toMatch(/unbound identifier nope/);
    expect(j.kind).toBe('source');
    expect(j.contracts).toHaveLength(1);
    expect(j.contracts[0]).toMatchObject({ file: 'broken.compact', ok: false });
    expect(j.contracts[0].error).toMatch(/line 4/);
  });

  test('a sample scans with 200 and grade F', async ({ request }) => {
    const r = await scan(request, { source: leaky.source, name: 'ballot-leaky.compact' });
    expect(r.status()).toBe(200);
    const j = await r.json();
    expect(j.error).toBeUndefined();
    expect(j.contracts[0]).toMatchObject({ ok: true, grade: 'F', file: 'ballot-leaky.compact' });
  });

  // Asks GitHub (codeload answers 404); runs in CI, where GitHub is always reachable, or with TELL_E2E_NETWORK=1.
  test('a repository that does not exist is a 404', async ({ request }) => {
    test.skip(!process.env.TELL_E2E_NETWORK && !process.env.CI, 'needs GitHub: set TELL_E2E_NETWORK=1');
    const r = await scan(request, { repo: 'RohanGlitched/no-such-repository-for-tell-tests' });
    expect(r.status()).toBe(404);
    expect((await r.json()).error).toMatch(/was not found, or it is private/);
  });

  test('GET explains the API and its status codes', async ({ request }) => {
    const r = await request.get('/api/scan');
    expect(r.status()).toBe(200);
    const j = await r.json();
    expect(j.usage).toMatch(/POST JSON/);
    expect(Object.keys(j.status)).toEqual(expect.arrayContaining(['200', '400', '404', '413', '422']));
  });
});

test('the scanner shows the compiler’s message for a contract that does not compile', async ({ page }) => {
  await page.goto('/scan');
  await page.locator('#src').fill(BROKEN);
  await page.getByRole('button', { name: 'Scan this contract' }).click();
  await expect(page.getByText('This contract did not compile, so there is nothing to trace yet')).toBeVisible();
  await expect(page.locator('pre', { hasText: 'unbound identifier nope' })).toBeVisible();
  await expect(page.getByText(/The scan failed/)).toHaveCount(0);
});
