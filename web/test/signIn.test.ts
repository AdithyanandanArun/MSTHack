import { describe, expect, it } from "vitest";
import { hashMessage, hashTypedData, recoverAddress, UnknownRpcError, UserRejectedRequestError } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { isUnsupportedMethodError, signInTypedData } from "@/lib/signIn";
import { hostnameOf } from "@/lib/server/auth";

describe("isUnsupportedMethodError", () => {
  it("recognises wallets that refuse personal_sign", () => {
    // The exact text a Bridgekey build returns, wrapped the way viem wraps provider errors.
    const raw = Object.assign(new Error('The method "personal_sign" does not exist / is not available. (method personal_sign not allowed'), { code: -32603 });
    expect(isUnsupportedMethodError(new UnknownRpcError(raw))).toBe(true);
    expect(isUnsupportedMethodError({ code: 4200, message: "Unsupported method" })).toBe(true);
    expect(isUnsupportedMethodError({ code: -32601, message: "x" })).toBe(true);
    // BridgeKey 0.2.5 for eth_signTypedData_v4, as observed from the real extension.
    expect(isUnsupportedMethodError(Object.assign(new Error("Unsupported method: eth_signTypedData_v4"), { code: -32601 }))).toBe(true);
  });

  it("does not treat a user rejection as unsupported", () => {
    expect(isUnsupportedMethodError(new UserRejectedRequestError(new Error("User rejected the request.")))).toBe(false);
    expect(isUnsupportedMethodError(undefined)).toBe(false);
  });
});

describe("signInTypedData", () => {
  it("binds the signature to the chain and differs from the personal_sign digest", async () => {
    const account = privateKeyToAccount(`0x${"11".repeat(32)}`);
    const message = "example.com wants you to sign in";
    const typed = signInTypedData(91_562_037, message);
    const signature = await account.signTypedData(typed);
    expect(await recoverAddress({ hash: hashTypedData(typed), signature })).toBe(account.address);
    expect(hashTypedData(typed)).not.toBe(hashTypedData(signInTypedData(1, message)));
    expect(hashTypedData(typed)).not.toBe(hashMessage(message));
  });
});

describe("hostnameOf", () => {
  it("strips the port for SIWE domains of wallets that compare hostnames only", () => {
    expect(hostnameOf("localhost:3000")).toBe("localhost");
    expect(hostnameOf("127.0.0.1:37085")).toBe("127.0.0.1");
    expect(hostnameOf("releasebond.example")).toBe("releasebond.example");
    expect(hostnameOf("[::1]:3000")).toBe("[::1]");
  });
});
