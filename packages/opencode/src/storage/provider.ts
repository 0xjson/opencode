import { Effect, Schema } from "effect"
import { type SQLiteTransaction } from "drizzle-orm/sqlite-core"

export type SQLiteClient = any
export type PostgresClient = any
export type SQLiteTx = SQLiteTransaction<"sync", void, any, any>
export type PostgresTx = any

export type AnyClient = SQLiteClient | PostgresClient
export type AnyTx = SQLiteTx | PostgresTx
export type TxOrDb = AnyClient | AnyTx

export class DatabaseProviderError extends Schema.TaggedErrorClass<DatabaseProviderError>()("DatabaseProviderError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect),
}) {}

export class ConnectionError extends Schema.TaggedErrorClass<ConnectionError>()("ConnectionError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect),
}) {}

export class TransactionError extends Schema.TaggedErrorClass<TransactionError>()("TransactionError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect),
}) {}

export type DatabaseError = DatabaseProviderError | ConnectionError | TransactionError

export interface DatabaseProvider {
  readonly name: string

  readonly connect: () => Effect.Effect<void, ConnectionError>

  readonly disconnect: () => Effect.Effect<void, DatabaseProviderError>

  readonly isConnected: () => boolean

  readonly healthCheck: () => Effect.Effect<boolean, DatabaseProviderError>

  readonly use: <T>(fn: (db: TxOrDb) => T) => Effect.Effect<T, DatabaseProviderError>

  readonly transaction: <T>(fn: (tx: TxOrDb) => T) => Effect.Effect<T, TransactionError>

  readonly effect: (fn: () => void | Promise<void>) => Effect.Effect<void, never>
}

export type DatabaseBackend = "sqlite" | "supabase"

export interface ProviderConfig {
  readonly backend: DatabaseBackend
  readonly sqlite?: {
    readonly path: string
    readonly pragmas?: Record<string, string | number>
  }
  readonly supabase?: {
    readonly url: string
    readonly key: string
    readonly poolSize?: number
    readonly retryAttempts?: number
    readonly retryDelay?: number
  }
  readonly fallback?: {
    readonly enabled: boolean
    readonly to: DatabaseBackend
  }
  readonly logging?: {
    readonly enabled: boolean
    readonly slowQueryThreshold?: number
  }
}

export const defaultConfig: ProviderConfig = {
  backend: "sqlite",
  sqlite: {
    path: ":memory:",
    pragmas: {
      journal_mode: "WAL",
      synchronous: "NORMAL",
      busy_timeout: 5000,
      cache_size: -64000,
      foreign_keys: "ON",
    },
  },
  fallback: {
    enabled: true,
    to: "sqlite",
  },
  logging: {
    enabled: false,
    slowQueryThreshold: 1000,
  },
}

export function createProvider(config: ProviderConfig): DatabaseProvider {
  const backend = config.backend

  if (backend === "sqlite") {
    return require("./providers/sqlite").createSQLiteProvider(config)
  }

  if (backend === "supabase") {
    return require("./providers/supabase").createSupabaseProvider(config)
  }

  throw new Error(`Unknown database backend: ${backend}`)
}

export function providerFromEnv(): DatabaseProvider {
  const backend = process.env["OPENCODE_DATABASE_BACKEND"] as DatabaseBackend | undefined
  const sqlitePath = process.env["OPENCODE_SQLITE_PATH"]
  const supabaseUrl = process.env["SUPABASE_URL"]
  const supabaseKey = process.env["SUPABASE_SERVICE_ROLE_KEY"] || process.env["SUPABASE_ANON_KEY"]
  const fallbackEnabled = process.env["OPENCODE_DATABASE_FALLBACK"] !== "false"

  const config: ProviderConfig = {
    backend: backend ?? "sqlite",
    sqlite: sqlitePath ? { path: sqlitePath } : defaultConfig.sqlite,
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

  return createProvider(config)
}
