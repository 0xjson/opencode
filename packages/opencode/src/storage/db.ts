import { Database as BunDatabase } from "bun:sqlite"
import { drizzle, type SQLiteBunDatabase } from "drizzle-orm/bun-sqlite"
import { migrate } from "drizzle-orm/bun-sqlite/migrator"
import { type SQLiteTransaction } from "drizzle-orm/sqlite-core"
import { Effect } from "effect"
export * from "drizzle-orm"
import path from "path"
import { existsSync, readFileSync, readdirSync } from "fs"

import { Context } from "../util/context"
import { lazy } from "../util/lazy"
import { Global } from "../global"
import { Log } from "../util/log"
import { NamedError } from "@opencode-ai/util/error"
import z from "zod"
import * as schema from "./schema"
import { Installation } from "../installation"
import { Flag } from "../flag/flag"
import { iife } from "@/util/iife"
import {
  type DatabaseProvider,
  type ProviderConfig,
  type DatabaseBackend,
  DatabaseProviderError,
  ConnectionError,
  TransactionError,
  type TxOrDb,
  defaultConfig,
} from "./provider"
import { createSQLiteProvider, SQLiteInternal } from "./providers/sqlite"
import {
  createSupabaseProvider,
  isSupabaseConfigured,
  testConnection as testSupabaseConnection,
} from "./providers/supabase"

declare const OPENCODE_MIGRATIONS: { sql: string; timestamp: number; name: string }[] | undefined

export const NotFoundError = NamedError.create(
  "NotFoundError",
  z.object({
    message: z.string(),
  }),
)

const log = Log.create({ service: "db" })

export namespace Database {
  export const Path = iife(() => {
    const channel = Installation.CHANNEL
    if (["latest", "beta"].includes(channel) || Flag.OPENCODE_DISABLE_CHANNEL_DB)
      return path.join(Global.Path.data, "opencode.db")
    const safe = channel.replace(/[^a-zA-Z0-9._-]/g, "-")
    return path.join(Global.Path.data, `opencode-${safe}.db`)
  })

  type Schema = typeof schema
  export type Transaction = SQLiteTransaction<"sync", void, Schema>

  type Client = SQLiteBunDatabase<Schema>

  type Journal = { sql: string; timestamp: number; name: string }[]

  const state = {
    sqlite: undefined as BunDatabase | undefined,
    provider: undefined as DatabaseProvider | undefined,
  }

  function time(tag: string) {
    const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(tag)
    if (!match) return 0
    return Date.UTC(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      Number(match[4]),
      Number(match[5]),
      Number(match[6]),
    )
  }

  function migrations(dir: string): Journal {
    const dirs = readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)

    const sql = dirs
      .map((name) => {
        const file = path.join(dir, name, "migration.sql")
        if (!existsSync(file)) return
        return {
          sql: readFileSync(file, "utf-8"),
          timestamp: time(name),
          name,
        }
      })
      .filter(Boolean) as Journal

    return sql.sort((a, b) => a.timestamp - b.timestamp)
  }

  export const Client = lazy(() => {
    log.info("opening database", { path: Path })

    const sqlite = new BunDatabase(Path, { create: true })
    state.sqlite = sqlite

    sqlite.run("PRAGMA journal_mode = WAL")
    sqlite.run("PRAGMA synchronous = NORMAL")
    sqlite.run("PRAGMA busy_timeout = 5000")
    sqlite.run("PRAGMA cache_size = -64000")
    sqlite.run("PRAGMA foreign_keys = ON")
    sqlite.run("PRAGMA wal_checkpoint(PASSIVE)")

    const db = drizzle({ client: sqlite, schema })

    const entries =
      typeof OPENCODE_MIGRATIONS !== "undefined"
        ? OPENCODE_MIGRATIONS
        : migrations(path.join(import.meta.dirname, "../../migration"))
    if (entries.length > 0) {
      log.info("applying migrations", {
        count: entries.length,
        mode: typeof OPENCODE_MIGRATIONS !== "undefined" ? "bundled" : "dev",
      })
      if (Flag.OPENCODE_SKIP_MIGRATIONS) {
        for (const item of entries) {
          item.sql = "select 1;"
        }
      }
      migrate(db, entries)
    }

    return db
  })

  export function close() {
    const sqlite = state.sqlite
    if (!sqlite) return
    sqlite.close()
    state.sqlite = undefined
    Client.reset()
  }

  export type TxOrDb = SQLiteTransaction<"sync", void, any, any> | Client

  const ctx = Context.create<{
    tx: TxOrDb
    effects: (() => void | Promise<void>)[]
  }>("database")

  export function use<T>(callback: (trx: TxOrDb) => T): T {
    try {
      return callback(ctx.use().tx)
    } catch (err) {
      if (err instanceof Context.NotFound) {
        const effects: (() => void | Promise<void>)[] = []
        const result = ctx.provide({ effects, tx: Client() }, () => callback(Client()))
        for (const effect of effects) effect()
        return result
      }
      throw err
    }
  }

  export function effect(fn: () => any | Promise<any>) {
    try {
      ctx.use().effects.push(fn)
    } catch {
      fn()
    }
  }

  export function transaction<T>(callback: (tx: TxOrDb) => T): T {
    try {
      return callback(ctx.use().tx)
    } catch (err) {
      if (err instanceof Context.NotFound) {
        const effects: (() => void | Promise<void>)[] = []
        const result = (Client().transaction as any)((tx: TxOrDb) => {
          return ctx.provide({ tx, effects }, () => callback(tx))
        })
        for (const effect of effects) effect()
        return result
      }
      throw err
    }
  }

  // Provider-based API for Effect integration
  export namespace Provider {
    export function create(config: ProviderConfig): DatabaseProvider {
      if (config.backend === "sqlite") {
        return createSQLiteProvider(config)
      }
      if (config.backend === "supabase") {
        return createSupabaseProvider(config)
      }
      throw new Error(`Unknown database backend: ${config.backend}`)
    }

    export function fromEnv(): DatabaseProvider {
      const backend = process.env["OPENCODE_DATABASE_BACKEND"] as DatabaseBackend | undefined
      const sqlitePath = process.env["OPENCODE_SQLITE_PATH"]
      const supabaseUrl = process.env["SUPABASE_URL"]
      const supabaseKey = process.env["SUPABASE_SERVICE_ROLE_KEY"] || process.env["SUPABASE_ANON_KEY"]
      const fallbackEnabled = process.env["OPENCODE_DATABASE_FALLBACK"] !== "false"

      const config: ProviderConfig = {
        backend: backend ?? "sqlite",
        sqlite: sqlitePath ? { path: sqlitePath } : { path: Path },
        supabase:
          supabaseUrl && supabaseKey
            ? {
                url: supabaseUrl,
                key: supabaseKey,
                poolSize: Number(process.env["SUPABASE_POOL_SIZE"]) || 10,
                retryAttempts: Number(process.env["SUPABASE_RETRY_ATTEMPTS"]) || 3,
                retryDelay: Number(process.env["SUPABASE_RETRY_DELAY"]) || 1000,
              }
            : undefined,
        fallback: {
          enabled: fallbackEnabled,
          to: "sqlite",
        },
        logging: {
          enabled: process.env["OPENCODE_DATABASE_LOGGING"] === "true",
          slowQueryThreshold: Number(process.env["OPENCODE_SLOW_QUERY_THRESHOLD"]) || 1000,
        },
      }

      return create(config)
    }

    export function getOrCreate(): DatabaseProvider {
      if (!state.provider) {
        state.provider = fromEnv()
      }
      return state.provider
    }

    export function reset() {
      state.provider = undefined
    }

    export function isSupabaseAvailable(): boolean {
      return isSupabaseConfigured()
    }

    export function testSupabase(): Effect.Effect<{ ok: true } | { ok: false; error: string }, never> {
      return testSupabaseConnection()
    }
  }
}

export type { DatabaseProvider, ProviderConfig, DatabaseBackend, TxOrDb }

export { DatabaseProviderError, ConnectionError, TransactionError, defaultConfig }
