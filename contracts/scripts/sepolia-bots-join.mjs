#!/usr/bin/env node
// Bots of the admin bank on the REAL Sepolia deployment (src/chain/deployments.js):
//   node scripts/sepolia-bots-join.mjs --join <arenaId> [--bots 10] [--from 0]
//                                      [--room "2026-11-07T10:00:00+07:00" --room-bot 10 --max 100 --preset 0]
// --join: bank bots #from..#from+bots-1 mint a hamster if they have none, deposit it, enter the arena.
// --room: one bank bot opens a room (createRoom) that starts at that time.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ethers } from '../../html/src/vendor/ethers.min.js';
import { HAMSTER_ABI, ARENA_ABI } from '../../html/src/chain/abi.js';
import { DEPLOYMENTS } from '../../html/src/chain/deployments.js';

const env = Object.fromEntries(readFileSync(fileURLToPath(new URL('../.env', import.meta.url)), 'utf8').split(/\r?\n/)
  .filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.split('=')[0], l.slice(l.indexOf('=') + 1).trim()]));
const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const dep = DEPLOYMENTS[11155111];
const provider = new ethers.JsonRpcProvider(env.SEPOLIA_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com', 11155111, { staticNetwork: true });
provider.pollingInterval = 3000;
const bot = (i) => new ethers.NonceManager(ethers.HDNodeWallet.fromPhrase(env.BANK_MNEMONIC, undefined, `m/44'/60'/0'/0/${i + 1}`).connect(provider));
const log = (...a) => console.log(new Date().toLocaleTimeString('vi-VN'), ...a);
const headroom = async (fn, args, value) => {
  const o = value === undefined ? {} : { value };
  return fn(...args, { ...o, gasLimit: ((await fn.estimateGas(...args, o)) * 13n) / 10n });
};
const arena = new ethers.Contract(dep.arena, ARENA_ABI, provider);

if (argv.includes('--room')) {
  const when = new Date(arg('room'));
  const b = bot(Number(arg('room-bot', 10)));
  const blk = await provider.getBlock('latest');
  const secs = Math.round(when.getTime() / 1000) - blk.timestamp;
  if (secs < 120) throw new Error(`${when} is less than 2 minutes away`);
  const start = blk.number + Math.round(secs / 12);
  const id = Number(await arena.arenaCount());
  await (await headroom(arena.connect(b).createRoom, [start, Number(arg('max', 100)), Number(arg('preset', 0))])).wait();
  log(`room Match #${id} opened by bank bot #${arg('room-bot', 10)} ${await b.getAddress()}: starts at block ${start} (~${when.toLocaleString('vi-VN')}), max ${arg('max', 100)}`);
}

if (argv.includes('--join')) {
  const id = Number(arg('join'));
  const n = Number(arg('bots', 10)), from = Number(arg('from', 0));
  const fee = (await arena.getArena(id)).fee;
  const res = await Promise.allSettled(Array.from({ length: n }, (_, k) => from + k).map(async (i) => {
    const b = bot(i), me = await b.getAddress();
    const ham = new ethers.Contract(dep.hamster, HAMSTER_ABI, b), ar = arena.connect(b);
    let mine = [...(await ar.depositsOf(me))].map(String);
    const free = [];
    for (const t of mine) if (!(await ar.tokenInArena(id, t))) free.push(t);
    let tok = free[0];
    if (!tok) {
      let wallet = [...(await ham.tokensOfOwner(me))].map(String);
      if (!wallet.length) { await (await headroom(ham.mint, [1])).wait(); wallet = [...(await ham.tokensOfOwner(me))].map(String); }
      tok = wallet[0];
      await (await headroom(ham['safeTransferFrom(address,address,uint256)'], [me, dep.arena, tok])).wait();
    }
    await (await headroom(ar.join, [id, tok], fee)).wait();
    log(`bank bot #${i} ${me.slice(0, 10)}… entered Match #${id} with hamster #${tok}`);
  }));
  const failed = res.filter((r) => r.status === 'rejected');
  for (const f of failed) log('failed:', f.reason?.shortMessage || f.reason?.message);
  const a = await arena.getArena(id);
  log(`Match #${id}: ${a.entrantCount}/${a.maxEntrants} entrants, pot ${ethers.formatEther(a.pot)} ETH (${n - failed.length}/${n} bots in)`);
}
