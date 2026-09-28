"use client";

import { useState } from "react";
import { Markdown } from "./Markdown";

export function MarkdownEditor({
  value,
  onChange,
  placeholder,
  minRows = 6,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  minRows?: number;
}) {
  const [tab, setTab] = useState<"write" | "preview">("write");
  return (
    <div className="rounded-md border" style={{ borderColor: "var(--border)" }}>
      <div className="flex gap-1 border-b px-2 pt-2" style={{ borderColor: "var(--border)", background: "var(--bg-subtle)" }}>
        {(["write", "preview"] as const).map((t) => (
          <button
            key={t}
            type="button"
            className="-mb-px rounded-t-md border px-3 py-1 text-sm capitalize"
            style={
              tab === t
                ? { background: "var(--bg)", borderColor: "var(--border)", borderBottomColor: "var(--bg)" }
                : { borderColor: "transparent", color: "var(--fg-muted)" }
            }
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
        <span className="ml-auto self-center text-xs muted">Markdown supported</span>
      </div>
      <div className="p-2">
        {tab === "write" ? (
          <textarea
            className="input font-mono"
            style={{ minHeight: `${minRows * 1.6}em` }}
            value={value}
            placeholder={placeholder}
            onChange={(e) => onChange(e.target.value)}
          />
        ) : (
          <div className="min-h-24 p-2">
            <Markdown>{value}</Markdown>
          </div>
        )}
      </div>
    </div>
  );
}
