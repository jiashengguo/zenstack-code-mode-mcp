import { ClientContract, ZenStackClient } from "@zenstackhq/orm";
import { SqliteDialect } from "@zenstackhq/orm/dialects/sqlite";
import SQLite from "better-sqlite3";
import { schema } from "../zenstack/schema.js";

let dbInstance: ClientContract<typeof schema, any> | null = null;

export function getDb(): ClientContract<typeof schema, any> {
  if (!dbInstance) {
    dbInstance = new ZenStackClient(schema, {
      dialect: new SqliteDialect({
        database: new SQLite("./zenstack/dev.db"),
      }),
    });
  }
  return dbInstance;
}
