import { idParam, json, route, type IdParams } from "@/lib/server/api";
import { requireSession } from "@/lib/server/auth";
import { deleteDraft, findingDetail } from "@/lib/server/findings";
import { currentViewer } from "@/lib/server/queries";
import { syncChain } from "@/lib/server/sync";

export const dynamic = "force-dynamic";

export const GET = route(async (_req, ctx: IdParams) => {
  await syncChain().catch(() => null);
  return json(await findingDetail(await idParam(ctx), await currentViewer()));
});

export const DELETE = route(async (_req, ctx: IdParams) => {
  const author = await requireSession();
  deleteDraft(await idParam(ctx), author);
  return json({ ok: true });
});
