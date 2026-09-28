import { describe, expect, it } from "vitest";
import { heuristicAgent, groundRefs } from "@/lib/evidence/agent";
import { checkClaims, outcomeOf } from "@/lib/evidence/claims";
import { parseTelemetry } from "@/lib/evidence/sandbox";
import type { DynamicRun, Fact, ReleaseArtifact } from "@/lib/evidence/types";

const STRACE = [
  '42 openat(AT_FDCWD, "/home/sandbox/.ssh/demo_key", O_RDONLY|O_CLOEXEC) = 21',
  '42 openat(AT_FDCWD, "/home/sandbox/work/pkg/index.js", O_RDONLY|O_CLOEXEC) = 22',
  '42 connect(23, {sa_family=AF_INET, sin_port=htons(443), sin_addr=inet_addr("203.0.113.10")}, 16) = -1 ENETUNREACH (Network is unreachable)',
  '43 execve("/usr/bin/curl", ["curl", "http://x"], 0x7ffd /* 12 vars */) = 0',
  '44 execve("/bin/sh", ["sh", "-c", "node x.js"], 0x7ffd /* 12 vars */) = 0',
  '45 openat(AT_FDCWD, "/home/sandbox/.bashrc", O_WRONLY|O_CREAT|O_APPEND, 0666) = 5',
].join("\n");

describe("sandbox telemetry parser", () => {
  const facts = parseTelemetry(
    { "strace-postinstall.log": STRACE, "node-events.log": '{"kind":"env","value":"AWS_SECRET_ACCESS_KEY"}\n{"kind":"dns","value":"evil.example"}\n' },
    1,
  );
  const obs = (o: string) => facts.filter((f) => f.observation === o);

  it("records sensitive reads, connects, unexpected execs, env reads and persistence writes", () => {
    expect(obs("FS_SENSITIVE_READ")[0].file).toBe("/home/sandbox/.ssh/demo_key");
    expect(obs("NETWORK_EGRESS").map((f) => f.detail).join(" ")).toContain("203.0.113.10:443");
    expect(obs("NETWORK_EGRESS").map((f) => f.detail).join(" ")).toContain("evil.example");
    expect(obs("PROCESS_SPAWN").map((f) => f.detail).join(" ")).toContain("/usr/bin/curl");
    expect(obs("ENV_SECRET_READ")[0].detail).toContain("AWS_SECRET_ACCESS_KEY");
    expect(obs("PERSISTENCE")[0].file).toBe("/home/sandbox/.bashrc");
  });

  it("ignores the package's own files and expected interpreters", () => {
    expect(facts.some((f) => f.file === "/home/sandbox/work/pkg/index.js")).toBe(false);
    expect(facts.some((f) => f.detail.includes("/bin/sh"))).toBe(false);
  });

  it("produces nothing for an empty trace", () => {
    expect(parseTelemetry({ "strace-require.log": "", "node-events.log": "" }, 1)).toEqual([]);
  });
});

const fact = (id: string, observation: Fact["observation"], source: Fact["source"] = "static"): Fact => ({
  id,
  rule: "t",
  category: "network",
  severity: "high",
  observation,
  source,
  detail: id,
});
const run = (n: number, observations: Fact["observation"][], ok = true): DynamicRun => ({
  run: n,
  ok,
  exitCode: 0,
  durationMs: 1,
  command: "x",
  facts: observations.map((o, i) => fact(`D${n}.${i}`, o, "dynamic")),
});

describe("claim checks", () => {
  it("confirms only when every fresh run reproduces", () => {
    const checks = checkClaims(["FS_SENSITIVE_READ"], [], [run(1, ["FS_SENSITIVE_READ"]), run(2, ["FS_SENSITIVE_READ"]), run(3, ["FS_SENSITIVE_READ"])]);
    expect(checks[0]).toMatchObject({ result: "confirmed", basis: "dynamic", dynamicRunsObserved: 3 });
    expect(outcomeOf(checks)).toBe("REPRODUCED");
  });

  it("surfaces flaky reproduction as inconclusive", () => {
    const checks = checkClaims(["NETWORK_EGRESS"], [], [run(1, ["NETWORK_EGRESS"]), run(2, []), run(3, ["NETWORK_EGRESS"])]);
    expect(checks[0].result).toBe("inconclusive");
    expect(outcomeOf(checks)).toBe("INCONCLUSIVE");
  });

  it("falls back to static evidence only when no sandbox ran", () => {
    expect(checkClaims(["NETWORK_EGRESS"], [fact("S1", "NETWORK_EGRESS")], [])[0]).toMatchObject({ result: "confirmed", basis: "static" });
    expect(checkClaims(["NETWORK_EGRESS"], [fact("S1", "NETWORK_EGRESS")], [run(1, [])])[0].result).toBe("inconclusive");
  });

  it("reports partial and failed reproduction", () => {
    const partial = checkClaims(["NETWORK_EGRESS", "PERSISTENCE"], [], [run(1, ["NETWORK_EGRESS"])]);
    expect(outcomeOf(partial)).toBe("PARTIALLY_REPRODUCED");
    expect(outcomeOf(checkClaims(["PERSISTENCE"], [], [run(1, [])]))).toBe("NOT_REPRODUCED");
    expect(outcomeOf([])).toBe("INCONCLUSIVE");
  });
});

describe("heuristic agent", () => {
  const artifact = {
    ecosystem: "npm",
    name: "x",
    version: "1.0.0",
    files: [{ path: "a.js", size: 10, sha256: "", mode: 0o644, binary: false, text: "const key = fs.readFileSync('/home/u/.ssh/id_rsa')\nconsole.log(1)\n" }],
    installScripts: {},
  } as unknown as ReleaseArtifact;

  it("challenges an exfiltration claim that only has a sensitive read", () => {
    const facts = [{ ...fact("S2", "FS_SENSITIVE_READ"), file: "a.js", line: 1 }];
    const claims = checkClaims(["FS_SENSITIVE_READ"], facts, []);
    const r = heuristicAgent({
      artifact,
      previous: null,
      facts,
      claims,
      finding: { title: "steals SSH keys", claimedSeverity: "critical", description: "sends the key to a server", proofOfConcept: "", reproduction: "", observations: ["FS_SENSITIVE_READ"] },
    });
    expect(r.mode).toBe("heuristic");
    expect(r.challenges.join(" ")).toMatch(/does not prove the data leaves the machine/);
    expect(r.missingEvidence.join(" ")).toMatch(/reproduction steps/);
  });

  it("only accepts evidence references that resolve", () => {
    const facts = [fact("S1", "NETWORK_EGRESS")];
    expect(groundRefs(["S1", "a.js:1"], facts, artifact)).toBe(true);
    expect(groundRefs(["S9"], facts, artifact)).toBe(false);
    expect(groundRefs(["a.js:99"], facts, artifact)).toBe(false);
    expect(groundRefs([], facts, artifact)).toBe(false);
  });
});
