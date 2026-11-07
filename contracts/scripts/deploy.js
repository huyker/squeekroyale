// Deploy SqueekHamster + SqueekArena.   npx hardhat run scripts/deploy.js --network <localhost|sepolia>
// Entry fee 0.0001 ETH, free mint, 24 h result timeout. Writes addresses for the web app.
const { ethers, network } = require('hardhat');
const { exportAbi, saveDeployment } = require('./export');

async function main() {
  const [deployer] = await ethers.getSigners();
  if (!deployer) throw new Error(`no deployer account for ${network.name}: set DEPLOYER_PRIVATE_KEY in contracts/.env`);
  const { chainId } = await ethers.provider.getNetwork();
  const bal = await ethers.provider.getBalance(deployer.address);
  console.log(`network ${network.name} (${chainId}) · deployer ${deployer.address} · ${ethers.formatEther(bal)} ETH`);

  const entryFee = ethers.parseEther(process.env.ENTRY_FEE_ETH || '0.0001');
  const mintPrice = ethers.parseEther(process.env.MINT_PRICE_ETH || '0');
  const resultTimeout = Number(process.env.RESULT_TIMEOUT_S || 86400);
  // a result is final (claimable) this long after it is posted; the owner may void it until then
  const claimDelay = Number(process.env.CLAIM_DELAY_S || (Number(chainId) === 31337 ? 20 : 3600));

  // Fees from the chain itself. Hardhat falls back to a 1 gwei tip when it cannot ask, which
  // on a testnet running at a few wei per gas makes a deploy look 50 000x dearer than it is
  // (and fail with "insufficient funds" on a wallet that holds plenty).
  const fees = {};
  if (Number(chainId) !== 31337) {
    const base = (await ethers.provider.getBlock('latest')).baseFeePerGas || 0n;
    let tip = 0n;
    try { tip = BigInt(await ethers.provider.send('eth_maxPriorityFeePerGas', [])); } catch { tip = base; }
    if (tip === 0n) tip = 1n;
    Object.assign(fees, { maxPriorityFeePerGas: tip, maxFeePerGas: base * 3n + tip });
    console.log(`fees: base ${base} wei, tip ${tip} wei`);
  }

  const hamster = await (await ethers.getContractFactory('SqueekHamster')).deploy(deployer.address, mintPrice, fees);
  await hamster.waitForDeployment();
  const hamsterTx = hamster.deploymentTransaction();
  console.log(`SqueekHamster ${await hamster.getAddress()}`);
  const arena = await (await ethers.getContractFactory('SqueekArena')).deploy(deployer.address, await hamster.getAddress(), entryFee, resultTimeout, claimDelay, fees);
  await arena.waitForDeployment();
  console.log(`SqueekArena   ${await arena.getAddress()}`);
  const block = (await ethers.provider.getTransactionReceipt(hamsterTx.hash)).blockNumber;

  exportAbi();
  saveDeployment({
    chainId: Number(chainId), network: network.name, deployedAt: new Date().toISOString(), fromBlock: block,
    owner: deployer.address, hamster: await hamster.getAddress(), arena: await arena.getAddress(),
    entryFeeWei: entryFee.toString(), mintPriceWei: mintPrice.toString(), resultTimeout, claimDelay,
  });
  console.log('addresses written to contracts/deployments and src/chain/deployments.js');
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
