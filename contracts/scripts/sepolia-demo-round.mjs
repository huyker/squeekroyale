#!/usr/bin/env node
// One demo round on the REAL Sepolia deployment (src/chain/deployments.js), played by the
// admin bank's bots (contracts/.env BANK_MNEMONIC: runner = path 0 = owner/operator, bot #i = path i+1).
//
//   node scripts/sepolia-demo-round.mjs [--bots 8] [--blocks 12]
//
// runner opens an arena closing in ~blocks*12 s; every bot mints if it has no hamster,
// deposits it if it is still in the wallet, and joins. Settling is left to the operator:
//   OPERATOR_PRIVATE_KEY=<runner key> node scripts/operator.mjs --network sepolia --once
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ethers } from '../../html/src/vendor/ethers.min.js';
import { HAMSTER_ABI, ARENA_ABI } from '../../html/src/chain/abi.js';
import { DEPLOYMENTS } from '../../html/src/chain/deployments.js';

const env = Object.fromEntries(readFileSync(fileURLToPath(new URL('../.env', import.meta.url)), 'utf8').split(/\r?\n/)
  .filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.split('=')[0], l.slice(l.indexOf('=') + 1).trim()]));
const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const N = Number(arg('bots', 8)), BLOCKS = Number(arg('blocks', 12));
const dep = DEPLOYMENTS[11155111];
if (!dep) throw new Error('no Sepolia deployment in src/chain/deployments.js');
const provider = new ethers.JsonRpcProvider(env.SEPOLIA_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com', 11155111, { staticNetwork: true });
provider.pollingInterval = 3000;
const hd = (i) => new ethers.NonceManager(ethers.HDNodeWallet.fromPhrase(env.BANK_MNEMONIC, undefined, `m/44'/60'/0'/0/${i}`).connect(provider));
const runner = hd(0), bots = Array.from({ length: N }, (_, i) => hd(i + 1));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const headroom = async (fn, args, value) => {
  const o = value === undefined ? {} : { value };
  return fn(...args, { ...o, gasLimit: ((await fn.estimateGas(...args, o)) * 13n) / 10n });
};

const arena = new ethers.Contract(dep.arena, ARENA_ABI, runner);
const id = Number(await arena.arenaCount());
const close = (await provider.getBlockNumber()) + BLOCKS;
await (await arena.createArena(close, 100, 0)).wait();
log(`arena #${id} opened, entries close at block ${close} (~${BLOCKS * 12}s)`);
const fee = (await arena.getArena(id)).fee;

await Promise.all(bots.map(async (b, i) => {
  const me = await b.getAddress();
  const ham = new ethers.Contract(dep.hamster, HAMSTER_ABI, b), ar = new ethers.Contract(dep.arena, ARENA_ABI, b);
  let deposited = [...(await ar.depositsOf(me))];
  if (!deposited.length) {
    let wallet = [...(await ham.tokensOfOwner(me))];
    if (!wallet.length) { await (await headroom(ham.mint, [1])).wait(); wallet = [...(await ham.tokensOfOwner(me))]; }
    await (await headroom(ham['safeTransferFrom(address,address,uint256)'], [me, dep.arena, wallet[0]])).wait();
    deposited = [wallet[0]];
  }
  await (await headroom(ar.join, [id, deposited[0]], fee)).wait();
  log(`bot #${i} ${me.slice(0, 10)}… joined with hamster #${deposited[0]}`);
}));
const a = await arena.getArena(id);
log(`arena #${id}: ${a.entrantCount} entrants, pot ${ethers.formatEther(a.pot)} ETH — now run the operator after block ${close + 2}`);
console.log(JSON.stringify({ arenaId: id, closeBlock: close, seedBlock: Number(a.seedBlock) }));
