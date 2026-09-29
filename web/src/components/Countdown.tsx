"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { formatDuration } from "@/lib/phase";

/**
 * Live countdown to a chain timestamp, anchored to the server's chain time. When a deadline that was
 * still ahead at page load passes, the page re-renders so the room moves to its next phase without a
 * manual reload (after a short delay that covers the server's cached chain time).
 */
export function Countdown({ to, serverNow, done = "now" }: { to: number; serverNow: number; done?: string }) {
  const router = useRouter();
  const [offset] = useState(() => serverNow - Math.floor(Date.now() / 1000));
  const [armed] = useState(() => to > serverNow);
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000) + offset), 1000);
    return () => clearInterval(t);
  }, [offset]);
  const left = to - now;
  const passed = left <= 0;
  useEffect(() => {
    if (!armed || !passed) return;
    const t = setTimeout(() => router.refresh(), 4_000);
    return () => clearTimeout(t);
  }, [armed, passed, router]);
  return <span suppressHydrationWarning>{left > 0 ? formatDuration(left) : done}</span>;
}
