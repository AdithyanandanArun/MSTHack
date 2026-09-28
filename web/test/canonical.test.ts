import { describe, expect, it } from "vitest";
import { canonicalJson, computeCommitment, findingHash, type FindingContent } from "@/lib/canonical";

describe("commitment hashing", () => {
  it("matches ReleaseBond.computeCommitment (vector produced by the Solidity contract)", () => {
    // npx hardhat: computeCommitment(7, 0xab.., 0xcd.., 0x1111.., 0xef..)
    const expected = "0x1de19d39d1694d60c6991047195ea8711bd7071c5079ef631a5220b22cf64398";
    expect(
      computeCommitment({
        roomId: 7,
        artifactHash: `0x${"ab".repeat(32)}`,
        findingHash: `0x${"cd".repeat(32)}`,
        researcher: "0x1111111111111111111111111111111111111111",
        nonce: `0x${"ef".repeat(32)}`,
      }),
    ).toBe(expected);
  });

  it("changes when any input changes", () => {
    const base = {
      roomId: 1,
      artifactHash: `0x${"ab".repeat(32)}` as const,
      findingHash: `0x${"cd".repeat(32)}` as const,
      researcher: "0x1111111111111111111111111111111111111111" as const,
      nonce: `0x${"ef".repeat(32)}` as const,
    };
    const h = computeCommitment(base);
    expect(computeCommitment({ ...base, roomId: 2 })).not.toBe(h);
    expect(computeCommitment({ ...base, researcher: "0x2222222222222222222222222222222222222222" })).not.toBe(h);
    expect(computeCommitment({ ...base, nonce: `0x${"ee".repeat(32)}` })).not.toBe(h);
  });
});

describe("finding hash", () => {
  const content: FindingContent = {
    roomId: 3,
    title: "SSH key read during postinstall",
    claimedSeverity: "high",
    description: "line one\r\nline two",
    proofOfConcept: "npm i pkg",
    reproduction: "1. install",
    observations: ["NETWORK_EGRESS", "FS_SENSITIVE_READ"],
    attachments: ["BB", "aa"],
  };

  it("is insensitive to observation/attachment order, hex case and CRLF", () => {
    const a = findingHash(content);
    const b = findingHash({
      ...content,
      description: "line one\nline two",
      observations: ["FS_SENSITIVE_READ", "NETWORK_EGRESS"],
      attachments: ["aa", "bb"],
    });
    expect(a).toBe(b);
  });

  it("binds every field of the report", () => {
    const a = findingHash(content);
    expect(findingHash({ ...content, claimedSeverity: "critical" })).not.toBe(a);
    expect(findingHash({ ...content, proofOfConcept: "different" })).not.toBe(a);
    expect(findingHash({ ...content, attachments: [] })).not.toBe(a);
    expect(findingHash({ ...content, roomId: 4 })).not.toBe(a);
  });

  it("canonical JSON sorts keys recursively", () => {
    expect(canonicalJson({ b: 1, a: { d: [2, { z: 1, y: 2 }], c: 3 } })).toBe('{"a":{"c":3,"d":[2,{"y":2,"z":1}]},"b":1}');
  });
});
