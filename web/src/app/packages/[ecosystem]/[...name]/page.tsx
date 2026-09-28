import Link from "next/link";
import { notFound } from "next/navigation";
import { ReviewList } from "@/components/ReviewHistory";
import { chainNow } from "@/lib/server/config";
import { packageHistory } from "@/lib/server/history";
import { syncChain } from "@/lib/server/sync";

export const dynamic = "force-dynamic";

export default async function PackagePage({ params }: { params: Promise<{ ecosystem: string; name: string[] }> }) {
  const { ecosystem, name: parts } = await params;
  if (ecosystem !== "npm" && ecosystem !== "pacman") notFound();
  const name = parts.map(decodeURIComponent).join("/");
  await syncChain().catch(() => null);
  const now = await chainNow();
  const h = packageHistory(ecosystem, name, now);
  return (
    <div className="space-y-4">
      <div>
        <div className="text-xs muted">
          <Link href="/">Security rooms</Link> / release security history
        </div>
        <h1 className="flex items-center gap-2 text-2xl">
          <span className="label mono" style={{ borderColor: "var(--border)" }}>{ecosystem}</span>
          <span className="font-semibold">{name}</span>
        </h1>
        <p className="mt-1 text-sm muted">
          Every exact release is reviewed on its own. A review of one version is not inherited by the next.
        </p>
      </div>
      <section className="card">
        <div className="card-header">
          <h2 className="font-semibold">Release security history</h2>
          <a className="text-xs" href={`/api/packages/${ecosystem}/${parts.join("/")}`}>JSON for CI/CD</a>
        </div>
        <ReviewList reviews={h.releases} now={now} />
      </section>
      <p className="flash flash-info text-sm">{h.disclaimer}</p>
    </div>
  );
}
