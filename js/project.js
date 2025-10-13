// C:\steptags2\js\project.js
// Live wiring for Project workspace. Defensive to existing markup.
// Requires: /js/supabase.js exporting { supabase, requireAuth }.
// Buckets: avatars, project-files (private). URL param: ?id=<project_uuid>.

import { supabase, requireAuth } from './supabase.js';

const session = await requireAuth();
const me = session.user;
const qs = new URLSearchParams(location.search);
const projectId = qs.get('id');
if (!projectId) {
  alert('Missing ?id=PROJECT_ID');
  location.replace('/dashboard.html');
  throw new Error('no project id');
}

// ---------- small helpers ----------
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString() : '—');
const nowISO = () => new Date().toISOString();
const safe = (v) => (v ?? '');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function signedFrom(bucket, path, secs = 3600) {
  if (!path) return null;
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, secs);
  return error ? null : data?.signedUrl || null;
}

function humanSize(b) {
  if (b == null) return '';
  const u = ['B','KB','MB','GB','TB']; let i = 0; let n = b;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n < 10 && i ? 1 : 0)} ${u[i]}`;
}

function setText(id, txt) { const el = document.getElementById(id); if (el) el.textContent = txt; }
function setValue(id, val) { const el = document.getElementById(id); if (el) el.value = val ?? ''; }

// ---------- state ----------
let project = null;
let members = [];
let steps = [];
let files = [];
let undoBin = []; // [{type:'step', row, when: Date}]

// ---------- load ----------
await loadProject();
await loadMembers();
await loadSteps();
await loadFiles();
await loadActivities();

renderProjectMeta();
renderDescription();
renderSteps();
renderBoard();
renderTimeline();
renderFiles();
refreshIcons();

// ---------- header hydration minimal (name/avatar) ----------
try {
  const { data: prof } = await supabase.from('profiles').select('display_name,avatar_path,email').eq('id', me.id).maybeSingle();
  const nm = $('#hdr-name'); if (nm) nm.textContent = prof?.display_name || me.email || 'User';
  const av = $('#hdr-avatar'); if (av && prof?.avatar_path) {
    const url = await signedFrom('avatars', prof.avatar_path);
    if (url) av.src = url;
  }
} catch { /* noop */ }
$('#logout-link')?.addEventListener('click', async (e) => { e.preventDefault(); await supabase.auth.signOut(); location.replace('/login.html'); });

// ---------- tabs (if your DOM has .tab-btn and #tab-*) ----------
(function initTabs() {
  const tabBtns = $$('.tab-btn');
  if (!tabBtns.length) return;
  const set = (k) => {
    tabBtns.forEach(b => {
      const on = b.dataset.tab === k;
      b.classList.toggle('tab-active', on);
      const p = document.getElementById('tab-' + b.dataset.tab);
      if (p) p.classList.toggle('hidden', !on);
    });
    refreshIcons();
  };
  tabBtns.forEach(b => b.addEventListener('click', () => set(b.dataset.tab)));
  set('description');
})();

// ---------- settings modal open (if present) ----------
$('#settings-open')?.addEventListener('click', () => $('#settings-modal')?.classList.remove('hidden'));

// ---------- project ----------
async function loadProject() {
  const { data, error } = await supabase
    .from('projects')
    .select('id,title,description,start_date,due_date,bg_path,created_by,updated_at')
    .eq('id', projectId)
    .maybeSingle();
  if (error) throw error;
  project = data;
}

function renderProjectMeta() {
  setText('p-title', safe(project?.title) || '(Untitled)');
  setText('p-title-inline', safe(project?.title) || '(Untitled)');
  setText('p-desc', safe(project?.description));
  setText('p-start', fmtDate(project?.start_date));
  setText('p-due', fmtDate(project?.due_date));
  setText('p-id', `id=${projectId}`);
  // progress
  const total = steps.length;
  const done = steps.filter(s => s.done).length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const bar = $('#p-progress'); if (bar) bar.style.width = `${pct}%`;
  setText('p-progress-label', `${pct}% complete`);
}

function renderDescription() {
  const form = $('#desc-form');
  if (!form) return;
  setValue('f_title', project?.title);
  setValue('f_desc', project?.description);
  setValue('f_start', project?.start_date);
  setValue('f_due', project?.due_date);

  // date pickers if flatpickr present
  if (window.flatpickr) {
    flatpickr('#f_start', { dateFormat: 'Y-m-d', weekNumbers: true, locale: { firstDayOfWeek: 1 } });
    flatpickr('#f_due', { dateFormat: 'Y-m-d', weekNumbers: true, locale: { firstDayOfWeek: 1 } });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const patch = {
      title: String(fd.get('title') || '').trim() || '(Untitled)',
      description: String(fd.get('description') || '').trim() || null,
      start_date: fd.get('start_date') || null,
      due_date: fd.get('due_date') || null,
      updated_at: nowISO(),
    };
    const { error } = await supabase.from('projects').update(patch).eq('id', projectId);
    const status = $('#desc-status');
    if (error) { if (status) status.textContent = error.message; return; }
    if (status) { status.textContent = 'Saved'; setTimeout(() => status.textContent = '', 1200); }
    await loadProject();
    renderProjectMeta();
  });
}

// ---------- team ----------
async function loadMembers() {
  const { data, error } = await supabase
    .from('project_members')
    .select('role,user_id,profiles:profiles!project_members_user_id_fkey(display_name,email,avatar_path)')
    .eq('project_id', projectId);
  if (error) { members = []; return; }
  members = data || [];
  const list = $('#team-list'); const tpl = $('#team-item-tpl');
  if (!list || !tpl) return;
  list.innerHTML = '';
  for (const m of members) {
    const node = tpl.content.cloneNode(true);
    node.querySelector('[data-prop="name"]').textContent = m.profiles?.display_name || 'Member';
    node.querySelector('[data-prop="email"]').textContent = m.profiles?.email || '';
    node.querySelector('[data-prop="role"]').textContent = m.role || '';
    const img = node.querySelector('[data-prop="avatar"]');
    if (m.profiles?.avatar_path) {
      const url = await signedFrom('avatars', m.profiles.avatar_path);
      img.src = url || 'https://i.pravatar.cc/64?img=1';
    } else img.src = 'https://i.pravatar.cc/64?img=1';
    list.appendChild(node);
  }
}
$('#btn-invite')?.addEventListener('click', () => alert('Invite flow handled elsewhere.'));

// ---------- steps ----------
async function loadSteps() {
  const { data, error } = await supabase
    .from('steps')
    .select('id,project_id,parent_id,title,assignee_id,status,done,due_date,order_num,created_at,updated_at')
    .eq('project_id', projectId)
    .order('parent_id', { ascending: true })
    .order('order_num', { ascending: true });
  if (error) { steps = []; return; }
  steps = data || [];
}

const statusTokenToLabel = (t) => {
  switch ((t || '').toLowerCase()) {
    case 'open':
    case 'todo': return 'To Do';
    case 'in_progress':
    case 'inprogress': return 'In Progress';
    case 'review': return 'In Review';
    case 'done': return 'Done';
    default: return 'To Do';
  }
};
const statusLabelToToken = (lbl) => {
  const x = (lbl || '').toLowerCase();
  if (x.startsWith('to do')) return 'open';
  if (x.startsWith('in progress')) return 'in_progress';
  if (x.startsWith('in review') || x === 'review') return 'review';
  if (x === 'done') return 'done';
  return 'open';
};

function childrenOf(pid) {
  return steps.filter(s => s.parent_id === pid).sort((a,b)=> (a.order_num??0)-(b.order_num??0));
}

function renderSteps() {
  const host = $('#stepsTree'); if (!host) return;
  host.innerHTML = '';

  const renderBranch = (pid, container) => {
    for (const s of childrenOf(pid)) {
      const li = document.createElement('li');
      li.dataset.id = s.id;
      li.innerHTML = `
        <div class="group flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-gray-50">
          <button class="toggle w-4 h-4 text-gray-400" aria-label="expand/collapse"></button>
          <input type="checkbox" class="chk rounded" ${s.done ? 'checked' : ''} />
          <input class="title flex-1 bg-transparent outline-none text-sm px-1 py-0.5 rounded focus:ring" value="${(s.title||'').replace(/"/g,'&quot;')}" />
          <span class="status-pill px-1.5 py-0.5 rounded border bg-gray-50">${statusTokenToLabel(s.status)}</span>
          <button class="date px-2 py-0.5 text-xs rounded bg-gray-100 border">${s.due_date || 'Due'}</button>
          <button class="add-sub text-xs px-2 py-1 rounded bg-gray-200">+ substep</button>
          <button class="del text-xs px-2 py-1 rounded bg-red-50 text-red-700 opacity-0 group-hover:opacity-100">Delete</button>
        </div>
        <ul class="ml-5 pl-3 border-l border-gray-200 space-y-1 hidden"></ul>
      `;
      const ul = li.querySelector('ul');

      // expand control
      const kids = childrenOf(s.id).length;
      const toggle = li.querySelector('.toggle');
      toggle.textContent = kids ? '▾' : '';
      toggle.dataset.state = 'open';
      toggle.addEventListener('click', () => {
        const open = toggle.dataset.state !== 'closed';
        toggle.dataset.state = open ? 'closed' : 'open';
        toggle.textContent = kids ? (open ? '▸' : '▾') : '';
        ul.classList.toggle('hidden', open);
      });
      if (kids) ul.classList.remove('hidden');

      // checkbox
      li.querySelector('.chk').addEventListener('change', async (e) => {
        const { error } = await supabase.from('steps').update({ done: e.target.checked, updated_at: nowISO() }).eq('id', s.id);
        if (error) { e.target.checked = !e.target.checked; alert(error.message); return; }
        s.done = e.target.checked;
        renderProjectMeta();
        insertActivity('step.toggle', 'steps', { id: s.id, title: s.title, done: s.done });
      });

      // title edit
      li.querySelector('.title').addEventListener('change', async (e) => {
        const title = e.target.value.trim() || 'Untitled';
        const { error } = await supabase.from('steps').update({ title, updated_at: nowISO() }).eq('id', s.id);
        if (error) { alert(error.message); e.target.value = s.title; return; }
        s.title = title;
        insertActivity('step.edit', 'steps', { id: s.id, title });
      });

      // status cycle on click
      li.querySelector('.status-pill').addEventListener('click', async (e) => {
        const order = ['To Do','In Progress','In Review','Done'];
        const cur = e.currentTarget.textContent.trim();
        const idx = order.indexOf(cur);
        const next = order[(idx + 1) % order.length];
        const token = statusLabelToToken(next);
        const { error } = await supabase.from('steps').update({ status: token, updated_at: nowISO() }).eq('id', s.id);
        if (error) { alert(error.message); return; }
        s.status = token; e.currentTarget.textContent = next;
        renderBoard(); insertActivity('step.status', 'steps', { id: s.id, status: token });
      });

      // due date picker
      li.querySelector('.date').addEventListener('click', (ev) => {
        if (!window.flatpickr) return;
        flatpickr(ev.currentTarget, {
          dateFormat: 'Y-m-d', defaultDate: s.due_date || null, weekNumbers: true, locale: { firstDayOfWeek: 1 },
          onChange: async (sel) => {
            const vv = sel[0] ? sel[0].toISOString().slice(0,10) : null;
            const { error } = await supabase.from('steps').update({ due_date: vv, updated_at: nowISO() }).eq('id', s.id);
            if (error) { alert(error.message); return; }
            s.due_date = vv; ev.currentTarget.textContent = vv || 'Due';
            renderTimeline(); insertActivity('step.date', 'steps', { id: s.id, due_date: vv });
          }
        }).open();
      });

      // add substep
      li.querySelector('.add-sub').addEventListener('click', async () => {
        const orderNum = childrenOf(s.id).length;
        const ins = { project_id: projectId, parent_id: s.id, title: 'New substep', status: 'open', done: false, order_num: orderNum };
        const { data, error } = await supabase.from('steps').insert(ins).select('id').single();
        if (error) { alert(error.message); return; }
        await loadSteps(); renderSteps(); renderBoard(); renderTimeline(); renderProjectMeta();
        insertActivity('step.add', 'steps', { id: data.id, parent_id: s.id });
      });

      // delete with 5s undo
      li.querySelector('.del').addEventListener('click', async () => {
        const ids = [s.id, ...collectDescendantIds(s.id)];
        const rows = steps.filter(x => ids.includes(x.id));
        undoBin.push({ type: 'step', rows, when: Date.now() });
        showUndoBanner(`${rows.length} item(s) deleted`, async () => {
          // undo: reinsert rows (topological by parent)
          for (const r of rows) {
            const payload = { ...r }; delete payload.created_at; delete payload.updated_at;
            await supabase.from('steps').insert(payload);
          }
          await loadSteps(); renderSteps(); renderBoard(); renderTimeline(); renderProjectMeta();
        });
        // perform delete after 5s if not undone
        await sleep(5000);
        // if still present in undoBin, commit deletion
        if (undoBin.find(u => u.type === 'step' && u.rows[0].id === s.id)) {
          const { error } = await supabase.from('steps').delete().in('id', ids);
          if (error) { alert(error.message); }
          undoBin = undoBin.filter(u => !(u.type === 'step' && u.rows[0].id === s.id));
          await loadSteps(); renderSteps(); renderBoard(); renderProjectMeta();
          insertActivity('step.delete', 'steps', { ids });
        }
      });

      container.appendChild(li);
      renderBranch(s.id, ul);
    }
  };
  renderBranch(null, host);

  // optional Sortable ordering for top-level items
  if (window.Sortable) {
    new Sortable(host, {
      animation: 150,
      onEnd: async () => {
        const ids = $$('#stepsTree > li').map(li => li.dataset.id);
        for (let i = 0; i < ids.length; i++) {
          await supabase.from('steps').update({ order_num: i, parent_id: null, updated_at: nowISO() }).eq('id', ids[i]);
        }
        await loadSteps(); renderBoard(); renderTimeline();
      }
    });
  }
  refreshIcons();
}

function collectDescendantIds(pid) {
  const acc = [];
  (function rec(id){ childrenOf(id).forEach(ch => { acc.push(ch.id); rec(ch.id); }); })(pid);
  return acc;
}

// add top-level step
$('#addStepBtn')?.addEventListener('click', async () => {
  const order = childrenOf(null).length;
  const { data, error } = await supabase.from('steps').insert({
    project_id: projectId, parent_id: null, title: 'New step', status: 'open', done: false, order_num: order
  }).select('id').single();
  if (error) { alert(error.message); return; }
  await loadSteps(); renderSteps(); renderBoard(); renderTimeline(); renderProjectMeta();
  insertActivity('step.add', 'steps', { id: data.id });
});

// bulk import (if modal exists)
$('#bulkImportBtn')?.addEventListener('click', () => $('#modalImport')?.showModal());
$('#m_import_apply')?.addEventListener('click', async (e) => {
  e.preventDefault();
  const text = $('#m_import_text')?.value || '';
  const lines = text.split('\n');
  const stack = [null];
  const rows = [];
  for (const raw of lines) {
    const line = raw.replace(/\t/g, '  ');
    if (!line.trim()) continue;
    const indent = ((line.match(/^(\s*)/)?.[0].length) || 0) / 2;
    const title = line.replace(/^\s*[-*]?\s*/, '').trim() || 'Untitled';
    const parent_id = stack[indent] ?? null;
    const order_num = rows.filter(r => r.parent_id === parent_id).length;
    rows.push({ project_id: projectId, parent_id, title, status: 'open', done: false, order_num });
    stack[indent + 1] = 'tmp' + rows.length;
    stack.length = indent + 2;
  }
  for (const r of rows) {
    const payload = { ...r };
    if (String(payload.parent_id || '').startsWith('tmp')) payload.parent_id = null;
    await supabase.from('steps').insert(payload);
  }
  $('#modalImport')?.close();
  await loadSteps(); renderSteps(); renderBoard(); renderTimeline(); renderProjectMeta();
  insertActivity('step.import', 'steps', { count: rows.length });
});

// ---------- board ----------
function renderBoard() {
  const host = $('#boardColumns'); if (!host) return;
  host.innerHTML = '';
  const cols = [
    { key: 'open', title: 'To Do' },
    { key: 'in_progress', title: 'In Progress' },
    { key: 'review', title: 'In Review' },
    { key: 'done', title: 'Done' }
  ];
  for (const c of cols) {
    const col = document.createElement('div');
    col.className = 'rounded-xl bg-gray-50 border border-gray-200 p-2 flex flex-col min-h-[16rem]';
    col.dataset.col = c.key;
    col.innerHTML = `<header class="text-xs font-semibold px-1 py-1">${c.title}</header><div class="flex-1 space-y-2" data-zone></div>`;
    host.appendChild(col);
  }
  // cards: only top-level
  steps.filter(s => s.parent_id === null).forEach(s => {
    const zone = host.querySelector(`[data-col="${s.status || 'open'}"] [data-zone]`) || host.querySelector('[data-col="open"] [data-zone]');
    const card = document.createElement('div');
    card.className = 'rounded-lg bg-white shadow p-2 text-sm border cursor-move';
    card.draggable = true;
    card.dataset.id = s.id;
    card.innerHTML = `
      <div class="flex items-center justify-between gap-2">
        <span class="${s.done ? 'line-through text-gray-400':''}">${s.title}</span>
        <span class="text-[10px] px-1.5 py-0.5 rounded border bg-gray-50">${statusTokenToLabel(s.status)}</span>
      </div>`;
    zone?.appendChild(card);
    card.addEventListener('dragstart', ev => { ev.dataTransfer.setData('text/plain', s.id); ev.dataTransfer.effectAllowed='move'; });
  });
  $$('#boardColumns [data-zone]').forEach(zone => {
    zone.addEventListener('dragover', e => e.preventDefault());
    zone.addEventListener('drop', async (e) => {
      e.preventDefault();
      const id = e.dataTransfer.getData('text/plain');
      const s = steps.find(x => x.id === id);
      if (!s) return;
      const col = e.currentTarget.closest('[data-col]').dataset.col;
      if (s.status === col) return;
      const { error } = await supabase.from('steps').update({ status: col, updated_at: nowISO() }).eq('id', id);
      if (error) { alert(error.message); return; }
      s.status = col; renderBoard();
      insertActivity('step.move', 'steps', { id, status: col });
    });
  });
}

// ---------- timeline (simple) ----------
function renderTimeline() {
  const wrap = $('#timelineCanvas'); if (!wrap) return;
  wrap.innerHTML = '';
  const tops = steps.filter(s => s.parent_id === null);
  const box = document.createElement('div'); box.className = 'relative h-[200px]';
  tops.forEach((s, i) => {
    const bar = document.createElement('div');
    bar.className = 'absolute left-0 right-10 h-6 rounded bg-gray-200 border';
    bar.style.top = `${10 + i * 28}px`;
    const d = s.due_date ? new Date(s.due_date) : null;
    const day = d ? ((d.getDay() || 7)) : 7; // 1..7
    const pct = (day - 1) / 6;
    bar.style.marginLeft = `calc(${pct * 100}% - 0px)`;
    bar.style.width = '30%';
    bar.title = `${s.title}${s.due_date ? ` • ${s.due_date}` : ''}`;
    box.appendChild(bar);
  });
  wrap.appendChild(box);
}

// ---------- files ----------
async function loadFiles() {
  const { data, error } = await supabase
    .from('files')
    .select('id,project_id,name,mime,size,path,uploaded_by,created_at')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) { files = []; return; }
  files = data || [];
}

async function renderFiles() {
  const list = $('#fileList'); if (!list) return;
  const tpl = $('#file-item-tpl');
  list.innerHTML = '';
  for (const f of files) {
    let url = await signedFrom('project-files', f.path);
    const li = tpl ? tpl.content.cloneNode(true) : document.createElement('li');
    if (!tpl) li.className = 'p-3 flex items-center gap-3';
    const a = tpl ? li.querySelector('[data-prop="name"]') : (()=>{ const a=document.createElement('a'); a.className='text-sm text-indigo-700 hover:text-indigo-900'; li.appendChild(a); return a; })();
    a.textContent = f.name; a.href = url || '#'; a.target = '_blank'; a.rel = 'noopener';
    const sz = tpl ? li.querySelector('[data-prop="size"]') : (()=>{ const sp=document.createElement('span'); sp.className='text-xs text-gray-500'; li.appendChild(sp); return sp; })();
    sz.textContent = humanSize(f.size);
    const by = tpl ? li.querySelector('[data-prop="by"]') : (()=>{ const sp=document.createElement('span'); sp.className='text-xs text-gray-500 ml-auto'; li.appendChild(sp); return sp; })();
    try {
      const { data: p } = await supabase.from('profiles').select('display_name,email').eq('id', f.uploaded_by).maybeSingle();
      by.textContent = p ? `by ${p.display_name || p.email || ''}` : '';
    } catch {}
    list.appendChild(li);
  }
  refreshIcons();
}

$('#file-browse')?.addEventListener('click', () => $('#file-input')?.click());
$('#file-input')?.addEventListener('change', (e) => handleFiles([...e.target.files || []]));
const drop = $('#dropzone');
if (drop) {
  ['dragover','dragenter'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('active'); }));
  ['dragleave','drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('active'); }));
  drop.addEventListener('drop', (e) => handleFiles([...e.dataTransfer.files || []]));
}

async function handleFiles(list) {
  if (!list.length) return;
  for (const f of list) {
    const path = `${projectId}/${Date.now()}_${f.name.replace(/[^\w.\- ]+/g,'_')}`;
    const up = await supabase.storage.from('project-files').upload(path, f, { upsert: false });
    if (up.error) { alert(up.error.message); continue; }
    const row = { project_id: projectId, name: f.name, mime: f.type || 'application/octet-stream', size: f.size, path, uploaded_by: me.id };
    const { error } = await supabase.from('files').insert(row);
    if (error) alert(error.message); else insertActivity('file.add', 'files', { name: f.name, size: f.size });
  }
  await loadFiles(); renderFiles();
}

// ---------- activity ----------
async function loadActivities() {
  const list = $('#activityFeed'); if (!list) return;
  const { data, error } = await supabase
    .from('activities')
    .select('id,actor_id,kind,ref_table,meta,created_at,profiles:profiles!activities_actor_id_fkey(display_name,avatar_path)')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) return;
  list.innerHTML = '';
  const tpl = $('#activity-item-tpl');
  for (const r of (data || [])) {
    const node = tpl ? tpl.content.cloneNode(true) : document.createElement('li');
    if (!tpl) node.className = 'p-3 flex items-start gap-3';
    const line = tpl ? node.querySelector('[data-prop="line"]') : (()=>{ const p=document.createElement('p'); p.className='text-sm'; node.appendChild(p); return p; })();
    const when = tpl ? node.querySelector('[data-prop="when"]') : (()=>{ const p=document.createElement('p'); p.className='text-xs text-gray-400'; node.appendChild(p); return p; })();
    const avatar = tpl ? node.querySelector('[data-prop="avatar"]') : null;
    line.textContent = r.kind || 'activity';
    when.textContent = new Date(r.created_at).toLocaleString();
    if (avatar) {
      if (r.profiles?.avatar_path) {
        const url = await signedFrom('avatars', r.profiles.avatar_path);
        if (url) avatar.src = url;
      } else avatar.src = 'https://i.pravatar.cc/64?img=2';
    }
    list.appendChild(node);
  }
}

async function insertActivity(kind, ref_table, meta) {
  await supabase.from('activities').insert({ project_id: projectId, actor_id: me.id, kind, ref_table, meta });
  // Best effort refresh
  loadActivities();
}

// ---------- realtime ----------
const ch = supabase
  .channel(`steps-${projectId}`)
  .on('postgres_changes', { event: '*', schema: 'public', table: 'steps', filter: `project_id=eq.${projectId}` }, async () => {
    await loadSteps();
    renderSteps(); renderBoard(); renderTimeline(); renderProjectMeta();
  })
  .subscribe();

// ---------- misc ----------
function showUndoBanner(text, onUndo) {
  let bar = document.getElementById('undo-bar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'undo-bar';
    bar.className = 'fixed bottom-4 left-1/2 -translate-x-1/2 bg-white border shadow-lg rounded-lg px-4 py-2 flex items-center gap-3 z-50';
    document.body.appendChild(bar);
  }
  bar.innerHTML = `<span class="text-sm">${text}</span><button id="undo-btn" class="text-sm text-indigo-700 hover:text-indigo-900 underline">Undo</button>`;
  $('#undo-btn', bar)?.addEventListener('click', async () => {
    const entry = undoBin.pop();
    if (entry && typeof onUndo === 'function') await onUndo();
    bar.remove();
  });
  setTimeout(() => { if (document.body.contains(bar)) bar.remove(); }, 5200);
}

function refreshIcons() { try { window.feather && window.feather.replace(); } catch {} }

// keep icons refreshed after mutations
new MutationObserver(() => refreshIcons()).observe(document.body, { childList: true, subtree: true });
