import { idParam, json, route, type IdParams } from "@/lib/server/api";
import { addComment, CreateComment } from "@/lib/server/findings";
import { currentViewer } from "@/lib/server/queries";
import { enforceLimit } from "@/lib/server/rateLimit";

export const POST = route(async (req, ctx: IdParams) => {
  const viewer = await currentViewer();
  enforceLimit("comment", req, viewer.address);
  const input = CreateComment.parse(await req.json());
  return json(await addComment(await idParam(ctx), viewer, input), 201);
});
