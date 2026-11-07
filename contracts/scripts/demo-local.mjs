#!/usr/bin/env node
// Fill a local Hardhat chain with a playable demo: hamsters for the dev accounts and an
// arena they have joined (drop points are random: drawn from the seed).  Needs `npm run node` + `npm run deploy:local`.
//
//   node scripts/demo-local.mjs [--players 9] [--per 3] [--start 120] [--settle]
//     --start  roughly seconds until entries close (the chain mines ~1 block/s; entries
//              close at a block number, players can still join from MetaMask until then)
//     --settle mine past the close and seed blocks and run the operator once (one
//              submitResult: seed + Merkle root of the points)
import { ethers } from 'ethers';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { HAMSTER_ABI, ARENA_ABI } from '../../html/src/chain/abi.js';
import { DEPLOYMENTS } from '../../html/src/chain/deployments.js';

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const PLAYERS = Number(arg('players', 9)), PER = Number(arg('per', 3)), START = Number(arg('start', 120));
const provider = new ethers.JsonRpcProvider('http://127.0.0.1:8545', 31337, { staticNetwork: true });
const dep = DEPLOYMENTS[31337];
if (!dep) throw new Error('deploy first: npm run deploy:local');
try { await import('dotenv/config'); } catch { /* env already set */ }
// Phrase of the local node's dev accounts (printed by `npx hardhat node`); set it in contracts/.env.
const MNEMONIC = process.env.LOCAL_DEV_MNEMONIC;
if (!MNEMONIC) throw new Error('set LOCAL_DEV_MNEMONIC in contracts/.env (the phrase printed by `npx hardhat node`)');
const signer = (i) => new ethers.NonceManager(ethers.HDNodeWallet.fromPhrase(MNEMONIC, undefined, `m/44'/60'/0'/0/${i}`).connect(provider));

const owner = signer(0);
const arenaW = new ethers.Contract(dep.arena, ARENA_ABI, owner);
// Entries close at a BLOCK. Mine ~1 block per second so "START seconds" means something
// on a dev chain that otherwise only mines when a transaction arrives.
await provider.send('evm_setIntervalMining', [1000]).catch(() => {});
const head = await provider.getBlockNumber();
const closeBlock = head + START + PLAYERS * 4 + 5;            // room for every mint + deposit + join below
const id = Number(await arenaW.arenaCount());
await (await arenaW.createArena(closeBlock, 100, 0)).wait();
console.log(`arena ${id} created, entries close at block ${closeBlock} (~${START}s)`);

const fee = BigInt(dep.entryFeeWei);
let k = 0;
for (let p = 1; p <= PLAYERS; p++) {
  const s = signer(p);
  const addr = await s.getAddress();
  const ham = new ethers.Contract(dep.hamster, HAMSTER_ABI, s);
  await (await ham.mint(PER)).wait();
  const ids = [...(await ham.tokensOfOwner(addr))].slice(-PER);
  const ar = new ethers.Contract(dep.arena, ARENA_ABI, s);
  // a hamster plays only while deposited in the arena (contract 1.4): deposit, then enter
  if (!(await ham.isApprovedForAll(addr, dep.arena))) await (await ham.setApprovalForAll(dep.arena, true)).wait();
  await (await ar.deposit(ids)).wait();
  await (await ar.joinMany(ids.map(() => id), ids, { value: fee * BigInt(ids.length) })).wait();
  k += ids.length;
  console.log(`player ${p} ${addr}: ${PER} hamsters deposited and joined`);
}
console.log(`arena ${id}: ${k} entrants, pot ${ethers.formatEther(fee * BigInt(k))} ETH`);

if (argv.includes('--settle')) {
  const now = await provider.getBlockNumber();
  if (now <= closeBlock + 2) await provider.send('hardhat_mine', ['0x' + (closeBlock + 3 - now).toString(16)]);
  const op = fileURLToPath(new URL('./operator.mjs', import.meta.url));
  execFileSync(process.execPath, [op, '--network', 'localhost', '--once'], { stdio: 'inherit' });
}
