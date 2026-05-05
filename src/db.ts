import { ClientContract, ZenStackClient } from "@zenstackhq/orm";
import { SqliteDialect } from "@zenstackhq/orm/dialects/sqlite";
import SQLite from "better-sqlite3";
import { schema } from "../zenstack/schema.js";
import { PolicyPlugin } from "@zenstackhq/plugin-policy";

let dbInstance: ClientContract<typeof schema, any> | null = null;
let authDbInstance: ClientContract<typeof schema, any> | null = null;

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

export function getAuthDb(userId:string){
  if(!authDbInstance) {
    authDbInstance = getDb().$use(new PolicyPlugin())
  }

  return authDbInstance.$setAuth({id: userId});
}
