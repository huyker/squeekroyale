#!/usr/bin/env node
// Schedule a week of games on the REAL Sepolia deployment, as cheaply as possible:
//   node scripts/sepolia-schedule.mjs [--every 10] [--days 7] [--max 100] [--preset 0] [--dry]
// The bank runner (owner/operator, contracts/.env BANK_MNEMONIC path 0) calls createArenas with
// as many arenas per transaction as fit (≤ 100, the contract's limit; checked against Sepolia's
// per-transaction gas cap), with a 1-wei priority fee. The first game starts at the next round
// <every>-minute mark at least 5 minutes away; one game every <every> minutes after that.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ethers } from '../../html/src/vendor/ethers.min.js';
import { ARENA_ABI } from '../../html/src/chain/abi.js';
import { DEPLOYMENTS } from '../../html/src/chain/deployments.js';

const env = Object.fromEntries(readFileSync(fileURLToPath(new URL('../.env', import.meta.url)), 'utf8').split(/\r?\n/)
  .filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.split('=')[0], l.slice(l.indexOf('=') + 1).trim()]));
const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const EVERY_MIN = Number(arg('every', 10)), DAYS = Number(arg('days', 7)), MAX = Number(arg('max', 100)), PRESET = Number(arg('preset', 0));
const BLOCK_S = 12, TX_GAS_CAP = 16_000_000;                 // Sepolia: 12 s slots; stay under the 2^24 per-tx cap
const dep = DEPLOYMENTS[11155111];
const provider = new ethers.JsonRpcProvider(env.SEPOLIA_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com', 11155111, { staticNetwork: true });
provider.pollingInterval = 3000;
const runner = new ethers.NonceManager(ethers.HDNodeWallet.fromPhrase(env.BANK_MNEMONIC, undefined, "m/44'/60'/0'/0/0").connect(provider));
const arena = new ethers.Contract(dep.arena, ARENA_ABI, runner);
const log = (...a) => console.log(new Date().toLocaleTimeString('vi-VN'), ...a);

const count = Math.round((DAYS * 24 * 60) / EVERY_MIN);
const every = Math.round((EVERY_MIN * 60) / BLOCK_S);
const blk = await provider.getBlock('latest');
const nowMs = blk.timestamp * 1000, step = EVERY_MIN * 60000;
const firstMs = Math.ceil((nowMs + 5 * 60000) / step) * step;            // next round mark ≥ 5 min away
const firstBlock = blk.number + Math.round((firstMs - nowMs) / 1000 / BLOCK_S);
const firstId = Number(await arena.arenaCount());
log(`${count} games, one every ${EVERY_MIN} min (${every} blocks), first at ${new Date(firstMs).toLocaleString('vi-VN')} (block ${firstBlock}), last ~${new Date(firstMs + (count - 1) * step).toLocaleString('vi-VN')}; ids from #${firstId}`);

// largest batch that fits one transaction
let batch = 100;
for (; batch >= 10; batch -= 10) {
  const g = await arena.createArenas.estimateGas(firstBlock, every, batch, MAX, PRESET, false);
  if (g * 11n / 10n <= BigInt(TX_GAS_CAP)) { log(`batch ${batch}: ~${g} gas per transaction`); break; }
}
const fees = async () => { const b = (await provider.getBlock('latest')).baseFeePerGas || 0n; return { maxPriorityFeePerGas: 1n, maxFeePerGas: b * 2n + 1n }; };
if (argv.includes('--dry')) process.exit(0);

let spent = 0n, txs = 0;
const bal0 = await provider.getBalance(await runner.getAddress());
for (let start = 0; start < count; start += batch) {
  const n = Math.min(batch, count - start);
  const first = firstBlock + start * every;
  const head = await provider.getBlockNumber();
  if (first <= head) throw new Error(`batch ${start}: block ${first} already passed — rerun to start later`);
  const g = await arena.createArenas.estimateGas(first, every, n, MAX, PRESET, false);
  const rc = await (await arena.createArenas(first, every, n, MAX, PRESET, false, { gasLimit: g * 11n / 10n, ...(await fees()) })).wait();
  spent += rc.gasUsed * rc.gasPrice; txs++;
  log(`games #${firstId + start}–#${firstId + start + n - 1}: ${rc.gasUsed} gas at ${rc.gasPrice} wei`);
}
const bal1 = await provider.getBalance(await runner.getAddress());
log(`done: ${count} games in ${txs} transactions · paid ${ethers.formatEther(spent)} ETH · runner ${ethers.formatEther(bal0)} → ${ethers.formatEther(bal1)} ETH`);
