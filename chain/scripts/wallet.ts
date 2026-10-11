// Copyright (C) 2026 Rohan Borade
// SPDX-License-Identifier: Apache-2.0
//
//   npm run wallet -w chain -- address    the address to fund at the faucet (TELL_NETWORK=preprod for Preprod)
//   npm run wallet -w chain -- status     sync, print NIGHT and DUST, save state
//   npm run wallet -w chain -- register   register NIGHT so it generates DUST
//   add --fresh to ignore saved state and start again from the reference bundle

import { House, NET, NETWORK, logger } from '../src/house.js';

const cmd = process.argv[2] ?? 'status';
const house = await House.open({ fresh: process.argv.includes('--fresh') });
if (cmd === 'address') {
  console.log(`\nFund this ${NETWORK} address at ${NET.faucet}\n${house.address}\n`);
  process.exit(0);
}
await house.start();
await house.sync();
console.log(await house.summary());
if (cmd === 'register') {
  const tx = await house.registerForDust();
  logger.info(tx ? `registration submitted: ${tx}` : 'all NIGHT is already registered');
  if (tx) {
    await new Promise((r) => setTimeout(r, 30_000));
    await house.sync();
    console.log(await house.summary());
  }
}
await house.stop();
process.exit(0);
