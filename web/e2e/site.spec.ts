// Copyright (C) 2026 Rohan Borade
// SPDX-License-Identifier: Apache-2.0

import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import samples from '../data/samples.json' with { type: 'json' };
import wave3 from '../data/wave3.json' with { type: 'json' };

const leaky = samples.find((s) => s.id === 'ballot-leaky')!;
const fixed = samples.find((s) => s.id === 'ballot-fixed')!;
const FIX_DIFF = fs.readFileSync(path.join(import.meta.dirname, 'fixtures', 'ballot.diff'), 'utf8');

async function scanDefault(page: Page) {
  await page.goto('/scan');
  await expect(page.locator('#src')).toHaveValue(leaky.source);
  await page.getByRole('button', { name: 'Scan this contract' }).click();
  await expect(page.getByLabel('Grade F').first()).toBeVisible();
}

// severity pills inside the report (the leak map and legend are not counted)
const pills = (page: Page, sev: string) => page.locator(`[data-testid="report-page"] .sev[data-sev="${sev}"]`);

test('home page loads with the Wave 3 band', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/Tell/);
  await expect(page.getByRole('heading', { level: 1, name: 'Your contract hides the vote. The ledger still shows it.' })).toBeVisible();
  // the hero ledger is the real Preprod deployment: six votes, each one showing through
  await expect(page.locator('figure .bar.see')).toHaveCount(6);
  const band = page.getByTestId('wave3-band');
  await expect(band).toBeVisible();
  await expect(band.getByRole('link', { name: 'Read the whole list' })).toHaveAttribute('href', '/wave3');
});

test('the default leaky ballot grades F with a critical finding', async ({ page }) => {
  await scanDefault(page);
  await expect(page.locator('[data-testid="finding"]', { hasText: 'Guessable hash' }).locator('.sev[data-sev="critical"]')).toBeVisible();
  await expect(page.getByTestId('fix-view').first()).toContainText('Fix:');
  await expect(page.getByRole('heading', { name: /F-1|Findings/ }).first()).toBeVisible();
});

test('the fixed ballot grades B', async ({ page }) => {
  await page.goto('/scan');
  await page.getByRole('button', { name: 'Fixed ballot' }).click();
  await expect(page.getByLabel('Grade B').first()).toBeVisible();
  await expect(pills(page, 'critical')).toHaveCount(0);
});

test('a share link restores the contract and scans it again', async ({ page, context }) => {
  await page.goto('/scan');
  await page.getByRole('button', { name: 'Fixed ballot' }).click();
  await expect(page.getByLabel('Grade B').first()).toBeVisible();
  // the address bar carries the share link; nothing about it is sent to the server
  await expect.poll(() => new URL(page.url()).hash).toMatch(/^#c=[A-Za-z0-9_-]+$/);
  const link = page.url();

  const other = await context.newPage();
  const sent: string[] = [];
  other.on('request', (r) => sent.push(r.url()));
  await other.goto(link);
  await expect(other.locator('#src')).toHaveValue(fixed.source);
  await expect(other.getByLabel('Grade B').first()).toBeVisible();
  const fragment = new URL(link).hash.slice(1);
  expect(sent.some((u) => u.includes(fragment))).toBe(false);
});

test('a damaged share link says so', async ({ page }) => {
  await page.goto('/scan#c=not-a-real-link');
  await expect(page.getByRole('alert').filter({ hasText: 'damaged' })).toBeVisible();
});

test('a verified fix re-scans and shows the grade before and after', async ({ page }) => {
  // The engine's auto-fix ships separately; here the first scan answer carries a patch in the
  // documented shape, and the re-scan runs for real against the patched source.
  let first = true;
  await page.route('**/api/scan', async (route) => {
    if (!first) return route.continue();
    first = false;
    const res = await route.fetch();
    const json = await res.json();
    for (const c of json.contracts)
      for (const f of c.report.findings) if (f.severity === 'critical') f.fix = { text: f.fix, diff: FIX_DIFF, verified: true, gradeAfter: 'B' };
    await route.fulfill({ response: res, json });
  });
  await scanDefault(page);
  await expect(page.getByRole('figure', { name: 'Proposed patch, unified diff' }).first()).toContainText('persistentCommit');
  await expect(page.getByText('Finding gone').first()).toBeVisible();
  await page.getByTestId('rescan-with-fix').first().click();
  const compare = page.getByTestId('fix-compare');
  await expect(compare).toBeVisible();
  await expect(compare).toContainText('Grade F before the fix, B after');
  await expect(page.locator('#src')).toHaveValue(fixed.source);
  await compare.getByRole('button', { name: 'Undo the fix' }).click();
  await expect(page.locator('#src')).toHaveValue(leaky.source);
  await expect(page.getByLabel('Grade F').first()).toBeVisible();
});

test('reports download as JSON, SARIF and Markdown', async ({ page }) => {
  await scanDefault(page);
  for (const [ext, check] of [
    ['json', (t: string) => expect(JSON.parse(t).contracts[0].grade).toBe('F')],
    ['sarif', (t: string) => expect(JSON.parse(t).version).toBe('2.1.0')],
    ['md', (t: string) => expect(t).toContain('# Tell privacy report')],
  ] as const) {
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId(`download-${ext}`).click()]);
    expect(dl.suggestedFilename()).toMatch(new RegExp(`\\.${ext}$`));
    check(fs.readFileSync((await dl.path())!, 'utf8'));
  }
});

test('/wave3 shows every feedback row and every criterion', async ({ page }) => {
  await page.goto('/wave3');
  await expect(page.getByRole('heading', { level: 1, name: 'You said. We did.' })).toBeVisible();
  await expect(page.getByTestId('feedback-row')).toHaveCount(wave3.feedback.length);
  for (const c of wave3.criteria) await expect(page.getByTestId(`criterion-${c.id}`)).toBeVisible();
  await expect(page.getByText('Deploy to testnet and add the contract address to your README', { exact: false })).toBeVisible();
});

test('/adoption renders and never links a team repository', async ({ page }) => {
  await page.goto('/adoption');
  await expect(page.getByRole('heading', { level: 1, name: 'Who uses Tell' })).toBeVisible();
  await expect(page.getByTestId('outreach-table').first()).toBeVisible();
  const hrefs = await page.locator('main a[href*="github.com"]').evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).href));
  for (const h of hrefs) expect(h).toMatch(/github\.com\/(RohanGlitched\/tell|midnightntwrk\/)/i);
});

test('/teams opens a prefilled GitHub issue', async ({ page }) => {
  await page.goto('/teams');
  await expect(page.getByTestId('segment')).toHaveCount(5);
  const href = await page.getByTestId('interest-link').getAttribute('href');
  expect(href).toMatch(/^https:\/\/github\.com\/RohanGlitched\/tell\/issues\/new\?/);
  expect(new URL(href!).searchParams.get('title')).toContain('Interest:');
});

test('/desk shows the public ledger beside the private state', async ({ page }) => {
  await page.goto('/desk');
  const ledger = page.getByTestId('dual-ledger');
  await expect(ledger.getByRole('region', { name: 'Public ledger' })).toBeVisible();
  await expect(ledger.getByRole('region', { name: 'Your private state' })).toBeVisible();
  await expect(page.getByTestId('desk-wallet-slot')).toBeVisible();
  await expect(page.getByTestId('desk-registry-slot')).toBeVisible();
});

test('the badge route answers SVG', async ({ request }) => {
  const r = await request.get('/api/badge/bad..owner/repo');
  expect(r.status()).toBe(200);
  expect(r.headers()['content-type']).toContain('image/svg+xml');
  const svg = await r.text();
  expect(svg).toMatch(/^<svg[^>]+xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  expect(svg).toContain('Tell');
  expect(svg).toContain('not found');
  expect(r.headers()['cache-control']).toContain('s-maxage');
});

// Scans a real repository (GitHub and the compiler): opt in with TELL_E2E_NETWORK=1.
test('the badge grades a real repository', async ({ request }) => {
  test.skip(!process.env.TELL_E2E_NETWORK, 'set TELL_E2E_NETWORK=1 to scan a real repository');
  const r = await request.get('/api/badge/midnightntwrk/example-bboard', { timeout: 80_000 });
  expect(r.headers()['content-type']).toContain('image/svg+xml');
  expect(await r.text()).toMatch(/grade [ABCDF]/);
});

test('phones get a menu with every page', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/');
  const menu = page.locator('#mobile-nav');
  // the button works once the page has hydrated; retry the click until the menu opens
  await expect(async () => {
    if (!(await menu.isVisible())) await page.getByRole('button', { name: 'Menu' }).click();
    await expect(menu).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 30_000 });
  for (const name of ['Scan', 'Live', 'Tell Desk', 'Survey', 'Leak zoo', 'For teams', 'How it works', 'Wave 3', 'Adoption'])
    await expect(menu.getByRole('link', { name, exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  // no sideways scrolling on a phone
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
});
