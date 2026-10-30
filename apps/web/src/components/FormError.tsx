import type { Dictionary } from "@tapserve/i18n";
import { errorMessage } from "@/lib/text";

export function FormError({ t, code }: { t: Dictionary; code?: string }) {
  const message = errorMessage(t, code);
  if (!message) return null;
  return (
    <p role="alert" className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
      {message}
    </p>
  );
}
