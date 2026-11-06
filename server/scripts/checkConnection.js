import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { readConfig } from '../src/config.js'

// Explicit, read-only hosted readiness check. Never prints keys, URLs, rows,
// raw SDK responses, or tokens. Does not create anonymous users or call join_game.
for (const name of ['.env.local', '.env']) {
  const path = fileURLToPath(new URL(`../${name}`, import.meta.url))
  if (existsSync(path)) process.loadEnvFile(path)
}
try {
  const config = readConfig()
  const client = createClient(config.supabaseUrl, config.secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(10000) }) },
  })
  const tables = {
    quizzes: ['id', 'teacher_id'],
    game_sessions: ['id', 'host_id', 'join_code', 'status', 'expires_at', 'max_players', 'team_count'],
    teams: ['session_id', 'team_number', 'name'],
    players: ['id', 'session_id', 'user_id', 'nickname', 'team_number'],
  }
  for (const [table, columns] of Object.entries(tables)) {
    const { error } = await client.from(table).select(columns.join(','), { head: true }).limit(0)
    console.log(`${table}: ${error ? 'schema/access check FAILED' : 'schema reachable'}`)
    if (error) {
      process.exitCode = 1
      for (const column of columns) {
        const check = await client.from(table).select(column, { head: true }).limit(0)
        if (check.error) console.log(`  unavailable: ${table}.${column}`)
      }
    }
  }
  const response = await fetch(`${config.supabaseUrl}/auth/v1/settings`, {
    headers: { apikey: config.publishableKey }, signal: AbortSignal.timeout(10000),
  })
  const settings = response.ok ? await response.json() : null
  const enabled = settings?.external?.anonymous_users
  console.log(`Anonymous Auth: ${enabled === true ? 'enabled' : enabled === false ? 'DISABLED' : 'unknown'}`)
  if (enabled !== true) process.exitCode = 1
  console.log('Read-only check complete; grants, RLS, RPC behavior, and end-to-end joins require integration tests.')
} catch {
  console.error('Connection check failed. Check local configuration and network access; no credential details logged.')
  process.exitCode = 1
}
