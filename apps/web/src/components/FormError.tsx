import type { Dictionary } from "@tapserve/i18n";

export function FormError({ t, code }: { t: Dictionary; code?: string }) {
  if (!code) return null;
  const message = (t.errors as Record<string, string>)[code] ?? t.errors.unknown;
  return (
    <p role="alert" className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
      {message}
    </p>
  );
}
