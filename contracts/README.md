# chain/ — Squeek Royale contracts: Squeek Hamster NFT + Arena (Hardhat)

This folder holds the contracts, the deploy scripts and the operator script for Squeek Royale. The full design (data flow, contract API, payouts, trust model) is in [../docs/nft-arena-testnet.md](../docs/nft-arena-testnet.md).

| File | Purpose |
|---|---|
| `contracts/SqueekHamster.sol` | ERC-721 hamster NFT. Minting draws a DNA; the DNA gives the outfit and 5 stats; on-chain metadata (JSON + SVG). |
| `contracts/SqueekArena.sol` | Arena contract. Players join a hamster for 0.0001 ETH — no position: every drop point is random, drawn from the seed; the arena locks, then a seed is drawn from a blockhash; the result is posted; players claim 90 % of the pot by points. |
| `contracts/HamsterGenome.sol` | **Generated** from `src/core/hamster.js` (`node scripts/gen-genome.mjs`). Do not edit by hand. |
| `/adminnn` → Khởi tạo contract | Deploys both contracts from the browser (MetaMask or a bank wallet). |
| `scripts/save-deployment.js` | Puts a deployment JSON downloaded from the admin console into the repo, after checking it on-chain. |
| `scripts/deploy.js` | Deploys both contracts and writes the addresses and ABIs for the web app (`src/chain/*.js`). |
| `scripts/operator.mjs` | Keeper. Locks arenas, draws seeds, runs the simulator, posts results. Can also open new arenas on a schedule (`--schedule`). |
| `scripts/demo-local.mjs` | Fills a local chain with sample players and one arena. |
| `scripts/autopilot.mjs` | **Full flow in one command.** Burner wallets deploy the contracts, fund themselves, mint, join, reveal the seed, settle and claim — on repeat. |
| `test/squeek.test.js` | Contract tests: JS ↔ Solidity genome parity, NFT, the full arena flow, refunds. |

## 0. Full flow in one command (fastest way to see everything work)

```bash
npm install
npm run node                                                   # terminal 1
node scripts/autopilot.mjs --network localhost --slots 100     # terminal 2, one round (~45 s)
node scripts/autopilot.mjs --network localhost --rounds 0      # …or run rounds back to back
```

The first run creates `contracts/.autopilot/keystore.json` (gitignored) holding one 12-word
phrase. Wallet 0 is the **runner**: it deploys, owns and operates the contracts and pays
everyone else; wallets 1…N are the **bot players**. On the local chain the runner funds
itself from a Hardhat dev account, so there is nothing to do by hand.

The same flow runs in the browser at `/adminnn` (tab Chơi thử) — one button, and you can take one of the
seats yourself with MetaMask (join and the bots make room: the arena is always exactly
`--slots` players).

Deployments from the autopilot go to `contracts/.autopilot/deployments/` and do **not** touch
the committed `contracts/deployments/`. Pass `--publish` when you do want to overwrite those.

> These wallets are testnet-only. The phrase sits in a plain file (CLI) or in localStorage
> (browser); anything that can read either controls every one of them.

## Requirements

- Node 18 or later.
- `npm install` in this folder.
- MetaMask, to test from the web page.

## 1. Test on a local chain

Use three terminals, all starting from `chain/`.

```bash
# Terminal 1: local Hardhat node (chainId 31337, 20 dev accounts with 10000 ETH each)
npm install
npm run node

# Terminal 2: deploy the contracts and add sample data
npm run deploy:local
node scripts/demo-local.mjs --players 6 --per 3 --start 600     # 18 hamsters, arena starts in 10 minutes
npm run operator:local -- --schedule 5                         # keeper; keeps one arena open at all times

# Terminal 3, from the repo root: static web server
python -m http.server 8777
```

Then open:
- `http://127.0.0.1:8777/play.html`: the player hub (mint, join, claim; drop points are random and appear on the map once the seed is drawn);
- `http://127.0.0.1:8777/adminnn/` (tab Quản lý): the management page (wallet and network, contract overview, my assets and rewards, owner/operator admin, a form for every contract function, event and transaction log).

To connect MetaMask to the local chain:

1. Add the network: RPC `http://127.0.0.1:8545`, chain ID `31337`. The page can also add it for you.
2. Import a Hardhat dev account using its private key, which is printed in Terminal 1.

> Dev account keys are **public**. Never send real ETH to them.

To check the result of an arena independently:

```bash
node scripts/operator.mjs --network localhost --verify <arenaId>
```

## 2. Deploy to Sepolia from the browser (MetaMask, no private key) — recommended

1. Fund your MetaMask account with a little Sepolia ETH from any faucet. Deploying costs about 6 M gas, usually under 0.01 ETH.
2. Serve the repo (`python -m http.server 8777`) and open `http://127.0.0.1:8777/adminnn/` (tab Khởi tạo contract).
3. Pick **Sepolia testnet**, click **Kết nối MetaMask**, then **🚀 Deploy contract**.
4. MetaMask asks you to confirm **two** transactions: SqueekHamster, then SqueekArena. Your account becomes owner and operator.
5. The page saves the addresses in this browser, so `/play` and the admin console use the new contracts at once. **Tạo arena** opens the first arena.
6. To make the deployment the default for everyone, click **Tải file JSON**, then run:
   ```bash
   cd chain && node scripts/save-deployment.js ~/Downloads/11155111.json
   ```
   The script checks both contracts on-chain and writes `contracts/deployments/11155111.json` and `src/chain/deployments.js`. Commit both files.
   You can also just send the JSON (or the two addresses) to whoever maintains the repo. Contract addresses are public.

Running arenas also needs no key, and there is little to run: entries close at the arena's `closeBlock` by themselves, and the seed is the hash of block `closeBlock + 2` (no transaction). In **manage.html → Quản trị**, the owner wallet then clicks **Mô phỏng & công bố**: the browser runs the simulator, and you confirm the one `submitResult` transaction in MetaMask. It stores the seed and the Merkle root of the points. Players claim with a Merkle proof, which the pages build for them.

`scripts/operator.mjs` exists only to automate this on a server. It is optional, and it is the only part that needs a key.

## 2b. Deploy to Sepolia from the command line (needs a key in `.env`)

1. Create a **testnet-only** wallet and fund it with Sepolia ETH from any faucet. About 0.05 ETH is enough to deploy and run.
2. Create `contracts/.env` from `.env.example`:
   ```
   SEPOLIA_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com   # or an Alchemy/Infura URL
   DEPLOYER_PRIVATE_KEY=0x...                                    # key of the testnet wallet
   OPERATOR_PRIVATE_KEY=0x...                                    # optional, defaults to the deployer
   ```
   `.env` is gitignored. Never commit it, and never paste the key into chat.
3. Deploy and run:
   ```bash
   npm run deploy:sepolia                          # writes contracts/deployments/11155111.json + src/chain/deployments.js
   npm run operator:sepolia -- --schedule 30       # opens a new arena every 30 minutes, settles finished ones
   ```
4. Commit `contracts/deployments/11155111.json` and `src/chain/deployments.js` so the web page knows the addresses.
5. Host the repository on any static host (GitHub Pages or similar) and open `/play`. MetaMask switches to Sepolia automatically.

Check the contracts on Blockscout: `https://eth-sepolia.blockscout.com/address/<address>`.

## 3. Changing balance or the item table

The contract must always decode DNA exactly like the game. After any change to the equipment table in `src/core/hamster.js`:

```bash
node scripts/gen-genome.mjs     # regenerate HamsterGenome.sol
npx hardhat test                # the parity test compares 300 random DNAs
```

Contracts that are already deployed do **not** change. A new item table needs a new deployment, so mark it as a new genome version.
