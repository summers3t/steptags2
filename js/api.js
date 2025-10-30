// C:\steptags2\js\api.js
// Supabase thin API aligned to current DB. ESM only. No UI work here.
import { supabase } from './supabase.js';

/* ========== Helpers ========== */
function nowISO() { return new Date().toISOString(); }
export function assert(ok, msg = 'Unexpected error') { if (!ok) throw new Error(msg); }
export function uiToDbStatus(s) {
  const map = { todo: 'open', inprogress: 'in_progress', review: 'review', done: 'done' };
  return map[s] || s || 'open';
}
export function dbToUiStatus(s) {
  const map = { open: 'todo', in_progress: 'inprogress', review: 'review', done: 'done' };
  return map[s] || s || 'todo';
}

/* ========== Profiles ========== */
export function getPublicFileURL(bucket, path) {
  try { return supabase.storage.from(bucket).getPublicUrl(path).data?.publicUrl || ''; }
  catch { return ''; }
}

export async function getProfile(userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('id,email,display_name,avatar_path,avatar_url')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const avatar = data.avatar_url || (data.avatar_path ? getPublicFileURL('avatars', data.avatar_path) : '');
  return { ...data, avatar };
}

/* ========== Projects & Membership ========== */
export async function getProject(projectId) {
  const { data, error } = await supabase
    .from('projects')
    .select('id,title,description,background,background_color,start_date,due_date,created_by,updated_at')
    .eq('id', projectId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

export async function getMembership(projectId) {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth?.user?.id;
  if (!uid) throw new Error('Not authenticated');
  const { data, error } = await supabase
    .from('project_members')
    .select('role,status')
    .eq('project_id', projectId)
    .eq('user_id', uid)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

export function canWrite(role) { return role === 'owner' || role === 'admin'; }

export async function updateProject(projectId, patch) {
  const safe = {
    ...(patch.title !== undefined ? { title: patch.title } : {}),
    ...(patch.description !== undefined ? { description: patch.description } : {}),
    ...(patch.start_date !== undefined ? { start_date: patch.start_date } : {}),
    ...(patch.due_date !== undefined ? { due_date: patch.due_date } : {}),
    ...(patch.background_color !== undefined ? { background_color: patch.background_color } : {}),
    updated_at: nowISO()
  };
  const { error } = await supabase
    .from('projects')
    .update(safe, { returning: 'minimal' })
    .eq('id', projectId);
  if (error) throw error;
  return { id: projectId, ...safe };
}

/* Background path is stored in projects.background. */
export async function setProjectBackground(projectId, storagePath) {
  const { error } = await supabase
    .from('projects')
    .update({ background: storagePath, updated_at: nowISO() }, { returning: 'minimal' })
    .eq('id', projectId);
  if (error) throw error;
  return { id: projectId, background: storagePath };
}

export function signFilePath(bucket, path, expires = 3600) {
  return supabase.storage.from(bucket).createSignedUrl(path, expires);
}

/* ========== Steps ========== */
export async function listSteps(projectId) {
  const { data, error } = await supabase
    .from('steps')
    .select('id,project_id,parent_id,name,notes,status,due_date,order_num,idx,assigned_to,created_at,updated_at')
    .eq('project_id', projectId)
    .is('deleted_at', null)
    .order('parent_id', { ascending: true, nullsFirst: true })
    .order('order_num', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function createStep(projectId, payload) {
  const row = {
    project_id: projectId,
    parent_id: payload.parent_id ?? null,
    name: payload.name ?? 'New step',
    notes: payload.notes ?? null,
    status: uiToDbStatus(payload.status || 'todo'),
    due_date: payload.due_date ?? null,
    order_num: payload.order_num ?? 999999,
    idx: payload.idx ?? null,
    assigned_to: payload.assigned_to ?? null,
    created_at: nowISO(),
    updated_at: nowISO()
  };
  const { data, error } = await supabase
    .from('steps')
    .insert(row)
    .select('id,project_id,parent_id,name,notes,status,due_date,order_num,idx,assigned_to,created_at,updated_at')
    .single();
  if (error) throw error;
  return data;
}

export async function updateStep(stepId, patch) {
  const safe = {
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
    ...(patch.status !== undefined ? { status: uiToDbStatus(patch.status) } : {}),
    ...(patch.due_date !== undefined ? { due_date: patch.due_date } : {}),
    ...(patch.order_num !== undefined ? { order_num: patch.order_num } : {}),
    ...(patch.parent_id !== undefined ? { parent_id: patch.parent_id } : {}),
    ...(patch.assigned_to !== undefined ? { assigned_to: patch.assigned_to } : {}),
    updated_at: nowISO()
  };
  const { data, error } = await supabase
    .from('steps')
    .update(safe)
    .eq('id', stepId)
    .select('id,project_id,parent_id,name,notes,status,due_date,order_num,idx,assigned_to,created_at,updated_at')
    .single();
  if (error) throw error;
  return data;
}

export async function deleteStep(stepId) {
  const { data, error } = await supabase
    .from('steps')
    .update({ deleted_at: nowISO(), updated_at: nowISO() })
    .eq('id', stepId)
    .select('id,deleted_at')
    .single();
  if (error) throw error;
  return data;
}

/* RLS-safe list reordering helper. */
export async function reorderSteps(projectId, ordered) {
  const items = Array.isArray(ordered) && ordered.length
    ? (typeof ordered[0] === 'string'
      ? ordered.map((id, i) => ({ id, order_num: i + 1 }))
      : ordered.map(o => ({ id: o.id, order_num: o.order_num, parent_id: o.parent_id }))
    )
    : [];
  if (!items.length) return [];

  const tasks = items.map(({ id, order_num, parent_id }) =>
    supabase.from('steps')
      .update({
        order_num,
        ...(parent_id !== undefined ? { parent_id } : {}),
        updated_at: nowISO()
      }, { returning: 'minimal' })
      .eq('id', id)
      .eq('project_id', projectId)
  );
  const results = await Promise.allSettled(tasks);
  const firstErr = results.find(r => r.status === 'rejected');
  if (firstErr) throw firstErr.reason;
  return items;
}

export function subscribeSteps(projectId, callback) {
  const channel = supabase
    .channel(`steps:${projectId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'steps', filter: `project_id=eq.${projectId}` },
      (payload) => callback(payload)
    )
    .subscribe();
  return () => supabase.removeChannel(channel);
}

/* ========== Activities ========== */
export async function logActivity(projectId, kind, refTable, meta = {}) {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth?.user?.id || null;
  const row = { project_id: projectId, actor_id: uid, kind, ref_table: refTable, meta, created_at: nowISO() };
  const { data, error } = await supabase.from('activities').insert(row).select('id').single();
  if (error) throw error;
  return data.id;
}

/* ========== Files bucket helpers ========== */
export async function uploadProjectFile(projectId, file) {
  const ext = file.name.split('.').pop();
  const id = crypto.randomUUID();
  const path = `${projectId}/${id}.${ext}`;
  const { error: upErr } = await supabase.storage.from('project-files').upload(path, file, {
    upsert: false,
    contentType: file.type
  });
  if (upErr) throw upErr;

  const row = {
    project_id: projectId, name: file.name, mime: file.type, size: file.size,
    path, created_at: nowISO()
  };
  const { data, error } = await supabase
    .from('files')
    .insert(row)
    .select('id,project_id,name,mime,size,path,created_at')
    .single();
  if (error) throw error;

  return data;
}

export async function listFiles(projectId) {
  const { data, error } = await supabase
    .from('files')
    .select('id,name,mime,size,path,uploaded_by,created_at')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function deleteFile(fileId) {
  const { data, error } = await supabase.from('files').delete().eq('id', fileId).select('id,path').single();
  if (error) throw error;
  const path = data?.path;
  if (path) await supabase.storage.from('project-files').remove([path]).catch(() => { });
  return true;
}

export async function getSignedFileURL(bucket, path, expiresInSeconds = 3600) {
  if (!path) return null;
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, expiresInSeconds);
  if (error) throw error;
  return data?.signedUrl || null;
}

/* ========== Members & Invites ========== */
export function canWriteRole(role) { return canWrite(role); }

// Helper: load profiles in bulk
export async function fetchProfilesMap(userIds = []) {
  const ids = Array.from(new Set(userIds)).filter(Boolean);
  if (!ids.length) return new Map();
  const { data, error } = await supabase
    .from('profiles')
    .select('id,display_name,avatar_path,avatar_url,email')
    .in('id', ids);
  if (error) throw error;
  const m = new Map();
  for (const r of data || []) {
    const avatar = r.avatar_url || (r.avatar_path ? getPublicFileURL('avatars', r.avatar_path) : '');
    m.set(r.id, { name: r.display_name || r.email || 'User', avatar, email: r.email || '' });
  }
  return m;
}

export async function listProjectMembers(projectId) {
  // Prefer view if present. Fall back to base table with status filter.
  let rows = [];
  let usedView = true;
  let res = await supabase
    .from('v_project_members_active')
    .select('user_id,role,status,created_at,removed_at')
    .eq('project_id', projectId);
  if (res.error) { usedView = false; }
  if (!res.error) rows = res.data || [];
  if (!usedView) {
    const { data, error } = await supabase
      .from('project_members')
      .select('user_id,role,status,created_at,removed_at')
      .eq('project_id', projectId)
      .eq('status', 'active');
    if (error) throw error;
    rows = data || [];
  }
  const ids = rows.map(r => r.user_id);
  const profiles = await fetchProfilesMap(ids);
  return rows.map(r => ({
    user_id: r.user_id,
    role: r.role,
    status: r.status,
    created_at: r.created_at,
    removed_at: r.removed_at,
    profile: {
      display_name: profiles.get(r.user_id)?.name || '',
      email: profiles.get(r.user_id)?.email || '',
      avatar_path: profiles.get(r.user_id)?.avatar || ''
    }
  }));
}

export async function listProjectInvites(projectId, { includeAccepted = false } = {}) {
  const { data, error } = await supabase.rpc('list_pending_invites', {
    p_project_id: projectId,
    p_include_accepted: !!includeAccepted
  });
  if (error) throw error;
  return data || [];
}


// function randomToken(len = 40) {
//   const bytes = crypto.getRandomValues(new Uint8Array(len));
//   const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
//   return Array.from(bytes, b => alphabet[b % alphabet.length]).join('');
// }

// UUID tokens are generated in DB (gen_random_uuid()). Do not generate client-side.
export async function inviteMemberByEmail(projectId, email, role = 'member') {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth?.user?.id;
  if (!uid) throw new Error('Not authenticated');

  // Create invite (token generated server-side)
  const { data, error } = await supabase
    .from('project_member_invites')
    .insert({ project_id: projectId, email, role, invited_by: uid })
    .select('id,project_id,email,role,status,created_at,token,expires_at')
    .single();
  if (error) throw error;
  if (!data?.token) throw new Error('Invite created without token. Ensure token has DEFAULT gen_random_uuid().');

  // Human-readable labels (only existing columns)
  let inviter = '';
  try {
    const { data: prof } = await supabase
      .from('profiles')
      .select('display_name,email')
      .eq('id', uid)
      .maybeSingle();
    inviter = (prof?.display_name || prof?.email || '').trim();
  } catch { }

  let projectName = '';
  try {
    const { data: proj } = await supabase
      .from('projects')
      .select('title')
      .eq('id', projectId)
      .maybeSingle();
    projectName = (proj?.title || '').trim();
  } catch { }

  const qs = new URLSearchParams({ token: data.token });
  if (inviter) qs.set('inviter', inviter);
  if (projectName) qs.set('project', projectName);
  const link = `${location.origin}/invite.html?${qs.toString()}`;

  return { ...data, link, inviter, projectName };
}


export async function updateMemberRole(projectId, userId, role) {
  const { error } = await supabase
    .from('project_members')
    .update({ role, updated_at: nowISO() }, { returning: 'minimal' })
    .eq('project_id', projectId)
    .eq('user_id', userId);
  if (error) throw error;
  return { user_id: userId, role };
}

export async function removeMember(projectId, userId) {
  const { error } = await supabase
    .from('project_members')
    .update({ status: 'removed', removed_at: nowISO(), updated_at: nowISO() }, { returning: 'minimal' })
    .eq('project_id', projectId)
    .eq('user_id', userId);
  if (error) throw error;
  return { user_id: userId, status: 'removed' };
}

export async function acceptInvite(token) {
  if (!token) throw new Error('Missing token');
  const { data: rpc, error } = await supabase.rpc('accept_invite', { p_token: token });
  if (error) throw error;
  // rpc = { project_id: '...' }
  return { ok: true, project_id: rpc?.project_id || null };
}

// --- Activities: list (read-only) ---
export async function listActivities(projectId, limit = 100) {
  const { data, error } = await supabase
    .from('activities')
    .select('id,actor_id,kind,ref_table,meta,created_at')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

export function subscribeActivities(projectId, onEvent) {
  const ch = supabase
    .channel(`activities:${projectId}`)
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'activities', filter: `project_id=eq.${projectId}` },
      (_payload) => { try { onEvent(); } catch { } })
    .subscribe();
  return () => supabase.removeChannel(ch);
}

export async function fetchStepsMap(stepIds = []) {
  const ids = Array.from(new Set(stepIds)).filter(Boolean);
  if (!ids.length) return new Map();
  const { data, error } = await supabase
    .from('steps')
    .select('id,name')
    .in('id', ids);
  if (error) throw error;
  const m = new Map();
  for (const r of data || []) m.set(r.id, r.name || '');
  return m;
}

export async function softDeleteProject(projectId) {
  const { error } = await supabase
    .from('projects')
    .update({ deleted_at: new Date().toISOString() }, { returning: 'minimal' })
    .eq('id', projectId);
  if (error) {
    const fb = await supabase
      .from('projects')
      .update({ is_deleted: true }, { returning: 'minimal' })
      .eq('id', projectId);
    if (fb.error) throw fb.error;
    return { id: projectId, is_deleted: true };
  }
  return { id: projectId, deleted_at: nowISO() };
}

// Upload only (no DB row in public.files). Used for project backgrounds.
export async function uploadBackgroundFile(projectId, file) {
  const ext = file.name.split('.').pop();
  const id = crypto.randomUUID();
  const path = `${projectId}/${id}.${ext}`;
  const { error } = await supabase.storage
    .from('project-backgrounds')
    .upload(path, file, { upsert: false, contentType: file.type });
  if (error) throw error;
  return { path };
}

export async function sendInviteEmail({ email, link, projectName, inviterName, role, expiresAtISO }) {
  const resp = await fetch('/api/invite-send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, link, projectName, inviterName, role, expiresAtISO })
  });
  const json = await resp.json();
  if (!resp.ok) throw new Error(json?.error || 'Email send failed');
  return json;
}


export async function inviteAndEmail(projectId, email, role = 'member') {
  const invite = await inviteMemberByEmail(projectId, email, role);
  const expiresAtISO = invite?.expires_at || null;
  await sendInviteEmail({
    email,
    link: invite.link,
    projectName: invite.projectName || '',
    inviterName: invite.inviter || '',
    role,
    expiresAtISO
  });
  return invite;
}

export async function revokeProjectInvite(inviteId) {
  const { error } = await supabase.rpc('revoke_invite', { p_invite_id: inviteId });
  if (error) throw error;
  return true;
}

export async function resendProjectInvite(inviteId) {
  const { data, error } = await supabase.rpc('resend_invite', { p_invite_id: inviteId });
  if (error) throw error;
  let row = Array.isArray(data) ? data[0] : data;

  // Fallback: ensure we have fresh token/email from DB
  if (!row?.token || !row?.email) {
    const { data: fetched, error: e2 } = await supabase
      .from('project_member_invites')
      .select('email, token, expires_at')
      .eq('id', inviteId)
      .single();
    if (e2) throw e2;
    row = fetched;
  }
  return row;
}
