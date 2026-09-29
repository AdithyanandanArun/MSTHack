import type { Metadata } from "next";
import { SignInPanel } from "@/components/SignInPanel";

export const metadata: Metadata = { title: "Sign in · ReleaseBond" };
export const dynamic = "force-dynamic";

/** Only same-site paths, so ?next= cannot send people to another site after signing in. */
function safeNext(next: string | undefined): string {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/signin") ? next : "/dashboard";
}

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ next?: string; switch?: string }> }) {
  const { next, switch: sw } = await searchParams;
  return <SignInPanel next={safeNext(next)} switchAccount={sw === "1"} />;
}
