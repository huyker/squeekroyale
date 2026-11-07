// Put a deployment made from deploy.html (MetaMask) into the repo so everyone — the web
// pages for all visitors and scripts/operator.mjs — uses it.
//   node scripts/save-deployment.js <path/to/11155111.json>
// Checks on-chain that both contracts exist and are bound together before saving.
const fs = require('fs');
const { ethers } = require('ethers');
const { saveDeployment } = require('./export');

const RPC = { 11155111: process.env.SEPOLIA_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com', 31337: 'http://127.0.0.1:8545' };

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error('usage: node scripts/save-deployment.js <deployment.json>');
  const d = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!RPC[d.chainId]) throw new Error(`unsupported chainId ${d.chainId}`);
  for (const k of ['hamster', 'arena', 'owner']) if (!ethers.isAddress(d[k])) throw new Error(`bad address: ${k}`);
  const p = new ethers.JsonRpcProvider(RPC[d.chainId], d.chainId, { staticNetwork: true });
  const [ch, ca] = await Promise.all([p.getCode(d.hamster), p.getCode(d.arena)]);
  if (ch === '0x' || ca === '0x') throw new Error('no contract code at one of the addresses');
  const arena = new ethers.Contract(d.arena, ['function hamsters() view returns (address)'], p);
  if ((await arena.hamsters()).toLowerCase() !== d.hamster.toLowerCase()) throw new Error('arena is not bound to this hamster contract');
  saveDeployment(d);
  console.log(`saved chain ${d.chainId}: hamster ${d.hamster} · arena ${d.arena} -> contracts/deployments/${d.chainId}.json + src/chain/deployments.js`);
}
main().catch((e) => { console.error(e.message || e); process.exitCode = 1; });
