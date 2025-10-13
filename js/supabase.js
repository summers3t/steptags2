// Browser Supabase client (anon key only). No env magic. No typos.
// Fill the two constants with your real values.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = 'https://vnkabkuqevummdugqige.supabase.co';         // <-- set
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZua2Fia3VxZXZ1bW1kdWdxaWdlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ1MTQwNTUsImV4cCI6MjA3MDA5MDA1NX0.MxMGH27JkLIhIrLdxa-oAsamUcrS3d5akGIu9WU86Q4';                    // <-- set (starts with eyJ...)

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error('Supabase URL/ANON key not set in js/supabase.js');
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});

export async function requireAuth() {
  const { data: { session } } = await supabase.auth.getSession();
  if (session) return session;

  // Wait for OAuth redirect if coming back
  const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => {
    if (s) { subscription.unsubscribe(); location.reload(); }
  });

  location.replace('/login.html');
  throw new Error('unauthenticated');
}

export async function redirectIfAuthed() {
  const { data: { session } } = await supabase.auth.getSession();
  if (session) location.replace('/dashboard.html');
}
