// Copyright (C) 2026 Rohan Borade
// SPDX-License-Identifier: Apache-2.0
//
// The numeric families kept as precomputed tables, shared by `scan` and `radar tables`.

import type { Family } from './families.js';

export function numericTables(uintMax: number): Family[] {
  return ([4, 8, 16, 32] as const).map((width) => ({ kind: 'uint', width, count: width === 16 ? Math.min(uintMax, 1 << 20) : uintMax }));
}
