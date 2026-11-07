'use client';
// Copyright (C) 2026 Rohan Borade
// SPDX-License-Identifier: Apache-2.0
//
// Vercel Web Analytics: cookieless page views, counted by Vercel for this deployment. A share
// link carries the scanned contract in the URL fragment (#c=…), so every event is stripped to
// the path before it leaves the browser: the contract is never part of an analytics event.

import { Analytics } from '@vercel/analytics/next';

export default function SiteAnalytics() {
  return <Analytics beforeSend={(event) => ({ ...event, url: event.url.split('#')[0] })} />;
}
