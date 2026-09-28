// Downloads a real Arch Linux package through the pacman adapter and prints
// the normalized ReleaseArtifact summary.
import crypto from "node:crypto";
import { fetchPacmanRelease } from "../src/lib/evidence/adapters/pacman";
import { staticScan } from "../src/lib/evidence/rules";

(async () => {
  const name = process.argv[2] || "which";
  const { buffer, artifact, previous } = await fetchPacmanRelease(name);
  const independent = crypto.createHash("sha256").update(buffer).digest("hex");
  console.log(
    JSON.stringify({
      ecosystem: artifact.ecosystem,
      name: artifact.name,
      version: artifact.version,
      sha256: artifact.sha256,
      independentSha256: independent,
      registryIntegrity: artifact.registryIntegrity,
      files: artifact.files.length,
      hasPkginfo: artifact.files.some((f) => f.path === ".PKGINFO"),
      dependencies: Object.keys(artifact.dependencies),
      previous: previous?.version ?? null,
      facts: staticScan(artifact).length,
      sourceUrl: artifact.sourceUrl,
    }),
  );
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
