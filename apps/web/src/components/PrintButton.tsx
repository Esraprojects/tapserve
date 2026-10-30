"use client";

import { useEffect } from "react";

/** Opens the print dialog once the page has loaded (for thermal printers via the browser). */
export function PrintButton({ label, auto = true }: { label: string; auto?: boolean }) {
  useEffect(() => {
    if (!auto) return;
    const id = setTimeout(() => window.print(), 300);
    return () => clearTimeout(id);
  }, [auto]);
  return (
    <button onClick={() => window.print()} className="no-print mb-4 rounded-lg bg-stone-900 px-4 py-2 text-sm text-white">
      {label}
    </button>
  );
}
