const fs = require("fs");
const path = require("path");

const DEFAULT_EXPLORER = "https://testnet.mstscan.com";
const COMPILER_VERSION = "v0.8.28+commit.7893614a";
const CONTRACT_NAME = "contracts/ReleaseBond.sol:ReleaseBond";
const LICENSE_TYPE = "mit";
const CONTRACT_SOURCE = "contracts/ReleaseBond.sol";
const ARTIFACT_PATH = path.join(
  __dirname,
  "..",
  "artifacts",
  "contracts",
  "ReleaseBond.sol",
  "ReleaseBond.json",
);
const BUILD_INFO_DIR = path.join(__dirname, "..", "artifacts", "build-info");

function normalizeAddress(value, label) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error(`${label} must be a 20-byte 0x-prefixed address`);
  }
  return value.toLowerCase();
}

function findMatchingBuildInput() {
  const artifact = JSON.parse(fs.readFileSync(ARTIFACT_PATH, "utf8"));
  const files = fs
    .readdirSync(BUILD_INFO_DIR)
    .filter((file) => file.endsWith(".json"))
    .sort();

  for (const file of files) {
    const buildInfo = JSON.parse(
      fs.readFileSync(path.join(BUILD_INFO_DIR, file), "utf8"),
    );
    const compiled =
      buildInfo.output?.contracts?.[CONTRACT_SOURCE]?.ReleaseBond?.evm?.bytecode?.object;
    if (compiled && `0x${compiled}` === artifact.bytecode) {
      const input = buildInfo.input;
      if (!input?.sources?.[CONTRACT_SOURCE]) {
        throw new Error(`Matching build-info ${file} is missing ${CONTRACT_SOURCE}`);
      }
      return JSON.parse(JSON.stringify(input));
    }
  }

  throw new Error(
    "No build-info input reproduces the ReleaseBond artifact creation bytecode",
  );
}

function buildVerificationPayload({ owner }) {
  const normalizedOwner = normalizeAddress(owner, "owner");
  const standardJsonInput = findMatchingBuildInput();
  const constructorArgs = normalizedOwner.slice(2).padStart(64, "0");

  return {
    standardJsonInput,
    compilerVersion: COMPILER_VERSION,
    contractName: CONTRACT_NAME,
    constructorArgs,
    licenseType: LICENSE_TYPE,
  };
}

function usage() {
  return [
    "Usage: node scripts/verify-blockscout.js --address <0x...> [options]",
    "",
    "Options:",
    "  --owner <0x...>       Constructor owner (looked up from Blockscout if omitted)",
    `  --explorer <url>      Blockscout base URL (default: ${DEFAULT_EXPLORER})`,
    "  --dry-run             Write the payload without making network requests",
    "  --out <file>          Dry-run output file (default: stdout)",
  ].join("\n");
}

function parseArgs(argv) {
  const options = {
    explorer: DEFAULT_EXPLORER,
    dryRun: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (["--address", "--owner", "--explorer", "--out"].includes(arg)) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`${arg} requires a value`);
      }
      options[arg.slice(2)] = value;
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function normalizeExplorer(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Invalid explorer URL: ${value}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Explorer URL must use http or https");
  }
  return url.toString().replace(/\/$/, "");
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body = {};
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  if (!response.ok) {
    const detail = typeof body === "string" ? body : JSON.stringify(body);
    throw new Error(`${response.status} ${response.statusText}: ${detail}`);
  }
  return body;
}

async function findDeployer(explorer, address) {
  const info = await fetchJson(`${explorer}/api/v2/addresses/${address}`);
  if (!info.creator_address_hash) {
    throw new Error(
      "Blockscout did not return creator_address_hash; pass --owner explicitly",
    );
  }
  return normalizeAddress(info.creator_address_hash, "Blockscout creator_address_hash");
}

function verificationUrl(explorer, address) {
  return `${explorer}/api/v2/smart-contracts/${address}`;
}

async function submitVerification(explorer, address, payload) {
  const form = new FormData();
  form.append("compiler_version", payload.compilerVersion);
  form.append("contract_name", payload.contractName);
  form.append("autodetect_constructor_args", "false");
  form.append("constructor_args", payload.constructorArgs);
  form.append("license_type", payload.licenseType);
  form.append(
    "files[0]",
    new Blob([JSON.stringify(payload.standardJsonInput)], {
      type: "application/json",
    }),
    "input.json",
  );

  const endpoint = `${verificationUrl(explorer, address)}/verification/via/standard-input`;
  const response = await fetchJson(endpoint, { method: "POST", body: form });
  const detail = typeof response === "string" ? response : JSON.stringify(response);
  console.log(`Verification submitted for ${address}: ${detail}`);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function pollUntilVerified(explorer, address) {
  const endpoint = verificationUrl(explorer, address);
  const deadline = Date.now() + 120_000;
  let lastStatus = "no status returned";

  while (true) {
    try {
      const contract = await fetchJson(endpoint);
      if (contract.is_verified === true) {
        console.log(`VERIFIED: ${address} on ${explorer}`);
        return;
      }
      lastStatus = JSON.stringify(contract);
    } catch (error) {
      lastStatus = error.message;
    }

    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new Error(
        `Verification was not confirmed within 2 minutes. Last status: ${lastStatus}`,
      );
    }
    await delay(Math.min(5_000, remaining));
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  if (!options.address) {
    throw new Error(`--address is required\n\n${usage()}`);
  }

  const address = normalizeAddress(options.address, "address");
  const explorer = normalizeExplorer(options.explorer);
  if (options.dryRun && !options.owner) {
    throw new Error("--owner is required with --dry-run (network access is disabled)");
  }
  if (options.out && !options.dryRun) {
    throw new Error("--out can only be used with --dry-run");
  }

  const owner = options.owner
    ? normalizeAddress(options.owner, "owner")
    : await findDeployer(explorer, address);
  const payload = buildVerificationPayload({ owner });

  if (options.dryRun) {
    const serialized = `${JSON.stringify(payload, null, 2)}\n`;
    if (options.out) {
      const outputPath = path.resolve(options.out);
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, serialized);
      console.error(`Wrote verification payload to ${outputPath}`);
    } else {
      process.stdout.write(serialized);
    }
    return;
  }

  await submitVerification(explorer, address, payload);
  await pollUntilVerified(explorer, address);
}

module.exports = { buildVerificationPayload };

if (require.main === module) {
  main().catch((error) => {
    console.error(`Verification failed: ${error.message}`);
    process.exitCode = 1;
  });
}
