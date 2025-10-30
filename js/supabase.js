// C:\steptags2\js\supabase.js
// Browser Supabase client (anon key only). No env magic.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = 'https://vnkabkuqevummdugqige.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZua2Fia3VxZXZ1bW1kdWdxaWdlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ1MTQwNTUsImV4cCI6MjA3MDA5MDA1NX0.MxMGH27JkLIhIrLdxa-oAsamUcrS3d5akGIu9WU86Q4';

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error('Supabase URL/ANON key not set in js/supabase.js');
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
});

// Utility: read ?redirect=... or fallback
export function getRedirectTarget(fallback = '/dashboard.html') {
  try {
    const u = new URL(location.href);
    return u.searchParams.get('redirect') || fallback;
  } catch {
    return fallback;
  }
}

// Gate: require an authenticated session
export async function requireAuth() {
  const { data: { session } } = await supabase.auth.getSession();
  if (session) return session;

  // Wait for OAuth return; otherwise go to login
  const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => {
    if (s) { subscription.unsubscribe(); location.reload(); }
  });

  location.replace('/login.html?redirect=' + encodeURIComponent(getRedirectTarget('/dashboard.html')));
  throw new Error('unauthenticated');
}

// If already authed, bounce to target
export async function redirectIfAuthed() {
  const { data: { session } } = await supabase.auth.getSession();
  if (session) location.replace(getRedirectTarget('/dashboard.html'));
}
