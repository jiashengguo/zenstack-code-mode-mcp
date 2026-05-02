import { ZenStackClient } from "@zenstackhq/orm";
import { SqliteDialect } from "@zenstackhq/orm/dialects/sqlite";
import SQLite from "better-sqlite3";
import { schema } from "../zenstack/schema.js";

let dbInstance: ZenStackClient<typeof schema> | null = null;

export function getDb(): ZenStackClient<typeof schema> {
  if (!dbInstance) {
    dbInstance = new ZenStackClient(schema, {
      dialect: new SqliteDialect({
        database: new SQLite("./zenstack/dev.db"),
      }),
    });
  }
  return dbInstance;
}
