// C:\steptags2\js\auth.js
import { supabase, getRedirectTarget } from './supabase.js';
import { purgeSupabaseSessions } from './devtools.js';

export async function signInWithGoogle() {
    purgeSupabaseSessions();
    const target = getRedirectTarget('/dashboard.html');
    await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
            redirectTo: `${location.origin}/login.html?redirect=${encodeURIComponent(target)}`,
            scopes: 'openid email profile' // ensures `picture` comes back
        }
    });
}

export async function signOut() {
    await supabase.auth.signOut();
}

export async function emailSignUp(email, password) {
    const target = getRedirectTarget('/dashboard.html');
    const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
            // Confirm email lands on login.html, which then redirects to `target` (invite or dashboard)
            emailRedirectTo: `${location.origin}/login.html?redirect=${encodeURIComponent(target)}`
        }
    });
    if (error) throw error;
}

export async function emailSignIn(email, password) {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    // On success, honor redirect immediately
    location.replace(getRedirectTarget('/dashboard.html'));
}
