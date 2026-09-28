import { idParam, json, route, type IdParams } from "@/lib/server/api";
import { addComment, CreateComment } from "@/lib/server/findings";
import { currentViewer } from "@/lib/server/queries";

export const POST = route(async (req, ctx: IdParams) => {
  const viewer = await currentViewer();
  const input = CreateComment.parse(await req.json());
  return json(await addComment(await idParam(ctx), viewer, input), 201);
});
