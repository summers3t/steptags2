import { supabase, requireAuth } from '/js/supabase.js';
import { hardSignOut } from '/js/devtools.js';
import { getProfile, resolveAvatarUrl, resolveDisplayName } from '/js/api.js';

export async function hydrateHeader() {
    const session = await requireAuth();
    const user = session.user;

    // name + avatar
    try {
        const profile = await getProfile(user.id);
        const name = resolveDisplayName(user, profile);
        const avatar = await resolveAvatarUrl(user, profile);
        const nameEl = document.getElementById('display-name');
        const avatarEl = document.getElementById('avatar');
        if (nameEl) nameEl.textContent = name;
        if (avatarEl && avatar) avatarEl.src = avatar;
    } catch {
        const nameEl = document.getElementById('display-name');
        const avatarEl = document.getElementById('avatar');
        if (nameEl) nameEl.textContent = user.email || 'User';
        if (avatarEl) avatarEl.src = `https://i.pravatar.cc/64?u=${encodeURIComponent(user?.id || 'anon')}`;
    }

    // sign out
    document.getElementById('logout-link')?.addEventListener('click', (e) => {
        e.preventDefault();
        hardSignOut();
    });

    // tiny dropdown wiring (if not already wired on the page)
    const btn = document.getElementById('user-menu-btn');
    const menu = document.getElementById('user-menu');
    const root = document.getElementById('user-menu-root');
    if (btn && menu && root && !btn.dataset.__bound) {
        btn.dataset.__bound = '1';
        function close() { menu.classList.add('hidden'); btn.setAttribute('aria-expanded', 'false'); }
        function toggle() { menu.classList.toggle('hidden'); btn.setAttribute('aria-expanded', menu.classList.contains('hidden') ? 'false' : 'true'); }
        btn.addEventListener('click', e => { e.stopPropagation(); toggle(); });
        document.addEventListener('click', e => { if (!root.contains(e.target)) close(); });
        document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
    }

    return { supabase, user };
}
