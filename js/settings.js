// C:\steptags2\js\settings.js
// Settings modal wiring.

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
    softDeleteProject,
    sendInviteEmail,
    getMembership,
    listProjectInvites,
    resendProjectInvite,
    revokeProjectInvite,
    listProjectActivity
} from './api.js';
import { supabase } from './supabase.js';

/* ========= Utils ========= */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const fmtISO = (d) => { if (!d) return ''; const x = new Date(d); const m = String(x.getMonth() + 1).padStart(2, '0'); const dd = String(x.getDate()).padStart(2, '0'); return `${x.getFullYear()}-${m}-${dd}`; };
const fmtHuman = (d) => { try { const x = new Date(d); const dd = String(x.getDate()).padStart(2, '0'); const mm = String(x.getMonth() + 1).padStart(2, '0'); const yyyy = x.getFullYear(); return `${dd}.${mm}.${yyyy}`; } catch { return ''; } };
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

// Invites
const pendingBox = $('#pendingBox');
const pendingList = $('#pendingList');
const pendingCount = $('#pendingCount');
const refreshPending = $('#refreshPending');

// Delete
const btnDelete = $('#btn-delete');

/* ========= State ========= */
const state = {
    id: null,
    currentUserId: null,
    project: null,
    myRole: null,
    original: { title: '', description: '', start_date: '', due_date: '', background_color: null, background: null },
    pending: {}, // { background_color: null|string, background_path: null|string }
    fpStart: null, fpDue: null,
    dirty: false,
    pendingRemovals: new Map(),
    selectedChip: null,
    membership: null,        // { role, status }
    invites: [],             // Cached pending invites
    activity: [],             // Cached activity items
    nameCache: new Map(),     // UserId -> display name/email

    // Queued member role edits (user_id -> { from, to })
    roleEdits: new Map(),

    // Flag to refresh members after saving queued edits
    needsMemberRefresh: false
};

function kindLabel(k) {
    const map = {
        invite_created: 'Invite created',
        invite_resent: 'Invite resent',
        invite_revoked: 'Invite revoked',
        invite_expired: 'Invite expired',
        invite_accepted: 'Invite accepted',
        member_role_changed: 'Role changed',
        member_removed: 'Member removed'
    };
    return map[k] || k;
}

function timeAgo(iso) {
    try {
        const d = new Date(iso);
        const s = Math.floor((Date.now() - d.getTime()) / 1000);
        if (s < 60) return `${s}s ago`;
        const m = Math.floor(s / 60);
        if (m < 60) return `${m}m ago`;
        const h = Math.floor(m / 60);
        if (h < 24) return `${h}h ago`;
        const dd = Math.floor(h / 24);
        return `${dd}d ago`;
    } catch { return ''; }
}


function setDirty(on = true) { state.dirty = !!on; if (saveBtn) saveBtn.disabled = !state.dirty; }

function computeCurrentDates() {
    const startVal = state.fpStart?.selectedDates?.[0]
        ? state.fpStart.formatDate(state.fpStart.selectedDates[0], 'Y-m-d')
        : (fStart?.value || null);
    const dueVal = state.fpDue?.selectedDates?.[0]
        ? state.fpDue.formatDate(state.fpDue.selectedDates[0], 'Y-m-d')
        : (fDue?.value || null);
    return { startVal, dueVal };
}

// Recompute "dirty" based on real differences (title/desc/dates/bg/roleEdits)
function recomputeDirty() {
    // 1) Text fields
    const titleDirty = !!(fTitle && fTitle.value !== state.original.title);
    const descDirty = !!(fDesc && fDesc.value !== state.original.description);

    // 2) Dates
    const { startVal, dueVal } = computeCurrentDates();
    const startDirty = (startVal ?? null) !== (state.original.start_date ?? null);
    const dueDirty = (dueVal ?? null) !== (state.original.due_date ?? null);

    // 3) Background
    const hasClrFlag = Object.prototype.hasOwnProperty.call(state.pending, 'background_color');
    const hasPathFlag = Object.prototype.hasOwnProperty.call(state.pending, 'background_path');
    const bgColorDirty = hasClrFlag ? (state.pending.background_color !== state.original.background_color) : false;
    const bgPathDirty = hasPathFlag ? (state.pending.background_path !== state.original.background) : false;

    // 4) Role edits
    const roleDirty = !!(state.roleEdits && state.roleEdits.size);

    setDirty(titleDirty || descDirty || startDirty || dueDirty || bgColorDirty || bgPathDirty || roleDirty);
}


/* ========= Init ========= */
document.addEventListener('DOMContentLoaded', init);

async function init() {
    // 0) Project id + current user
    state.id = qsProjectId();
    if (!state.id) { console.error('Missing projectId'); return; }

    try {
        const { data } = await supabase.auth.getUser();
        state.currentUserId = data?.user?.id || null;
    } catch { state.currentUserId = null; }

    // 1) Base UI wiring
    setupFlatpickr();
    wireDateClears();

    // 2) Load project first (need created_by)
    await hydrateProject();

    // 3) Load my membership
    try {
        const m = await getMembership(state.id);
        state.membership = m || null;
        state.myRole = m?.role || null;
    } catch {
        state.membership = null;
        state.myRole = null;
    }

    // Helper flags
    const iAmCreator = !!(state.project?.created_by && state.currentUserId === state.project.created_by);
    const iAmAdmin = iAmCreator || state.myRole === 'admin' || state.myRole === 'owner';

    // 4) Members + realtime
    await hydrateMembers();
    wireMembersRealtime?.();

    // 5) Admin-only pending invites + realtime
    if (iAmAdmin) {
        pendingBox?.classList.remove('hidden');
        await hydrateInvites?.();
        wireInvitesRealtime?.();

        // Activity (admin/creator only)
        await hydrateActivity?.();
        wireActivityRealtime?.();
    } else {
        pendingBox?.classList.add('hidden');
        // Ensure activity panel stays hidden if dynamically created earlier
        document.getElementById('activityPanel')?.classList.add('hidden');
    }

    // 6) Remaining UI wiring
    wireEditFields();
    wireBackground();
    wireInvites();   // (trims 'admin' opt for non-creator)

    // 6.1) Hide the entire invite strip for non-admins (Member/Guest)
    try {
        if (!iAmAdmin) {
            const inviteContainer = inviteBtn?.closest('.flex.items-center.gap-2')
                || inviteEmail?.closest('.flex.items-center.gap-2')
                || inviteRole?.closest('.flex.items-center.gap-2');
            inviteContainer?.classList.add('hidden');
        }
    } catch { }

    wireDelete();

    // 7) Shortcut keys
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            closeAndDiscard();
        } else if (e.key === 'Enter') {
            const t = e.target;
            if (t && t.tagName === 'TEXTAREA') return;
            if (formEdit && formEdit.contains(t)) {
                e.preventDefault();
                if (!saveBtn.disabled) saveBtn.click();
            }
        }
    });

    // 8) Manual refresh for pending (still gated)
    refreshPending?.addEventListener('click', async () => {
        const isAdminNow = iAmCreator || state.myRole === 'admin' || state.myRole === 'owner';
        if (!isAdminNow) return;
        await hydrateInvites?.();
    });

    setDirty(false);
}

function isAdmin() {
    const r = state.membership?.role || '';
    return r === 'admin' || r === 'owner';
}

function wireMembersRealtime() {
    if (!supabase || !state.id) return;
    const ch = supabase.channel(`members:${state.id}`)
        .on('postgres_changes',
            { event: '*', schema: 'public', table: 'project_members', filter: `project_id=eq.${state.id}` },
            async (_payload) => {
                try {
                    // Defer list refresh while there are unsaved edits
                    if (state.dirty || (state.roleEdits && state.roleEdits.size)) {
                        state.needsMemberRefresh = true;
                        return;
                    }
                    await hydrateMembers();
                } finally {
                    if (window.feather) try { window.feather.replace({ elements: membersList }); } catch { }
                }
            }
        )
        .on('postgres_changes',
            { event: 'DELETE', schema: 'public', table: 'project_members', filter: `project_id=eq.${state.id}` },
            (payload) => {
                if (payload?.old?.user_id && payload.old.user_id === state.currentUserId) {
                    const msg = encodeURIComponent(`You have been moved out of the project by an admin.`);
                    location.replace(`/dashboard.html?notice=${msg}`);
                }
            })
        .subscribe();
}

/* ========= Invites realtime ========= */
function wireInvitesRealtime() {
    if (!supabase || !state.id) return;
    const ch = supabase.channel(`invites:${state.id}`)
        .on('postgres_changes',
            { event: '*', schema: 'public', table: 'project_member_invites', filter: `project_id=eq.${state.id}` },
            async (_payload) => {
                if (!isAdmin()) return;
                try { await hydrateInvites(); } catch { }
            })
        .subscribe();
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

    try { state.fpStart?.clear(); } catch { }
    try { state.fpDue?.clear(); } catch { }
    if (start_date) state.fpStart?.setDate(new Date(`${start_date}T00:00:00Z`), true);
    if (due_date) state.fpDue?.setDate(new Date(`${due_date}T00:00:00Z`), true);

    state.original = {
        title: fTitle?.value || '',
        description: fDesc?.value || '',
        start_date: start_date || '',
        due_date: due_date || '',
        background_color,
        background
    };

    enforceDateBounds();

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
    if (membersList) {
        membersList.innerHTML = '';
        const roleRank = (m) => {
            if (m.user_id === state.project?.created_by) return 0;
            if (m.role === 'admin') return 1;
            if (m.role === 'member') return 2;
            return 3;
        };
        const nameOf = (m) => (m.profile?.display_name || m.profile?.email || '').toLowerCase();
        rows.sort((a, b) => {
            const r = roleRank(a) - roleRank(b);
            if (r !== 0) return r;
            return nameOf(a).localeCompare(nameOf(b));
        });
        const frag = document.createDocumentFragment();
        for (const m of rows) frag.appendChild(renderMemberRow(m));
        membersList.appendChild(frag);
        if (window.feather) try { window.feather.replace({ elements: membersList }); } catch { }
    }
    skMembers?.classList.add('hidden'); membersList?.classList.remove('hidden');
}

/* ========= Invites hydrate/render ========= */
async function hydrateInvites() {
    try {
        const rows = await listProjectInvites(state.id, { includeAccepted: false });
        state.invites = Array.isArray(rows) ? rows : [];
    } catch (e) {
        console.error('listProjectInvites', e);
        state.invites = [];
    }
    // Render
    if (!pendingList) return;
    pendingList.innerHTML = '';
    if (!state.invites.length) {
        pendingCount && (pendingCount.textContent = '0');
        return;
    }
    const frag = document.createDocumentFragment();
    for (const inv of state.invites) frag.appendChild(renderInviteRow(inv));
    pendingList.appendChild(frag);
    pendingCount && (pendingCount.textContent = String(state.invites.length));
}

// Cached inviter name for emails
async function getInviterName() {
    if (state._inviterName) return state._inviterName;
    try {
        const prof = await getProfile(state.currentUserId);
        state._inviterName = (prof?.display_name || prof?.email || '').trim();
        return state._inviterName;
    } catch {
        return '';
    }
}

function renderInviteRow(inv) {
    const li = document.createElement('li');
    li.className = 'flex items-center justify-between px-3 py-2';
    li.dataset.id = inv.id;

    const sent = fmtHuman(inv.created_at);
    const meta = `${escapeHtml(inv.role || '')} • sent ${sent}`;
    const email = escapeHtml(inv.email || '');
    const expires = inv.expires_at ? `Expires ${fmtHuman(inv.expires_at)}` : '';

    li.innerHTML = `
      <div class="min-w-0">
        <p class="truncate text-sm font-medium text-gray-900">${email}</p>
        <p class="text-xs text-gray-600">${escapeHtml(meta)}</p>
      </div>
      <div class="flex items-center gap-2">
        ${expires ? `<span class="text-[11px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-200">${escapeHtml(expires)}</span>` : ''}
        <button data-action="resend" class="text-xs px-2 py-1 rounded-md border border-gray-300 hover:bg-white">Resend</button>
        <button data-action="revoke" class="text-xs px-2 py-1 rounded-md text-red-700 border border-red-300 hover:bg-red-50">Revoke</button>
      </div>
    `;

    // Handlers
    const onClick = async (e) => {
        const btn = e.target.closest('button'); if (!btn) return;
        const act = btn.getAttribute('data-action');
        if (act === 'resend') {
            btn.disabled = true;
            try {
                // 1) Rotate token + extend expiry
                const res = await resendProjectInvite(inv.id);
                const token = res?.token;

                // 2) Build same-style link (inviter & project in query)
                const inviterName = await getInviterName();
                const qs = new URLSearchParams({ token: token || '' });
                if (inviterName) qs.set('inviter', inviterName);
                if (state.project?.title) qs.set('project', state.project.title);
                const link = `${location.origin}/invite.html?${qs.toString()}`;

                // 3) Copy as backup
                if (token && navigator.clipboard?.writeText) {
                    try { await navigator.clipboard.writeText(link); } catch { }
                }

                // 4) Email (same payload contract as initial Invite)
                await sendInviteEmail({
                    email: inv.email,
                    link,
                    projectName: state.project?.title || '',
                    inviterName,
                    role: inv.role || 'member',
                    expiresAtISO: res?.expires_at || null
                });

                toast('Invite resent by email. Link copied as backup.');
                await hydrateInvites();
            } catch (err) {
                console.error('resendProjectInvite', err);
                alert('Could not resend invite.');
            } finally { btn.disabled = false; }
        } else if (act === 'revoke') {
            btn.disabled = true;
            try {
                await revokeProjectInvite(inv.id);
                toast('Invite revoked.');
                await hydrateInvites();
            } catch (err) {
                console.error('revokeProjectInvite', err);
                alert('Could not revoke invite.');
            } finally { btn.disabled = false; }
        }
    };
    li.addEventListener('click', onClick);

    return li;
}

/* ========= Members ========= */
function renderMemberRow(m) {
    const user_id = m.user_id;
    const role = m.role || 'member';
    const prof = m.profile || {};
    const name = prof.display_name || prof.email || 'Member';
    const email = prof.email || '';
    const avatar = prof.avatar_path || '';

    // Identity flags (target)
    const isSelf = !!(state.currentUserId && user_id === state.currentUserId);
    const isCreator = !!(state.project?.created_by && user_id === state.project.created_by);

    // Actor flags
    const iAmCreator = !!(state.project?.created_by && state.currentUserId === state.project.created_by);
    const iAmAdmin = !iAmCreator && (state.myRole === 'admin' || state.myRole === 'owner');

    // Treat owner/admin equal for target protection
    const targetIsOwner = role === 'owner';
    const targetIsAdmin = role === 'admin' || targetIsOwner;

    const li = document.createElement('li');
    li.className = 'flex items-center justify-between p-3 rounded-lg border';
    if (isSelf) li.classList.add('ring-2', 'ring-indigo-300', 'bg-indigo-50/40');
    li.dataset.userId = user_id;

    li.innerHTML = `
      <div class="flex items-center gap-3">
        ${avatar ? `<img src="${escapeHtml(avatar)}" alt="" class="w-8 h-8 rounded-full">` : `<div class="w-8 h-8 rounded-full bg-gray-200"></div>`}
        <div>
          <p class="text-sm font-medium leading-5">
              ${escapeHtml(name)}
              ${isSelf ? `<span class="ml-1 text-xs text-indigo-700">(you)</span>` : ``}
              ${isCreator ? `<span class="ml-1 text-[11px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-200 align-middle">creator</span>` : ``}
          </p>
          <p class="text-xs text-gray-500">${escapeHtml(email)}</p>
        </div>
      </div>
      <div class="flex items-center gap-2">
        <select class="member-role text-sm border rounded-md px-2 py-1">
          <option value="admin"  ${role === 'admin' ? 'selected' : ''}>admin</option>
          <option value="member" ${role === 'member' ? 'selected' : ''}>member</option>
          <option value="guest"  ${role === 'guest' ? 'selected' : ''}>guest</option>
        </select>
        <button class="member-remove p-1.5 rounded-md text-red-600 hover:bg-red-50" aria-label="Remove">
          <i data-feather="trash-2" class="w-4 h-4"></i>
        </button>
      </div>
    `;

    const roleSel = li.querySelector('.member-role');
    const removeBtn = li.querySelector('.member-remove');

    // ===== Role select permissions =====
    if (iAmCreator) {
        // Creator: can change anyone EXCEPT themselves
        if (isSelf && isCreator) {
            roleSel.disabled = true; // lock creator’s own role
        }
        // else: creator can edit others freely
    } else if (iAmAdmin) {
        // Admin: cannot touch creator/admin/owner; can toggle member <-> guest only
        if (isCreator || targetIsAdmin) {
            roleSel.disabled = true;
        } else {
            // remove 'admin' option entirely so only member/guest remain
            Array.from(roleSel.options)
                .filter(o => o.value === 'admin')
                .forEach(o => o.remove());
        }
    } else {
        // Member/Guest: read-only
        roleSel.disabled = true;
    }

    // ===== Remove button permissions (kept but explicit) =====
    if (isSelf) {
        removeBtn?.remove();
    } else if (iAmCreator) {
        removeBtn?.addEventListener('click', () => startSoftRemove(li, user_id));
    } else if (iAmAdmin) {
        if (isCreator || targetIsAdmin) {
            removeBtn?.remove();
        } else {
            removeBtn?.addEventListener('click', () => startSoftRemove(li, user_id));
        }
    } else {
        removeBtn?.remove();
    }

    // Initialize a stable baseline for comparison
    roleSel?.setAttribute('data-prev', role);

    // Change handler: queue only, no DB writes here
    roleSel?.addEventListener('change', () => {
        const prev = roleSel.getAttribute('data-prev') || role;
        const next = roleSel.value;

        if (next === prev) {
            // No change → remove from queue & clear highlight
            state.roleEdits.delete(user_id);
            li.classList.remove('ring-2', 'ring-amber-300', 'bg-amber-50/30');
        } else {
            // Queue the change and visually mark the row
            state.roleEdits.set(user_id, { from: prev, to: next });
            li.classList.add('ring-2', 'ring-amber-300', 'bg-amber-50/30');
        }

        // // Mark form dirty and defer realtime refresh to avoid flicker
        // setDirty(true);
        // state.needsMemberRefresh = true;

        // Re-evaluate dirtiness; if all role edits are reverted, Save disables again
        recomputeDirty();
        state.needsMemberRefresh = true;
    });

    if (window.feather) window.feather.replace({ elements: [removeBtn] });
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

async function hydrateActivity() {
    try {
        const rows = await listProjectActivity(state.id, { limit: 30 });
        state.activity = Array.isArray(rows) ? rows : [];
    } catch (e) {
        console.error('listProjectActivity', e);
        state.activity = [];
    }
    renderActivity();
}

// async function nameFor(userId) {
//     if (!userId) return ''; // system/trigger
//     try {
//         const prof = await getProfile(userId);
//         return (prof?.display_name || prof?.email || '').trim();
//     } catch { return ''; }
// }

async function displayNameFor(userId) {
    if (!userId) return '';
    const cache = state.nameCache;
    if (cache?.has(userId)) return cache.get(userId);
    try {
        const prof = await getProfile(userId);
        const nm = (prof?.display_name || prof?.email || `user:${userId.slice(0, 8)}`).trim();
        cache?.set(userId, nm);
        return nm;
    } catch {
        const nm = `user:${userId.slice(0, 8)}`;
        cache?.set(userId, nm);
        return nm;
    }
}

function renderActivity() {
    // Ensure container exists (dynamic; no HTML edits required)
    let panel = document.getElementById('activityPanel');
    if (!panel) {
        panel = document.createElement('section');
        panel.id = 'activityPanel';
        panel.className = 'mt-4 rounded-lg border bg-white';
        const anchor = pendingBox?.parentElement || membersList?.parentElement || document.body;
        anchor.appendChild(panel);
    }

    const isAdminNow = isAdmin() || (state.project?.created_by && state.currentUserId === state.project.created_by);
    panel.classList.toggle('hidden', !isAdminNow);

    // Header + refresh
    panel.innerHTML = `
    <div class="flex items-center justify-between px-3 py-2 border-b">
      <h3 class="text-sm font-semibold">Recent activity</h3>
      <div class="flex items-center gap-2">
        <button id="activityRefresh"
          class="text-xs px-2 py-1 rounded-md border border-gray-300 hover:bg-white">Refresh</button>
      </div>
    </div>
    <ul id="activityList" class="divide-y"></ul>
  `;

    const list = panel.querySelector('#activityList');
    if (!state.activity.length) {
        list.innerHTML = `<li class="px-3 py-3 text-sm text-gray-500">No activity yet.</li>`;
        panel.querySelector('#activityRefresh')?.addEventListener('click', hydrateActivity);
        return;
    }

    // Render rows (lazy name resolution for actor + target)
    list.innerHTML = '';
    const frag = document.createDocumentFragment();

    for (const row of state.activity) {
        const li = document.createElement('li');
        li.className = 'px-3 py-2 text-sm flex items-start justify-between gap-2';

        // Primary line
        const label = kindLabel(row.kind);
        const when = timeAgo(row.created_at);

        // Secondary meta (short form)
        const metaBits = [];
        const m = row.meta || {};
        if (m.email) metaBits.push(escapeHtml(m.email));

        // Target user placeholder -> resolved async
        if (m.target_user_id) {
            const short = m.target_user_id.slice(0, 8);
            metaBits.push(
                `<span class="act-target" data-uid="${short}" data-full-uid="${m.target_user_id}">user:${short}</span>`
            );
        }

        if (m.new_role && m.old_role) metaBits.push(`${escapeHtml(m.old_role)} → ${escapeHtml(m.new_role)}`);
        if (m.expires_at) {
            try {
                metaBits.push(`exp: ${new Date(m.expires_at).toLocaleDateString()}`);
            } catch { /* noop */ }
        }

        li.innerHTML = `
      <div class="min-w-0">
        <p class="font-medium">${escapeHtml(label)}</p>
        <p class="text-xs text-gray-600">${metaBits.join(' • ')}</p>
      </div>
      <div class="text-xs text-gray-500 whitespace-nowrap">${escapeHtml(when)}</div>
    `;

        frag.appendChild(li);

        // Resolve actor name asynchronously (don’t block paint)
        (async () => {
            const nm = await displayNameFor(row.actor_id);
            if (!nm) return;
            const p = li.querySelector('p.font-medium');
            if (p && !p.dataset.actor) {
                p.dataset.actor = '1';
                p.innerHTML = `${escapeHtml(label)} <span class="text-gray-500 font-normal">by ${escapeHtml(nm)}</span>`;
            }
        })();

        // Resolve target user name asynchronously
        (async () => {
            const span = li.querySelector('.act-target');
            if (!span) return;
            const uid = span.getAttribute('data-full-uid');
            const nm = await displayNameFor(uid);
            if (nm) span.textContent = nm;
        })();
    }

    list.appendChild(frag);
    panel.querySelector('#activityRefresh')?.addEventListener('click', hydrateActivity);
}


function wireActivityRealtime() {
    if (!supabase || !state.id) return;
    const ch = supabase.channel(`activity:${state.id}`)
        .on('postgres_changes', {
            event: '*',
            schema: 'public',
            table: 'project_audit_log',
            filter: `project_id=eq.${state.id}`
        }, async (_payload) => {
            // Don’t clobber in-progress edits; just refresh view quickly
            try {
                const isDirty = state.dirty || (state._roleChanges && state._roleChanges.size);
                if (isDirty) return; // respect your current pattern
                await hydrateActivity();
            } catch { }
        })
        .subscribe();
}

/* ========= Invites creation ========= */
function wireInvites() {
    // Trim roles for non-creator: Admin option hidden
    try {
        const isCreator = state.project?.created_by && state.currentUserId === state.project.created_by;
        if (!isCreator && inviteRole) {
            const optAdmin = Array.from(inviteRole.options).find(o => o.value === 'admin');
            if (optAdmin) optAdmin.remove();
            // Keep Member default; Guest remains
        }
    } catch { }
    inviteBtn?.addEventListener('click', async () => {
        const email = (inviteEmail?.value || '').trim();
        const role = inviteRole?.value || 'member';
        if (!email) { alert('Enter email'); return; }
        inviteBtn.disabled = true;
        try {
            const res = await inviteMemberByEmail(state.id, email, role);
            const link = res?.link || null;

            try { if (link && navigator.clipboard?.writeText) await navigator.clipboard.writeText(link); } catch { }

            try {
                await sendInviteEmail({
                    email,
                    link,
                    projectName: res?.projectName || '',
                    inviterName: res?.inviter || '',
                    role,
                    expiresAtISO: res?.expires_at || null
                });
                alert('Invite sent by email. Link copied to clipboard as backup.');
            } catch (mailErr) {
                console.error('sendInviteEmail', mailErr);
                alert('Invite created. Email failed. Link copied to clipboard.');
            }

            await hydrateMembers();
            if (isAdmin()) await hydrateInvites();
        } catch (e) {
            console.error('inviteMemberByEmail', e);
            alert('Could not create invite.');
        } finally {
            inviteBtn.disabled = false;
            if (inviteEmail) inviteEmail.value = '';
        }
    });
}

/* ========= Edit fields ========= */
function wireEditFields() {
    const onAnyChange = () => recomputeDirty();

    [fTitle, fDesc, fStart, fDue].forEach(el => {
        el?.addEventListener('input', onAnyChange);
        el?.addEventListener('change', () => {
            if (el === fStart || el === fDue) enforceDateBounds();
            recomputeDirty();
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

        if (state.pending.hasOwnProperty('background_color') && state.pending.background_color !== state.original.background_color) {
            patch.background_color = state.pending.background_color;
        }

        try {
            // 1) Persist background path first (can be null to clear)
            if (state.pending.hasOwnProperty('background_path')) {
                await setProjectBackground(state.id, state.pending.background_path);
            }

            // 2) Persist project text/color
            if (Object.keys(patch).length) await updateProject(state.id, patch);

            // 3) NEW: apply queued member role edits (sequential for clearer error reporting)
            if (state.roleEdits && state.roleEdits.size) {
                for (const [userId, { to }] of state.roleEdits.entries()) {
                    await updateMemberRole(state.id, userId, to);
                }
            }

            // 4) Commit snapshot / UI reflect (unchanged)
            const commit = {
                color: state.pending.hasOwnProperty('background_color') ? state.pending.background_color : state.original.background_color,
                path: state.pending.hasOwnProperty('background_path') ? state.pending.background_path : state.original.background
            };
            sendToParent('project-bg-commit', { color: commit.color || null, path: commit.path || null });

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

            // 5) NEW: clear role edit marks & queue
            try {
                $$('#membersList > li').forEach(li => li.classList.remove('ring-2', 'ring-amber-300', 'bg-amber-50/30'));
            } catch { }
            state.roleEdits.clear();

            // Reset general pending
            state.pending = {};
            setDirty(false);

            if (pTitle) pTitle.textContent = fTitle?.value || 'Untitled project';
            if (pDesc) pDesc.textContent = fDesc?.value || '';
            if (pDue) pDue.textContent = fDue?.value ? `Due ${fmtHuman(fDue?.value)}` : 'No due date';

            // 6) NEW: perform deferred members refresh now
            if (state.needsMemberRefresh) {
                try { await hydrateMembers(); } catch { }
                state.needsMemberRefresh = false;
            }

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

    state.fpStart = window.flatpickr('#f_start', {
        dateFormat: 'Y-m-d',
        altInput: true,
        altFormat: 'd.m.Y',
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
        enforceDateBounds();
        recomputeDirty();
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

    bgLinkColor?.addEventListener('click', () => togglePopovers('color'));
    bgLinkImage?.addEventListener('click', () => {
        togglePopovers(null);
        bgFile?.click();
    });

    $$('#bg-uploader [data-bg]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const color = btn.getAttribute('data-bg');
            delete state.pending.background_path;
            if (state.original.background && !state.pending.hasOwnProperty('background_path')) {
                state.pending.background_path = null;
            }
            state.pending.background_color = color;
            highlightChip(btn);
            bgPreview?.classList.add('hidden');
            bgClear?.classList.remove('hidden');
            recomputeDirty();
            sendToParent('preview:bg-color', { color });
        });
    });

    bgFile?.addEventListener('change', async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        if (!/^image\//.test(file.type) || file.size > 5 * 1024 * 1024) {
            alert('Use image up to 5MB.'); bgFile.value = ''; return;
        }

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
            const stored = await uploadBackgroundFile(state.id, file);
            const url = await getSignedFileURL('project-backgrounds', stored.path);
            state.pending.background_color = null;
            state.pending.background_path = stored.path;
            recomputeDirty();
            if (url) sendToParent('preview:bg-image', { url });
            toast('Background uploaded.');
        } catch (err) {
            console.error('background', err);
            alert('Could not update background.');
        } finally {
            bgProgress?.classList.add('hidden');
        }
    });

    bgClear?.addEventListener('click', () => {
        if (bgFile) bgFile.value = '';
        if (bgImg) bgImg.src = '';
        bgPreview?.classList.add('hidden');
        bgClear?.classList.add('hidden');
        state.pending.background_path = null;
        state.pending.background_color = null;
        highlightChip(null);
        togglePopovers(null);
        recomputeDirty();
        sendToParent('preview:bg-clear', {});
    });
}

/* ========= Close / Delete ========= */
function closeAndDiscard() {
    // Clear local pending role edits & visual highlights (no DB writes)
    try {
        state.roleEdits.clear();
        state.needsMemberRefresh = false;
        $$('#membersList > li').forEach(li => li.classList.remove('ring-2', 'ring-amber-300', 'bg-amber-50/30'));
    } catch { }

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
