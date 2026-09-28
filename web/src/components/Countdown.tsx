"use client";

import { useEffect, useState } from "react";
import { formatDuration } from "@/lib/phase";

/** Live countdown to a chain timestamp, anchored to the server's chain time. */
export function Countdown({ to, serverNow, done = "now" }: { to: number; serverNow: number; done?: string }) {
  const [offset] = useState(() => serverNow - Math.floor(Date.now() / 1000));
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000) + offset), 1000);
    return () => clearInterval(t);
  }, [offset]);
  const left = to - now;
  return <span suppressHydrationWarning>{left > 0 ? formatDuration(left) : done}</span>;
}
