// Copyright (C) 2026 Rohan Borade
// SPDX-License-Identifier: Apache-2.0
//
// Applies a unified diff (the engine's proposed fix) to the scanned source, so the
// scanner can re-scan the patched contract. Hunks are matched on their context lines;
// a hunk may sit a few lines away from where its header says (an edited source).

export type ParsedLine = { kind: ' ' | '-' | '+'; text: string };
export type Hunk = { oldStart: number; lines: ParsedLine[] };

const HEADER = /^@@ -(\d+)(?:,\d+)? \+\d+(?:,\d+)? @@/;

export function parseDiff(diff: string): Hunk[] {
  const hunks: Hunk[] = [];
  let cur: Hunk | null = null;
  // the diff's own final newline is not a blank context line
  for (const raw of diff.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n')) {
    const h = raw.match(HEADER);
    if (h) {
      cur = { oldStart: Number(h[1]), lines: [] };
      hunks.push(cur);
      continue;
    }
    if (!cur || raw.startsWith('\\')) continue; // file headers before the first hunk, "\ No newline at end of file"
    // a new file's "--- a/x" / "+++ b/x" headers end the current hunk
    if (isFileHeader(raw) || raw.startsWith('diff ')) {
      cur = null;
      continue;
    }
    const k = raw[0];
    if (k === ' ' || k === '-' || k === '+') cur.lines.push({ kind: k, text: raw.slice(1) });
    else if (raw === '') cur.lines.push({ kind: ' ', text: '' }); // some tools drop the space on blank context lines
  }
  return hunks.filter((h) => h.lines.some((l) => l.kind !== ' '));
}

// "--- a/contract.compact" or "+++ b/contract.compact": a path, not a removed line of code.
const isFileHeader = (raw: string) => /^(---|\+\+\+) (a\/|b\/|\/dev\/null)/.test(raw);

export type Applied = { ok: true; text: string } | { ok: false; error: string };

export function applyDiff(source: string, diff: string): Applied {
  const hunks = parseDiff(diff);
  if (hunks.length === 0) return { ok: false, error: 'The patch has no changes in it.' };
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  let offset = 0;
  for (const h of hunks) {
    const before = h.lines.filter((l) => l.kind !== '+').map((l) => l.text);
    const after = h.lines.filter((l) => l.kind !== '-').map((l) => l.text);
    const want = Math.max(0, h.oldStart - 1 + offset);
    const at = find(lines, before, want);
    if (at < 0) return { ok: false, error: `The patch does not match the source near line ${h.oldStart}. Scan the original contract and try again.` };
    lines.splice(at, before.length, ...after);
    offset += at - (h.oldStart - 1 + offset) + after.length - before.length;
  }
  return { ok: true, text: lines.join(eol) };
}

// The nearest place `block` occurs, searching outward from `want`; trailing whitespace is ignored.
function find(lines: string[], block: string[], want: number): number {
  const same = (a: string, b: string) => a.trimEnd() === b.trimEnd();
  const fits = (i: number) => i >= 0 && i + block.length <= lines.length && block.every((b, j) => same(lines[i + j], b));
  if (block.length === 0) return Math.min(want, lines.length);
  for (let d = 0; d <= lines.length; d++) {
    if (fits(want - d)) return want - d;
    if (d && fits(want + d)) return want + d;
  }
  return -1;
}
