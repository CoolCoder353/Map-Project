import type { IDatabase } from '../types.ts';
export interface BunSqlLike {
    unsafe(text: string, values?: unknown[]): Promise<unknown>;
    reserve(): Promise<BunReservedSqlLike>;
    listen?(channel: string, onNotification: (payload: string) => void, onSubscribe?: () => void): Promise<BunSubscriptionLike>;
}
export interface BunSubscriptionLike {
    unlisten(): Promise<void> | void;
}
export interface BunReservedSqlLike {
    unsafe(text: string, values?: unknown[]): Promise<unknown>;
    release(): void;
}
/**
 * Adapts a `Bun.SQL` client to pg-boss's IDatabase, for running pg-boss on Bun's built-in
 * PostgreSQL driver instead of the bundled `pg` pool.
 *
 * @example
 * ```ts
 * import { SQL } from 'bun'
 * import { PgBoss, fromBunSql } from 'pg-boss'
 *
 * const boss = new PgBoss({ db: fromBunSql(new SQL(connectionString)) })
 * await boss.start()
 * ```
 *
 * The caller owns the client's lifecycle: pg-boss never calls `end()` on it.
 *
 * `useListenNotify` needs `sql.listen()`, which Bun added in 1.4.0. On an older runtime the adapter
 * exposes no `listen` and pg-boss falls back to polling.
 */
export declare function fromBunSql(client: BunSqlLike): IDatabase;
//# sourceMappingURL=bun.d.ts.map