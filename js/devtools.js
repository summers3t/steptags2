// C:\steptags2\js\devtools.js
// Purge any cached Supabase sessions for this project ref.
export function purgeSupabaseSessions() {
    const ref = 'vnkabkuqevummdugqige' // from your SUPABASE_URL
    const keys = [
        `sb-${ref}-auth-token`,
        `sb-${ref}-auth-token.0`,
        `sb-${ref}-auth-token.1`,
        `sb-${ref}-persist-session`,
        `sb-${ref}-persist-session.0`,
        `sb-${ref}-persist-session.1`
    ]
    keys.forEach(k => localStorage.removeItem(k))
}

// Hard logout: supabase signOut + local purge + redirect.
import { supabase } from './supabase.js'
export async function hardSignOut() {
    try { await supabase.auth.signOut() } catch { }
    purgeSupabaseSessions()
    // Also clear our app keys if any
    Object.keys(localStorage).forEach(k => { if (k.startsWith('st_') || k.startsWith('steptags_')) localStorage.removeItem(k) })
    location.replace('/login.html')
}
