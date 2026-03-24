import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { lazy } from "@/util/lazy"

export namespace Supabase {
  export const url = process.env["SUPABASE_URL"]
  export const anonKey = process.env["SUPABASE_ANON_KEY"]
  export const serviceRoleKey = process.env["SUPABASE_SERVICE_ROLE_KEY"]

  export const enabled = url && (anonKey || serviceRoleKey)

  export const client = lazy<SupabaseClient>(() => {
    if (!url) throw new Error("SUPABASE_URL not configured")
    const key = serviceRoleKey ?? anonKey
    if (!key) throw new Error("SUPABASE_ANON_KEY or SUPABASE_SERVICE_ROLE_KEY not configured")

    return createClient(url, key, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
      db: {
        schema: "public",
      },
    })
  })

  export async function testConnection() {
    if (!enabled) return { ok: false, error: "Supabase not configured" }

    try {
      const { data, error } = await client().from("session").select("id").limit(1)
      if (error) return { ok: false, error: error.message }
      return { ok: true }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  }
}
