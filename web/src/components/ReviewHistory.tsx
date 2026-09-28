import Link from "next/link";
import type { ReleaseReview } from "@/lib/server/history";
import { mstc, short, timeAgo } from "@/lib/format";
import { Label, PhaseBadge, SeverityLabel } from "./Labels";

/** One line per reviewed release: phase, pool, accepted findings and the evidence statement. */
export function ReviewList({ reviews, now, withPackage }: { reviews: ReleaseReview[]; now: number; withPackage?: boolean }) {
  if (!reviews.length) return <p className="px-4 py-6 text-center muted">No funded reviews yet.</p>;
  return (
    <ul>
      {reviews.map((r) => (
        <li key={r.roomId} className="border-t px-4 py-3 first:border-t-0" style={{ borderColor: "var(--border-muted)" }}>
          <div className="flex flex-wrap items-center gap-2">
            {withPackage && (
              <Link href={`/packages/${r.ecosystem}/${r.packageName}`} className="label mono" style={{ borderColor: "var(--border)" }}>
                {r.ecosystem}
              </Link>
            )}
            <Link href={`/rooms/${r.roomId}`} className="text-base font-semibold">
              {withPackage ? `${r.packageName}@` : ""}
              {r.version}
            </Link>
            <PhaseBadge phase={r.phase} />
            <span className="text-sm">{mstc(r.bountyWei, 2)} pool</span>
            {r.acceptedFindings.total > 0 ? (
              (Object.entries(r.acceptedFindings.bySeverity) as [string, number][])
                .filter(([, n]) => n > 0)
                .map(([sev, n]) => <SeverityLabel key={sev} severity={sev} prefix={`${n}×`} />)
            ) : r.phase === "settled" ? (
              <Label tone="muted">no valid findings accepted</Label>
            ) : null}
            {!r.acceptedFindings.final && r.acceptedFindings.total > 0 && <Label tone="attention">provisional</Label>}
          </div>
          <p className="mt-1 text-sm">{r.summary}</p>
          <div className="text-xs muted">
            Room #{r.roomId} · artifact <span className="mono">{short(r.artifactHash, 8)}</span> · {r.commitments} commitment
            {r.commitments === 1 ? "" : "s"} · opened {timeAgo(r.openedAt, now)}
          </div>
        </li>
      ))}
    </ul>
  );
}
