// C:\steptags2\js\project.js
// Keep original UI. Add hierarchical substeps + nested DnD. Zero flicker.

import { supabase } from './supabase.js';
import {
  getProject, getMembership, canWrite,
  listSteps, createStep, updateStep, reorderSteps,
  subscribeSteps, logActivity, deleteStep,
  listActivities, subscribeActivities,
  getSignedFileURL, fetchProfilesMap, fetchStepsMap
} from './api.js';

const $ = (s, el = document) => el.querySelector(s);
const byId = (id) => document.getElementById(id);
const ESC = (s) => String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const ui2db = { todo: 'open', inprogress: 'in_progress', review: 'review', done: 'done' };
const db2ui = (s) => ({ open: 'todo', in_progress: 'inprogress', review: 'review', done: 'done' }[(s || '').toLowerCase()] || 'todo');

const state = {
  id: null,
  role: 'viewer',
  project: null,
  steps: [],     // flat rows
  tree: null,    // built hierarchy
  unsubSteps: null,
  nestedSortables: new Set(),
  boardOrder: { backlog: [], inprogress: [], review: [], done: [] },
  pendingDelete: null
};

/* ================= Boot ================= */
document.addEventListener('DOMContentLoaded', boot);

function pid() {
  const u = new URL(location.href);
  return u.searchParams.get('id') || u.searchParams.get('project') || null;
}
function toast(msg) {
  const t = document.createElement('div');
  t.className = 'fixed bottom-4 right-4 px-3 py-2 bg-indigo-100 text-indigo-800 rounded-md shadow z-50';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 1800);
}

async function boot() {
  const id = pid(); if (!id) { location.replace('/dashboard.html'); return; }
  state.id = id;

  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user?.id) { location.replace('/login.html'); return; }

  const [proj, mem] = await Promise.all([getProject(id), getMembership(id).catch(() => null)]);
  if (!proj) { toast('No access to project'); location.replace('/dashboard.html'); return; }
  state.project = proj;
  state.role = mem?.role || 'viewer';

  hydrateHeaderTitle();
  await hydrateDescription();

  const stepsHost = byId('steps-tree');
  if (stepsHost) stepsHost.innerHTML = skeletonHtml();

  await loadSteps();
  renderAll();

  wireSettingsModal();
  wireChatModal();
  wrapOpenAddStepModal();

  wireTimelineTab();
  wireBoardTab();
  wireActivityTab();
  startActivityRealtime();

  if (!byId('activity-content')?.classList.contains('hidden')) await renderActivity(false);

  mountStepsRealtime();
}

/* ================ Header / Description ================ */
function hydrateHeaderTitle() {
  const t = state.project?.title || 'Project';
  const h = byId('project-title') || $('[data-project="title"]') || $('h1');
  if (h) h.textContent = t;
}
async function hydrateDescription() {
  const descP = $('#description-content .bg-white.border.border-gray-200.rounded-lg.p-4 p.text-sm') ||
    $('#description-content p.text-sm');
  if (descP) descP.textContent = state.project?.description || 'No description yet.';

  const dueEl = byId('due-date') || $('[name="due_date"]');
  if (dueEl) dueEl.value = state.project?.due_date || '';

  const bgImg = byId('project-bg-img') || byId('bgImg');
  const bg = state.project?.background;
  if (bgImg && bg) {
    try { const url = await getSignedFileURL('project-backgrounds', bg, 3600); if (url) bgImg.src = url; } catch { }
  }
}

/* ================= Data ================= */
async function loadSteps() {
  state.steps = await listSteps(state.id);
  state.tree = buildTree(state.steps);
}
function buildTree(rows) {
  const byParent = new Map();
  for (const r of rows) {
    const key = r.parent_id || 'ROOT';
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(r);
  }
  for (const arr of byParent.values()) arr.sort((a, b) => (a.order_num ?? 0) - (b.order_num ?? 0));
  const makeNode = (row) => ({ row, children: (byParent.get(row.id) || []).map(makeNode) });
  return { row: null, children: (byParent.get('ROOT') || []).map(makeNode) };
}

/* ================= Render ================= */
function renderAll() {
  renderStepsTree();
  initBoardOrderFromTopLevel();
  renderBoardFromTopLevel();
  updateBoardCounts();
}

function skeletonHtml() {
  const row = `
    <div class="rounded-lg border border-gray-200 bg-white p-2 animate-pulse">
      <div class="h-4 w-2/3 bg-gray-200 rounded mb-2"></div>
      <div class="h-3 w-1/3 bg-gray-200 rounded"></div>
    </div>`;
  return row + row + row;
}

/* ---------- Steps Tree using original card visuals ---------- */
function stepsHost() { return byId('steps-tree'); }

function stepRowMarkup(step) {
  const uiStatus = db2ui(step.status);
  const due = step.due_date ? new Date(step.due_date).toISOString().slice(0, 10) : '';
  const title = step.name || '(untitled)';
  return `
  <div class="step-item bg-white p-3 rounded-lg border border-gray-200 relative" data-id="${step.id}" data-parent="${step.parent_id || ''}">
    <div class="flex items-start">
      <button class="mr-2 text-gray-400 hover:text-gray-600 disclose" aria-label="Collapse/Expand" aria-expanded="false">
        <i data-feather="chevron-right" class="w-4 h-4"></i>
      </button>
      <div class="flex-grow">
        <div class="flex items-center">
          <select class="text-xs px-2 py-1 rounded mr-2 status-select" data-field="status">
            <option value="todo" ${uiStatus === 'todo' ? 'selected' : ''}>To Do</option>
            <option value="inprogress" ${uiStatus === 'inprogress' ? 'selected' : ''}>In Progress</option>
            <option value="review" ${uiStatus === 'review' ? 'selected' : ''}>Review</option>
            <option value="done" ${uiStatus === 'done' ? 'selected' : ''}>Done</option>
          </select>
          <input type="text" class="font-medium flex-grow focus:outline-none title" data-field="title" value="${ESC(title)}" />
        </div>
        <div class="mt-2 flex items-center text-xs text-gray-500 flex-wrap gap-x-3 gap-y-1">
          <div class="flex items-center">
            <i data-feather="user" class="w-3 h-3 mr-1"></i>
            <select class="text-xs border-none bg-transparent focus:outline-none" data-field="assignee">
              <option ${!step.assigned_to ? 'selected' : ''}>Unassigned</option>
            </select>
          </div>
          <div class="flex items-center">
            <i data-feather="calendar" class="w-3 h-3 mr-1"></i>
            <input type="text" data-datepicker class="text-xs border-none bg-transparent focus:outline-none due" data-field="due" value="${due}" />
          </div>
          <button type="button" class="flex items-center text-gray-500 hover:text-indigo-700 focus:outline-none" data-action="comments">
            <i data-feather="message-circle" class="w-3 h-3 mr-1"></i><span>Comments</span>
          </button>
        </div>
      </div>
      <div class="step-actions flex space-x-1 ml-2">
        <button class="text-gray-400 hover:text-indigo-600" aria-label="Add substep" data-action="add-substep">
          <i data-feather="plus" class="w-4 h-4"></i>
        </button>
        <button class="text-gray-400 hover:text-indigo-600" aria-label="More" data-action="more">
          <i data-feather="more-vertical" class="w-4 h-4"></i>
        </button>
        <button class="text-gray-400 hover:text-red-500 ml-1" aria-label="Delete step" data-action="delete-step" title="Delete">
          <i data-feather="trash-2" class="w-4 h-4"></i>
        </button>
      </div>
    </div>
    <div class="children pl-6 space-y-2 hidden"></div>
  </div>`;
}

function renderStepsTree() {
  const host = stepsHost(); if (!host || !state.tree) return;

  // destroy previous Sortables
  for (const s of state.nestedSortables) { try { s.destroy(); } catch { } }
  state.nestedSortables.clear();

  host.innerHTML = '';
  const rootList = document.createElement('div');
  rootList.className = 'space-y-2';
  host.appendChild(rootList);

  const build = (node, depth, mount) => {
    for (const child of node.children) {
      const wrapper = document.createElement('div');
      wrapper.innerHTML = stepRowMarkup(child.row);
      const el = wrapper.firstElementChild;
      mount.appendChild(el);

      // disclosure a11y
      const btn = el.querySelector('.disclose');
      const kids = el.querySelector('.children');
      if (child.children.length) {
        btn.setAttribute('aria-expanded', 'true');
        kids.classList.remove('hidden');
        btn.innerHTML = `<i data-feather="chevron-down" class="w-4 h-4"></i>`;
      } else {
        btn.classList.add('invisible');
      }
      btn.addEventListener('click', () => {
        const open = btn.getAttribute('aria-expanded') === 'true';
        btn.setAttribute('aria-expanded', open ? 'false' : 'true'); // required by WAI-ARIA Disclosure. :contentReference[oaicite:0]{index=0}
        kids.classList.toggle('hidden', open);
        btn.innerHTML = `<i data-feather="${open ? 'chevron-right' : 'chevron-down'}" class="w-4 h-4"></i>`;
        window.feather?.replace();
      });

      // field bindings
      const id = el.dataset.id;
      const title = el.querySelector('.title');
      const statusSel = el.querySelector('.status-select');
      const due = el.querySelector('.due');

      title?.addEventListener('change', async () => {
        try { await updateStep(id, { name: title.value.trim() || '(untitled)' }); } catch { toast('Rename failed'); }
      });
      statusSel?.addEventListener('change', async () => {
        const newDb = ui2db[statusSel.value] || 'open';
        try { await updateStep(id, { status: newDb }); const s = state.steps.find(x => x.id === id); if (s) s.status = newDb; renderBoardFromTopLevel(); updateBoardCounts(); }
        catch { toast('Status update failed'); }
      });
      // Flatpickr with week starting Monday
      if (window.flatpickr && due && !due._fp) window.flatpickr(due, {
        dateFormat: 'Y-m-d',
        weekNumbers: true,
        locale: { firstDayOfWeek: 1 } // Monday. Supported by flatpickr via locale. :contentReference[oaicite:1]{index=1}
      });

      el.querySelector('[data-action="add-substep"]')?.addEventListener('click', async () => {
        if (!canWrite(state.role)) return toast('No permission');
        const next = maxOrderAmong(id) + 1;
        try {
          const row = await createStep(state.id, { name: 'New substep', parent_id: id, order_num: next });
          state.steps.push(row);
          state.tree = buildTree(state.steps);
          renderStepsTree();
          renderBoardFromTopLevel();
          updateBoardCounts();
          await logActivity(state.id, 'step_created', 'steps', { step_id: row.id });
        } catch { toast('Create failed'); }
      });

      el.querySelector('[data-action="delete-step"]')?.addEventListener('click', () => handleDelete(id));

      // recurse
      build(child, depth + 1, el.querySelector('.children'));
    }
  };

  build(state.tree, 0, rootList);
  wireNestedSortables(host);
  try { window.feather?.replace(); } catch { }
}

/* Nested Sortable wiring */
function wireNestedSortables(host) {
  const containers = [host.querySelector('.space-y-2'), ...host.querySelectorAll('.children')];
  containers.forEach(el => {
    if (!window.Sortable) return;
    const s = new Sortable(el, {
      group: 'steps-nested',
      animation: 180,
      handle: '.title, .disclose',
      ghostClass: 'drag-ghost',
      chosenClass: 'drag-chosen',
      dragClass: 'is-dragging',
      fallbackOnBody: true,              // Sortable nested guidance. :contentReference[oaicite:2]{index=2}
      swapThreshold: 0.65,
      onAdd: onSortOrAdd,
      onUpdate: onSortOrAdd
    });
    state.nestedSortables.add(s);
  });
}
function onSortOrAdd(evt) {
  const container = evt.to;
  const parentStepEl = container.closest('.step-item');
  const newParentId = parentStepEl ? parentStepEl.dataset.id : null;

  const ids = Array.from(container.children)
    .map(ch => ch.closest('.step-item')?.dataset.id)
    .filter(Boolean);

  const updates = ids.map((id, idx) => ({ id, order_num: idx, parent_id: newParentId }));
  persistReorder(updates);
}
async function persistReorder(updates) {
  try { await reorderSteps(state.id, updates); }
  catch { await loadSteps(); }
  finally {
    state.tree = buildTree(state.steps);
    renderStepsTree();
    renderBoardFromTopLevel();
    updateBoardCounts();
  }
}

function maxOrderAmong(parentId) {
  const sibs = state.steps.filter(s => (s.parent_id || null) === (parentId || null));
  return sibs.reduce((m, s) => Math.max(m, s.order_num ?? 0), -1);
}

/* ---------- Delete with Undo (single row) ---------- */
function showUndoSnackbar({ text = 'Deleted', seconds = 5, onUndo, onElapsed }) {
  document.getElementById('undo-snackbar')?.remove();
  const bar = document.createElement('div');
  bar.id = 'undo-snackbar';
  bar.className = 'fixed bottom-4 left-1/2 -translate-x-1/2 z-[100] bg-gray-900 text-white text-sm rounded-md shadow-lg px-3 py-2 flex items-center gap-3';
  const msg = document.createElement('span'); msg.textContent = text;
  const btn = document.createElement('button'); btn.className = 'underline underline-offset-2';
  let remaining = seconds; btn.textContent = `Undo (${remaining})`;
  bar.append(msg, btn); document.body.appendChild(bar);
  const cleanup = () => { try { bar.remove(); } catch { } };
  const tick = setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) { clearInterval(tick); cleanup(); try { onElapsed?.(); } catch { } }
    else btn.textContent = `Undo (${remaining})`;
  }, 1000);
  btn.addEventListener('click', () => { clearInterval(tick); cleanup(); try { onUndo?.(); } catch { } });
  return { dismiss() { try { cleanup(); } catch { } } };
}
function handleDelete(id) {
  try { state.pendingDelete?.finalizeNow?.(); } catch { }

  const idx = state.steps.findIndex(x => x.id === id);
  const backup = idx >= 0 ? state.steps[idx] : null;

  const removeLocal = () => {
    const i = state.steps.findIndex(s => s.id === id);
    if (i >= 0) state.steps.splice(i, 1);
    state.tree = buildTree(state.steps);
    renderStepsTree();
    renderBoardFromTopLevel();
    updateBoardCounts();
  };
  removeLocal();

  const bar = showUndoSnackbar({
    text: 'Step deleted',
    seconds: 5,
    onUndo: () => {
      state.pendingDelete = null;
      if (backup) { state.steps.push(backup); state.tree = buildTree(state.steps); renderStepsTree(); renderBoardFromTopLevel(); updateBoardCounts(); }
    },
    onElapsed: async () => {
      try { await deleteStep(id); await logActivity(state.id, 'step_deleted', 'steps', { step_id: id }); }
      catch { toast('Delete failed'); if (backup) { state.steps.push(backup); state.tree = buildTree(state.steps); renderStepsTree(); renderBoardFromTopLevel(); updateBoardCounts(); } }
      finally { state.pendingDelete = null; }
    }
  });

  state.pendingDelete = {
    id,
    async finalizeNow() {
      try { bar.dismiss(); } catch { }
      try { await deleteStep(id); await logActivity(state.id, 'step_deleted', 'steps', { step_id: id }); }
      catch { }
      state.pendingDelete = null;
    }
  };
}

/* ================= Timeline ================= */
function wireTimelineTab() {
  const btn = document.querySelector('.tab-button[data-tab="timeline"]');
  if (!btn || btn.dataset.boundTimeline === '1') return;
  btn.dataset.boundTimeline = '1';
  btn.addEventListener('click', () => renderTimelineFromSteps());
}
function renderTimelineFromSteps() {
  const host = byId('timeline-content'); if (!host) return;
  const mountId = 'timeline-mount';
  let mount = byId(mountId);
  if (!mount) { mount = document.createElement('div'); mount.id = mountId; host.appendChild(mount); }
  while (mount.firstChild) mount.removeChild(mount.firstChild);

  const rows = (state?.steps || []).filter(s => !!s.due_date)
    .sort((a, b) => new Date(a.due_date) - new Date(b.due_date));

  if (rows.length === 0) {
    const p = document.createElement('p'); p.className = 'text-sm text-gray-500'; p.textContent = 'No dated steps yet.'; mount.appendChild(p); return;
  }

  const ul = document.createElement('ul'); ul.className = 'space-y-2';
  for (const s of rows) {
    const li = document.createElement('li');
    li.className = 'flex items-start justify-between rounded-lg border border-gray-200 bg-white px-3 py-2';
    li.innerHTML = `
      <div class="min-w-0">
        <p class="text-sm font-medium text-gray-900 truncate">${ESC(s.name || 'Untitled')}</p>
        <p class="text-xs text-gray-500">${(s.status || '').replace('_', ' ')}</p>
      </div>
      <div class="text-sm text-gray-700 ml-3 whitespace-nowrap">${s.due_date}</div>`;
    ul.appendChild(li);
  }
  mount.appendChild(ul);
  try { window.feather?.replace(); } catch { }
}

/* ================= Activity ================= */
function wireActivityTab() {
  const btn = document.querySelector('.tab-button[data-tab="activity"]');
  if (!btn || btn.dataset.boundActivity === '1') return;
  btn.dataset.boundActivity = '1';

  let badge = btn.querySelector('#activity-badge');
  if (!badge) {
    badge = document.createElement('span');
    badge.id = 'activity-badge';
    badge.className = 'ml-2 inline-flex items-center justify-center rounded-full bg-indigo-600 text-white text-xs px-2 py-0.5 hidden';
    badge.textContent = '0';
    btn.appendChild(badge);
  }
  btn.addEventListener('click', () => renderActivity(true));
}
function startActivityRealtime() {
  const btn = document.querySelector('.tab-button[data-tab="activity"]');
  const badge = btn?.querySelector('#activity-badge');
  if (!subscribeActivities || !badge) return;
  const isActiveTab = () => !byId('activity-content')?.classList.contains('hidden');
  if (window.__unsubActivities) { try { window.__unsubActivities(); } catch { } }
  window.__unsubActivities = subscribeActivities(state.id, () => {
    if (isActiveTab()) return;
    const n = Number(badge.textContent || '0') + 1;
    badge.textContent = String(n);
    badge.classList.remove('hidden');
  });
}
function timeAgo(ts) {
  const d = (Date.now() - new Date(ts).getTime()) / 1000;
  if (d < 60) return `${Math.floor(d)}s ago`;
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
}
function buildActivityLine(kind, meta, stepTitle) {
  switch (kind) {
    case 'step_created': return `Step created: ${ESC(stepTitle || meta?.step_name || '')}`;
    case 'step_updated': return `Step updated: ${ESC(stepTitle || meta?.step_name || '')}`;
    case 'step_deleted': return `Step deleted`;
    case 'file_uploaded': return `File uploaded: ${ESC(meta?.name || '')}`;
    case 'member_invited': return `Member invited: ${ESC(meta?.email || '')}`;
    default: return ESC(kind || 'event');
  }
}
function safeJson(x) { try { return typeof x === 'string' ? JSON.parse(x) : x; } catch { return {}; } }
async function resolveAvatarUrl(avatarPath, userId) {
  if (!avatarPath) return `https://i.pravatar.cc/64?u=${encodeURIComponent(userId || '0')}`;
  try { return (await getSignedFileURL('avatars', avatarPath, 3600)) || `https://i.pravatar.cc/64?u=${encodeURIComponent(userId || '0')}`; }
  catch { return `https://i.pravatar.cc/64?u=${encodeURIComponent(userId || '0')}`; }
}
async function renderActivity(openedByUser = false) {
  const host = byId('activity-content'); if (!host || !state?.id) return;

  let rows = []; try { rows = await listActivities(state.id, 100); } catch { rows = []; }

  const actorIds = Array.from(new Set(rows.map(r => r.actor_id).filter(Boolean)));
  const stepIds = Array.from(new Set(rows.map(r => safeJson(r.meta)?.step_id).filter(Boolean)));
  const profiles = await (async () => { try { return await fetchProfilesMap(actorIds); } catch { return new Map(); } })();
  const stepsMap = await (async () => { try { return await fetchStepsMap(stepIds); } catch { return new Map(); } })();

  host.querySelector('.space-y-4')?.classList.add('hidden');

  let mount = byId('activity-live');
  if (!mount) { mount = document.createElement('div'); mount.id = 'activity-live'; host.appendChild(mount); }
  while (mount.firstChild) mount.removeChild(mount.firstChild);

  const badge = document.querySelector('.tab-button[data-tab="activity"] #activity-badge');
  const key = `activity:lastSeen:${state.id}`;
  const lastSeen = Number(localStorage.getItem(key) || '0');
  let unseen = 0;
  const newestTs = rows[0]?.created_at ? new Date(rows[0].created_at).getTime() : 0;

  if (rows.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'text-sm text-gray-500';
    empty.textContent = 'No activity yet.';
    mount.appendChild(empty);
  } else {
    const ul = document.createElement('ul');
    ul.className = 'divide-y divide-gray-200 bg-white rounded-lg border border-gray-200';
    for (const a of rows) {
      const meta = safeJson(a.meta);
      const prof = profiles.get(a.actor_id) || { name: 'User', avatar: '' };
      const stepTitle = meta?.step_id ? (stepsMap.get(meta.step_id) || '') : (meta?.step_name || '');
      if (new Date(a.created_at).getTime() > lastSeen) unseen++;

      const li = document.createElement('li');
      li.className = 'p-3';
      const when = timeAgo(a.created_at);
      const avatarUrl = await resolveAvatarUrl(prof.avatar, a.actor_id);

      li.innerHTML = `
        <div class="flex items-start gap-3">
          <img class="h-8 w-8 rounded-full object-cover bg-gray-100" src="${avatarUrl}" alt="">
          <div class="min-w-0 flex-1">
            <div class="flex items-center justify-between">
              <p class="text-sm font-medium text-gray-900 truncate">${ESC(prof.name)}</p>
              <span class="text-xs text-gray-500 whitespace-nowrap">${when}</span>
            </div>
            <p class="text-sm text-gray-900 mt-0.5">${buildActivityLine(a.kind, meta, stepTitle)}</p>
          </div>
        </div>`;
      ul.appendChild(li);
    }
    mount.appendChild(ul);
  }

  if (badge) {
    if (openedByUser) {
      badge.classList.add('hidden'); badge.textContent = '0';
      if (newestTs) localStorage.setItem(key, String(newestTs));
    } else {
      if (unseen > 0) { badge.textContent = String(unseen); badge.classList.remove('hidden'); }
      else { badge.classList.add('hidden'); }
    }
  }
}

/* ================= Board (top-level only) ================= */
function wireBoardTab() {
  const btn = document.querySelector('.tab-button[data-tab="board"]');
  if (!btn || btn.dataset.boundBoard === '1') return;
  btn.dataset.boundBoard = '1';
  btn.addEventListener('click', () => { try { renderBoardFromTopLevel(); updateBoardCounts(); } catch { } });
}
function groupByStatusTopLevel() {
  const tops = state.steps.filter(s => !s.parent_id);
  const bucket = { backlog: [], inprogress: [], review: [], done: [] };
  for (const s of tops) {
    const ui = ({ open: 'backlog', in_progress: 'inprogress', review: 'review', done: 'done' }[String(s.status).toLowerCase()] || 'backlog');
    bucket[ui].push(s);
  }
  Object.values(bucket).forEach(list => list.sort((a, b) => (a.order_num ?? 0) - (b.order_num ?? 0)));
  return bucket;
}
function initBoardOrderFromTopLevel() {
  const buckets = groupByStatusTopLevel();
  state.boardOrder.backlog = buckets.backlog.map(s => s.id);
  state.boardOrder.inprogress = buckets.inprogress.map(s => s.id);
  state.boardOrder.review = buckets.review.map(s => s.id);
  state.boardOrder.done = buckets.done.map(s => s.id);
}
function ensureSentinel(host) {
  if (!host) return;
  if (!host.querySelector('.board-sentinel')) {
    const s = document.createElement('div');
    s.className = 'board-sentinel h-1';
    host.appendChild(s);
  }
}
function renderBoardFromTopLevel() {
  const cols = {
    backlog: byId('backlog-column'),
    inprogress: byId('inprogress-column'),
    review: byId('review-column'),
    done: byId('done-column')
  };
  const buckets = groupByStatusTopLevel();

  for (const key of Object.keys(state.boardOrder)) {
    const present = new Set(buckets[key].map(s => s.id));
    state.boardOrder[key] = state.boardOrder[key].filter(id => present.has(id));
    for (const s of buckets[key]) if (!state.boardOrder[key].includes(s.id)) state.boardOrder[key].push(s.id);
  }

  for (const [key, host] of Object.entries(cols)) {
    if (!host) continue;
    if (!host.dataset.cleaned) { host.innerHTML = ''; host.dataset.cleaned = '1'; }
    host.innerHTML = '';

    const map = new Map(buckets[key].map(s => [s.id, s]));
    for (const id of state.boardOrder[key]) {
      const row = map.get(id); if (!row) continue;
      const div = document.createElement('div');
      div.className = 'step-card bg-white p-3 rounded-lg shadow-sm border border-gray-200 step-item';
      div.dataset.id = row.id;
      const subCount = state.steps.filter(s => s.parent_id === row.id).length;
      div.innerHTML = `
        <p class="text-sm font-medium ${row.status === 'done' ? 'line-through' : ''}">${ESC(row.name || 'Untitled')}</p>
        <div class="mt-2 flex items-center justify-between">
          <span class="text-xs text-gray-500">${row.due_date ? 'Due ' + row.due_date : ''}</span>
          <span class="text-[10px] text-gray-400">${subCount ? `${subCount} substeps` : ''}</span>
        </div>`;
      host.appendChild(div);
    }

    ensureSentinel(host);

    if (key === 'backlog') {
      const wrapper = host.closest('.bg-gray-50.rounded-lg.p-3');
      const h5 = wrapper?.querySelector('h5');
      if (h5 && h5.textContent.trim() !== 'To Do') h5.textContent = 'To Do';
    }
  }

  try { window.feather?.replace(); } catch { }
  initBoardDnD(cols);
  updateBoardCounts();
}
function updateBoardCounts() {
  const buckets = groupByStatusTopLevel();
  const map = {
    backlog: byId('backlog-column'),
    inprogress: byId('inprogress-column'),
    review: byId('review-column'),
    done: byId('done-column')
  };
  for (const [key, host] of Object.entries(map)) {
    if (!host) continue;
    const wrapper = host.closest('.bg-gray-50.rounded-lg.p-3');
    const countSpan = wrapper?.querySelector('.flex.justify-between span');
    if (countSpan) countSpan.textContent = String(buckets[key].length);
  }
}
function removeIdFromBoard(id) {
  for (const k of Object.keys(state.boardOrder)) state.boardOrder[k] = state.boardOrder[k].filter(x => x !== id);
}
function moveIdBetweenColumns(id, newDbStatus) {
  const key = ({ open: 'backlog', in_progress: 'inprogress', review: 'review', done: 'done' }[String(newDbStatus).toLowerCase()] || 'backlog');
  removeIdFromBoard(id);
  state.boardOrder[key].push(id);
}
function boardKeyFromContainer(el) {
  const id = el?.id || '';
  if (id.startsWith('inprogress')) return 'inprogress';
  if (id.startsWith('review')) return 'review';
  if (id.startsWith('done')) return 'done';
  return 'backlog';
}
function syncBoardOrderFromDOM(cols) {
  for (const [key, host] of Object.entries(cols)) {
    if (!host) continue;
    state.boardOrder[key] = Array.from(host.querySelectorAll('.step-item')).map(n => n.dataset.id);
  }
}
function initBoardDnD(cols) {
  if (!window.Sortable) return;
  const opts = {
    group: { name: 'board', pull: true, put: true },
    sort: true,
    animation: 200,
    emptyInsertThreshold: 24,
    ghostClass: 'opacity-50',
    draggable: '.step-item',
    filter: '.board-sentinel',
    onAdd: async (evt) => {
      const el = evt.item;
      const id = el.dataset.id;
      const toKey = boardKeyFromContainer(evt.to);
      try {
        const db = ({ backlog: 'open', inprogress: 'in_progress', review: 'review', done: 'done' }[toKey]) || 'open';
        await updateStep(id, { status: db });
        const s = state.steps.find(x => x.id === id); if (s) s.status = db;
        syncBoardOrderFromDOM(cols);
        renderBoardFromTopLevel(); updateBoardCounts();
      } catch (e) { console.error(e); }
    },
    onUpdate: () => { syncBoardOrderFromDOM(cols); },
    onEnd: () => { syncBoardOrderFromDOM(cols); updateBoardCounts(); }
  };
  for (const host of Object.values(cols)) {
    if (!host) continue;
    if (host.__sortable) { try { host.__sortable.destroy(); } catch { } host.__sortable = null; }
    ensureSentinel(host);
    host.__sortable = new Sortable(host, opts);
  }
}

/* ================= Realtime: Steps ================= */
function mountStepsRealtime() {
  if (state.unsubSteps) state.unsubSteps();
  let t = null;
  state.unsubSteps = subscribeSteps(state.id, async () => {
    const prev = window.scrollY;
    await loadSteps();
    renderAll();
    window.scrollTo(0, prev);
    clearTimeout(t);
  });
  window.addEventListener('beforeunload', () => { try { state.unsubSteps?.(); } catch { } });
}

/* ================= Add Step modal ================= */
function stepModalEls() {
  const root = byId('step-modal'); if (!root) return null;
  const nameI = root.querySelector('input[type="text"]:not([data-datepicker])');
  const notesI = root.querySelector('textarea');
  const statusI = root.querySelector('select');
  const dueI = root.querySelector('input[data-datepicker]') || root.querySelector('input[type="date"]');
  const saveBtn = root.querySelector('.bg-gray-50 button.bg-indigo-600');
  return { root, nameI, notesI, statusI, dueI, saveBtn };
}
function bindStepModalSaveOnce() {
  const els = stepModalEls(); if (!els) return;
  if (window.flatpickr && els.dueI && !els.dueI._fp) window.flatpickr(els.dueI, {
    dateFormat: 'Y-m-d',
    weekNumbers: true,
    locale: { firstDayOfWeek: 1 } // Monday. :contentReference[oaicite:3]{index=3}
  });
  const onSave = async (e) => {
    e.preventDefault();
    if (!canWrite(state.role)) return toast('You cannot add steps');
    if (!els.nameI?.value?.trim()) { toast('Title required'); els.nameI?.focus(); return; }
    try {
      const order = maxOrderAmong(null) + 1;
      const payload = {
        name: els.nameI.value.trim(),
        notes: els.notesI?.value?.trim() || null,
        status: ui2db[(els.statusI?.value || 'todo').toLowerCase()] || 'open',
        due_date: els.dueI?.value || null,
        order_num: order,
        parent_id: null
      };
      const row = await createStep(state.id, payload);
      state.steps.push(row);
      state.tree = buildTree(state.steps);
      renderStepsTree();
      renderBoardFromTopLevel();
      updateBoardCounts();
      await logActivity(state.id, 'step_created', 'steps', { step_id: row.id });
      window.closeStepModal?.();
    } catch { toast('Create failed'); }
  };
  els.saveBtn?.addEventListener('click', onSave, { once: true });
}
function wrapOpenAddStepModal() {
  const existing = window.openAddStepModal;
  window.openAddStepModal = function wrapped() {
    if (typeof existing === 'function') existing();
    bindStepModalSaveOnce();
  };
}
window.closeStepModal = window.closeStepModal || (() => {
  const m = byId('step-modal');
  if (m) { m.classList.add('hidden'); document.documentElement.classList.remove('overflow-hidden'); }
});

/* ================= Settings / Chat Modals ================= */
function wireSettingsModal() {
  const btn = byId('settings-open'), modal = byId('settings-modal'), frame = byId('settings-frame');
  if (!btn || !modal || !frame) return;
  if (btn.dataset.bound === '1') return;
  btn.dataset.bound = '1';
  btn.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    frame.src = `/projects/settings.html?id=${encodeURIComponent(state.id)}`;
    document.documentElement.classList.add('overflow-hidden'); modal.classList.remove('hidden');
  });
  window.closeSettingsModal = () => { document.documentElement.classList.remove('overflow-hidden'); modal.classList.add('hidden'); };
}
function wireChatModal() {
  const btn = byId('chat-open'), modal = byId('chat-modal'), frame = byId('chat-frame');
  if (!btn || !modal || !frame) return;
  if (btn.dataset.bound === '1') return;
  btn.dataset.bound = '1';
  btn.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    frame.src = `/projects/chat.html?id=${encodeURIComponent(state.id)}`;
    document.documentElement.classList.add('overflow-hidden'); modal.classList.remove('hidden');
  });
  window.closeChatModal = () => { document.documentElement.classList.remove('overflow-hidden'); modal.classList.add('hidden'); };
}

/* ================= Invite accept (no-op if absent) ================= */
(function acceptInviteIfPresent() {
  const u = new URL(location.href);
  const token = u.searchParams.get('invite');
  const id = u.searchParams.get('id');
  if (!token || !id) return;
  import('./api.js').then(({ acceptInvite }) => { acceptInvite(id, token).catch(() => { }); });
})();
