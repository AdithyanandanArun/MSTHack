"use client";

import { useState } from "react";
import { api, errorMessage } from "@/lib/client/api";

export interface UploadedFile {
  id: number;
  filename: string;
  size: number;
  sha256: string;
}

/** Uploads proof files immediately; their sha256 digests become part of the signed report. */
export function AttachmentPicker({ files, onChange, disabled }: { files: UploadedFile[]; onChange: (f: UploadedFile[]) => void; disabled?: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const upload = async (list: FileList | null) => {
    if (!list) return;
    setError(null);
    setUploading(true);
    try {
      const added: UploadedFile[] = [];
      for (const f of Array.from(list)) {
        const form = new FormData();
        form.set("file", f);
        added.push(await api<UploadedFile>("/api/uploads", { method: "POST", body: form }));
      }
      onChange([...files, ...added]);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setUploading(false);
    }
  };
  return (
    <div className="space-y-1">
      <input type="file" multiple disabled={disabled || uploading} onChange={(e) => upload(e.target.files)} className="text-sm" />
      {uploading && <div className="text-xs muted">Uploading…</div>}
      {files.length > 0 && (
        <ul className="text-sm">
          {files.map((f) => (
            <li key={f.id} className="flex items-center gap-2">
              📎 {f.filename} <span className="text-xs muted">{(f.size / 1024).toFixed(1)} KB · sha256 {f.sha256.slice(0, 12)}…</span>
              <button type="button" className="btn btn-sm" onClick={() => onChange(files.filter((x) => x.id !== f.id))}>remove</button>
            </li>
          ))}
        </ul>
      )}
      {error && <div className="flash flash-error">{error}</div>}
    </div>
  );
}
