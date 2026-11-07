// Hardhat config for the Squeek Royale contracts (Squeek Hamster NFT + Arena).
// Secrets come from contracts/.env (never committed): see .env.example.
require('dotenv').config();
require('@nomicfoundation/hardhat-ethers');
require('@nomicfoundation/hardhat-chai-matchers');

const { SEPOLIA_RPC_URL, DEPLOYER_PRIVATE_KEY } = process.env;

module.exports = {
  solidity: {
    version: '0.8.28',
    settings: { optimizer: { enabled: true, runs: 200 }, viaIR: true, evmVersion: 'cancun' },
  },
  networks: {
    hardhat: { chainId: 31337 },
    localhost: { url: 'http://127.0.0.1:8545', chainId: 31337 },
    sepolia: {
      url: SEPOLIA_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com',
      chainId: 11155111,
      accounts: DEPLOYER_PRIVATE_KEY ? [DEPLOYER_PRIVATE_KEY] : [],
    },
  },
  mocha: { timeout: 120000 },
};
