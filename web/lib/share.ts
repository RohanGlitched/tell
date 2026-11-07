// Copyright (C) 2026 Rohan Borade
// SPDX-License-Identifier: Apache-2.0
//
// Share links for the scanner. The scanned contract travels in the URL fragment
// (`#c=` raw deflate, base64url), which browsers never send to a server; a repository
// scan is `#r=owner/name`. Opening the link restores the input and scans it again.

import { deflateSync, inflateSync, strFromU8, strToU8 } from 'fflate';

const MAX_SHARED = 200_000; // the scanner's own limit on a pasted contract

function toBase64Url(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function encodeSource(source: string): string {
  return toBase64Url(deflateSync(strToU8(source), { level: 9 }));
}

export function decodeSource(encoded: string): string | null {
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(encoded)) return null;
    const text = strFromU8(inflateSync(fromBase64Url(encoded)));
    return text.length > 0 && text.length <= MAX_SHARED ? text : null;
  } catch {
    return null;
  }
}

export type Shared = { kind: 'source'; source: string } | { kind: 'repo'; repo: string };

// Reads `#c=…` or `#r=…` from a location hash ("#c=abc" or "c=abc").
export function readShare(hash: string): Shared | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const c = params.get('c');
  if (c) {
    const source = decodeSource(c);
    return source ? { kind: 'source', source } : null;
  }
  const r = params.get('r');
  if (r && /^[\w.-]{1,100}\/[\w.-]{1,100}$/.test(r)) return { kind: 'repo', repo: r };
  return null;
}

export function shareHash(s: Shared): string {
  return s.kind === 'source' ? `#c=${encodeSource(s.source)}` : `#r=${s.repo}`;
}
