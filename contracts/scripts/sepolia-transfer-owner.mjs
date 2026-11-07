#!/usr/bin/env node
// Hand both contracts of the REAL Sepolia deployment to a new owner:
//   node scripts/sepolia-transfer-owner.mjs <newOwner> [--operator]   (--dry to only show the state)
// Ownable.transferOwnership on SqueekHamster and SqueekArena, signed by the current owner (the
// bank runner, contracts/.env BANK_MNEMONIC path 0). The arena OPERATOR (who posts results) stays the
// runner unless --operator is given — the scheduled games need it to keep being settled.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ethers } from '../../html/src/vendor/ethers.min.js';
import { HAMSTER_ABI, ARENA_ABI } from '../../html/src/chain/abi.js';
import { DEPLOYMENTS } from '../../html/src/chain/deployments.js';

const env = Object.fromEntries(readFileSync(fileURLToPath(new URL('../.env', import.meta.url)), 'utf8').split(/\r?\n/)
  .filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.split('=')[0], l.slice(l.indexOf('=') + 1).trim()]));
const argv = process.argv.slice(2);
const NEW = ethers.getAddress(argv[0]);                      // throws on a malformed / bad-checksum address
const dep = DEPLOYMENTS[11155111];
const provider = new ethers.JsonRpcProvider(env.SEPOLIA_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com', 11155111, { staticNetwork: true });
const runner = new ethers.NonceManager(ethers.HDNodeWallet.fromPhrase(env.BANK_MNEMONIC, undefined, "m/44'/60'/0'/0/0").connect(provider));
const ham = new ethers.Contract(dep.hamster, HAMSTER_ABI, runner), are = new ethers.Contract(dep.arena, ARENA_ABI, runner);
const fees = async () => { const b = (await provider.getBlock('latest')).baseFeePerGas || 0n; return { maxPriorityFeePerGas: 1n, maxFeePerGas: b * 2n + 1n }; };
const state = async () => ({ hamsterOwner: await ham.owner(), arenaOwner: await are.owner(), operator: await are.operator(),
  treasury: ethers.formatEther(await are.treasury()), nftBalance: ethers.formatEther(await provider.getBalance(dep.hamster)) });
console.log('new owner', NEW, '· code at it:', (await provider.getCode(NEW)) === '0x' ? 'none (a wallet)' : 'a contract');
console.log('before', await state());
if (argv.includes('--dry')) process.exit(0);
const me = await runner.getAddress();
if ((await ham.owner()) === me) await (await ham.transferOwnership(NEW, await fees())).wait();
if (argv.includes('--operator')) await (await are.setOperator(NEW, await fees())).wait();   // while still owner
if ((await are.owner()) === me) await (await are.transferOwnership(NEW, await fees())).wait();
console.log('after ', await state());
