import type { AppDb } from "./client";
export function one<T>(
  db: AppDb,
  sql: string,
  ...args: unknown[]
): T | undefined {
  return db.prepare(sql).get(...args) as T | undefined;
}
export function all<T>(db: AppDb, sql: string, ...args: unknown[]): T[] {
  return db.prepare(sql).all(...args) as T[];
}
