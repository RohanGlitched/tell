// Copies the zoo contracts and two official Midnight examples into data/samples.json for the scanner.
import fs from 'node:fs';
import path from 'node:path';
const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const zoo = path.resolve(here, '../../zoo/contracts');
const ledger9 = path.resolve(here, '../../zoo/ledger9/contracts');
const fixtures = path.resolve(here, '../../engine/test/fixtures/src');
if (!fs.existsSync(zoo)) { console.log('zoo not present; using committed samples'); process.exit(0); }
const pick = (dir, f) => fs.readFileSync(path.join(dir, f), 'utf8');
const samples = [
  { id: 'ballot-leaky', label: 'Leaky ballot', note: 'hash(choice): four guesses', source: pick(zoo, 'ballot-leaky.compact') },
  { id: 'ballot-fixed', label: 'Fixed ballot', note: 'salted commitment', source: pick(zoo, 'ballot-fixed.compact') },
  { id: 'payband-leaky', label: 'Salary record', note: 'hash(id, salary)', source: pick(zoo, 'payband-leaky.compact') },
  { id: 'reserve-leaky', label: 'Sealed sale', note: 'branch on the bid', source: pick(zoo, 'reserve-leaky.compact') },
  { id: 'board-leaky', label: 'Staff board', note: 'same tag on every post', source: pick(zoo, 'board-leaky.compact') },
  { id: 'vault-leaky', label: 'Vault', note: 'key on the ledger', source: pick(zoo, 'vault-leaky.compact') },
  { id: 'raffle-leaky', label: 'Raffle', note: 'constructor seals hash(number)', source: pick(zoo, 'raffle-leaky.compact') },
  { id: 'faucet-leaky', label: 'Faucet', note: 'shielded mint, public nonce', source: pick(zoo, 'faucet-leaky.compact') },
  { id: 'deposit-leaky', label: 'Deposit', note: 'bid paid as an unshielded amount', source: pick(zoo, 'deposit-leaky.compact') },
  { id: 'poll-leaky', label: 'Poll (Ledger 9)', note: 'hash(choice) in an event', source: pick(ledger9, 'poll-leaky.compact') },
  { id: 'election', label: 'Midnight example: election', note: 'official example', source: pick(fixtures, 'election.compact') },
];
fs.mkdirSync(path.resolve(here, '../data'), { recursive: true });
fs.writeFileSync(path.resolve(here, '../data/samples.json'), JSON.stringify(samples, null, 1));
const pairs = [
  ...['ballot', 'payband', 'reserve', 'vault', 'board', 'raffle', 'faucet', 'deposit'].map((id) => ({ id, leaky: pick(zoo, `${id}-leaky.compact`), fixed: pick(zoo, `${id}-fixed.compact`) })),
  { id: 'poll', leaky: pick(ledger9, 'poll-leaky.compact'), fixed: pick(ledger9, 'poll-fixed.compact') },
];
fs.writeFileSync(path.resolve(here, '../data/zoo.json'), JSON.stringify(pairs, null, 1));
console.log(`samples: ${samples.length}, zoo pairs: ${pairs.length}`);
