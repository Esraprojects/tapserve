import { getMenu, getOrder, listTables, sellsAtCounter } from "@tapserve/db";
import { PosScreen } from "@/components/pos/PosScreen";
import { param, resolveLocale, type LocaleParams } from "@/lib/locale";
import { db } from "@/server/db";
import { appContext } from "@/server/context";

type Search = Promise<Record<string, string | string[] | undefined>>;

export default async function PosPage({ params, searchParams }: { params: LocaleParams; searchParams: Search }) {
  const { locale, t } = await resolveLocale(params);
  const search = await searchParams;
  const { actor, branchId, access } = await appContext(locale, "order.create");
  const orderId = param(search.order);
  const [menu, tables, order] = await Promise.all([
    getMenu(db(), actor, branchId),
    listTables(db(), actor, branchId),
    orderId ? getOrder(db(), actor, orderId) : Promise.resolve(null),
  ]);

  return (
    <PosScreen
      locale={locale}
      t={{ pos: t.pos, menu: t.menu, domain: t.domain, errors: t.errors, offline: t.offline }}
      menu={menu}
      tables={tables.map((x) => ({ id: x.id, name: x.name, status: x.status }))}
      initialTableId={param(search.table) ?? null}
      counterFirst={sellsAtCounter(access.businessType)}
      existingOrder={order && order.status === "open" ? { id: order.id, orderNo: order.order_no, tableName: order.table_name } : null}
    />
  );
}
