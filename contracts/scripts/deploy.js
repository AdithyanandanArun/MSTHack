// Deploys ReleaseBond and records the deployment for the web app.
//   npx hardhat run scripts/deploy.js --network mstTestnet
//   npx hardhat run scripts/deploy.js --network localhost
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  if (!deployer) throw new Error("No deployer account. Set PRIVATE_KEY in contracts/.env");
  const owner = process.env.RELEASEBOND_OWNER || deployer.address;
  const net = await hre.ethers.provider.getNetwork();
  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log(`network=${hre.network.name} chainId=${net.chainId} deployer=${deployer.address}`);
  console.log(`balance=${hre.ethers.formatEther(balance)} owner=${owner}`);

  const Factory = await hre.ethers.getContractFactory("ReleaseBond");
  const contract = await Factory.deploy(owner);
  const receipt = await contract.deploymentTransaction().wait();
  const address = await contract.getAddress();
  console.log(`ReleaseBond deployed at ${address} (block ${receipt.blockNumber}, tx ${receipt.hash})`);

  const extraModerators = (process.env.RELEASEBOND_MODERATORS || "").split(",").map((s) => s.trim()).filter(Boolean);
  for (const m of extraModerators) {
    if (owner.toLowerCase() !== deployer.address.toLowerCase()) break;
    await (await contract.setModerator(m, true)).wait();
    console.log(`moderator registered: ${m}`);
  }

  const out = path.join(__dirname, "..", "deployments", `${hre.network.name}.json`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(
    out,
    JSON.stringify(
      {
        network: hre.network.name,
        chainId: Number(net.chainId),
        address,
        owner,
        deployBlock: receipt.blockNumber,
        txHash: receipt.hash,
        deployedAt: new Date().toISOString(),
      },
      null,
      2,
    ) + "\n",
  );
  console.log(`wrote ${path.relative(process.cwd(), out)}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
