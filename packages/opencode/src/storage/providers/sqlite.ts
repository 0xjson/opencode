import { Database as BunDatabase } from "bun:sqlite"
import { drizzle, type SQLiteBunDatabase } from "drizzle-orm/bun-sqlite"
import { migrate } from "drizzle-orm/bun-sqlite/migrator"
import { Effect, Schema } from "effect"
import path from "path"
import { existsSync, readFileSync, readdirSync } from "fs"

import { Context } from "@/util/context"
import { lazy } from "@/util/lazy"
import { Log } from "@/util/log"
import {
  type DatabaseProvider,
  type ProviderConfig,
  DatabaseProviderError,
  ConnectionError,
  TransactionError,
  type TxOrDb,
  defaultConfig,
} from "../provider"
import * as schema from "../schema"
import { Global } from "@/global"
import { Installation } from "@/installation"
import { Flag } from "@/flag/flag"
import { iife } from "@/util/iife"

declare const OPENCODE_MIGRATIONS: { sql: string; timestamp: number; name: string }[] | undefined

const log = Log.create({ service: "db:sqlite" })

export class SQLiteNotFoundError extends Schema.TaggedErrorClass<SQLiteNotFoundError>()("SQLiteNotFoundError", {
  message: Schema.String,
}) {}

namespace SQLiteInternal {
  export const Path = iife(() => {
    const channel = Installation.CHANNEL
    if (["latest", "beta"].includes(channel) || Flag.OPENCODE_DISABLE_CHANNEL_DB)
      return path.join(Global.Path.data, "opencode.db")
    const safe = channel.replace(/[^a-zA-Z0-9._-]/g, "-")
    return path.join(Global.Path.data, `opencode-${safe}.db`)
  })

  type Journal = { sql: string; timestamp: number; name: string }[]

  const state = {
    sqlite: undefined as BunDatabase | undefined,
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

  export const Client = lazy<SQLiteBunDatabase<typeof schema>>(() => {
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
        : migrations(path.join(import.meta.dirname, "../../../migration"))
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

  const ctx = Context.create<{
    tx: TxOrDb
    effects: (() => void | Promise<void>)[]
  }>("sqlite:database")

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

  export function effect(fn: () => void | Promise<void>) {
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
}

export function createSQLiteProvider(config: ProviderConfig): DatabaseProvider {
  const sqliteConfig = config.sqlite ?? defaultConfig.sqlite!
  let connected = false

  return {
    name: "sqlite",

    connect: Effect.fn("SQLiteProvider.connect")(() =>
      Effect.gen(function* () {
        if (connected) return

        try {
          const _ = SQLiteInternal.Client()
          connected = true
          log.info("SQLite connected", { path: SQLiteInternal.Path })
        } catch (cause) {
          return yield* new ConnectionError({
            message: `Failed to connect to SQLite: ${String(cause)}`,
            cause,
          })
        }
      }),
    ),

    disconnect: Effect.fn("SQLiteProvider.disconnect")(() =>
      Effect.gen(function* () {
        if (!connected) return

        try {
          SQLiteInternal.close()
          connected = false
          log.info("SQLite disconnected")
        } catch (cause) {
          return yield* new DatabaseProviderError({
            message: `Failed to disconnect from SQLite: ${String(cause)}`,
            cause,
          })
        }
      }),
    ),

    isConnected: () => connected,

    healthCheck: Effect.fn("SQLiteProvider.healthCheck")(() =>
      Effect.gen(function* () {
        if (!connected) return false

        try {
          const client = SQLiteInternal.Client()
          client.run("SELECT 1")
          return true
        } catch (cause) {
          return yield* new DatabaseProviderError({
            message: "SQLite health check failed",
            cause,
          })
        }
      }),
    ),

    use: Effect.fn("SQLiteProvider.use")(<T>(fn: (db: TxOrDb) => T) =>
      Effect.gen(function* () {
        try {
          return SQLiteInternal.use(fn)
        } catch (cause) {
          return yield* new DatabaseProviderError({
            message: "SQLite query failed",
            cause,
          })
        }
      }),
    ),

    transaction: Effect.fn("SQLiteProvider.transaction")(<T>(fn: (tx: TxOrDb) => T) =>
      Effect.gen(function* () {
        try {
          return SQLiteInternal.transaction(fn)
        } catch (cause) {
          return yield* new TransactionError({
            message: "SQLite transaction failed",
            cause,
          })
        }
      }),
    ),

    effect: (fn: () => void | Promise<void>) => Effect.sync(() => SQLiteInternal.effect(fn)),
  }
}

export { SQLiteInternal }
