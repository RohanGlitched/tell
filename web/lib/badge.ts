// Copyright (C) 2026 Rohan Borade
// SPDX-License-Identifier: Apache-2.0
//
// The README badge: "Tell | grade B". Drawn by the /api/badge route and, from a scan
// already on screen, by the scanner itself. No Node imports: used on both sides.

import type { Grade } from './types';

const COLOR: Record<Grade, string> = { A: '#2f7d4f', B: '#4d7f2a', C: '#b06a00', D: '#d3263a', F: '#d3263a' };
const GREY = '#6f788b';
const LABEL_BG = '#1a1040';

// Verdana 11px advance widths, rounded: enough to size a badge without a font engine.
function width(text: string): number {
  let w = 0;
  for (const ch of text) w += /[A-Z]/.test(ch) ? 7.5 : /[ilj.,:|' ]/.test(ch) ? 3.6 : /[mw]/.test(ch) ? 9.5 : 6.4;
  return Math.ceil(w);
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export type BadgeState = Grade | 'no contracts' | 'not compiled' | 'unknown' | 'not found';

export function badgeSvg(state: BadgeState): string {
  const isGrade = /^[ABCDF]$/.test(state);
  const label = 'Tell';
  const value = isGrade ? `grade ${state}` : state;
  const color = isGrade ? COLOR[state as Grade] : GREY;
  const lw = width(label) + 14;
  const vw = width(value) + 14;
  const total = lw + vw;
  const title = `Tell privacy grade: ${state}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${total}" height="20" role="img" aria-label="${esc(title)}"><title>${esc(title)}</title><linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient><clipPath id="r"><rect width="${total}" height="20" rx="3" fill="#fff"/></clipPath><g clip-path="url(#r)"><rect width="${lw}" height="20" fill="${LABEL_BG}"/><rect x="${lw}" width="${vw}" height="20" fill="${color}"/><rect width="${total}" height="20" fill="url(#s)"/></g><g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11"><text x="${lw / 2}" y="15" fill="#010101" fill-opacity=".3">${esc(label)}</text><text x="${lw / 2}" y="14">${esc(label)}</text><text x="${lw + vw / 2}" y="15" fill="#010101" fill-opacity=".3">${esc(value)}</text><text x="${lw + vw / 2}" y="14">${esc(value)}</text></g></svg>`;
}

// GitHub owner and repository names: what GitHub itself allows, nothing else.
export function validRepo(owner: string, name: string): boolean {
  return /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(owner) && /^[A-Za-z0-9._-]{1,100}$/.test(name) && name !== '.' && name !== '..';
}

export function badgeMarkdown(site: string, repo: string): string {
  return `[![Tell privacy grade](${site}/api/badge/${repo})](${site}/scan#r=${repo})`;
}
