// Copyright (C) 2026 Rohan Borade
// SPDX-License-Identifier: Apache-2.0
//
// Full-page screenshots of the pages, at desktop and phone width, into e2e/screenshots/
// (git-ignored). Opt in: SHOTS=1 npx playwright test screenshots

import path from 'node:path';
import { expect, test } from '@playwright/test';

const PAGES = ['/', '/wave3', '/adoption', '/teams', '/desk', '/scan'];
const WIDTHS = [1440, 375];
const OUT = path.join(import.meta.dirname, 'screenshots');

test.skip(!process.env.SHOTS, 'set SHOTS=1 to write screenshots');

for (const width of WIDTHS)
  for (const p of PAGES)
    test(`screenshot ${p} at ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: width > 800 ? 900 : 812 });
      await page.goto(p);
      if (p === '/scan') {
        await page.getByRole('button', { name: 'Scan this contract' }).click();
        await expect(page.getByLabel('Grade F')).toBeVisible();
      }
      await page.waitForLoadState('networkidle');
      const name = `${p === '/' ? 'home' : p.slice(1)}-${width}.png`;
      await page.screenshot({ path: path.join(OUT, name), fullPage: true });
    });
