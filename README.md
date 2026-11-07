squeekchain-project: a9d5709b-407a-4600-9ffe-c6b23d122699
# Squeek Royale

Deterministic 2D hamster battle royale whose results are settled on-chain.

```
contracts/   Solidity contracts (Hardhat) + chain scripts (deploy, operator, autopilot, Sepolia tools)
html/        Web app: deterministic simulator, replay, renderer, chain client, pages, tests
```

The two folders are siblings on purpose: the operator and the Sepolia scripts in
`contracts/scripts/` import the simulator from `html/src/` so a match is computed by exactly
the same code in Node and in the browser.

## Art

No art files are shipped. Every image the game asks for is optional: hamsters render as
coloured dots, obstacles and ground fall back to vector drawing, and page images become dots.
Simulation, replay hashes and results do not depend on art.

## Contracts

```bash
cd contracts
npm ci
npx hardhat test                     # compile + 27 contract tests
```

| File | Role |
|---|---|
| `contracts/SqueekHamster.sol` | ERC-721 hamster NFT, on-chain genome and art metadata |
| `contracts/SqueekArena.sol` | Arenas: join/deposit, seed block, result + Merkle points, claims, refunds, void, sweep |
| `contracts/HamsterGenome.sol` | Genome decoding shared by the NFT |
| `contracts/test/*.sol` | Test harnesses / mocks |
| `scripts/deploy.js`, `export.js` | Deploy, then export ABI/bytecode/addresses into `html/src/chain/` |
| `scripts/operator.mjs` | Locks arenas, simulates, submits results |
| `deployments/*.json` | Published addresses (31337 local, 11155111 Sepolia) |

Keys are never in the repository. Copy `contracts/.env.example` to `contracts/.env` and fill in
what the script you run needs (`DEPLOYER_PRIVATE_KEY`, `OPERATOR_PRIVATE_KEY`, and for a local
Hardhat node `LOCAL_DEV_MNEMONIC` / `OPERATOR_PRIVATE_KEY_LOCAL`).

## Web

No build step. Serve `html/` as the web root (pages link to `/` and `/play`):

```bash
cd html
python3 -m http.server 8777          # http://127.0.0.1:8777/  ·  /play.html  ·  /viewer.html
```

Tests (Node >= 18):

```bash
cd html
node tests/run-tests.mjs --runs 20   # simulator, AI, replay, determinism, chain helpers
node tools/simulate-cli.mjs --seed 20261105 --bots 100 --runs 10
node tools/browser-check.mjs --seeds alpha --presets standard   # needs Chrome/Edge
```

| Path | Role |
|---|---|
| `src/core/` | Deterministic simulator (fixed-point, seeded RNG, AI, zone, world) |
| `src/replay/` | Replay reader + validator |
| `src/workers/` | Web Worker that precomputes a match |
| `src/render/` | Canvas renderer, camera, asset loader (art optional) |
| `src/chain/` | ABI, deployments, contract client, Merkle proofs, keeper/schedule |
| `src/ui/` | Pages: portal (`index.html`), player hub (`play.html`), match viewer (`viewer.html`) |
| `tests/`, `tools/` | Test suite, golden vectors, CLI simulator, browser checks |
