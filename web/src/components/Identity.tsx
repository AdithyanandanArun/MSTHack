import Link from "next/link";
import { short } from "@/lib/format";

export interface IdentityInfo {
  address: string;
  researcherNo?: number | null;
  handle?: string | null;
  verified?: boolean;
}

/** "Researcher #101 (alice)" linked to the profile; the wallet is the identity. */
export function Researcher({ who, role }: { who: IdentityInfo; role?: string | null }) {
  const name = who.handle ? who.handle : who.researcherNo ? `Researcher #${who.researcherNo}` : short(who.address);
  return (
    <span className="inline-flex items-center gap-1">
      <Link href={`/researchers/${who.address}`} className="font-semibold" style={{ color: "var(--fg)" }}>
        {name}
      </Link>
      {who.verified ? (
        <span title="Verified human researcher" style={{ color: "var(--success)" }}>
          ✔
        </span>
      ) : null}
      {role ? (
        <span className="label" style={{ color: "var(--fg-muted)", borderColor: "var(--border)" }}>
          {role}
        </span>
      ) : null}
    </span>
  );
}

export function ExplorerLink({ explorer, kind, value, children }: { explorer: string | null; kind: "tx" | "address" | "block"; value: string; children?: React.ReactNode }) {
  const label = children ?? <span className="mono">{short(value, 8)}</span>;
  if (!explorer) return <span title={value}>{label}</span>;
  return (
    <a href={`${explorer}/${kind}/${value}`} target="_blank" rel="noreferrer" title={value}>
      {label}
    </a>
  );
}
