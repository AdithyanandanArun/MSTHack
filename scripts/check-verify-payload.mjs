import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { buildVerificationPayload } = require(
  "../contracts/scripts/verify-blockscout.js",
);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactPath = path.join(
  root,
  "contracts",
  "artifacts",
  "contracts",
  "ReleaseBond.sol",
  "ReleaseBond.json",
);
const nativeCompiler = path.join(
  homedir(),
  ".cache",
  "hardhat-nodejs",
  "compilers-v2",
  "linux-amd64",
  "solc-linux-amd64-v0.8.28+commit.7893614a",
);
const expectedCompilerVersion = "0.8.28+commit.7893614a";

function parseCompilerOutput(raw) {
  const output = JSON.parse(raw);
  const errors = (output.errors || []).filter((entry) => entry.severity === "error");
  assert.equal(
    errors.length,
    0,
    `Solidity compilation failed:\n${errors
      .map((entry) => entry.formattedMessage || entry.message)
      .join("\n")}`,
  );
  return output;
}

function nativeVersion(binary) {
  const result = spawnSync(binary, ["--version"], { encoding: "utf8" });
  if (result.status !== 0) return null;
  const match = result.stdout.match(/Version:\s*([^\s]+)/);
  return match?.[1] || null;
}

function makeCompiler() {
  if (existsSync(nativeCompiler)) {
    const version = nativeVersion(nativeCompiler);
    if (version?.startsWith(expectedCompilerVersion)) {
      return {
        description: `native solc ${version} (${nativeCompiler})`,
        compile(input) {
          const result = spawnSync(nativeCompiler, ["--standard-json"], {
            input: JSON.stringify(input),
            encoding: "utf8",
            maxBuffer: 128 * 1024 * 1024,
          });
          assert.equal(
            result.status,
            0,
            `Native solc exited ${result.status}: ${result.stderr}`,
          );
          return parseCompilerOutput(result.stdout);
        },
      };
    }
  }

  const solc = require("../contracts/node_modules/solc");
  const version = solc.version();
  assert.ok(
    version.startsWith(expectedCompilerVersion),
    `Expected solc ${expectedCompilerVersion}, found ${version}`,
  );
  return {
    description: `solc-js ${version}`,
    compile(input) {
      return parseCompilerOutput(solc.compile(JSON.stringify(input)));
    },
  };
}

function compiledReleaseBond(output) {
  const contract = output.contracts?.["contracts/ReleaseBond.sol"]?.ReleaseBond;
  assert.ok(contract, "Compiler output does not contain ReleaseBond");
  return {
    creation: `0x${contract.evm.bytecode.object}`,
    runtime: `0x${contract.evm.deployedBytecode.object}`,
  };
}

const owner = "0x1111111111111111111111111111111111111111";
const payload = buildVerificationPayload({ owner });
const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
const compiler = makeCompiler();

assert.equal(payload.compilerVersion, "v0.8.28+commit.7893614a");
assert.equal(payload.contractName, "contracts/ReleaseBond.sol:ReleaseBond");
assert.equal(payload.licenseType, "mit");
assert.equal(
  payload.constructorArgs,
  "0000000000000000000000001111111111111111111111111111111111111111",
  "Constructor arguments are not the 32-byte left-padded owner address",
);

const compiled = compiledReleaseBond(compiler.compile(payload.standardJsonInput));
assert.equal(compiled.creation, artifact.bytecode, "Creation bytecode mismatch");
assert.equal(compiled.runtime, artifact.deployedBytecode, "Runtime bytecode mismatch");

const negativeInput = JSON.parse(JSON.stringify(payload.standardJsonInput));
assert.equal(negativeInput.settings.optimizer.runs, 400);
negativeInput.settings.optimizer.runs = 401;
const negative = compiledReleaseBond(compiler.compile(negativeInput));
assert.notEqual(
  negative.creation,
  artifact.bytecode,
  "Negative control unexpectedly reproduced creation bytecode",
);
assert.notEqual(
  negative.runtime,
  artifact.deployedBytecode,
  "Negative control unexpectedly reproduced runtime bytecode",
);

console.log(`Compiler: ${compiler.description}`);
console.log(`Creation bytecode: ${(compiled.creation.length - 2) / 2} bytes`);
console.log(`Runtime bytecode: ${(compiled.runtime.length - 2) / 2} bytes`);
console.log("VERIFY PAYLOAD REPRODUCES BYTECODE");
