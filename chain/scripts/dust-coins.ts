// Copyright (C) 2026 Rohan Borade
// SPDX-License-Identifier: Apache-2.0
//
// Diagnostic: list the house wallet's DUST coins (value now, creation time, backing NIGHT) without
// spending anything.   TELL_NETWORK=preprod npx tsx chain/scripts/dust-coins.ts
import { House } from '../src/house.js';

const house = await House.open();
await house.start();
await house.sync();
const s = await (house as any).facade.waitForSyncedState();
const now = new Date();
const coins = s.dust.availableCoins as any[];
const big = (_k: string, v: unknown) => (typeof v === 'bigint' ? v.toString() : v instanceof Uint8Array ? `bytes(${v.length})` : v);
console.log('dust balance', Number(s.dust.balance(now)) / 1e15, 'coins', coins.length);
for (const c of coins) console.log(JSON.stringify(c, big).slice(0, 600));
console.log('night utxos', JSON.stringify((s.unshielded.availableCoins as any[]).map((u) => ({ value: String(u.utxo?.value ?? u.value ?? ''), reg: u.meta?.registeredForDustGeneration, ctime: u.meta?.ctime ?? u.ctime })), big));
await house.stop();
process.exit(0);
