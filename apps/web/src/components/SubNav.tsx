import Link from "next/link";

/** Tabs between related pages (for example the inventory sections). */
export function SubNav({ items, active }: { items: { href: string; label: string; key: string }[]; active: string }) {
  return (
    <nav className="no-print mb-6 flex gap-1 overflow-x-auto rounded-xl bg-stone-100 p-1 dark:bg-stone-800">
      {items.map((i) => (
        <Link key={i.key} href={i.href} aria-current={i.key === active ? "page" : undefined}
          className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium ${i.key === active ? "bg-white shadow-sm dark:bg-stone-900" : "text-stone-600 dark:text-stone-300"}`}>
          {i.label}
        </Link>
      ))}
    </nav>
  );
}
