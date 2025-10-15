// C:\steptags2\js\dashboard.js
// Dashboard: RLS-driven list + robust card navigation (no UI changes)
import { supabase } from './supabase.js';

const $ = (s, el = document) => el.querySelector(s);
const listEl = $('#projects-list');
const tpl = $('#project-card-tpl');

function clear(el) { if (!el) return; while (el.firstChild) el.removeChild(el.firstChild); }

function renderEmpty() {
  clear(listEl);
  const empty = document.createElement('div');
  empty.className = 'col-span-full text-center text-gray-500 py-16';
  empty.innerHTML = `
    <div class="mx-auto w-12 h-12 rounded-2xl bg-gray-100 flex items-center justify-center mb-4">
      <i data-feather="folder"></i>
    </div>
    <p class="text-sm">No projects yet.</p>
  `;
  listEl.appendChild(empty);
  window.feather?.replace();
}

function renderProjects(rows) {
  clear(listEl);
  if (!rows || rows.length === 0) { renderEmpty(); return; }

  for (const p of rows) {
    const node = tpl.content.firstElementChild.cloneNode(true);

    // Optional “Manage Team” trigger: if a global opener exists, use it; else let anchor navigate.
    const manage = node.querySelector('[data-prop="manageTeam"]');
    if (manage) {
      manage.href = `/projects/project.html?id=${encodeURIComponent(p.id)}`;
      manage.addEventListener('click', (e) => {
        const opener = window.__openTeamModal;
        if (typeof opener === 'function') {
          e.preventDefault();
          opener(p.title ?? 'Project');
        }
        // else default navigation
      });
    }

    // Fill fields
    const tEl = node.querySelector('[data-prop="title"]');
    if (tEl) tEl.textContent = p.title || 'Untitled project';
    const dEl = node.querySelector('[data-prop="description"]');
    if (dEl) dEl.textContent = p.description || '';

    // Canonical URL
    const url = `/projects/project.html?id=${encodeURIComponent(p.id)}`;

    // Prefer existing anchor in template
    const a = node.querySelector('a[href]');
    if (a) a.href = url;

    // Mark card for delegated navigation
    node.dataset.projectId = p.id;

    // Keyboard access without style change
    if (!node.hasAttribute('tabindex')) node.setAttribute('tabindex', '0');
    if (!node.hasAttribute('role')) node.setAttribute('role', 'link');

    listEl.appendChild(node);
  }
  window.feather?.replace();
}

async function waitForSession() {
  const { data } = await supabase.auth.getSession();
  if (data?.session?.user?.id) return data.session;
  return await new Promise((resolve) => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => {
      if (s?.user?.id) { subscription.unsubscribe(); resolve(s); }
    });
    setTimeout(() => resolve(null), 800);
  });
}

async function loadProjects() {
  const sess = await waitForSession();
  if (!sess?.user?.id) { renderEmpty(); return; }

  const { data, error } = await supabase
    .from('projects')
    .select('id,title,description')
    .limit(100);

  if (error) {
    console.error('Projects query failed:', error);
    renderEmpty();
    return;
  }
  renderProjects(data);
}

/* Delegated navigation: click or Enter anywhere on a card */
function openProject(id) {
  if (!id) return;
  window.location.href = `/projects/project.html?id=${encodeURIComponent(id)}`;
}

listEl.addEventListener('click', (e) => {
  // Ignore clicks on explicit interactive elements inside cards
  if (e.target.closest('a,button,[role="button"],input,select,textarea,[data-no-nav]')) return;

  const card = e.target.closest('[data-project-id]');
  if (!card) return;

  // If user clicked an <a>, let browser handle it
  const anchor = e.target.closest('a[href]');
  if (anchor && anchor.href) return;

  openProject(card.dataset.projectId);
});

listEl.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const card = e.target.closest('[data-project-id]');
  if (!card) return;
  openProject(card.dataset.projectId);
});

await loadProjects();
