import { formatEther } from "viem";

export function mstc(wei: string | bigint | null | undefined, digits = 4): string {
  if (wei === null || wei === undefined) return "0 MSTC";
  const s = formatEther(BigInt(wei));
  const [i, f = ""] = s.split(".");
  const frac = f.slice(0, digits).replace(/0+$/, "");
  return `${Number(i).toLocaleString("en-US")}${frac ? `.${frac}` : ""} MSTC`;
}

export const short = (hex: string | null | undefined, n = 6) => (hex ? `${hex.slice(0, n + 2)}…${hex.slice(-4)}` : "");

export function timeAgo(ts: number, now = Math.floor(Date.now() / 1000)): string {
  const d = now - ts;
  if (d < 60) return "just now";
  if (d < 3600) return `${Math.floor(d / 60)} minutes ago`;
  if (d < 86400) return `${Math.floor(d / 3600)} hours ago`;
  if (d < 86400 * 30) return `${Math.floor(d / 86400)} days ago`;
  return new Date(ts * 1000).toISOString().slice(0, 10);
}

export const isoTime = (ts: number) => new Date(ts * 1000).toISOString().replace("T", " ").slice(0, 19) + " UTC";
