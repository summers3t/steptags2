// Fast, no-flicker header for StepTags Pro.
// Hide avatar+name until ready, then reveal. Always replace src.
// Dropdown wired to #user-menu-btn / #user-menu. Auto-runs once.

import { supabase } from './supabase.js';

const qs = (s, r = document) => r.querySelector(s);

function displayNameFrom(user, profile) {
  const m = user?.user_metadata || {};
  const id0 = Array.isArray(user?.identities) ? (user.identities[0]?.identity_data || {}) : {};
  return (
    profile?.display_name ||
    m.full_name || m.name || id0.full_name || id0.name ||
    (user?.email ? user.email.split('@')[0] : 'User')
  );
}
function oauthPhoto(user) {
  const m = user?.user_metadata || {};
  const id0 = Array.isArray(user?.identities) ? (user.identities[0]?.identity_data || {}) : {};
  return m.avatar_url || m.picture || id0.avatar_url || id0.picture || null;
}
async function signAvatar(path, expires = 21600) {
  if (!path) return null;
  const { data, error } = await supabase.storage.from('avatars').createSignedUrl(path, expires);
  if (error) return null;
  return data?.signedUrl || null;
}
function wireDropdown(btn, menu) {
  if (!btn || !menu) return;
  let open = false;
  const show = () => { menu.classList.remove('hidden'); menu.setAttribute('aria-expanded','true'); open = true; };
  const hide = () => { menu.classList.add('hidden');  menu.setAttribute('aria-expanded','false'); open = false; };
  btn.addEventListener('click', (e) => { e.preventDefault(); open ? hide() : show(); });
  document.addEventListener('click', (e) => {
    if (!open) return;
    if (e.target.closest('#user-menu-btn') || e.target.closest('#user-menu')) return;
    hide();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && open) hide(); });
}
function wireLogout() {
  document.addEventListener('click', async (e) => {
    const a = e.target.closest('#logout-link');
    if (!a) return;
    e.preventDefault();
    await supabase.auth.signOut();
    location.replace('/login.html');
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  const root   = qs('#user-menu-root') || document;
  const nameEl = qs('#display-name', root);
  const avatar = qs('#avatar', root);
  const btn    = qs('#user-menu-btn', root);
  const menu   = qs('#user-menu', root);

  // Make holder clear: hide avatar+name until set
  if (nameEl) { nameEl.style.visibility = 'hidden'; nameEl.textContent = ''; }
  if (avatar) {
    avatar.style.visibility = 'hidden';
    avatar.removeAttribute('src');         // no broken icon if hidden
    avatar.setAttribute('aria-hidden', 'true');
  }

  wireDropdown(btn, menu);
  wireLogout();

  const { data: auth } = await supabase.auth.getUser();
  const user = auth?.user;
  if (!user) return;

  // Immediate metadata
  const metaName = displayNameFrom(user, null);
  const metaPhoto = oauthPhoto(user); // may be null for email users

  if (nameEl) {
    nameEl.textContent = metaName;
    nameEl.style.visibility = '';      // reveal name immediately
  }

  if (avatar && metaPhoto) {
    avatar.onload = () => { avatar.style.visibility = ''; avatar.removeAttribute('aria-hidden'); };
    avatar.onerror = () => { avatar.style.visibility = ''; avatar.removeAttribute('aria-hidden'); };
    avatar.src = metaPhoto;            // set now for OAuth users
  }

  // Upgrade for email users: signed avatar_path
  try {
    const { data: prof } = await supabase
      .from('profiles')
      .select('email,display_name,avatar_path')
      .eq('id', user.id)
      .maybeSingle();

    const finalName = displayNameFrom(user, prof);
    if (nameEl && finalName && nameEl.textContent !== finalName) nameEl.textContent = finalName;

    const signed = prof?.avatar_path ? await signAvatar(prof.avatar_path) : null;

    // Always replace image src when we have a better one
    if (avatar && signed) {
      avatar.onload = () => { avatar.style.visibility = ''; avatar.removeAttribute('aria-hidden'); };
      avatar.onerror = () => { avatar.style.visibility = ''; avatar.removeAttribute('aria-hidden'); };
      avatar.src = signed;            // unconditional replace
      avatar.alt = finalName || 'User';
    } else if (avatar && !metaPhoto) {
      // No image available: keep it hidden silhouette-free
      avatar.style.visibility = '';   // reveal empty space gracefully
      avatar.removeAttribute('aria-hidden');
    }
  } catch {
    if (avatar && !metaPhoto) {
      avatar.style.visibility = '';
      avatar.removeAttribute('aria-hidden');
    }
  }
});
