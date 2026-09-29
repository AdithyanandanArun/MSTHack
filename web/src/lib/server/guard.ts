import "server-only";
import { redirect } from "next/navigation";
import { appConfig } from "./config";
import { currentViewer, type UserRow } from "./queries";

/** Where to send a signed-out visitor so they come back to `next` after signing in. */
export function signInUrl(next: string): string {
  return `/signin?next=${encodeURIComponent(next)}`;
}

/** Server pages that need an account call this first; signed-out visitors go to /signin. */
export async function requireSignedIn(next: string): Promise<{ address: string; isModerator: boolean; user: UserRow }> {
  const viewer = await currentViewer();
  if (!viewer.address || !viewer.user) redirect(signInUrl(next));
  return { address: viewer.address, isModerator: viewer.isModerator, user: viewer.user };
}

/**
 * Admin is for ReleaseBond moderators (the owner is the first one). Before the contract exists there
 * is nobody to ask, so any signed-in account may open it to deploy.
 */
export function canAdminister(viewer: { address: string | null; isModerator: boolean }): boolean {
  return !!viewer.address && (viewer.isModerator || !appConfig().contractAddress);
}
