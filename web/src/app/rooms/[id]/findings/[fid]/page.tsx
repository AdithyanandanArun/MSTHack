import Link from "next/link";
import { FindingThread, type FindingDetail } from "@/components/FindingThread";
import { appConfig, chainNow } from "@/lib/server/config";
import { findingDetail } from "@/lib/server/findings";
import { currentViewer, HttpError } from "@/lib/server/queries";
import { syncChain } from "@/lib/server/sync";

export const dynamic = "force-dynamic";

export default async function FindingPage({ params }: { params: Promise<{ id: string; fid: string }> }) {
  const { id, fid } = await params;
  await syncChain().catch(() => null);
  const viewer = await currentViewer();
  let detail: FindingDetail;
  try {
    detail = (await findingDetail(Number(fid), viewer)) as unknown as FindingDetail;
  } catch (e) {
    if (e instanceof HttpError) {
      return (
        <div className="card mx-auto max-w-xl p-8 text-center">
          <h1 className="text-lg font-semibold">{e.status === 404 ? "Finding not found" : "This finding is private"}</h1>
          <p className="mt-2 muted">{e.message}</p>
          <p className="mt-4 text-sm">
            During the hunt only the researcher can read a report. The developer and moderator see it during private disclosure;
            signed-in researchers see it during peer review; everyone sees it after settlement.
          </p>
          <Link href={`/rooms/${id}`} className="btn mt-4">Back to the room</Link>
        </div>
      );
    }
    throw e;
  }
  if (detail.room.id !== Number(id)) {
    return <div className="flash flash-error">This finding belongs to room #{detail.room.id}.</div>;
  }
  return <FindingThread d={detail} now={await chainNow()} explorer={appConfig().explorerUrl} />;
}
