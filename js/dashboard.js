// Lists ONLY projects where the current user is a member.
// Cards link to /projects/project.html?id=<uuid>

import { supabase, requireAuth } from './supabase.js';

const session = await requireAuth();
const me = session.user;

const $ = (s, el = document) => el.querySelector(s);

async function loadProjects() {
  // read via membership to respect RLS and avoid full table reads
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
    console.error('projects load error', error);
    render([]);
    return;
  }
  const rows = (data || []).map(r => r.projects).filter(Boolean);
  render(rows);
}

function render(rows) {
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

await loadProjects();
