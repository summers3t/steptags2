// C:\steptags2\js\supabase.js
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'

if (!window.__env) window.__env = {}
window.__env.SUPABASE_URL ??= 'https://vnkabkuqevummdugqige.supabase.co'
window.__env.SUPABASE_ANON_KEY ??= 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZua2Fia3VxZXZ1bW1kdWdxaWdlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ1MTQwNTUsImV4cCI6MjA3MDA5MDA1NX0.MxMGH27JkLIhIrLdxa-oAsamUcrS3d5akGIu9WU86Q4'
window.__env.REDIRECT_DASH ??= `${location.origin}/dashboard.html`
window.__env.REDIRECT_LOGIN ??= `${location.origin}/login.html`

export const SUPABASE_REF = 'vnkabkuqevummdugqige'

export const supabase = createClient(
    window.__env.SUPABASE_URL,
    window.__env.SUPABASE_ANON_KEY,
    {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
        global: { headers: { 'x-steptags': 'pro' } }
    }
)

export async function requireAuth() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) location.replace(window.__env.REDIRECT_LOGIN)
    return session
}

export async function redirectIfAuthed() {
    const { data: { session } } = await supabase.auth.getSession()
    if (session) location.replace(window.__env.REDIRECT_DASH)
}
