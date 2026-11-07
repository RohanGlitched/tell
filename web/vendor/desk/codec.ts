// Copyright (C) 2026 Rohan Borade
// SPDX-License-Identifier: Apache-2.0
//
// Off-chain encodings shared by the client, the CLI and the website. Uses only Web
// Crypto, so it runs in Node 22+ and in browsers alike.

export const toHex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

export function fromHex(h: string): Uint8Array {
  const s = h.trim().replace(/^0x/, '');
  if (!/^[0-9a-fA-F]*$/.test(s) || s.length % 2) throw new Error(`not hex: ${h}`);
  return Uint8Array.from(s.match(/../g) ?? [], (x) => parseInt(x, 16));
}

export const randomBytes32 = (): Uint8Array => crypto.getRandomValues(new Uint8Array(32));

export async function sha256(data: Uint8Array | string): Promise<Uint8Array> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource));
}

/**
 * A repository URL in one canonical form, so that the researcher, the maintainer and
 * anyone verifying a reveal compute the same project id. GitHub owners and repository
 * names are case-insensitive, so the whole thing is lower-cased.
 */
export function canonicalRepo(url: string): string {
  return url
    .trim()
    .toLowerCase()
    .replace(/^git@([^:]+):/, 'https://$1/')
    .replace(/^[a-z+]+:\/\//, '')
    .replace(/^www\./, '')
    .replace(/[?#].*$/, '')
    .replace(/\.git$/, '')
    .replace(/\/+$/, '');
}

/** The project id the contract uses: SHA-256 of a domain tag and the canonical repository URL. */
export const projectId = (repoUrl: string): Promise<Uint8Array> => sha256(`tell-desk:project:${canonicalRepo(repoUrl)}`);

/** The digest a seal commits to: SHA-256 of the report's exact UTF-8 bytes. */
export const reportDigest = (text: string): Promise<Uint8Array> => sha256(text);

// Tell's grades, as the contract stores them.
export const GRADES = ['A', 'B', 'C', 'D', 'F'] as const;
export type GradeLetter = (typeof GRADES)[number];
export function gradeToNumber(g: GradeLetter): bigint {
  const i = GRADES.indexOf(g);
  if (i < 0) throw new Error(`not a Tell grade: ${g}`);
  return BigInt(i);
}
export const gradeToLetter = (n: bigint): GradeLetter => {
  const g = GRADES[Number(n)];
  if (!g) throw new Error(`not a Tell grade: ${n}`);
  return g;
};

/** Seconds since the epoch, a little behind the local clock so a fast clock does not trip the contract's check. */
export const nowSeconds = (skew = 120): bigint => BigInt(Math.floor(Date.now() / 1000) - skew);

/**
 * A deployed contract's code hash, as Tell's grade registry keys it: SHA-256 over every
 * circuit's name and verifier key, sorted by name. A wallet computes it from the contract
 * state the indexer returns for an address; Tell computes the same from the compiled keys.
 */
export async function codeHash(circuits: { name: string; verifierKey: Uint8Array }[]): Promise<Uint8Array> {
  const lines = [...circuits].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)).map((c) => `${c.name}:${toHex(c.verifierKey)}\n`);
  return sha256(`tell-desk:code:v1\n${lines.join('')}`);
}

export const equalBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);
