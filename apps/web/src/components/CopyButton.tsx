"use client";

import { useState } from "react";

export function CopyButton({ text, label, done }: { text: string; label: string; done: string }) {
  const [copied, setCopied] = useState<boolean | "failed">(false);
  if (copied === "failed") {
    return <input readOnly value={text} aria-label={label} className="input py-2 text-xs" onFocus={(e) => e.currentTarget.select()} />;
  }
  return (
    <button type="button" className="btn-secondary px-3 py-2 text-sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          setCopied("failed");
        }
      }}>
      {copied ? `✓ ${done}` : label}
    </button>
  );
}
