// C:\steptags2\js\dashboard.js
import { supabase, requireAuth } from './supabase.js'

const session = await requireAuth()
void session // silences linters if unused
// const userId = session.user.id // keep if needed later

async function listProjects() {
    const { data, error } = await supabase
        .from('projects')
        .select('id,title,description,updated_at,created_by')
        .order('updated_at', { ascending: false })
    if (error) { console.error(error); return [] }
    return data || []
}

function renderProjects(rows) {
    const list = document.querySelector('#projects-list')
    if (!list) return
    list.innerHTML = rows.map(p => `
    <a href="/project.html?id=${p.id}" class="block p-4 rounded-xl bg-white/5 hover:bg-white/10">
      <div class="text-base font-semibold">${p.title ?? '(Untitled)'}</div>
      <div class="text-sm opacity-70">${p.description ?? ''}</div>
      <div class="text-xs opacity-50 mt-1">Updated ${new Date(p.updated_at).toLocaleString()}</div>
    </a>
  `).join('') || `<div class="opacity-70">No projects yet.</div>`
}

renderProjects(await listProjects())

document.querySelector('#btn-new-project')?.addEventListener('click', () => {
    location.href = '/newproject.html'
})

document.querySelector('#btn-logout')?.addEventListener('click', async () => {
    await supabase.auth.signOut()
    location.replace('/login.html')
})
