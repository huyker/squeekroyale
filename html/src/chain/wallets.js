// Burner keystore for the automated flow.
//
// ONE 12-word phrase generates every wallet the autopilot needs, so the whole thing is
// backed up by a single short string:
//
//   index 0        the RUNNER — deploys the contracts, owns them, is the operator, holds
//                  the float and pays everyone else. This is the wallet you fund.
//   index 1 .. N   the BOT players — mint a hamster, commit a cell, claim their reward.
//
// The phrase is kept in localStorage and offered as a JSON file. That means anything able
// to run script in this origin can take the keys, so this is a TESTNET-ONLY tool: never
// put a phrase here that has ever touched mainnet, and never send real ETH to these
// addresses. `assertTestnet` refuses every chain that is not Hardhat local or Sepolia.
//
// No DOM beyond localStorage (guarded), so contracts/scripts/autopilot.mjs imports it as is.
import { ethers } from '../vendor/ethers.min.js';

export const KEYSTORE_VERSION = 1;
export const DEFAULT_BOT_COUNT = 100;
export const TESTNET_CHAINS = [31337, 11155111];
const LS_KEY = 'squeek.keystore.v1';

/**
 * Hardhat's development phrase. Public knowledge, printed by every `hardhat node` on
 * start-up and hard-coded in thousands of repositories — which is exactly why it is safe
 * to commit and useless to steal.
 *
 * Deriving the bank from it gives every machine the SAME wallet addresses with no file to
 * copy around, and on a local node the first twenty already hold 10000 ETH each, so there
 * is nothing to fund either. That is the whole reason it exists: a shared, worthless,
 * reproducible set of keys.
 *
 * Never on a network where the balance means anything. `isDevPhrase` lets callers refuse.
 */
// Read on demand (not at import) so a caller can load contracts/.env first. Empty in the browser.
export const devPhrase = () => String((globalThis.process && globalThis.process.env && globalThis.process.env.LOCAL_DEV_MNEMONIC) || '').trim();
export const isDevPhrase = (k) => !!devPhrase() && !!k && k.mnemonic === devPhrase();

/**
 * Is this bank's phrase public knowledge?
 *
 * True for Hardhat's phrase, and for any keystore carrying `public: true` — which is how
 * the bank committed to this repository marks itself. A published phrase is not a secret
 * that leaked; it is a phrase that was never a secret. The distinction matters because the
 * danger is the same either way: on a chain where balances are worth taking, these
 * addresses are swept by bots that watch GitHub, so callers check this before signing.
 */
export const isPublicKeystore = (k) => isDevPhrase(k) || !!(k && k.public);

export const RUNNER_PATH = "m/44'/60'/0'/0/0";
export const botPath = (i) => `m/44'/60'/0'/0/${i + 1}`;

/** Throw unless `chainId` is one of the testnets this tool is allowed to touch. */
export function assertTestnet(chainId) {
  if (!TESTNET_CHAINS.includes(Number(chainId)))
    throw new Error(`ví burner chỉ dùng trên testnet (${TESTNET_CHAINS.join(', ')}), không phải chain ${chainId}`);
}

// ------------------------------------------------------------------ create / store
/** A brand-new keystore. Nothing is written until you call saveKeystore. */
export function createKeystore({ botCount = DEFAULT_BOT_COUNT, label = '' } = {}) {
  const w = ethers.Wallet.createRandom();
  return { version: KEYSTORE_VERSION, createdAt: new Date().toISOString(), label, botCount, mnemonic: w.mnemonic.phrase };
}

/**
 * The shared development bank: same wallets on every machine, pre-funded on a local node.
 * Use it to work on the tooling, never to hold anything you would miss.
 */
export function devKeystore({ botCount = DEFAULT_BOT_COUNT } = {}) {
  if (!devPhrase()) throw new Error('LOCAL_DEV_MNEMONIC is not set (the phrase printed by `npx hardhat node`)');
  return keystoreFromPhrase(devPhrase(), { botCount, label: 'hardhat dev (public phrase)' });
}

/** Rebuild a keystore from an existing phrase (import, or recovery on another machine). */
export function keystoreFromPhrase(phrase, { botCount = DEFAULT_BOT_COUNT, label = '' } = {}) {
  const words = String(phrase).trim().toLowerCase().split(/\s+/).join(' ');
  if (!ethers.Mnemonic.isValidMnemonic(words)) throw new Error('cụm từ khôi phục không hợp lệ (phải là 12 hoặc 24 từ BIP-39)');
  return { version: KEYSTORE_VERSION, createdAt: new Date().toISOString(), label, botCount, mnemonic: words };
}

const ls = () => (typeof localStorage === 'undefined' ? null : localStorage);

export function loadKeystore() {
  try {
    const raw = ls() && ls().getItem(LS_KEY);
    if (!raw) return null;
    const k = JSON.parse(raw);
    return k && k.mnemonic && ethers.Mnemonic.isValidMnemonic(k.mnemonic) ? k : null;
  } catch { return null; }
}
export function saveKeystore(k) { if (ls()) ls().setItem(LS_KEY, JSON.stringify(k)); return k; }
export function clearKeystore() { if (ls()) ls().removeItem(LS_KEY); }
export const hasKeystore = () => !!loadKeystore();

/** Load the stored keystore, creating and saving one the first time. */
export function ensureKeystore(opts) {
  return loadKeystore() || saveKeystore(createKeystore(opts));
}

// ------------------------------------------------------------------ derive
const derive = (k, path) => ethers.HDNodeWallet.fromPhrase(k.mnemonic, '', path);

/** The runner: deployer + owner + operator + paymaster. Connected to `provider` if given. */
export function runnerWallet(k, provider) {
  const w = derive(k, RUNNER_PATH);
  return provider ? w.connect(provider) : w;
}

/**
 * One bot wallet by index.
 *
 * `botWallets(k, i + 1)[i]` derives i+1 keys to use the last one, which turns a loop over
 * N wallets into N²/2 derivations — at 100 wallets that is five thousand, and it shows.
 */
export function botWallet(k, i, provider) {
  const w = derive(k, botPath(i));
  return provider ? w.connect(provider) : w;
}

/** Bot players 0 .. n-1 (defaults to the keystore's botCount). */
export function botWallets(k, n, provider) {
  const count = n ?? k.botCount ?? DEFAULT_BOT_COUNT;
  const out = [];
  for (let i = 0; i < count; i++) {
    const w = derive(k, botPath(i));
    out.push(provider ? w.connect(provider) : w);
  }
  return out;
}

/** Addresses only — cheap, no signing keys handed around. */
export function addressesOf(k, n) {
  return { runner: runnerWallet(k).address, bots: botWallets(k, n).map((w) => w.address) };
}

// ------------------------------------------------------------------ import / export
/** The JSON file the UI offers for download. It holds the phrase: treat it as a secret. */
export function exportKeystore(k) {
  return JSON.stringify({
    _warning: k.public
      ? 'PUBLISHED PHRASE. This bank is committed to a public repository: anyone can derive and drain it. Local test chain only.'
      : 'TESTNET ONLY. This file contains the seed phrase for every Squeek autopilot wallet. Anyone holding it controls them.',
    version: k.version, createdAt: k.createdAt, label: k.label || '', botCount: k.botCount,
    ...(k.public ? { public: true } : {}),
    mnemonic: k.mnemonic, runner: runnerWallet(k).address,
  }, null, 2) + '\n';
}

export function importKeystore(text) {
  const j = typeof text === 'string' ? JSON.parse(text) : text;
  if (!j || !j.mnemonic) throw new Error('file không có trường "mnemonic"');
  const k = keystoreFromPhrase(j.mnemonic, { botCount: Number(j.botCount) || DEFAULT_BOT_COUNT, label: j.label || '' });
  if (j.public) k.public = true;              // a bank that announces itself as published
  return k;
}

/**
 * Every wallet spelled out: index, role, derivation path, address and private key.
 *
 * The phrase alone already *is* the backup — all N wallets come back from it, which is why
 * `exportKeystore` is the file to keep. This is the other half of "save them all": a
 * listing you can read, search, paste into a block explorer, or hand to another tool that
 * wants keys rather than a phrase. It holds live private keys, so it is as secret as the
 * phrase and just as testnet-only.
 */
export function walletRows(k, n) {
  const count = n ?? k.botCount ?? DEFAULT_BOT_COUNT;
  const rows = [{ index: 0, role: 'runner', path: RUNNER_PATH, ...keyOf(derive(k, RUNNER_PATH)) }];
  for (let i = 0; i < count; i++) rows.push({ index: i + 1, role: `bot #${i}`, path: botPath(i), ...keyOf(derive(k, botPath(i))) });
  return rows;
}
const keyOf = (w) => ({ address: w.address, privateKey: w.privateKey });

/** The same listing as a CSV file, for a spreadsheet or another tool. */
export function exportWalletsCsv(k, n) {
  const head = 'index,role,path,address,privateKey';
  return [head, ...walletRows(k, n).map((r) => [r.index, r.role, r.path, r.address, r.privateKey].join(','))].join('\n') + '\n';
}

/** The same listing as JSON, with the warning that belongs on top of it. */
export function exportWalletsJson(k, n) {
  return JSON.stringify({
    _warning: 'TESTNET ONLY. Private keys in clear text. Anyone holding this file controls every wallet listed.',
    createdAt: k.createdAt, label: k.label || '', mnemonic: k.mnemonic, wallets: walletRows(k, n),
  }, null, 2) + '\n';
}

// ------------------------------------------------------------------ balances / funding
/** Balances of the runner and every bot, in one pass. */
export async function balancesOf(provider, runner, bots) {
  const [r, ...b] = await Promise.all([runner, ...bots].map((a) => provider.getBalance(typeof a === 'string' ? a : a.address)));
  return { runner: r, bots: b, botTotal: b.reduce((s, v) => s + v, 0n) };
}

/**
 * What the runner must hold before a round can start: every bot topped up to `perBot`,
 * plus `reserve` for the runner's own transactions (createArena,
 * submitResult and the gas of the funding transfers themselves).
 */
export function fundingShortfall({ runnerBalance, botBalances, perBot, reserve }) {
  let need = reserve;
  const tops = [];
  botBalances.forEach((bal, i) => {
    if (bal < perBot) { const d = perBot - bal; tops.push({ i, amount: d }); need += d; }
  });
  return { need, tops, short: need > runnerBalance ? need - runnerBalance : 0n };
}
