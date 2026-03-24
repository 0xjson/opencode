import { Effect, Schema, Option } from "effect"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"

import { Context } from "@/util/context"
import { Log } from "@/util/log"
import {
  type DatabaseProvider,
  type ProviderConfig,
  DatabaseProviderError,
  ConnectionError,
  TransactionError,
  type TxOrDb,
} from "../provider"

const log = Log.create({ service: "db:supabase" })

export class SupabaseConnectionError extends Schema.TaggedErrorClass<SupabaseConnectionError>()(
  "SupabaseConnectionError",
  { message: Schema.String },
) {}

export class SupabaseQueryError extends Schema.TaggedErrorClass<SupabaseQueryError>()("SupabaseQueryError", {
  message: Schema.String,
  code: Schema.optional(Schema.String),
  details: Schema.optional(Schema.String),
}) {}

namespace SupabaseInternal {
  type ClientState = {
    client: SupabaseClient
    config: NonNullable<ProviderConfig["supabase"]>
  }

  const state = {
    state: undefined as ClientState | undefined,
    retryCount: 0,
  }

  function createClientFromConfig(config: NonNullable<ProviderConfig["supabase"]>): SupabaseClient {
    return createClient(config.url, config.key, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
      db: {
        schema: "public",
      },
    })
  }

  export function connect(config: ProviderConfig): Effect.Effect<SupabaseClient, ConnectionError> {
    return Effect.gen(function* () {
      if (state.state) {
        return state.state.client
      }

      if (!config.supabase) {
        return yield* new ConnectionError({
          message: "Supabase configuration not provided",
        })
      }

      const client = createClientFromConfig(config.supabase)

      const result = yield* Effect.promise(() =>
        client
          .from("session")
          .select("id")
          .limit(1)
          .then(({ error }) => ({ error })),
      ).pipe(
        Effect.timeout("5 seconds"),
        Effect.mapError(
          (cause) =>
            new ConnectionError({
              message: `Supabase connection test failed: ${String(cause)}`,
              cause,
            }),
        ),
      )

      if (result.error) {
        return yield* new ConnectionError({
          message: `Supabase connection error: ${result.error.message}`,
        })
      }

      state.state = { client, config: config.supabase }
      state.retryCount = 0

      log.info("Supabase connected", { url: config.supabase.url })
      return client
    })
  }

  export function disconnect(): Effect.Effect<void, DatabaseProviderError> {
    return Effect.gen(function* () {
      if (!state.state) return

      state.state = undefined
      state.retryCount = 0
      log.info("Supabase disconnected")
    })
  }

  export function isConnected(): boolean {
    return state.state !== undefined
  }

  export function getClient(): SupabaseClient {
    if (!state.state) {
      throw new SupabaseConnectionError({ message: "Not connected to Supabase" })
    }
    return state.state.client
  }

  export function healthCheck(): Effect.Effect<boolean, DatabaseProviderError> {
    return Effect.gen(function* () {
      if (!state.state) return false

      const result = yield* Effect.promise(() =>
        state.state!.client.from("session").select("count", { count: "exact", head: true }),
      ).pipe(
        Effect.timeout("5 seconds"),
        Effect.mapError(
          (cause) =>
            new DatabaseProviderError({
              message: "Supabase health check error",
              cause,
            }),
        ),
      )

      if (result.error) {
        return yield* new DatabaseProviderError({
          message: `Supabase health check failed: ${result.error.message}`,
        })
      }

      return true
    })
  }

  export function resetRetryCount() {
    state.retryCount = 0
  }

  export function incrementRetryCount(): number {
    return ++state.retryCount
  }

  export function getRetryCount(): number {
    return state.retryCount
  }

  export function getConfig(): Option.Option<NonNullable<ProviderConfig["supabase"]>> {
    return state.state ? Option.some(state.state.config) : Option.none()
  }
}

// Wrap Supabase operations with retry logic
export function withRetry<A>(
  operation: () => Promise<A>,
  config?: ProviderConfig["supabase"],
): Effect.Effect<A, SupabaseQueryError> {
  const maxRetries = config?.retryAttempts ?? 3
  const delay = config?.retryDelay ?? 1000

  return Effect.gen(function* () {
    let lastError: Error | undefined

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) {
        const backoff = delay * Math.pow(2, attempt - 1)
        yield* Effect.sleep(`${backoff} millis`)
        log.warn(`Retrying Supabase operation`, { attempt, maxRetries })
      }

      try {
        const result = yield* Effect.promise(operation)
        SupabaseInternal.resetRetryCount()
        return result
      } catch (cause) {
        lastError = cause instanceof Error ? cause : new Error(String(cause))
        SupabaseInternal.incrementRetryCount()

        const isRetryable =
          lastError.message.includes("timeout") ||
          lastError.message.includes("connection") ||
          lastError.message.includes("network") ||
          lastError.message.includes("ECONNRESET") ||
          lastError.message.includes("ETIMEDOUT") ||
          lastError.message.includes("503") ||
          lastError.message.includes("502") ||
          lastError.message.includes("504")

        if (!isRetryable) break
      }
    }

    return yield* new SupabaseQueryError({
      message: lastError?.message ?? "Unknown error",
    })
  })
}

// Context for transactions (Supabase doesn't support true transactions via REST,
// so we use a batched approach or optimistic locking)
const ctx = Context.create<{
  effects: (() => void | Promise<void>)[]
}>("supabase:database")

export function createSupabaseProvider(config: ProviderConfig): DatabaseProvider {
  return {
    name: "supabase",

    connect: Effect.fn("SupabaseProvider.connect")(() =>
      Effect.gen(function* () {
        yield* SupabaseInternal.connect(config)
      }),
    ),

    disconnect: Effect.fn("SupabaseProvider.disconnect")(() => SupabaseInternal.disconnect()),

    isConnected: SupabaseInternal.isConnected,

    healthCheck: Effect.fn("SupabaseProvider.healthCheck")(() => SupabaseInternal.healthCheck()),

    // Supabase operations are async by nature, so we wrap them
    use: Effect.fn("SupabaseProvider.use")(<T>(_fn: (db: TxOrDb) => T) =>
      Effect.gen(function* () {
        // Supabase doesn't have a direct "use" pattern like Drizzle
        // Operations are done via the client directly
        // This is a placeholder - actual queries would use the Supabase client directly
        return yield* new DatabaseProviderError({
          message:
            "Supabase provider does not support synchronous use(). Use Supabase client directly or implement async wrappers.",
        })
      }),
    ),

    // Supabase via REST doesn't support true transactions
    // This would need to be implemented using PostgreSQL functions or edge functions
    transaction: Effect.fn("SupabaseProvider.transaction")(<T>(_fn: (tx: TxOrDb) => T) =>
      Effect.gen(function* () {
        return yield* new TransactionError({
          message:
            "Supabase REST API does not support transactions. Use database functions or RPC calls for atomic operations.",
        })
      }),
    ),

    effect: (fn: () => void | Promise<void>) =>
      Effect.gen(function* () {
        try {
          ctx.use().effects.push(fn)
        } catch {
          fn()
        }
      }),
  }
}

// Helper to check if Supabase is configured
export function isSupabaseConfigured(): boolean {
  return !!(
    process.env["SUPABASE_URL"] &&
    (process.env["SUPABASE_ANON_KEY"] || process.env["SUPABASE_SERVICE_ROLE_KEY"])
  )
}

// Helper to test connection
export function testConnection(): Effect.Effect<{ ok: true } | { ok: false; error: string }, never> {
  return Effect.gen(function* () {
    if (!isSupabaseConfigured()) {
      return { ok: false, error: "Supabase not configured" }
    }

    const url = process.env["SUPABASE_URL"]!
    const key = process.env["SUPABASE_SERVICE_ROLE_KEY"] || process.env["SUPABASE_ANON_KEY"]!

    const client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const result = yield* Effect.promise(() =>
      client
        .from("session")
        .select("id")
        .limit(1)
        .then(({ error }) => (error ? { ok: false, error: error.message } : { ok: true })),
    ).pipe(
      Effect.timeout("5 seconds"),
      Effect.orElseSucceed(() => ({ ok: false, error: "Timeout" })),
    )

    return result as { ok: true } | { ok: false; error: string }
  })
}

export { SupabaseInternal }
