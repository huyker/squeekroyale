// Measured gas for everything a player or the operator ever sends.
//   npx hardhat run scripts/gas-report.js                  (in-process chain, no node needed)
//   npx hardhat run scripts/gas-report.js --network localhost
//
// Prints gas per action and what it costs at a few gas prices, so "is this expensive for
// the user?" gets answered with numbers instead of a guess. Re-run after any contract
// change: the figures quoted in docs/ come from here.
//
//   ENTRANTS=100 ETH_USD=3000 npx hardhat run scripts/gas-report.js
const { ethers, network } = require('hardhat');

const N = Number(process.env.ENTRANTS || 100);
const FEE = ethers.parseEther('0.0001');
const GWEI = [0.001, 1, 5, 20];                 // L2-ish, cheap L1, normal L1, busy L1
const ETH_USD = Number(process.env.ETH_USD || 3000);

const rows = [];
const add = (what, gas, who, note) => rows.push({ what, gas: Number(gas), who, note: note || '' });
const gasOf = async (p) => (await (await p).wait()).gasUsed;

/**
 * `N` distinct player wallets. A Hardhat node only unlocks 20 accounts, and the whole
 * point of this report is what 100 separate players cost — and that `submitResult` stays
 * flat however many entrants there are (one Merkle root, built on-chain). So the extra ones are impersonated and
 * funded, which costs no gas of its own and keeps every entry a different address.
 */
async function playerSigners(n) {
  const signers = await ethers.getSigners();
  const out = signers.slice(1, n + 1);
  for (let i = out.length; i < n; i++) {
    const addr = ethers.getAddress('0x' + (BigInt('0x1111000000000000000000000000000000000000') + BigInt(i)).toString(16).padStart(40, '0'));
    await network.provider.send('hardhat_setBalance', [addr, '0x3635C9ADC5DEA00000']);   // 1000 ETH
    await network.provider.send('hardhat_impersonateAccount', [addr]);
    out.push(await ethers.getSigner(addr));
  }
  return out;
}

async function main() {
  const signers = await ethers.getSigners();
  const owner = signers[0];
  const players = await playerSigners(N);
  console.log(`network ${network.name} · ${players.length} ví người chơi (${signers.length - 1} ví mở sẵn + ${Math.max(0, N - signers.length + 1)} ví giả lập) · ${N} lượt tham gia\n`);

  // ---------------------------------------------------------------- deploy (one-off, project)
  const hamster = await (await ethers.getContractFactory('SqueekHamster')).deploy(owner.address, 0);
  await hamster.waitForDeployment();
  add('deploy SqueekHamster', (await hamster.deploymentTransaction().wait()).gasUsed, 'dự án', 'một lần duy nhất');

  const arena = await (await ethers.getContractFactory('SqueekArena'))
    .deploy(owner.address, await hamster.getAddress(), FEE, 86400, 3600);
  await arena.waitForDeployment();
  add('deploy SqueekArena', (await arena.deploymentTransaction().wait()).gasUsed, 'dự án', 'một lần duy nhất');

  // ---------------------------------------------------------------- mint (player, once per NFT)
  add('mint(1) — hamster đầu tiên của ví', await gasOf(hamster.connect(players[0]).mint(1)), 'người chơi', 'một lần cho mỗi NFT');
  add('mint(1) — ví đã có hamster', await gasOf(hamster.connect(players[0]).mint(1)), 'người chơi', '');
  const g10 = await gasOf(hamster.connect(players[1]).mint(10));
  add('mint(10) — một giao dịch', g10, 'người chơi', `≈ ${Math.round(Number(g10) / 10).toLocaleString()} gas mỗi con`);
  for (let i = 2; i < players.length; i++) await hamster.connect(players[i]).mint(1);

  // ---------------------------------------------------------------- deposit (player, once per NFT)
  const arenaAddr = await arena.getAddress();
  const SAFE = 'safeTransferFrom(address,address,uint256)';
  add('ký gửi 1 hamster (safeTransferFrom)', await gasOf(hamster.connect(players[0])[SAFE](players[0].address, arenaAddr, 1)),
      'người chơi', 'một lần, rồi chơi bao nhiêu trận cũng được');
  add('ký gửi hamster thứ 2 cùng ví', await gasOf(hamster.connect(players[0])[SAFE](players[0].address, arenaAddr, 2)), 'người chơi', '');
  await hamster.connect(players[1]).setApprovalForAll(arenaAddr, true);
  const ids1 = [...(await hamster.tokensOfOwner(players[1].address))];
  const gd10 = await gasOf(arena.connect(players[1]).deposit(ids1));
  add(`deposit(${ids1.length}) — sau setApprovalForAll`, gd10, 'người chơi', `≈ ${Math.round(Number(gd10) / ids1.length).toLocaleString()} gas mỗi con`);
  for (let i = 2; i < players.length; i++)
    for (const id of await hamster.tokensOfOwner(players[i].address)) await hamster.connect(players[i])[SAFE](players[i].address, arenaAddr, id);

  // ---------------------------------------------------------------- per match
  const proofs = await import('../../html/src/chain/proofs.js');
  const closeBlock = (await ethers.provider.getBlockNumber()) + 1000;
  add('createArena', await gasOf(arena.connect(owner).createArena(closeBlock, 200, 0)), 'operator', 'mỗi trận một lần');
  const g100 = await gasOf(arena.connect(owner).createArenas(closeBlock + 10, 150, 100, 200, 0, true));
  add('createArenas(100) — lịch nhiều game', g100, 'operator', `≈ ${Math.round(Number(g100) / 100).toLocaleString()} gas mỗi trận`);

  const joinGas = [];
  for (let i = 0; i < N; i++) {
    const p = players[i % players.length];
    const ids = await arena.depositsOf(p.address);
    const tid = ids[Math.floor(i / players.length) % ids.length];
    if (await arena.tokenInArena(0, tid)) continue;
    joinGas.push(Number(await gasOf(arena.connect(p).join(0, tid, { value: FEE }))));
  }
  const mean = (a) => Math.round(a.reduce((x, y) => x + y, 0) / a.length);
  add('join — người đầu tiên của arena', joinGas[0], 'người chơi', 'nộp phí vào (điểm rơi ngẫu nhiên, không chọn)');
  add('join — người thứ 2 trở đi', mean(joinGas.slice(1)), 'người chơi', `trung bình ${joinGas.length - 1} lượt (lượt đăng ký đầu tiên của mỗi hamster)`);
  // the same hamsters entering their next arenas: their registration list already exists
  const again = [];
  for (let k = 0; k < 6; k++) {
    const p = players[3 + k];
    const tid = (await arena.depositsOf(p.address))[0];
    for (const id of [20, 21, 22]) again.push(Number(await gasOf(arena.connect(p).join(id, tid, { value: FEE }))));
  }
  add('join — hamster đã đăng ký trận khác', mean(again), 'người chơi', 'trường hợp thường gặp: chơi tiếp trận sau');

  // one player, ten arenas, one transaction
  const ten = Array.from({ length: 10 }, (_, k) => 2 + k);
  const t2 = (await arena.depositsOf(players[2].address))[0];
  const gm = await gasOf(arena.connect(players[2]).joinMany(ten, ten.map(() => t2), { value: FEE * 10n }));
  add('joinMany(10 trận) — một giao dịch', gm, 'người chơi', `≈ ${Math.round(Number(gm) / 10).toLocaleString()} gas mỗi trận`);
  const gw = await gasOf(arena.connect(players[2]).withdraw([t2]));
  add('withdraw — hamster đang ở 11 trận mở', gw, 'người chơi', 'huỷ 11 lượt đăng ký + hoàn phí + trả NFT');

  // entries close at closeBlock; the seed is the hash of a later block — no lock, no drawSeed
  await network.provider.send('hardhat_mine', ['0x' + (1003).toString(16)]);
  const count = Number((await arena.getArena(0)).entrantCount);
  const points = Array.from({ length: count }, (_, i) => 10 + ((i * 7919) % 300));
  const stats = proofs.encodeStats(points.map((_, i) => ({ rank: i + 1, kills: i % 7 })));
  const subGas = await gasOf(arena.connect(owner).submitResult(0, points, stats, '0x0123456789abcdef', '0xfedcba9876543210'));
  add(`submitResult — ${count} người (seed + Merkle root + hạng/kill)`, subGas, 'operator', 'hạng + kill nằm trong calldata, không lưu storage');
  await network.provider.send('evm_increaseTime', [3600]);                     // claim delay
  await network.provider.send('evm_mine');

  const tree = proofs.pointsTree(points);
  const claims = [];
  for (let i = 0; i < count; i++) claims.push(Number(await gasOf(arena.claim(0, i, points[i], tree.proof(i)))));
  add('claim', mean(claims), 'người chơi', `trung bình ${claims.length} lượt, kèm proof ${tree.proof(0).length} hash`);

  // ---------------------------------------------------------------- report
  const money = (gas, gwei) => {
    const eth = (gas * gwei) / 1e9;
    const usd = eth * ETH_USD;
    return `${eth < 0.00001 ? eth.toExponential(1) : eth.toFixed(6)} ETH ($${usd < 0.01 ? usd.toFixed(4) : usd.toFixed(2)})`;
  };
  const w = Math.max(...rows.map((r) => r.what.length));
  console.log(`| ${'Hành động'.padEnd(w)} | Ai trả | Gas | ${GWEI.map((g) => g + ' gwei').join(' | ')} | Ghi chú |`);
  console.log(`|${'-'.repeat(w + 2)}|---|---:|${GWEI.map(() => '---:').join('|')}|---|`);
  for (const r of rows)
    console.log(`| ${r.what.padEnd(w)} | ${r.who} | ${r.gas.toLocaleString()} | ${GWEI.map((g) => money(r.gas, g)).join(' | ')} | ${r.note} |`);

  const perMatch = rows.find((r) => r.what.startsWith('join — người thứ 2')).gas
                 + rows.find((r) => r.what.startsWith('claim')).gas;
  const once = rows.find((r) => r.what.startsWith('mint(1) — hamster đầu')).gas;
  console.log(`\nNGƯỜI CHƠI — mỗi trận (join + claim): ${perMatch.toLocaleString()} gas`);
  for (const g of GWEI) console.log(`   ${String(g).padStart(6)} gwei → ${money(perMatch, g)}`);
  console.log(`   (phí vào trận cố định 0.0001 ETH = $${(0.0001 * ETH_USD).toFixed(2)}, không phải gas)`);
  console.log(`\nNGƯỜI CHƠI — một lần (mint 1 hamster): ${once.toLocaleString()} gas`);
  for (const g of GWEI) console.log(`   ${String(g).padStart(6)} gwei → ${money(once, g)}`);

  // ---------------------------------------------------------------- break-even
  // Gas is paid in ETH, the reward is paid in ETH: there is a gas price above which a
  // player spends more to take part than the pot can ever give back. That price, not the
  // raw gas figure, is what decides which chain this design can live on.
  const feeEth = Number(ethers.formatEther(FEE));
  const avgReward = (feeEth * count * 0.9) / count;          // rewardPool / entrants
  const claimGas = rows.find((r) => r.what.startsWith('claim')).gas;
  const beClaim = (avgReward * 1e18) / claimGas / 1e9;
  const beRound = (feeEth * 1e18) / perMatch / 1e9;
  console.log('\nĐIỂM HOÀ VỐN');
  console.log(`   Thưởng trung bình mỗi người: ${avgReward.toFixed(8)} ETH ($${(avgReward * ETH_USD).toFixed(3)}) — quỹ 90% chia cho ${count} người`);
  console.log(`   claim chỉ đáng gọi khi gas < ${beClaim.toFixed(3)} gwei  (dưới mức đó mới thu > chi)`);
  console.log(`   join+claim chỉ rẻ hơn chính phí vào trận khi gas < ${beRound.toFixed(3)} gwei`);
  console.log(`   → thiết kế này hợp với L2 / chain riêng (≈0.001–0.01 gwei), không hợp Ethereum L1 (1–20 gwei).`);
  console.log(`\n(quy đổi ở ETH = $${ETH_USD}; đặt ETH_USD=... để đổi)`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
