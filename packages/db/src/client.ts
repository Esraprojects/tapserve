import postgres from "postgres";

export type Sql = postgres.Sql;
export type Tx = postgres.TransactionSql;

export function createSql(url: string, options: postgres.Options<{}> = {}): Sql {
  return postgres(url, { max: 10, idle_timeout: 20, ...options });
}

export interface TenantContext {
  tenantId: string;
  userId: string;
}

/**
 * Run queries for one business. Row-level security reads app.tenant_id, so every
 * statement in fn can only see and change that tenant's rows.
 */
export function withTenant<T>(sql: Sql, ctx: TenantContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return sql.begin(async (tx) => {
    await tx`select set_config('app.tenant_id', ${ctx.tenantId}, true), set_config('app.user_id', ${ctx.userId}, true)`;
    return fn(tx);
  }) as Promise<T>;
}

/** Run queries as a signed-in user before a business is chosen (no tenant rows visible). */
export function withUser<T>(sql: Sql, userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return sql.begin(async (tx) => {
    await tx`select set_config('app.user_id', ${userId}, true)`;
    return fn(tx);
  }) as Promise<T>;
}
