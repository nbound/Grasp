import { createClient } from '@supabase/supabase-js'

let sharedClient
export function getSupabase(env = import.meta.env) {
  if (sharedClient) return sharedClient
  const url = env.VITE_SUPABASE_URL
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY
  if (!url || !key || key.startsWith('sb_secret_')) {
    throw new Error('Supabase is not configured with a public browser key.')
  }
  sharedClient = createClient(url, key)
  return sharedClient
}
