import Database from "better-sqlite3";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { dbPath } from "../config";
export type AppDb = Database.Database;
export function openDb(file = dbPath()): AppDb {
  mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  db.exec(
    `CREATE TABLE IF NOT EXISTS owners(id TEXT PRIMARY KEY);INSERT OR IGNORE INTO owners VALUES('local');CREATE TABLE IF NOT EXISTS modules(id TEXT PRIMARY KEY,ownerId TEXT NOT NULL REFERENCES owners(id),code TEXT NOT NULL,title TEXT NOT NULL,createdAt TEXT NOT NULL,UNIQUE(ownerId,code));`,
  );
  db.exec(readFileSync(path.resolve("drizzle/0001_core.sql"), "utf8"));
  return db;
}
let singleton: AppDb | undefined;
export function getDb() {
  return (singleton ??= openDb());
}
