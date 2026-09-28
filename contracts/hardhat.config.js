require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

const MST_TESTNET_RPC = process.env.MST_RPC_URL || "https://testnetrpc.mstblockchain.com";
const accounts = process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [];

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: { enabled: true, runs: 400 },
      // MST Testnet runs a Cancun-capable Geth fork (blob fields present in headers).
      evmVersion: "cancun",
      viaIR: false,
    },
  },
  networks: {
    hardhat: { chainId: 31337 },
    localhost: { url: "http://127.0.0.1:8545", chainId: 31337 },
    mstTestnet: {
      url: MST_TESTNET_RPC,
      chainId: 91562037,
      accounts,
      gasPrice: 1_000_000_000,
    },
  },
  gasReporter: { enabled: !!process.env.REPORT_GAS },
};
