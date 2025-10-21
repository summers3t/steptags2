// C:\steptags2\js\settings.js
// Settings modal wiring. No layout changes. No self-background painting.

import {
    getProject,
    getProfile,
    updateProject,
    setProjectBackground,
    getSignedFileURL,
    uploadBackgroundFile,
    listProjectMembers,
    inviteMemberByEmail,
    updateMemberRole,
    removeMember,
    softDeleteProject
} from './api.js';

/* ========= Utils ========= */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const fmtISO = (d) => { if (!d) return ''; const x = new Date(d); const m = String(x.getMonth() + 1).padStart(2, '0'); const dd = String(x.getDate()).padStart(2, '0'); return `${x.getFullYear()}-${m}-${dd}`; };
const fmtHuman = (d) => {
    try {
        const x = new Date(d);
        const dd = String(x.getDate()).padStart(2, '0');
        const mm = String(x.getMonth() + 1).padStart(2, '0');
        const yyyy = x.getFullYear();
        return `${dd}.${mm}.${yyyy}`;
    } catch { return ''; }
};
const escapeHtml = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const qsProjectId = () => { const u = new URL(location.href); return u.searchParams.get('projectId') || u.searchParams.get('id') || u.searchParams.get('p'); };
const toast = (m) => console.log('[settings]', m);

/** parent messaging shape: {type, projectId, payload} */
const sendToParent = (type, payload) =>
    window.parent?.postMessage({ type, projectId: state.id, payload }, location.origin);

/* ========= DOM ========= */
// Top meta
const skTop = $('#sk-top'); const pTitle = $('#p-title'); const pDesc = $('#p-desc'); const pMeta = $('#p-meta');
const pCreatedBy = $('#p-createdby'); const pDue = $('#p-due');

// Overview
const skOverview = $('#sk-overview'); const ovCards = $('#ov-cards');
const stepsCount = $('#stepsCount'); const completedCount = $('#completedCount'); const dueSoonCount = $('#dueSoonCount');
const ovProgressWrap = $('#ov-progress'); const overallPct = $('#overallPct'); const overallBar = $('#overallBar');

// Edit
const formEdit = $('#form-edit'); const fTitle = $('#f_title'); const fDesc = $('#f_desc');
const fStart = $('#f_start'); const fDue = $('#f_due');
const saveBtn = $('#btn-save'); const closeBtn = $('#btn-cancel');

// Background
const bgZone = $('#bg-uploader');
const bgFile = $('#bgFile');
const bgPreview = $('#bgPreview');
const bgImg = $('#bgImg');
const bgProgress = $('#bg-progress');
const bgClear = $('#bg-clear');
const bgLinkColor = $('#bg-link-color');
const bgLinkImage = $('#bg-link-image');
const bgPopoverColor = $('#bg-popover-color');
const bgPopoverImage = $('#bg-popover-image');

// Members
const skMembers = $('#sk-members'); const membersList = $('#membersList');
const inviteEmail = $('#inviteEmail'); const inviteRole = $('#inviteRole'); const inviteBtn = $('#inviteBtn');

// Delete
const btnDelete = $('#btn-delete');

/* ========= State ========= */
const state = {
    id: null,
    project: null,
    original: { title: '', description: '', start_date: '', due_date: '', background_color: null, background: null },
    pending: {}, // { background_color: null|string, background_path: null|string }
    fpStart: null, fpDue: null,
    dirty: false,
    pendingRemovals: new Map(),
    selectedChip: null
};

function setDirty(on = true) { state.dirty = !!on; if (saveBtn) saveBtn.disabled = !state.dirty; }

/* ========= Init ========= */
document.addEventListener('DOMContentLoaded', init);

async function init() {
    state.id = qsProjectId();
    if (!state.id) return console.error('Missing projectId');

    setupFlatpickr();
    wireDateClears();
    await hydrateProject();
    await hydrateMembers();

    wireEditFields();
    wireBackground();
    wireInvites();
    wireDelete();

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { e.preventDefault(); closeAndDiscard(); }
        else if (e.key === 'Enter') {
            const t = e.target;
            if (t && t.tagName === 'TEXTAREA') return;
            if (formEdit && formEdit.contains(t)) {
                e.preventDefault();
                if (!saveBtn.disabled) saveBtn.click();
            }
        }
    });

    setDirty(false);
}

/* ========= Hydration ========= */
async function hydrateProject() {
    let proj = null;
    try { proj = await getProject(state.id); } catch (e) { console.error('getProject', e); }
    state.project = proj || {};

    const { title = '', description = '', background = null, background_color = null, start_date = null, due_date = null, created_by = null } = state.project;

    // Created by
    let createdTxt = '';
    try {
        if (created_by) {
            const prof = await getProfile(created_by);
            const name = prof?.display_name || '';
            const email = prof?.email || '';
            createdTxt = name || email ? `Created by ${name || email}` : '';
        }
    } catch { }

    // Top meta
    pTitle && (pTitle.textContent = title || 'Untitled project');
    pDesc && (pDesc.textContent = description || '');
    pCreatedBy && (pCreatedBy.textContent = createdTxt);
    pDue && (pDue.textContent = due_date ? `Due ${fmtHuman(due_date)}` : 'No due date');
    skTop && skTop.classList.add('hidden'); pTitle?.classList.remove('hidden'); pDesc?.classList.remove('hidden'); pMeta?.classList.remove('hidden');

    // Overview placeholders
    stepsCount && (stepsCount.textContent = '—'); completedCount && (completedCount.textContent = '—'); dueSoonCount && (dueSoonCount.textContent = '—');
    overallPct && (overallPct.textContent = '—'); overallBar && (overallBar.style.width = '0%');
    skOverview && skOverview.classList.add('hidden'); ovCards?.classList.remove('hidden'); ovProgressWrap?.classList.add('hidden');

    // Edit values
    if (fTitle) fTitle.value = title;
    if (fDesc) fDesc.value = description;

    // Drive Flatpickr directly from DB dates to avoid altInput desync
    try { state.fpStart?.clear(); } catch { }
    try { state.fpDue?.clear(); } catch { }
    if (start_date) state.fpStart?.setDate(new Date(`${start_date}T00:00:00Z`), true);
    if (due_date) state.fpDue?.setDate(new Date(`${due_date}T00:00:00Z`), true);

    // Snapshot originals from DB, not the input fields
    state.original = {
        title: fTitle?.value || '',
        description: fDesc?.value || '',
        start_date: start_date || '',
        due_date: due_date || '',
        background_color,
        background
    };

    enforceDateBounds();

    // Background preview only
    if (background) {
        try {
            const url = await getSignedFileURL('project-backgrounds', background);
            if (url) { bgImg.src = url; bgPreview?.classList.remove('hidden'); bgClear?.classList.remove('hidden'); }
        } catch (e) { console.warn('bg preview failed', e); }
    } else if (background_color) {
        const chip = findChipForColor(background_color);
        highlightChip(chip);
        bgClear?.classList.remove('hidden');
    }
}

async function hydrateMembers() {
    skMembers?.classList.remove('hidden'); membersList?.classList.add('hidden');
    let rows = [];
    try { rows = await listProjectMembers(state.id) || []; } catch (e) { console.error('listProjectMembers', e); }
    if (membersList) { membersList.innerHTML = ''; for (const m of rows) membersList.appendChild(renderMemberRow(m)); }
    skMembers?.classList.add('hidden'); membersList?.classList.remove('hidden');
}

/* ========= Members ========= */
function renderMemberRow(m) {
    const user_id = m.user_id;
    const role = m.role || 'member';
    const prof = m.profile || {};
    const name = prof.display_name || prof.email || 'Member';
    const email = prof.email || '';
    const avatar = prof.avatar_path || '';

    const li = document.createElement('li');
    li.className = 'flex items-center justify-between p-3 rounded-lg border';
    li.dataset.userId = user_id;
    li.innerHTML = `
    <div class="flex items-center gap-3">
      ${avatar ? `<img src="${escapeHtml(avatar)}" alt="" class="w-8 h-8 rounded-full">` : `<div class="w-8 h-8 rounded-full bg-gray-200"></div>`}
      <div>
        <p class="text-sm font-medium leading-5">${escapeHtml(name)}</p>
        <p class="text-xs text-gray-500">${escapeHtml(email)}</p>
      </div>
    </div>
    <div class="flex items-center gap-2">
      <select class="member-role text-sm border rounded-md px-2 py-1">
        <option value="admin" ${role === 'admin' ? 'selected' : ''}>admin</option>
        <option value="member" ${role === 'member' ? 'selected' : ''}>member</option>
        <option value="guest" ${role === 'guest' ? 'selected' : ''}>guest</option>
      </select>
      <button class="member-remove p-1.5 rounded-md text-red-600 hover:bg-red-50" aria-label="Remove">
        <i data-feather="trash-2" class="w-4 h-4"></i>
      </button>
    </div>
  `;

    const roleSel = li.querySelector('.member-role');
    roleSel?.addEventListener('change', async () => {
        const prev = roleSel.getAttribute('data-prev') || role;
        const next = roleSel.value;
        try { await updateMemberRole(state.id, user_id, next); roleSel.setAttribute('data-prev', next); toast('Role updated'); }
        catch (e) { console.error('updateMemberRole', e); roleSel.value = prev; toast('Reverted'); }
    });

    const btn = li.querySelector('.member-remove');
    btn?.addEventListener('click', () => startSoftRemove(li, user_id));

    if (window.feather) window.feather.replace({ elements: [btn] });
    return li;
}

function startSoftRemove(li, userId) {
    const original = li.innerHTML;
    li.innerHTML = `<div class="text-sm">Member scheduled for removal. <button class="undo text-indigo-600 hover:text-indigo-800 ml-2">Undo</button></div>`;
    const undo = li.querySelector('.undo');
    const tid = setTimeout(async () => {
        try { await removeMember(state.id, userId); li.remove(); toast('Member removed'); }
        catch (e) { console.error('removeMember', e); li.innerHTML = original; rebindMemberRow(li, userId); toast('Restore'); }
        finally { state.pendingRemovals.delete(userId); }
    }, 5000);
    state.pendingRemovals.set(userId, tid);
    undo?.addEventListener('click', () => { clearTimeout(tid); state.pendingRemovals.delete(userId); li.innerHTML = original; rebindMemberRow(li, userId); });
}

function rebindMemberRow(li, userId) {
    const roleSel = li.querySelector('.member-role');
    roleSel?.addEventListener('change', async () => {
        const prev = roleSel.getAttribute('data-prev') || 'member';
        const next = roleSel.value;
        try { await updateMemberRole(state.id, userId, next); roleSel.setAttribute('data-prev', next); }
        catch (e) { roleSel.value = prev; }
    });
    const btn = li.querySelector('.member-remove');
    btn?.addEventListener('click', () => startSoftRemove(li, userId));
    if (window.feather) window.feather.replace({ elements: [btn] });
}

/* ========= Invites ========= */
function wireInvites() {
    inviteBtn?.addEventListener('click', async () => {
        const email = (inviteEmail?.value || '').trim();
        const role = inviteRole?.value || 'member';
        if (!email) { alert('Enter email'); return; }
        inviteBtn.disabled = true;
        try {
            const res = await inviteMemberByEmail(state.id, email, role);
            const link = res?.link || null;
            if (link && navigator.clipboard?.writeText) { await navigator.clipboard.writeText(link); alert('Invite link copied to clipboard.'); }
            else { alert('Invite created. Copy from console.'); console.log('Invite:', res); }
            await hydrateMembers();
        } catch (e) { console.error('inviteMemberByEmail', e); alert('Could not create invite.'); }
        finally { inviteBtn.disabled = false; if (inviteEmail) inviteEmail.value = ''; }
    });
}

/* ========= Edit fields ========= */
function wireEditFields() {
    const onAnyChange = () => setDirty(true);

    [fTitle, fDesc, fStart, fDue].forEach(el => {
        el?.addEventListener('input', onAnyChange);
        el?.addEventListener('change', () => {
            setDirty(true);
            if (el === fStart || el === fDue) enforceDateBounds();
        });
    });

    saveBtn?.addEventListener('click', async (e) => {
        e.preventDefault();
        if (!validateDates()) return;

        const patch = {};
        if (fTitle && fTitle.value !== state.original.title) patch.title = fTitle.value;
        if (fDesc && fDesc.value !== state.original.description) patch.description = fDesc.value;

        const startVal = state.fpStart?.selectedDates?.[0]
            ? state.fpStart.formatDate(state.fpStart.selectedDates[0], 'Y-m-d')
            : (fStart?.value || null);

        const dueVal = state.fpDue?.selectedDates?.[0]
            ? state.fpDue.formatDate(state.fpDue.selectedDates[0], 'Y-m-d')
            : (fDue?.value || null);

        if (startVal !== state.original.start_date) patch.start_date = startVal ?? null;
        if (dueVal !== state.original.due_date) patch.due_date = dueVal ?? null;

        // Include color only if explicitly changed this session (may be null to clear)
        if (state.pending.hasOwnProperty('background_color') && state.pending.background_color !== state.original.background_color) {
            patch.background_color = state.pending.background_color; // can be null
        }

        try {
            // 1) Persist image path first if changed (may be null to clear)
            if (state.pending.hasOwnProperty('background_path')) {
                await setProjectBackground(state.id, state.pending.background_path);
            }

            // TEMPORARY !!!!!!!!!!!!!!
            // console.log('updateProject patch =', JSON.stringify(patch));

            // 2) Persist text + color
            if (Object.keys(patch).length) await updateProject(state.id, patch);

            // 3) Build commit payload as the new single source of truth
            const commit = {
                color: state.pending.hasOwnProperty('background_color') ? state.pending.background_color : state.original.background_color,
                path: state.pending.hasOwnProperty('background_path') ? state.pending.background_path : state.original.background
            };

            // Notify parent for immediate refresh
            sendToParent('project-bg-commit', { color: commit.color || null, path: commit.path || null });

            // Snapshot new originals
            // force inputs and pickers to the saved values
            if (state.fpStart) state.fpStart.setDate(startVal || null, true);
            if (state.fpDue) state.fpDue.setDate(dueVal || null, true);
            if (fStart) fStart.value = startVal || '';
            if (fDue) fDue.value = dueVal || '';

            state.original = {
                title: fTitle?.value || '',
                description: fDesc?.value || '',
                start_date: startVal || null,
                due_date: dueVal || null,
                background_color: commit.color || null,
                background: commit.path || null
            };

            // UI reflect
            if (state.original.background) {
                try {
                    const url = await getSignedFileURL('project-backgrounds', state.original.background);
                    if (url) { bgImg.src = url; bgPreview?.classList.remove('hidden'); }
                } catch { }
                highlightChip(null);
            } else {
                bgPreview?.classList.add('hidden');
                if (state.original.background_color) {
                    const chip = findChipForColor(state.original.background_color);
                    highlightChip(chip);
                } else {
                    highlightChip(null);
                }
            }
            bgClear?.classList.toggle('hidden', !state.original.background && !state.original.background_color);

            // Reset session changes
            state.pending = {};
            setDirty(false);

            // Top meta reflect
            if (pTitle) pTitle.textContent = fTitle?.value || 'Untitled project';
            if (pDesc) pDesc.textContent = fDesc?.value || '';
            if (pDue) pDue.textContent = fDue?.value ? `Due ${fmtHuman(fDue?.value)}` : 'No due date';

            toast('Saved');
        } catch (e2) {
            console.error('save', e2);
            alert('Could not save changes.');
        }
    });

    closeBtn?.addEventListener('click', (e) => { e.preventDefault(); closeAndDiscard(); });
}

/* ========= Date constraints ========= */
function enforceDateBounds() {
    const start = state.fpStart?.selectedDates?.[0] || null;
    const due = state.fpDue?.selectedDates?.[0] || null;
    if (state.fpDue) state.fpDue.set('minDate', start || null);
    if (state.fpStart) state.fpStart.set('maxDate', due || null);
}

function validateDates() {
    const toUtcDate = (v) => v ? new Date(`${v}T00:00:00Z`) : null;
    const sStr = state.fpStart?.selectedDates?.[0]
        ? state.fpStart.formatDate(state.fpStart.selectedDates[0], 'Y-m-d')
        : (fStart?.value || '');
    const dStr = state.fpDue?.selectedDates?.[0]
        ? state.fpDue.formatDate(state.fpDue.selectedDates[0], 'Y-m-d')
        : (fDue?.value || '');
    const s = toUtcDate(sStr);
    const d = toUtcDate(dStr);
    if (s && d && d < s) {
        alert('Due date cannot be earlier than start date.');
        return false;
    }
    return true;
}


/* ========= Flatpickr ========= */
function setupFlatpickr() {
    if (!window.flatpickr) return;
    const locale = { firstDayOfWeek: 1 };

    const markDirtyFromPicker = () => setDirty(true);

    state.fpStart = window.flatpickr('#f_start', {
        dateFormat: 'Y-m-d',        // value saved/read from the hidden original input
        altInput: true,             // show a pretty input to the user
        altFormat: 'd.m.Y',         // visible format: 20.10.2025
        allowInput: true,
        locale,
        weekNumbers: true,
        onChange: enforceDateBounds
    });

    state.fpDue = window.flatpickr('#f_due', {
        dateFormat: 'Y-m-d',
        altInput: true,
        altFormat: 'd.m.Y',
        allowInput: true,
        locale,
        weekNumbers: true,
        onChange: enforceDateBounds
    });
}

/* ========= Date clear buttons ========= */
function wireDateClears() {
    const btnClearStart = document.getElementById('f_start_clear');
    const btnClearDue = document.getElementById('f_due_clear');

    btnClearStart?.addEventListener('click', () => {
        state.fpStart?.clear();
        if (fStart) fStart.value = '';
        setDirty(true);
        enforceDateBounds();
    });

    btnClearDue?.addEventListener('click', () => {
        state.fpDue?.clear();
        if (fDue) fDue.value = '';
        setDirty(true);
        enforceDateBounds();
    });
}

/* ========= Background ========= */
function findChipForColor(color) { return $(`#bg-uploader [data-bg="${CSS.escape(color)}"]`); }
function highlightChip(chip) {
    if (state.selectedChip) state.selectedChip.classList.remove('ring-2', 'ring-indigo-400');
    state.selectedChip = chip || null;
    if (state.selectedChip) state.selectedChip.classList.add('ring-2', 'ring-indigo-400');
}
function togglePopovers(which) {
    const showColor = which === 'color';
    const showImage = which === 'image';
    bgPopoverColor?.classList.toggle('hidden', !showColor);
    bgPopoverImage?.classList.toggle('hidden', !showImage);
}

function wireBackground() {
    if (!bgZone) return;

    // Openers
    bgLinkColor?.addEventListener('click', () => togglePopovers('color'));
    // bgLinkImage?.addEventListener('click', () => togglePopovers('image'));
    bgLinkImage?.addEventListener('click', () => {
        togglePopovers(null);           // do not show the Browse button pane
        bgFile?.click();                // open file chooser immediately
    });

    // Color chips: selecting a color cancels any image (existing or pending)
    $$('#bg-uploader [data-bg]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const color = btn.getAttribute('data-bg');

            // Cancel any image: clear pending path; if an image exists in DB and not already scheduled, schedule clearing
            delete state.pending.background_path;
            if (state.original.background && !state.pending.hasOwnProperty('background_path')) {
                state.pending.background_path = null; // explicit clear on save
            }

            state.pending.background_color = color; // set color

            // UI
            highlightChip(btn);
            bgPreview?.classList.add('hidden');
            bgClear?.classList.remove('hidden');

            setDirty(true);
            sendToParent('preview:bg-color', { color });
        });
    });

    // Image upload: selecting an image cancels any color (existing or pending)
    bgFile?.addEventListener('change', async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        if (!/^image\//.test(file.type) || file.size > 5 * 1024 * 1024) {
            alert('Use image up to 5MB.'); bgFile.value = ''; return;
        }

        // Local preview
        const r = new FileReader();
        r.onload = () => {
            bgImg.src = r.result;
            bgPreview?.classList.remove('hidden');
            bgClear?.classList.remove('hidden');
            highlightChip(null);
        };
        r.readAsDataURL(file);

        try {
            bgProgress?.classList.remove('hidden');

            // Upload to storage
            const stored = await uploadBackgroundFile(state.id, file); // { path }
            const url = await getSignedFileURL('project-backgrounds', stored.path);

            // Cancel any color. Ensure DB color clears on save.
            state.pending.background_color = null;

            // Set image path to persist
            state.pending.background_path = stored.path;

            setDirty(true);
            if (url) sendToParent('preview:bg-image', { url });

            toast('Background uploaded.');
        } catch (err) {
            console.error('background', err);
            alert('Could not update background.');
        } finally {
            bgProgress?.classList.add('hidden');
        }
    });

    // Clear: clears BOTH color and image to "no background"
    bgClear?.addEventListener('click', () => {
        if (bgFile) bgFile.value = '';
        if (bgImg) bgImg.src = '';
        bgPreview?.classList.add('hidden');
        bgClear?.classList.add('hidden');

        // Explicitly clear both on save regardless of current originals
        state.pending.background_path = null;
        state.pending.background_color = null;

        highlightChip(null);
        togglePopovers(null);
        setDirty(true);
        sendToParent('preview:bg-clear', {});
    });
}

/* ========= Close / Delete ========= */
function closeAndDiscard() {
    // Revert parent preview to ORIGINAL state only on cancel
    if (state.original.background) {
        getSignedFileURL('project-backgrounds', state.original.background)
            .then((url) => sendToParent('preview:bg-image', { url: url || null }))
            .catch(() => sendToParent('preview:bg-clear', {}))
            .finally(() => tryCloseModal(false));
    } else if (state.original.background_color) {
        sendToParent('preview:bg-color', { color: state.original.background_color });
        tryCloseModal(false);
    } else {
        sendToParent('preview:bg-clear', {});
        tryCloseModal(false);
    }
}

function wireDelete() {
    btnDelete?.addEventListener('click', async () => {
        if (!confirm('Move project to recycle bin? Admin can restore later.')) return;
        try { await softDeleteProject(state.id); toast('Project moved to recycle bin.'); tryCloseModal(true); }
        catch (e) { console.error('softDeleteProject', e); alert('Could not move to recycle bin.'); }
    });
}

function tryCloseModal(refresh = false) {
    try { window.parent?.closeSettingsModal?.({ refresh }); } catch { }
}
