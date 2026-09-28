/**
 * Sign-in signature schemes shared by the browser and the server.
 *
 * The EIP-4361 (SIWE) message is always the thing being signed. Most wallets sign it with
 * `personal_sign` (EIP-191). Some wallets, including some Bridgekey builds, refuse `personal_sign`,
 * so the same message text can instead be signed as EIP-712 typed data (`eth_signTypedData_v4`).
 */
export type SignInScheme = "eip191" | "eip712";

export function signInTypedData(chainId: number, message: string) {
  return {
    domain: { name: "ReleaseBond", version: "1", chainId },
    types: { SignIn: [{ name: "message", type: "string" }] },
    primaryType: "SignIn" as const,
    message: { message },
  };
}

/** True when a wallet error means "this RPC method is not available", not "the user said no". */
export function isUnsupportedMethodError(e: unknown): boolean {
  for (let err = e as { code?: number; message?: string; details?: string; cause?: unknown } | undefined; err; ) {
    if (err.code === 4200 || err.code === -32601 || err.code === -32004) return true;
    if (/not (exist|allowed|supported|available)|unsupported method|method not found/i.test(`${err.message} ${err.details}`)) {
      return true;
    }
    err = err.cause as typeof err;
  }
  return false;
}
