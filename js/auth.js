// C:\steptags2\js\auth.js
import { supabase } from './supabase.js'
import { purgeSupabaseSessions } from './devtools.js'

export async function signInWithGoogle() {
    // Clean stale state before OAuth to avoid loops
    purgeSupabaseSessions()
    await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
            redirectTo: `${location.origin}/dashboard.html`
        }
    })
}

export async function signOut() {
    // soft sign out; UI uses hardSignOut from devtools on header
    await supabase.auth.signOut()
}

export async function emailSignUp(email, password) {
    const { error } = await supabase.auth.signUp({ email, password })
    if (error) throw error
}

export async function emailSignIn(email, password) {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
}
