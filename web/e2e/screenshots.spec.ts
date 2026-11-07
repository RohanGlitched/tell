// Copyright (C) 2026 Rohan Borade
// SPDX-License-Identifier: Apache-2.0
//
// Full-page screenshots of every page at desktop and phone width, into e2e/screenshots/
// (git-ignored). Opt in: SHOTS=1 npx playwright test screenshots
// Narrow the set with SHOT_PAGES=/,/scan and SHOT_WIDTHS=390.

import path from 'node:path';
import { expect, test } from '@playwright/test';

const PAGES = (process.env.SHOT_PAGES ?? '/,/scan,/wave3,/adoption,/teams,/desk,/survey,/zoo,/live,/how,/missing-page').split(',');
const WIDTHS = (process.env.SHOT_WIDTHS ?? '1440,390').split(',').map(Number);
const OUT = path.join(import.meta.dirname, 'screenshots');

test.skip(!process.env.SHOTS, 'set SHOTS=1 to write screenshots');

for (const width of WIDTHS)
  for (const p of PAGES)
    test(`screenshot ${p} at ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: width > 800 ? 900 : 844 });
      await page.goto(p);
      if (p === '/scan') {
        await page.getByRole('button', { name: 'Scan this contract' }).click();
        await expect(page.getByLabel('Grade F').first()).toBeVisible();
      }
      await page.waitForLoadState('networkidle').catch(() => {});
      const name = `${p === '/' ? 'home' : p.slice(1)}-${width}`;
      await page.screenshot({ path: path.join(OUT, `${name}-fold.png`) });
      await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
      // no sideways scrolling at any width
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    });
