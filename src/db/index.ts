import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { config } from "../config.js";
import * as schema from "./schema.js";

mkdirSync(config.dataDir, { recursive: true });
mkdirSync(join(config.dataDir, "images"), { recursive: true });
mkdirSync(config.profilesDir, { recursive: true });

const sqlite = new Database(join(config.dataDir, "app.db"));
sqlite.pragma("journal_mode = WAL");

export const db = drizzle(sqlite, { schema });

migrate(db, { migrationsFolder: resolve(config.root, "drizzle") });

export { schema };
