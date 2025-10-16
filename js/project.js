// C:\steptags2\js\project.js
// Wire project page to real data using existing DOM (no HTML edits).
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

const ui2db = { todo: 'open', inprogress: 'in_progress', review: 'review', done: 'done' };
const db2ui = (s) => ({ open: 'todo', in_progress: 'inprogress', review: 'review', done: 'done' }[(s || '').toLowerCase()] || 'todo');

const state = {
  id: null,
  role: 'viewer',
  project: null,
  steps: [],
  unsub: null,
  sortableSteps: null,
  boardOrder: { backlog: [], inprogress: [], review: [], done: [] },
  pendingDelete: null, // { id, restore, finalizeNow() }
};



function pid() {
  const u = new URL(location.href);
  return u.searchParams.get('id') || u.searchParams.get('project') || null;
}
function toast(msg) {
  const t = document.createElement('div');
  t.className = 'fixed bottom-4 right-4 px-3 py-2 bg-indigo-100 text-indigo-800 rounded-md shadow z-50';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2000);
}

/* Snackbar with countdown + Undo. Single instance. */
function showUndoSnackbar({ text = 'Deleted', seconds = 5, onUndo, onElapsed }) {
  // remove previous
  document.getElementById('undo-snackbar')?.remove();

  const bar = document.createElement('div');
  bar.id = 'undo-snackbar';
  bar.className = 'fixed bottom-4 left-1/2 -translate-x-1/2 z-[100] bg-gray-900 text-white text-sm rounded-md shadow-lg px-3 py-2 flex items-center gap-3';
  const msg = document.createElement('span'); msg.textContent = text;
  const btn = document.createElement('button'); btn.className = 'underline underline-offset-2';
  let remaining = seconds; btn.textContent = `Undo (${remaining})`;

  bar.append(msg, btn);
  document.body.appendChild(bar);

  const cleanup = () => { try { bar.remove(); } catch { } };
  const tick = setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) {
      clearInterval(tick);
      cleanup();
      try { onElapsed?.(); } catch { }
    } else {
      btn.textContent = `Undo (${remaining})`;
    }
  }, 1000);

  btn.addEventListener('click', () => {
    clearInterval(tick);
    cleanup();
    try { onUndo?.(); } catch { }
  });

  return { dismiss() { clearInterval(tick); cleanup(); } };
}
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])); }

document.addEventListener('DOMContentLoaded', boot);

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
  await loadSteps();
  initBoardOrderFromSteps();
  renderBoardFromSteps();
  updateBoardCounts();

  // Modals guaranteed to work regardless of inline script
  wireSettingsModal();
  wireChatModal();
  wrapOpenAddStepModal(); // hook DB save into your existing #step-modal

  wireTimelineTab();
  wireBoardTab();
  wireActivityTab();
  startActivityRealtime();

  if (!byId('activity-content')?.classList.contains('hidden')) await renderActivity(false);

  mountRealtime();
}

/* ---------------- Header / Description ---------------- */
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
    try { const url = await getSignedFileURL('project-files', bg, 3600); if (url) bgImg.src = url; } catch { }
  }
}

/* ---------------- Steps tab ---------------- */
function stepsHost() { return byId('steps-tree'); }

function stepRowMarkup(step, showActions) {
  const uiStatus = db2ui(step.status);
  const due = step.due_date ? new Date(step.due_date).toISOString().slice(0, 10) : '';
  const title = step.name || '(untitled)';
  return `
  <div class="step-item bg-white p-3 rounded-lg border border-gray-200 relative" data-id="${step.id}">
    <div class="flex items-start">
      <button class="mr-2 text-gray-400 hover:text-gray-600" aria-label="Collapse/Expand">
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
          <input type="text" class="font-medium flex-grow focus:outline-none" data-field="title" value="${escapeHtml(title)}" />
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
            <input type="text" data-datepicker class="text-xs border-none bg-transparent focus:outline-none" data-field="due" value="${due}" />
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
        ${showActions ? `
        <button class="text-gray-400 hover:text-red-500 ml-1" aria-label="Delete step" data-action="delete-step" title="Delete">
          <i data-feather="trash-2" class="w-4 h-4"></i>
        </button>` : ``}
      </div>
    </div>
  </div>`;
}

function renderSteps() {
  const host = stepsHost(); if (!host) return;
  if (!host.dataset.cleaned) { host.innerHTML = ''; host.dataset.cleaned = '1'; }

  if (!state.steps.length) {
    host.innerHTML = '<div class="text-sm text-gray-500 py-2">No steps yet.</div>';
    return;
  }

  const sorted = [...state.steps].sort((a, b) =>
    (a.order_num ?? a.idx ?? 0) - (b.order_num ?? b.idx ?? 0) || new Date(a.created_at) - new Date(b.created_at)
  );

  host.innerHTML = '';
  for (const s of sorted) {
    const div = document.createElement('div');
    div.innerHTML = stepRowMarkup(s, canWrite(state.role));
    const node = div.firstElementChild;
    host.appendChild(node);

    if (canWrite(state.role)) {
      const delBtn = node.querySelector('[data-action="delete-step"]');
      if (delBtn) {
        delBtn.addEventListener('click', (e) => {
          e.preventDefault();
          const id = node.getAttribute('data-id');
          if (!id) return;

          // finalize any previous pending delete immediately
          try { state.pendingDelete?.finalizeNow?.(); } catch { }

          // capture backup to allow local restore
          const idx = state.steps.findIndex(x => x.id === id);
          const backup = idx >= 0 ? state.steps[idx] : null;

          // optimistic local remove
          if (idx >= 0) state.steps.splice(idx, 1);
          node.remove();
          removeIdFromBoard(id);
          renderSteps();
          renderBoardFromSteps();
          updateBoardCounts();

          // show undo bar and delay server delete
          const bar = showUndoSnackbar({
            text: 'Step deleted',
            seconds: 5,
            onUndo: () => {
              state.pendingDelete = null;
              if (!backup) return;
              // restore locally
              state.steps.push(backup);                // order_num preserved from backup
              moveIdBetweenColumns(backup.id, backup.status); // to end of its column (safe and simple)
              renderSteps();
              renderBoardFromSteps();
              updateBoardCounts();
            },
            onElapsed: async () => {
              try {
                await deleteStep(id);
                await logActivity(state.id, 'step_deleted', 'steps', { step_id: id });
              } catch (err) {
                // if server delete fails, restore locally as fallback
                console.error(err);
                toast('Delete failed');
                if (backup && !state.steps.find(s => s.id === backup.id)) {
                  state.steps.push(backup);
                  moveIdBetweenColumns(backup.id, backup.status);
                  renderSteps();
                  renderBoardFromSteps();
                  updateBoardCounts();
                }
              } finally {
                state.pendingDelete = null;
              }
            }
          });

          // allow programmatic finalize (e.g., user deletes another step before timeout)
          state.pendingDelete = {
            id,
            restore: backup,
            async finalizeNow() {
              try { bar.dismiss(); } catch { }
              try {
                await deleteStep(id);
                await logActivity(state.id, 'step_deleted', 'steps', { step_id: id });
              } catch { /* ignore */ }
              state.pendingDelete = null;
            }
          };
        });
      }

    }
  }

  window.feather?.replace();

  if (canWrite(state.role)) {
    host.querySelectorAll('.step-item').forEach(card => {
      const id = card.getAttribute('data-id');

      const title = card.querySelector('[data-field="title"]');
      title?.addEventListener('change', async () => {
        try { await updateStep(id, { name: title.value.trim() || '(untitled)' }); }
        catch (e) { console.error(e); toast('Rename failed'); }
      });

      const statusSel = card.querySelector('[data-field="status"]');
      statusSel?.addEventListener('change', async () => {
        const newDb = ui2db[statusSel.value] || 'open';
        try {
          await updateStep(id, { status: newDb });
          const s = state.steps.find(x => x.id === id);
          if (s) s.status = newDb;
          moveIdBetweenColumns(id, newDb); // to end of new column
          renderBoardFromSteps();
          updateBoardCounts();
        } catch (e) { console.error(e); toast('Status update failed'); }
      });

      const due = card.querySelector('[data-field="due"]');
      if (window.flatpickr && due && !due._fp) window.flatpickr(due, { dateFormat: 'Y-m-d', weekNumbers: true, locale: { firstDayOfWeek: 1 } });
      due?.addEventListener('change', async () => {
        try { await updateStep(id, { due_date: due.value || null }); }
        catch (e) { console.error(e); toast('Date update failed'); }
      });
    });

    // Steps list ordering (persists order_num)
    if (state.sortableSteps) { state.sortableSteps.destroy(); state.sortableSteps = null; }
    if (window.Sortable) {
      state.sortableSteps = window.Sortable.create(host, {
        handle: '.step-item',
        draggable: '.step-item',
        direction: 'vertical',
        animation: 300,
        swapThreshold: 0.65,
        invertSwap: true,
        ghostClass: 'drag-ghost',
        chosenClass: 'drag-chosen',
        dragClass: 'sortable-drag',
        onStart: () => { document.body.classList.add('is-dragging'); host.classList.add('sorting'); },
        onEnd: async () => {
          document.body.classList.remove('is-dragging');
          host.classList.remove('sorting');
          const cards = Array.from(host.querySelectorAll('.step-item'));
          const updates = cards.map((el, i) => ({ id: el.getAttribute('data-id'), order_num: i + 1 }));
          updates.forEach(u => {
            const s = state.steps.find(x => x.id === u.id);
            if (s) { s.order_num = u.order_num; s.idx = u.order_num; }
          });
          try { await reorderSteps(state.id, updates); toast('Order updated'); }
          catch (err) { console.error('reorder failed', err); toast('Reorder failed'); await loadSteps(); }
        }
      });
    }
  }
}

async function loadSteps() {
  try {
    state.steps = await listSteps(state.id);
    renderSteps();
  } catch (e) { console.error(e); }
}

/* ---------- Add Step modal: use your HTML, add DB save ---------- */
function stepModalEls() {
  const root = byId('step-modal'); if (!root) return null;
  const nameI = root.querySelector('input[type="text"]:not([data-datepicker])');
  const notesI = root.querySelector('textarea');
  const statusI = root.querySelector('select'); // first select is Status in your modal
  const dueI = root.querySelector('input[data-datepicker]') || root.querySelector('input[type="date"]');
  const saveBtn = root.querySelector('.bg-gray-50 button.bg-indigo-600'); // footer Save
  return { root, nameI, notesI, statusI, dueI, saveBtn };
}
function bindStepModalSaveOnce() {
  const els = stepModalEls(); if (!els) return;
  if (window.flatpickr && els.dueI && !els.dueI._fp) window.flatpickr(els.dueI, { dateFormat: 'Y-m-d', weekNumbers: true, locale: { firstDayOfWeek: 1 } });
  const onSave = async (e) => {
    e.preventDefault();
    if (!canWrite(state.role)) { toast('You cannot add steps'); return; }
    if (!els.nameI?.value?.trim()) { toast('Title required'); els.nameI?.focus(); return; }
    try {
      const max = state.steps.reduce((m, s) => Math.max(m, (s.order_num ?? s.idx ?? 0)), 0);
      const payload = {
        name: els.nameI.value.trim(),
        notes: els.notesI?.value?.trim() || null,
        status: ui2db[(els.statusI?.value || 'todo').toLowerCase()] || 'open',
        due_date: els.dueI?.value || null,
        order_num: max + 1,
        idx: max + 1,
      };
      const row = await createStep(state.id, payload);
      state.steps.push(row);
      moveIdBetweenColumns(row.id, row.status);
      renderSteps();
      renderBoardFromSteps();
      updateBoardCounts();
      await logActivity(state.id, 'step_created', 'steps', { step_id: row.id });
      // close via your inline function if present
      window.closeStepModal?.();
    } catch (err) { console.error(err); toast('Create failed'); }
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

/* ---------- Settings modal (force-wire) ---------- */
function wireSettingsModal() {
  const btn = byId('settings-open');
  const modal = byId('settings-modal');
  const frame = byId('settings-frame');
  if (!btn || !modal || !frame) return;
  if (btn.dataset.bound === '1') return;
  btn.dataset.bound = '1';
  btn.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    frame.src = `/projects/settings.html?id=${encodeURIComponent(state.id)}`;
    document.documentElement.classList.add('overflow-hidden');
    modal.classList.remove('hidden');
  });
  window.closeSettingsModal = () => { document.documentElement.classList.remove('overflow-hidden'); modal.classList.add('hidden'); };
}
/* ---------- Chat modal (force-wire) ---------- */
function wireChatModal() {
  const btn = byId('chat-open');
  const modal = byId('chat-modal');
  const frame = byId('chat-frame');
  if (!btn || !modal || !frame) return;
  if (btn.dataset.bound === '1') return;
  btn.dataset.bound = '1';
  btn.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    frame.src = `/projects/chat.html?id=${encodeURIComponent(state.id)}`;
    document.documentElement.classList.add('overflow-hidden');
    modal.classList.remove('hidden');
  });
  window.closeChatModal = () => { document.documentElement.classList.remove('overflow-hidden'); modal.classList.add('hidden'); };
}

/* ---------- Timeline ---------- */
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

  const rows = (state?.steps || []).filter(s => s.due_date).slice()
    .sort((a, b) => new Date(a.due_date) - new Date(b.due_date));

  if (rows.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'text-sm text-gray-500';
    empty.textContent = 'No dated steps yet.';
    mount.appendChild(empty);
    return;
  }

  const ul = document.createElement('ul');
  ul.className = 'space-y-2';
  for (const s of rows) {
    const li = document.createElement('li');
    li.className = 'flex items-start justify-between rounded-lg border border-gray-200 bg-white px-3 py-2';
    li.innerHTML = `
      <div class="min-w-0">
        <p class="text-sm font-medium text-gray-900 truncate">${escapeHtml(s.name || 'Untitled')}</p>
        <p class="text-xs text-gray-500">${s.status?.replace('_', ' ') || ''}</p>
      </div>
      <div class="text-sm text-gray-700 ml-3 whitespace-nowrap">${s.due_date}</div>
    `;
    ul.appendChild(li);
  }
  mount.appendChild(ul);
  try { window.feather?.replace(); } catch { }
}

/* ---------- Activity (DB only) ---------- */
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
    case 'step_created': return `Step created: ${escapeHtml(stepTitle || meta?.step_name || '')}`;
    case 'step_updated': return `Step updated: ${escapeHtml(stepTitle || meta?.step_name || '')}`;
    case 'step_deleted': return `Step deleted`;
    case 'file_uploaded': return `File uploaded: ${escapeHtml(meta?.name || '')}`;
    case 'member_invited': return `Member invited: ${escapeHtml(meta?.email || '')}`;
    default: return escapeHtml(kind || 'event');
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

  // hide static demo items from HTML
  const demoWrap = host.querySelector('.space-y-4');
  demoWrap?.classList.add('hidden');

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
      li.setAttribute('data-activity-id', a.id);
      const when = timeAgo(a.created_at);
      const avatarUrl = await resolveAvatarUrl(prof.avatar, a.actor_id);

      li.innerHTML = `
        <div class="flex items-start gap-3">
          <img class="h-8 w-8 rounded-full object-cover bg-gray-100" src="${avatarUrl}" alt="">
          <div class="min-w-0 flex-1">
            <div class="flex items-center justify-between">
              <p class="text-sm font-medium text-gray-900 truncate">${escapeHtml(prof.name)}</p>
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
      badge.classList.add('hidden');
      badge.textContent = '0';
      if (newestTs) localStorage.setItem(key, String(newestTs));
    } else {
      if (unseen > 0) { badge.textContent = String(unseen); badge.classList.remove('hidden'); }
      else { badge.classList.add('hidden'); }
    }
  }
}

/* ---------- Board ---------- */
function wireBoardTab() {
  const btn = document.querySelector('.tab-button[data-tab="board"]');
  if (!btn || btn.dataset.boundBoard === '1') return;
  btn.dataset.boundBoard = '1';
  btn.addEventListener('click', () => { try { renderBoardFromSteps(); updateBoardCounts(); } catch { } });
}

function initBoardOrderFromSteps() {
  const buckets = groupByStatus();
  state.boardOrder.backlog = buckets.backlog.map(s => s.id);
  state.boardOrder.inprogress = buckets.inprogress.map(s => s.id);
  state.boardOrder.review = buckets.review.map(s => s.id);
  state.boardOrder.done = buckets.done.map(s => s.id);
}

function groupByStatus() {
  const bucket = { backlog: [], inprogress: [], review: [], done: [] };
  for (const s of state.steps) {
    const ui = ({ open: 'backlog', in_progress: 'inprogress', review: 'review', done: 'done' }[String(s.status).toLowerCase()] || 'backlog');
    bucket[ui].push(s);
  }
  Object.values(bucket).forEach(list => list.sort((a, b) => (a.order_num ?? 0) - (b.order_num ?? 0)));
  return bucket;
}

function ensureSentinel(host) {
  // A non-draggable item at the end to allow dropping into empty space -> last position.
  if (!host) return;
  if (!host.querySelector('.board-sentinel')) {
    const s = document.createElement('div');
    s.className = 'board-sentinel h-1'; // tiny height; not draggable
    host.appendChild(s);
  }
}

function renderBoardFromSteps() {
  const cols = {
    backlog: byId('backlog-column'),
    inprogress: byId('inprogress-column'),
    review: byId('review-column'),
    done: byId('done-column')
  };

  const buckets = groupByStatus();

  // sanitize local order against current items and append missing to tail
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
      div.setAttribute('data-id', row.id);
      div.innerHTML = `
        <p class="text-sm font-medium ${row.status === 'done' ? 'line-through' : ''}">${escapeHtml(row.name || 'Untitled')}</p>
        <div class="mt-2 flex items-center justify-between">
          <span class="text-xs text-gray-500">${row.due_date ? 'Due ' + row.due_date : ''}</span>
          <i data-feather="hash" class="w-4 h-4 text-gray-300"></i>
        </div>`;
      host.appendChild(div);
    }

    // allow “drop to whitespace to land last”
    ensureSentinel(host);

    // Rename "Backlog" header to "To Do"
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
  const buckets = groupByStatus();
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
  for (const k of Object.keys(state.boardOrder)) {
    state.boardOrder[k] = state.boardOrder[k].filter(x => x !== id);
  }
}
function moveIdBetweenColumns(id, newDbStatus) {
  const key = ({ open: 'backlog', in_progress: 'inprogress', review: 'review', done: 'done' }[String(newDbStatus).toLowerCase()] || 'backlog');
  removeIdFromBoard(id);
  state.boardOrder[key].push(id); // to end
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
    state.boardOrder[key] = Array.from(host.querySelectorAll('.step-item')).map(n => n.getAttribute('data-id'));
  }
}

function initBoardDnD(cols) {
  if (!window.Sortable) return;

  const opts = {
    group: { name: 'board', pull: true, put: true },
    sort: true,
    animation: 200,
    delay: 0,
    fallbackOnBody: true,
    forceFallback: false,
    emptyInsertThreshold: 24, // easier to drop into empty space
    swapThreshold: 0.5,
    ghostClass: 'opacity-50',
    draggable: '.step-item',           // sentinel not draggable
    filter: '.board-sentinel',         // ignore sentinel
    onAdd: async (evt) => {
      const el = evt.item;
      const id = el.getAttribute('data-id');
      const toKey = boardKeyFromContainer(evt.to);
      try {
        const db = ({ backlog: 'open', inprogress: 'in_progress', review: 'review', done: 'done' }[toKey]) || 'open';
        await updateStep(id, { status: db });      // status only; no order_num change
        const s = state.steps.find(x => x.id === id); if (s) s.status = db;
        syncBoardOrderFromDOM(cols);               // record new local column order (including end position)
        // repaint to avoid any stuck drag ghost or need to re-grab
        renderBoardFromSteps();
        updateBoardCounts();
      } catch (e) { console.error(e); }
    },
    onUpdate: () => { syncBoardOrderFromDOM(cols); }, // same-column reorder (local only)
    onEnd: () => { syncBoardOrderFromDOM(cols); updateBoardCounts(); }
  };

  for (const host of Object.values(cols)) {
    if (!host) continue;
    // rebind every render for stability (remove old Sortable if present)
    if (host.__sortable) { try { host.__sortable.destroy(); } catch { } host.__sortable = null; }
    ensureSentinel(host);
    host.__sortable = new Sortable(host, opts);
  }
}

/* ---------- Realtime ---------- */
function mountRealtime() {
  if (state.unsub) state.unsub();
  let t = null;
  state.unsub = subscribeSteps(state.id, (payload) => {
    const { eventType, new: n, old: o } = payload;

    if (eventType === 'INSERT') {
      if (!state.steps.some(s => s.id === n.id)) {
        state.steps.push(n);
        moveIdBetweenColumns(n.id, n.status);
        renderSteps();
        renderBoardFromSteps();
        updateBoardCounts();
      }
    } else if (eventType === 'UPDATE') {
      const i = state.steps.findIndex(s => s.id === n.id);
      if (i >= 0) {
        state.steps[i] = { ...state.steps[i], ...n };
        if (n?.status) moveIdBetweenColumns(n.id, n.status);
      }
      clearTimeout(t);
      t = setTimeout(() => {
        if (!document.body.classList.contains('is-dragging')) {
          renderSteps();
          renderBoardFromSteps();
          updateBoardCounts();
        }
      }, 160);
    } else if (eventType === 'DELETE') {
      const i = state.steps.findIndex(s => s.id === o.id);
      if (i >= 0) { state.steps.splice(i, 1); removeIdFromBoard(o.id); }
      renderSteps();
      renderBoardFromSteps();
      updateBoardCounts();
    }
  });
  window.addEventListener('beforeunload', () => { try { state.unsub?.(); } catch { } });
}

/* ---------- Invite token accept ---------- */
(function acceptInviteIfPresent() {
  const u = new URL(location.href);
  const token = u.searchParams.get('invite');
  const id = u.searchParams.get('id');
  if (!token || !id) return;
  import('./api.js').then(({ acceptInvite }) => { acceptInvite(id, token).catch(() => { }); });
})();
