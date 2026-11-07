// Contract tests: genome parity with the game, NFT metadata / art / royalties, and the full
// arena 1.4 flow (deposit -> enter -> close at a block -> seed = hash of a later block ->
// simulate with the real game core -> one submitResult (Merkle root built on-chain, rank +
// kills in calldata) -> claim delay -> claim with proofs), plus withdraw, void and sweep.
const { expect } = require('chai');
const { ethers, network } = require('hardhat');

const FEE = ethers.parseEther('0.0001');
const DAY = 86400;
const HOUR = 3600;
const SAFE = 'safeTransferFrom(address,address,uint256)';

let core;                                          // ES modules of the game, loaded once
before(async () => {
  core = {
    hamster: await import('../../html/src/core/hamster.js'),
    manifest: await import('../../html/src/core/manifest.js'),
    sim: await import('../../html/src/core/simulator.js'),
    replay: await import('../../html/src/replay/replay.js'),
    plan: await import('../../html/src/core/plan.js'),
    glue: await import('../../html/src/chain/arena-manifest.js'),
    read: await import('../../html/src/chain/arena-read.js'),
    proofs: await import('../../html/src/chain/proofs.js'),
  };
});

const head = async () => ethers.provider.getBlockNumber();
const warp = async (s) => { await network.provider.send('evm_increaseTime', [s]); await network.provider.send('evm_mine'); };
const mine = async (n) => { if (n > 0) await network.provider.send('hardhat_mine', ['0x' + n.toString(16)]); };
/** Mine until the arena's seed block exists (so the seed is known). */
async function pastSeedBlock(arena, id) {
  const a = await arena.getArena(id);
  await mine(Number(a.seedBlock) - (await head()) + 1);
}
async function pastClose(arena, id) { await mine(Number((await arena.getArena(id)).closeBlock) - (await head())); }

async function deploy() {
  const [owner, ...players] = await ethers.getSigners();
  const hamster = await (await ethers.getContractFactory('SqueekHamster')).deploy(owner.address, 0);
  const arena = await (await ethers.getContractFactory('SqueekArena')).deploy(owner.address, await hamster.getAddress(), FEE, DAY, HOUR);
  return { owner, players, hamster, arena };
}

/** Mint `n` hamsters to `p` and deposit them into the arena (safeTransferFrom: one step). */
async function mintIn(hamster, arena, p, n = 1) {
  const first = Number(await hamster.totalMinted()) + 1;
  await hamster.connect(p).mint(n);
  const ids = Array.from({ length: n }, (_, i) => BigInt(first + i));
  for (const id of ids) await hamster.connect(p)[SAFE](p.address, await arena.getAddress(), id);
  return ids;
}

/** Read + simulate an arena exactly like the operator does (seed derived from the seed block). */
async function simulateArena(arena, id) {
  const { arena: a, entries } = await core.read.readArena(arena, ethers.provider, { chainId: 31337, arenaId: id });
  const input = core.glue.manifestInputFromArena({ chainId: 31337, contract: await arena.getAddress(), arenaId: id, arena: a, entries });
  const { manifest, ruleset } = core.manifest.buildManifest(input);
  const replay = core.sim.simulate(manifest, ruleset);
  const statsList = core.glue.statsFromResult(replay.result);
  return {
    a, entries, manifest, ruleset, replay, statsList,
    points: core.glue.pointsFromResult(replay.result),
    stats: core.proofs.encodeStats(statsList),
    resultHash: core.proofs.hashToBytes8(replay.result.resultHash),
    replayHash: core.proofs.hashToBytes8(replay.replayHash),
  };
}
const submit = (arena, id, run) => arena.submitResult(id, run.points, run.stats, run.resultHash, run.replayHash);
async function settle(arena, id) {
  await pastSeedBlock(arena, id);
  const run = await simulateArena(arena, id);
  await (await submit(arena, id, run)).wait();
  return run;
}

/** Open an arena that closes `blocks` blocks from now. */
async function open(arena, owner, blocks = 50, max = 50, preset = 0) {
  await (await arena.connect(owner).createArena((await head()) + blocks, max, preset)).wait();
  return Number(await arena.arenaCount()) - 1;
}

/** Every registration of `tokenId` must point at the entry that really holds it. */
async function expectRegsConsistent(arena, tokenId) {
  const [ids, idx] = await arena.registrationsOf(tokenId);
  for (let i = 0; i < ids.length; i++) {
    const [es] = await arena.getEntries(ids[i]);
    expect(es[Number(idx[i])].tokenId, `token ${tokenId} in arena ${ids[i]}`).to.equal(BigInt(tokenId));
    expect(Number(es[Number(idx[i])].slot)).to.equal(i);
  }
}

// ======================================================================== NFT
describe('HamsterGenome — contract decodes DNA exactly like the game', () => {
  it('matches src/core/hamster.js on 300 random DNAs (equipment, stats, name)', async () => {
    const h = await (await ethers.getContractFactory('GenomeHarness')).deploy();
    for (let i = 0; i < 300; i++) {
      const dna = ethers.hexlify(ethers.randomBytes(32));
      const js = core.hamster.traitsOf(dna);
      const t = await h.decode(dna);
      const sol = { fur: t.fur, pattern: t.pattern, eyes: t.eyes, body: t.body, head: t.head, back: t.back,
                    stats: { str: t.str, agi: t.agi, arm: t.arm, vit: t.vit, per: t.per } };
      const want = { fur: js.fur, pattern: js.pattern, eyes: js.eyes, body: js.body, head: js.head, back: js.back, stats: js.stats };
      expect(JSON.stringify(Object.fromEntries(Object.entries(sol).map(([k, v]) => [k, typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([a, b]) => [a, Number(b)])) : Number(v)]))))
        .to.equal(JSON.stringify(want), `dna ${dna}`);
      expect(await h.name(dna)).to.equal(core.hamster.dnaName(dna));
    }
  });
});

const metaOf = async (hamster, id) => JSON.parse(Buffer.from((await hamster.tokenURI(id)).split(',')[1], 'base64').toString());

describe('SqueekHamster NFT', () => {
  it('mints with a DNA, returns equipment + stats, and on-chain metadata', async () => {
    const { players, hamster } = await deploy();
    const p = players[0];
    await expect(hamster.connect(p).mint(3)).to.emit(hamster, 'HamsterMinted');
    expect(await hamster.balanceOf(p.address)).to.equal(3n);
    expect((await hamster.tokensOfOwner(p.address)).map(Number)).to.deep.equal([1, 2, 3]);
    const dna = await hamster.dnaOf(2);
    expect(dna).to.not.equal(0n);
    const [, name, t] = await hamster.hamsterOf(2);
    const js = core.hamster.traitsOf(dna);
    expect(name).to.equal(core.hamster.dnaName(dna));
    expect([t.str, t.agi, t.arm, t.vit, t.per].map(Number)).to.deep.equal([js.stats.str, js.stats.agi, js.stats.arm, js.stats.vit, js.stats.per]);
    const meta = await metaOf(hamster, 2);
    expect(meta.name).to.equal(`${name} #2`);
    expect(meta.attributes.find((x) => x.trait_type === 'Strength').value).to.equal(js.stats.str);
    expect(meta.image.startsWith('data:image/svg+xml;base64,')).to.equal(true);
    expect(await hamster.dnaOf(1)).to.not.equal(await hamster.dnaOf(3));
  });

  it('enforces quantity and price', async () => {
    const { owner, players, hamster } = await deploy();
    await expect(hamster.connect(players[0]).mint(0)).to.be.revertedWithCustomError(hamster, 'BadQuantity');
    await expect(hamster.connect(players[0]).mint(11)).to.be.revertedWithCustomError(hamster, 'BadQuantity');
    await hamster.connect(owner).setMintPrice(5);
    await expect(hamster.connect(players[0]).mint(2, { value: 5 })).to.be.revertedWithCustomError(hamster, 'WrongPayment');
    await hamster.connect(players[0]).mint(2, { value: 10 });
  });

  it('card art is replaceable (and lockable) but stats, name and DNA are not', async () => {
    const { owner, players, hamster } = await deploy();
    await hamster.connect(players[0]).mint(1);
    const m0 = await metaOf(hamster, 1);
    expect(await hamster.supportsInterface('0x49064906')).to.equal(true);       // EIP-4906
    expect(await hamster.supportsInterface('0x2a55205a')).to.equal(true);       // EIP-2981
    expect(await hamster.supportsInterface('0x80ac58cd')).to.equal(true);       // ERC-721

    const art = await (await ethers.getContractFactory('ArtMock')).deploy();
    await expect(hamster.connect(players[0]).setArt(art)).to.be.revertedWithCustomError(hamster, 'OwnableUnauthorizedAccount');
    await expect(hamster.connect(owner).setArt(art)).to.emit(hamster, 'BatchMetadataUpdate');
    const m1 = await metaOf(hamster, 1);
    const str = m0.attributes.find((x) => x.trait_type === 'Strength').value;
    expect(m1.image).to.equal(`https://art.example/1?str=${str}`);             // the renderer got the real traits
    expect(m1.attributes).to.deep.equal(m0.attributes);                         // stats come from the NFT itself
    expect(m1.name).to.equal(m0.name);
    expect(m1.dna).to.equal(m0.dna);

    const broken = await (await ethers.getContractFactory('BrokenArtMock')).deploy();
    await hamster.setArt(broken);
    expect((await metaOf(hamster, 1)).image).to.equal(m0.image);               // a failing renderer falls back
    await hamster.setArt(ethers.ZeroAddress);
    expect((await metaOf(hamster, 1)).image).to.equal(m0.image);
    await expect(hamster.lockArt()).to.emit(hamster, 'ArtLocked');
    await expect(hamster.setArt(art)).to.be.revertedWithCustomError(hamster, 'Locked');
  });

  it('royalties (EIP-2981, at most 10 %) and the collection URI', async () => {
    const { owner, players, hamster } = await deploy();
    await hamster.connect(players[0]).mint(1);
    await expect(hamster.setRoyalty(owner.address, 1001)).to.be.revertedWithCustomError(hamster, 'BadRoyalty');
    await expect(hamster.connect(players[0]).setRoyalty(owner.address, 500)).to.be.revertedWithCustomError(hamster, 'OwnableUnauthorizedAccount');
    await hamster.setRoyalty(owner.address, 500);
    expect(await hamster.royaltyInfo(1, 10_000)).to.deep.equal([owner.address, 500n]);
    await hamster.setRoyalty(ethers.ZeroAddress, 0);
    expect((await hamster.royaltyInfo(1, 10_000))[1]).to.equal(0n);
    await expect(hamster.setContractURI('ipfs://collection')).to.emit(hamster, 'ContractURIUpdated');
    expect(await hamster.contractURI()).to.equal('ipfs://collection');
  });
});

describe('SqueekHamster — the DNA a buyer paid for never changes', () => {
  it('survives deposits, arenas, settlement, withdrawal and transfers untouched', async () => {
    const { owner, players, hamster, arena } = await deploy();
    const [a, b] = players;
    const [tid] = await mintIn(hamster, arena, a, 1);
    await mintIn(hamster, arena, b, 1);
    const dna0 = await hamster.dnaOf(tid);
    const traits0 = await hamster.traitsOf(tid);
    const uri0 = await hamster.tokenURI(tid);
    const jsTraits = core.hamster.traitsOf('0x' + dna0.toString(16).padStart(64, '0'));
    expect(Number(traits0.str)).to.equal(jsTraits.stats.str);
    expect(Number(traits0.body)).to.equal(jsTraits.body);

    const id = await open(arena, owner, 10);
    await arena.connect(a).join(id, tid, { value: FEE });
    await arena.connect(b).join(id, 2n, { value: FEE });
    const run = await settle(arena, id);
    await warp(HOUR);
    const t = core.proofs.pointsTree(run.points);
    await arena.connect(b).claimMany(id, [0, 1], run.points, [t.proof(0), t.proof(1)]);
    await arena.connect(a).withdraw([tid]);
    await hamster.connect(a).transferFrom(a.address, b.address, tid);
    await hamster.connect(owner).setMintPrice(1234);

    expect(await hamster.dnaOf(tid)).to.equal(dna0);
    expect(await hamster.tokenURI(tid)).to.equal(uri0);
    const traits1 = await hamster.traitsOf(tid);
    for (const k of ['fur', 'pattern', 'eyes', 'body', 'head', 'back', 'str', 'agi', 'arm', 'vit', 'per'])
      expect(Number(traits1[k]), k).to.equal(Number(traits0[k]));
  });

  it('gives every token its own DNA, even ten in one transaction', async () => {
    const { players, hamster } = await deploy();
    await hamster.connect(players[0]).mint(10);
    const dnas = [];
    for (let i = 1n; i <= 10n; i++) dnas.push((await hamster.dnaOf(i)).toString());
    expect(new Set(dnas).size).to.equal(10);
  });

  it('the stats a hamster brings to a match come from its DNA alone, not from the arena seed', async () => {
    const { owner, players, hamster, arena } = await deploy();
    for (const p of players.slice(0, 2)) await mintIn(hamster, arena, p, 1);
    const seen = [], seeds = [];
    for (const id of [0, 1]) {
      await open(arena, owner, 10);
      await arena.connect(players[0]).join(id, 1n, { value: FEE });
      await arena.connect(players[1]).join(id, 2n, { value: FEE });
      await pastSeedBlock(arena, id);
      const run = await simulateArena(arena, id);
      seeds.push(run.a.seed);
      const bot = run.replay.initial.bots.find((x) => x.tokenId === '1');
      seen.push([bot.dna, bot.maxHp, bot.moveSpeed, bot.strMul, bot.armor, bot.aimSkill, bot.dodgeSkill, bot.awareness].join('|'));
    }
    expect(seeds[0]).to.not.equal(seeds[1]);
    expect(seen[0]).to.equal(seen[1]);
  });
});

// ======================================================================== arena
describe('SqueekArena — full flow', () => {
  it('deposit -> join -> close -> seed -> one submitResult (points, rank, kills) -> confirm -> claim', async () => {
    const { owner, players, hamster, arena } = await deploy();
    const P = players.slice(0, 6);
    // two ways in: safeTransferFrom (one step) and setApprovalForAll + deposit(ids)
    for (const p of P.slice(0, 3)) await mintIn(hamster, arena, p, 2);
    for (const p of P.slice(3)) {
      await hamster.connect(p).mint(2);
      await hamster.connect(p).setApprovalForAll(arena, true);
      await expect(arena.connect(p).deposit([...(await hamster.tokensOfOwner(p.address))])).to.emit(arena, 'Deposited');
    }
    for (const p of P) expect((await arena.depositsOf(p.address)).length).to.equal(2);
    expect(await hamster.ownerOf(1)).to.equal(await arena.getAddress());
    expect(await arena.depositorOf(1)).to.equal(P[0].address);
    const id = await open(arena, owner, 80);
    for (const p of P) for (const tid of await arena.depositsOf(p.address)) await arena.connect(p).join(id, tid, { value: FEE });

    // join rules
    const extra = players[7];
    await hamster.connect(extra).mint(1);
    const tid = 13n;
    await expect(arena.connect(extra).join(id, tid, { value: FEE })).to.be.revertedWithCustomError(arena, 'NotDepositor');   // still in the wallet
    await hamster.connect(extra)[SAFE](extra.address, await arena.getAddress(), tid);
    await expect(arena.connect(extra).join(id, tid, { value: FEE - 1n })).to.be.revertedWithCustomError(arena, 'WrongFee');
    await expect(arena.connect(extra).join(id, 1, { value: FEE })).to.be.revertedWithCustomError(arena, 'NotDepositor');      // someone else's
    await expect(arena.connect(P[0]).join(id, 1, { value: FEE })).to.be.revertedWithCustomError(arena, 'AlreadyJoined');
    expect(await arena.tokenInArena(id, 1)).to.equal(true);
    expect(await arena.tokenInArena(id, tid)).to.equal(false);
    expect(arena.interface.getFunction('join').inputs.map((i) => i.name)).to.deep.equal(['arenaId', 'tokenId']);
    { const [es] = await arena.getEntries(id); expect(Object.keys(es[0].toObject())).to.deep.equal(['tokenId', 'player', 'claimed', 'slot']); }

    // entries close at closeBlock; the seed is not knowable until seedBlock is mined
    await expect(arena.pinSeed(id)).to.be.revertedWithCustomError(arena, 'TooEarly');
    const a0 = await arena.getArena(id);
    await pastClose(arena, id);
    await expect(arena.connect(extra).join(id, tid, { value: FEE })).to.be.revertedWithCustomError(arena, 'TooLate');
    await expect(arena.pinSeed(id)).to.be.revertedWithCustomError(arena, 'TooEarly');
    await pastSeedBlock(arena, id);

    const run = await simulateArena(arena, id);
    const bh = (await ethers.provider.getBlock(Number(a0.seedBlock))).hash;
    expect(run.a.seed).to.equal(core.proofs.seedFromBlockHash(bh, id, await arena.getAddress(), 31337));
    expect(run.entries.length).to.equal(12);
    expect(core.replay.validateReplay(run.replay).ok).to.equal(true);

    // settle: operator only, points (and stats, if given) must cover every entry
    await expect(arena.connect(extra).submitResult(id, run.points, run.stats, run.resultHash, run.replayHash)).to.be.revertedWithCustomError(arena, 'NotOperator');
    await expect(arena.submitResult(id, run.points.slice(1), run.stats, run.resultHash, run.replayHash)).to.be.revertedWithCustomError(arena, 'BadPoints');
    await expect(arena.submitResult(id, run.points, run.stats.slice(0, -2), run.resultHash, run.replayHash)).to.be.revertedWithCustomError(arena, 'BadPoints');
    const tx = await submit(arena, id, run);
    await expect(tx).to.emit(arena, 'SeedDrawn').and.to.emit(arena, 'ResultPosted');
    const after = await core.read.readArena(arena, ethers.provider, { chainId: 31337, arenaId: id });
    const a = after.arena;
    expect(a.status).to.equal('Settled');
    expect(a.seed).to.equal(run.a.seed);
    expect(a.pointsRoot).to.equal(core.proofs.pointsTree(run.points).root);
    expect(after.entries.map((e) => e.points)).to.deep.equal(run.points);                 // read back from calldata
    expect(after.entries.map((e) => [e.rank, e.kills])).to.deep.equal(run.statsList.map((s) => [s.rank, s.kills]));
    expect(after.entries.find((e) => e.rank === 1).index).to.equal(run.replay.result.winnerId);
    expect(core.glue.bytes32ToHash(a.resultHash)).to.equal(run.replay.result.resultHash);
    expect(a.ruleset).to.equal(1);
    expect(a.fee).to.equal(FEE);
    const pot = FEE * 12n;
    expect(a.pot).to.equal(pot);
    expect(a.rewardPool).to.equal(pot * 9000n / 10000n);
    expect(await arena.treasury()).to.equal(pot - a.rewardPool);

    // not final yet: claims wait for the claim delay, and the page must not say "Confirmed"
    expect(a.confirmed).to.equal(false);
    expect(core.glue.phaseOf(a, after.head, after.now)).to.equal('Confirming');
    const tree = core.proofs.pointsTree(run.points);
    await expect(arena.claim(id, 0, run.points[0], tree.proof(0))).to.be.revertedWithCustomError(arena, 'TooEarly');
    await warp(HOUR);
    const final = await core.read.readArena(arena, ethers.provider, { chainId: 31337, arenaId: id });
    expect(final.arena.confirmed).to.equal(true);
    expect(core.glue.phaseOf(final.arena, final.head, final.now)).to.equal('Settled');

    // claims need the right proof
    await expect(arena.claim(id, 0, run.points[0] + 1, tree.proof(0))).to.be.revertedWithCustomError(arena, 'BadProof');
    await expect(arena.claim(id, 0, run.points[1], tree.proof(1))).to.be.revertedWithCustomError(arena, 'BadProof');
    const total = run.points.reduce((s, v) => s + BigInt(v), 0n);
    let paid = 0n;
    for (const p of P) {
      const mine_ = after.entries.filter((e) => e.player === p.address.toLowerCase());
      const want = mine_.reduce((s, e) => s + (a.rewardPool * BigInt(run.points[e.index])) / total, 0n);
      const idx = mine_.map((e) => e.index);
      const before = await ethers.provider.getBalance(p.address);
      const rc = await (await arena.connect(p).claimMany(id, idx, idx.map((i) => run.points[i]), idx.map((i) => tree.proof(i)))).wait();
      const bal = await ethers.provider.getBalance(p.address);
      expect(bal - before + rc.gasUsed * rc.gasPrice).to.equal(want);
      paid += want;
    }
    expect(paid <= a.rewardPool && a.rewardPool - paid < 12n).to.equal(true);       // only rounding dust
    expect(await ethers.provider.getBalance(await arena.getAddress())).to.equal(pot - paid);
    await expect(arena.claim(id, 0, run.points[0], tree.proof(0))).to.be.revertedWithCustomError(arena, 'AlreadyClaimed');
    expect(Number((await arena.getArena(id)).claimedCount)).to.equal(12);
  });

  it('pinSeed stores the same seed early; a later submitResult uses it (stats optional)', async () => {
    const { owner, players, hamster, arena } = await deploy();
    for (const p of players.slice(0, 3)) await mintIn(hamster, arena, p, 1);
    const id = await open(arena, owner, 10, 10, 1);
    for (let i = 0; i < 3; i++) await arena.connect(players[i]).join(id, BigInt(i + 1), { value: FEE });
    await pastSeedBlock(arena, id);
    const derived = (await core.read.readArena(arena, ethers.provider, { chainId: 31337, arenaId: id })).arena.seed;
    await expect(arena.connect(players[9]).pinSeed(id)).to.emit(arena, 'SeedDrawn');           // anyone
    expect((await arena.getArena(id)).seed.toLowerCase()).to.equal(derived);
    const run = await simulateArena(arena, id);
    await arena.submitResult(id, run.points, '0x', run.resultHash, run.replayHash);           // no stats: still valid
    expect((await arena.getArena(id)).seed.toLowerCase()).to.equal(derived);
    const r = await core.read.readArena(arena, ethers.provider, { chainId: 31337, arenaId: id });
    expect(r.arena.hasStats).to.equal(false);
    expect(r.entries[0].rank).to.equal(undefined);
  });

  it('builds the same Merkle tree as JS for 2, 3, 5 and 7 players (odd layers included)', async () => {
    const { owner, players, hamster, arena } = await deploy();
    for (const p of players.slice(0, 7)) await mintIn(hamster, arena, p, 1);
    for (const n of [2, 3, 5, 7]) {
      const id = await open(arena, owner, 20, 10, 0);
      for (let i = 0; i < n; i++) await arena.connect(players[i]).join(id, BigInt(i + 1), { value: FEE });
      const run = await settle(arena, id);
      await warp(HOUR);
      const tree = core.proofs.pointsTree(run.points);
      expect((await arena.getArena(id)).pointsRoot.toLowerCase()).to.equal(tree.root);
      for (let i = 0; i < n; i++) await arena.connect(players[i]).claim(id, i, run.points[i], tree.proof(i));
      expect(Number((await arena.getArena(id)).claimedCount)).to.equal(n);
    }
  });

  it('cancels with full refunds when fewer than 2 hamsters joined', async () => {
    const { owner, players, hamster, arena } = await deploy();
    await mintIn(hamster, arena, players[0], 1);
    const id = await open(arena, owner, 5, 10, 1);
    await arena.connect(players[0]).join(id, 1, { value: FEE });
    await mine(6);
    await expect(arena.pinSeed(id)).to.emit(arena, 'Cancelled');
    await expect(arena.claim(id, 0, 0, [])).to.changeEtherBalance(players[0], FEE);           // no delay for refunds
  });

  it('anyone may cancel an arena whose result never came (refunds)', async () => {
    const { owner, players, hamster, arena } = await deploy();
    for (const p of players.slice(0, 2)) await mintIn(hamster, arena, p, 1);
    const id = await open(arena, owner, 5, 10, 2);
    await arena.connect(players[0]).join(id, 1, { value: FEE });
    await arena.connect(players[1]).join(id, 2, { value: FEE });
    await pastSeedBlock(arena, id);
    await arena.pinSeed(id);
    await expect(arena.connect(players[5]).cancelStale(id)).to.be.revertedWithCustomError(arena, 'WrongStatus');
    await warp(DAY + 10);
    await expect(arena.connect(players[5]).cancelStale(id)).to.emit(arena, 'Cancelled');
    await expect(arena.claimMany(id, [1], [0], [[]])).to.changeEtherBalance(players[1], FEE);
  });

  it('re-arms the seed block if the 256-block window was missed', async () => {
    const { owner, players, hamster, arena } = await deploy();
    for (const p of players.slice(0, 2)) await mintIn(hamster, arena, p, 1);
    const id = await open(arena, owner, 5, 10, 0);
    await arena.connect(players[0]).join(id, 1, { value: FEE });
    await arena.connect(players[1]).join(id, 2, { value: FEE });
    const first = (await arena.getArena(id)).seedBlock;
    await mine(300);
    await expect(arena.pinSeed(id)).to.be.revertedWithCustomError(arena, 'SeedExpired');
    expect((await core.read.readArena(arena, ethers.provider, { chainId: 31337, arenaId: id })).arena.seedExpired).to.equal(true);
    await expect(arena.rearm(id)).to.emit(arena, 'Rearmed');
    expect((await arena.getArena(id)).seedBlock).to.be.greaterThan(first);
    await expect(arena.rearm(id)).to.be.revertedWithCustomError(arena, 'WrongStatus');
    await pastSeedBlock(arena, id);
    const run = await simulateArena(arena, id);
    await expect(submit(arena, id, run)).to.emit(arena, 'ResultPosted');
  });

  it('a hamster enters many arenas but each arena only once', async () => {
    const { owner, players, hamster, arena } = await deploy();
    await mintIn(hamster, arena, players[0], 1);
    for (let k = 0; k < 3; k++) {
      const id = await open(arena, owner, 50);
      await arena.connect(players[0]).join(id, 1, { value: FEE });
      await expect(arena.connect(players[0]).join(id, 1, { value: FEE })).to.be.revertedWithCustomError(arena, 'AlreadyJoined');
    }
    expect(await arena.tokenInArena(0, 1)).to.equal(true);
    expect(await arena.tokenInArena(2, 1)).to.equal(true);
    await open(arena, owner, 50);
    expect(await arena.tokenInArena(3, 1)).to.equal(false);
  });
});

describe('SqueekArena — deposits', () => {
  it('joinMany, no transfer while deposited, withdraw cancels open entries (refund) and keeps closed ones', async () => {
    const { owner, players, hamster, arena } = await deploy();
    const [a, b, c] = players;
    await mintIn(hamster, arena, a, 1);            // token 1
    await mintIn(hamster, arena, b, 1);            // token 2
    await mintIn(hamster, arena, c, 1);            // token 3
    const early = await open(arena, owner, 14);
    const late1 = await open(arena, owner, 300);
    const late2 = await open(arena, owner, 300);

    await expect(arena.connect(a).joinMany([early, late1, late2], [1, 1, 1], { value: FEE * 2n })).to.be.revertedWithCustomError(arena, 'WrongFee');
    await arena.connect(a).joinMany([early, late1, late2], [1, 1, 1], { value: FEE * 3n });
    await arena.connect(b).joinMany([early, late1, late2], [2, 2, 2], { value: FEE * 3n });
    await arena.connect(c).joinMany([late1, late2], [3, 3], { value: FEE * 2n });
    // deposited: the player cannot move it anywhere
    await expect(hamster.connect(a).transferFrom(a.address, c.address, 1)).to.be.reverted;
    await expect(arena.connect(b).withdraw([1])).to.be.revertedWithCustomError(arena, 'NotDepositor');

    await pastClose(arena, early);
    // token 1 sits first in every arena; taking it out moves the last entry into its place
    const before = await ethers.provider.getBalance(a.address);
    const rc = await (await arena.connect(a).withdraw([1])).wait();
    expect(await ethers.provider.getBalance(a.address) - before + rc.gasUsed * rc.gasPrice).to.equal(FEE * 2n);   // late1 + late2
    expect(await hamster.ownerOf(1)).to.equal(a.address);
    expect((await arena.depositsOf(a.address)).length).to.equal(0);
    for (const id of [late1, late2]) {
      const [es] = await arena.getEntries(id);
      expect(es.map((e) => Number(e.tokenId)).sort()).to.deep.equal([2, 3]);
      const x = await arena.getArena(id);
      expect(Number(x.entrantCount)).to.equal(2);
      expect(x.pot).to.equal(FEE * 2n);
      expect(await arena.tokenInArena(id, 1)).to.equal(false);
    }
    expect(await arena.tokenInArena(early, 1)).to.equal(true);                 // closed: stays in
    expect(Number((await arena.getArena(early)).entrantCount)).to.equal(2);
    await expectRegsConsistent(arena, 2);
    await expectRegsConsistent(arena, 3);

    // c leaves too: the bookkeeping holds after a second swap
    await arena.connect(c).withdraw([3]);
    for (const id of [late1, late2]) expect((await arena.getEntries(id))[0].map((e) => Number(e.tokenId))).to.deep.equal([2]);
    await expectRegsConsistent(arena, 2);

    // a sold the hamster: the buyer deposits it and enters the very same open arena
    await hamster.connect(a).transferFrom(a.address, c.address, 1);
    await hamster.connect(c)[SAFE](c.address, await arena.getAddress(), 1);
    await arena.connect(c).join(late1, 1, { value: FEE });
    await expectRegsConsistent(arena, 1);

    // the early arena (closed before the withdrawal) still plays — and pays the player who entered it
    const run = await settle(arena, early);
    await warp(HOUR);
    const tree = core.proofs.pointsTree(run.points);
    const i = run.entries.findIndex((e) => e.tokenId === '1');
    expect(run.entries[i].player).to.equal(a.address.toLowerCase());
    const owed = await arena.rewardFor(early, run.points[i]);
    await expect(arena.connect(c).claim(early, i, run.points[i], tree.proof(i))).to.changeEtherBalance(a, owed);
  });

  it('one hamster holds at most 50 open entries; closed arenas free their places', async () => {
    const { owner, players, hamster, arena } = await deploy();
    await mintIn(hamster, arena, players[0], 1);
    const first = (await head()) + 400;
    await arena.createArenas(first, 1, 51, 10, 0, false);
    const ids = Array.from({ length: 50 }, (_, i) => i);
    await arena.connect(players[0]).joinMany(ids, ids.map(() => 1), { value: FEE * 50n });
    await expect(arena.connect(players[0]).join(50, 1, { value: FEE })).to.be.revertedWithCustomError(arena, 'TooManyOpen');
    await mine(first + 5 - (await head()));        // the join below lands in block first+6: arenas 0..6 are closed
    await arena.connect(players[0]).join(50, 1, { value: FEE });
    const [regs] = await arena.registrationsOf(1);
    expect(regs.length).to.equal(50 - 7 + 1);
    expect(regs.map(Number).every((x) => x > 6)).to.equal(true);
    await expectRegsConsistent(arena, 1);
  });

  it('refuses other NFTs; a hamster sent without deposit can be recovered by the owner', async () => {
    const { owner, players, hamster, arena } = await deploy();
    const foreign = await (await ethers.getContractFactory('ForeignSender')).deploy();
    await expect(foreign.poke(await arena.getAddress(), 5)).to.be.reverted;
    await hamster.connect(players[0]).mint(1);
    await hamster.connect(players[0]).transferFrom(players[0].address, await arena.getAddress(), 1);   // not a deposit
    expect(await arena.depositorOf(1)).to.equal(ethers.ZeroAddress);
    const id = await open(arena, owner, 50);
    await expect(arena.connect(players[0]).join(id, 1, { value: FEE })).to.be.revertedWithCustomError(arena, 'NotDepositor');
    await expect(arena.connect(players[0]).recoverHamster(1, players[0].address)).to.be.revertedWithCustomError(arena, 'OwnableUnauthorizedAccount');
    await arena.recoverHamster(1, players[0].address);
    expect(await hamster.ownerOf(1)).to.equal(players[0].address);
    await mintIn(hamster, arena, players[1], 1);
    await expect(arena.recoverHamster(2, owner.address)).to.be.revertedWithCustomError(arena, 'NotDepositor');
  });
});

describe('SqueekArena — confirmation, void, sweep, claimAcross', () => {
  async function twoPlayerArena(env, blocks = 10) {
    const { owner, players, arena } = env;
    const id = await open(arena, owner, blocks);
    await arena.connect(players[0]).join(id, 1, { value: FEE });
    await arena.connect(players[1]).join(id, 2, { value: FEE });
    return id;
  }

  it('the owner can void a wrong result during the claim delay: cancelled, everyone refunded', async () => {
    const env = await deploy();
    const { owner, players, hamster, arena } = env;
    for (const p of players.slice(0, 2)) await mintIn(hamster, arena, p, 1);
    const id = await twoPlayerArena(env);
    await settle(arena, id);
    expect(await arena.treasury()).to.equal(FEE * 2n / 10n);
    await expect(arena.connect(players[0]).voidResult(id)).to.be.revertedWithCustomError(arena, 'OwnableUnauthorizedAccount');
    await expect(arena.connect(owner).voidResult(id)).to.emit(arena, 'ResultVoided');
    expect(await arena.treasury()).to.equal(0n);
    expect(Number((await arena.getArena(id)).status)).to.equal(4);                 // Cancelled
    await expect(arena.claim(id, 0, 0, [])).to.changeEtherBalance(players[0], FEE);
    await expect(arena.claim(id, 1, 0, [])).to.changeEtherBalance(players[1], FEE);

    const id2 = await twoPlayerArena(env);
    await settle(arena, id2);
    await warp(HOUR);
    await expect(arena.voidResult(id2)).to.be.revertedWithCustomError(arena, 'TooLate');     // final now
  });

  it('after 90 days the owner sweeps what nobody claimed; later claims are refused', async () => {
    const env = await deploy();
    const { owner, players, hamster, arena } = env;
    for (const p of players.slice(0, 2)) await mintIn(hamster, arena, p, 1);
    const id = await twoPlayerArena(env);
    const run = await settle(arena, id);
    await warp(HOUR);
    const tree = core.proofs.pointsTree(run.points);
    await arena.claim(id, 0, run.points[0], tree.proof(0));
    const lone = await open(arena, owner, 5);
    await arena.connect(players[0]).join(lone, 1, { value: FEE });
    await mine(6);
    await arena.pinSeed(lone);                                                      // cancelled, refund unclaimed
    await expect(arena.sweep(id)).to.be.revertedWithCustomError(arena, 'TooEarly');
    await warp(90 * DAY);
    const t0 = await arena.treasury();
    const a = await arena.getArena(id);
    await expect(arena.connect(players[0]).sweep(id)).to.be.revertedWithCustomError(arena, 'OwnableUnauthorizedAccount');
    await expect(arena.sweep(id)).to.emit(arena, 'Swept');
    expect(await arena.treasury() - t0).to.equal(a.rewardPool - a.paidOut);
    await expect(arena.claim(id, 1, run.points[1], tree.proof(1))).to.be.revertedWithCustomError(arena, 'WrongStatus');
    await arena.sweep(lone);
    expect(await arena.treasury() - t0).to.equal(a.rewardPool - a.paidOut + FEE);
    await expect(arena.claim(lone, 0, 0, [])).to.be.revertedWithCustomError(arena, 'WrongStatus');
    await arena.withdrawTreasury(owner.address);
    expect(await ethers.provider.getBalance(await arena.getAddress())).to.equal(0n);
  });

  it('claimAcross pays settled rewards and cancelled refunds of many arenas in one transaction', async () => {
    const env = await deploy();
    const { owner, players, hamster, arena } = env;
    for (const p of players.slice(0, 2)) await mintIn(hamster, arena, p, 1);
    const x = await twoPlayerArena(env, 30);
    const y = await twoPlayerArena(env, 30);
    const z = await open(arena, owner, 30);
    await arena.connect(players[0]).join(z, 1, { value: FEE });
    const rx = await settle(arena, x);
    const ry = await settle(arena, y);
    await arena.pinSeed(z);                                                        // 1 player: cancelled
    await warp(HOUR);
    const tx_ = core.proofs.pointsTree(rx.points), ty = core.proofs.pointsTree(ry.points);
    const want = (await arena.rewardFor(x, rx.points[0])) + (await arena.rewardFor(y, ry.points[0])) + FEE;
    await expect(arena.connect(players[1]).claimAcross([x, y, z], [0, 0, 0], [rx.points[0], ry.points[0], 0], [tx_.proof(0), ty.proof(0), []]))
      .to.changeEtherBalance(players[0], want);                                    // anyone may trigger; pays the player
    await expect(arena.claimAcross([x], [0], [rx.points[0]], [tx_.proof(0)])).to.be.revertedWithCustomError(arena, 'AlreadyClaimed');
  });

  it('fee, reward share and simulator version are set per arena; old arenas keep theirs', async () => {
    const env = await deploy();
    const { owner, players, hamster, arena } = env;
    for (const p of players.slice(0, 2)) await mintIn(hamster, arena, p, 1);
    await expect(arena.connect(players[0]).setDefaults(FEE, 9000, 1)).to.be.revertedWithCustomError(arena, 'OwnableUnauthorizedAccount');
    await expect(arena.setDefaults(FEE, 4999, 1)).to.be.revertedWithCustomError(arena, 'BadSetting');
    await expect(arena.setDefaults(FEE + 1n, 9000, 1)).to.be.revertedWithCustomError(arena, 'BadSetting');      // not whole gwei
    await expect(arena.setDefaults(FEE, 9000, 0)).to.be.revertedWithCustomError(arena, 'BadSetting');
    const old = await twoPlayerArena(env, 40);
    await expect(arena.setDefaults(FEE * 2n, 8000, 2)).to.emit(arena, 'DefaultsChanged');
    expect(await arena.entryFee()).to.equal(FEE * 2n);
    const nu = await open(arena, owner, 40);
    const [o, n] = [await arena.getArena(old), await arena.getArena(nu)];
    expect([o.fee, Number(o.rewardBps), Number(o.ruleset)]).to.deep.equal([FEE, 9000, 1]);
    expect([n.fee, Number(n.rewardBps), Number(n.ruleset)]).to.deep.equal([FEE * 2n, 8000, 2]);
    await expect(arena.connect(players[0]).join(nu, 1, { value: FEE })).to.be.revertedWithCustomError(arena, 'WrongFee');
    await arena.connect(players[0]).join(nu, 1, { value: FEE * 2n });
    await arena.connect(players[1]).join(nu, 2, { value: FEE * 2n });
    // the old arena settles on its own terms
    await settle(arena, old);
    expect((await arena.getArena(old)).rewardPool).to.equal(FEE * 2n * 9000n / 10000n);
    // ruleset 2 does not exist in this build: clients refuse to simulate it rather than guess
    await pastSeedBlock(arena, nu);
    let threw = null;
    try { await simulateArena(arena, nu); } catch (e) { threw = e.message; }
    expect(threw).to.match(/ruleset 2/);
  });

  it('getArenas reads a page of arenas in one call', async () => {
    const { arena } = await deploy();
    const first = (await head()) + 100;
    await arena.createArenas(first, 7, 5, 20, 0, true);
    const page = await arena.getArenas(1, 3);
    expect(page.length).to.equal(3);
    expect(page.map((a) => Number(a.closeBlock))).to.deep.equal([first + 7, first + 14, first + 21]);
    expect((await arena.getArenas(4, 10)).length).to.equal(1);
    expect((await arena.getArenas(9, 2)).length).to.equal(0);
  });
});

describe('SqueekArena — rooms opened by players', () => {
  it('any player opens a room: start up to ~7 days ahead, 2..100 hamsters, any preset', async () => {
    const { players, hamster, arena } = await deploy();
    const [alice, bob, carol] = players;
    const h = await head();
    await expect(arena.connect(alice).createRoom(h + 2, 10, 0)).to.be.revertedWithCustomError(arena, 'TooLate');      // starts too soon
    await expect(arena.connect(alice).createRoom(h + 60_000, 10, 0)).to.be.revertedWithCustomError(arena, 'TooEarly'); // > 7 days
    await expect(arena.connect(alice).createRoom(h + 30, 101, 0)).to.be.revertedWithCustomError(arena, 'BadArena');
    await expect(arena.connect(alice).createRoom(h + 30, 1, 0)).to.be.revertedWithCustomError(arena, 'BadArena');
    await expect(arena.connect(alice).createRoom(h + 30, 10, 3)).to.be.revertedWithCustomError(arena, 'BadArena');
    await expect(arena.connect(alice).createRoom(h + 30, 100, 2)).to.emit(arena, 'RoomCreated').withArgs(0, alice.address);
    const a = await arena.getArena(0);
    expect([Number(a.maxEntrants), Number(a.preset), a.fee, Number(a.rewardBps)]).to.deep.equal([100, 2, FEE, 9000]);
    // it plays like any arena: bob and carol enter, the operator settles, they claim
    await mintIn(hamster, arena, bob, 1);
    await mintIn(hamster, arena, carol, 1);
    await arena.connect(bob).join(0, 1, { value: FEE });
    await arena.connect(carol).join(0, 2, { value: FEE });
    const run = await settle(arena, 0);
    await warp(HOUR);
    const tree = core.proofs.pointsTree(run.points);
    await expect(arena.claim(0, 0, run.points[0], tree.proof(0))).to.changeEtherBalance(bob, await arena.rewardFor(0, run.points[0]));
  });

  it('a room with one player: no match, and the player takes 100 % back alone once it starts', async () => {
    const { players, hamster, arena } = await deploy();
    const [alice] = players;
    await arena.connect(alice).createRoom((await head()) + 10, 5, 0);
    await mintIn(hamster, arena, alice, 1);
    await arena.connect(alice).join(0, 1, { value: FEE });
    await expect(arena.connect(alice).claim(0, 0, 0, [])).to.be.revertedWithCustomError(arena, 'WrongStatus');   // still open
    await pastClose(arena, 0);
    // nobody pinned or cancelled anything: the claim itself cancels and refunds the full fee
    await expect(arena.connect(alice).claim(0, 0, 0, [])).to.changeEtherBalance(alice, FEE);
    expect(Number((await arena.getArena(0)).status)).to.equal(4);                                                  // Cancelled
    expect(await arena.treasury()).to.equal(0n);
    await expect(arena.connect(alice).claim(0, 0, 0, [])).to.be.revertedWithCustomError(arena, 'AlreadyClaimed');
  });
});

describe('SqueekArena — creating arenas', () => {
  it('schedules many arenas in one transaction (createArenas): spacing, preset rotation, limits', async () => {
    const { owner, players, hamster, arena } = await deploy();
    const first = (await head()) + 50;
    await expect(arena.connect(players[0]).createArenas(first, 10, 5, 20, 0, true)).to.be.revertedWithCustomError(arena, 'NotOperator');
    await expect(arena.createArenas(first, 10, 0, 20, 0, false)).to.be.revertedWithCustomError(arena, 'BadArena');
    await expect(arena.createArenas(first, 10, 101, 20, 0, false)).to.be.revertedWithCustomError(arena, 'BadArena');
    await expect(arena.createArenas(first, 0, 5, 20, 0, false)).to.be.revertedWithCustomError(arena, 'BadArena');
    await expect(arena.createArenas(await head(), 10, 5, 20, 0, false)).to.be.revertedWithCustomError(arena, 'TooLate');
    const rc = await (await arena.connect(owner).createArenas(first, 10, 7, 20, 1, true)).wait();
    expect(await arena.arenaCount()).to.equal(7n);
    for (let i = 0; i < 7; i++) {
      const a = await arena.getArena(i);
      expect(Number(a.closeBlock)).to.equal(first + 10 * i);
      expect(Number(a.seedBlock)).to.equal(first + 10 * i + 2);
      expect(Number(a.preset)).to.equal((1 + i) % 3);
      expect(Number(a.maxEntrants)).to.equal(20);
    }
    expect(rc.logs.length).to.equal(7);
    for (const p of players.slice(0, 2)) await mintIn(hamster, arena, p, 1);
    await arena.connect(players[0]).join(3, 1, { value: FEE });
    await arena.connect(players[1]).join(3, 2, { value: FEE });
    await pastSeedBlock(arena, 3);
    const run = await simulateArena(arena, 3);
    await expect(submit(arena, 3, run)).to.emit(arena, 'ResultPosted');
  });

  it('only the operator/owner creates arenas; window, preset and size are checked', async () => {
    const { owner, players, arena } = await deploy();
    const b = (await head()) + 100;
    await expect(arena.connect(players[0]).createArena(b, 10, 0)).to.be.revertedWithCustomError(arena, 'NotOperator');
    await expect(arena.createArena(await head(), 10, 0)).to.be.revertedWithCustomError(arena, 'TooLate');
    await expect(arena.createArena(b, 1, 0)).to.be.revertedWithCustomError(arena, 'BadArena');
    await expect(arena.createArena(b, 201, 0)).to.be.revertedWithCustomError(arena, 'BadArena');
    await expect(arena.createArena(b, 10, 3)).to.be.revertedWithCustomError(arena, 'BadArena');
    await arena.connect(owner).setOperator(players[0].address);
    await arena.connect(players[0]).createArena(b, 10, 0);
    expect(await arena.arenaCount()).to.equal(1n);
  });
});
