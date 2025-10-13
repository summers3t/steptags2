// C:\steptags2\js\dashboard.js
// Lists ONLY projects where current user is a member.
// Also wires cards to /projects/project.html?id=<uuid>.

import { supabase, requireAuth } from './supabase.js';

const session = await requireAuth();
const me = session.user;

const $ = (s, el = document) => el.querySelector(s);

async function hydrateHeader() {
  try {
    const { data: prof } = await supabase
      .from('profiles')
      .select('display_name,avatar_path,email')
      .eq('id', me.id)
      .maybeSingle();

    const nameEl = $('#hdr-name');
    if (nameEl) nameEl.textContent = prof?.display_name || me.email || 'User';

    if (prof?.avatar_path) {
      const { data } = await supabase.storage
        .from('avatars')
        .createSignedUrl(prof.avatar_path, 3600);
      if (data?.signedUrl) {
        const img = $('#hdr-avatar');
        if (img) img.src = data.signedUrl;
      }
    }
  } catch (e) {
    console.error('header hydrate error', e);
  }
}

async function loadProjects() {
  // Pull membership rows for this user, with joined project fields.
  const { data, error } = await supabase
    .from('project_members')
    .select(`
      role,
      projects:projects (
        id, title, description, updated_at
      )
    `)
    .eq('user_id', me.id)
    .order('updated_at', { referencedTable: 'projects', ascending: false });

  if (error) {
    console.error('loadProjects error', error);
    renderProjects([]);
    return;
  }

  // Map to project list, guard against null joins.
  const rows = (data || [])
    .map(r => r.projects)
    .filter(Boolean);

  renderProjects(rows);
}

function renderProjects(rows) {
  const list = document.getElementById('projectsList');
  if (!list) return;
  list.innerHTML = '';

  if (!rows.length) {
    list.innerHTML = `<li class="p-4 text-sm text-gray-500">No projects yet.</li>`;
    return;
  }

  for (const p of rows) {
    const li = document.createElement('li');
    li.className = 'rounded-xl border bg-white p-4 hover:shadow-sm transition';
    li.innerHTML = `
      <a class="block" href="/projects/project.html?id=${p.id}">
        <div class="flex items-start justify-between gap-3">
          <div>
            <h3 class="font-medium">${p.title || '(Untitled)'}</h3>
            <p class="text-sm text-gray-600 line-clamp-2">${p.description || ''}</p>
          </div>
          <span class="text-xs text-gray-500">${new Date(p.updated_at || Date.now()).toLocaleDateString()}</span>
        </div>
      </a>
    `;
    list.appendChild(li);
  }

  if (window.feather) window.feather.replace();
}

document.getElementById('logout-link')?.addEventListener('click', async (e) => {
  e.preventDefault();
  await supabase.auth.signOut();
  location.replace('/login.html');
});

await hydrateHeader();
await loadProjects();
