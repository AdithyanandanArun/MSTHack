import { idParam, json, route, type IdParams } from "@/lib/server/api";
import { requireSession } from "@/lib/server/auth";
import { chainNow } from "@/lib/server/config";
import { createFinding, CreateFinding } from "@/lib/server/findings";
import { currentViewer, findingListItem, requireRoom, roomFindings } from "@/lib/server/queries";

export const dynamic = "force-dynamic";

export const GET = route(async (_req, ctx: IdParams) => {
  const room = requireRoom(await idParam(ctx));
  const viewer = await currentViewer();
  const now = await chainNow();
  return json(
    roomFindings(room.id)
      .filter((f) => f.status === "committed" || f.author === viewer.address)
      .map((f) => findingListItem(viewer, room, f, now)),
  );
});

export const POST = route(async (req, ctx: IdParams) => {
  const author = await requireSession();
  const roomId = await idParam(ctx);
  const input = CreateFinding.parse(await req.json());
  return json(await createFinding(roomId, author, input), 201);
});
