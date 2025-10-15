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
export async function getProfile(userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('id,email,display_name,avatar_path')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

/* ========== Projects & Membership ========== */
export async function getProject(projectId) {
  const { data, error } = await supabase
    .from('projects')
    .select('id,title,description,background,due_date,created_by,updated_at')
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
    ...(patch.due_date !== undefined ? { due_date: patch.due_date } : {}),
    updated_at: nowISO()
  };
  const { data, error } = await supabase
    .from('projects')
    .update(safe)
    .eq('id', projectId)
    .select('id,title,description,due_date,updated_at')
    .single();
  if (error) throw error;
  return data;
}

/* Background path is stored in projects.background. */
export async function setProjectBackground(projectId, storagePath) {
  const { data, error } = await supabase
    .from('projects')
    .update({ background: storagePath, updated_at: nowISO() })
    .eq('id', projectId)
    .select('id,background,updated_at')
    .single();
  if (error) throw error;
  return data;
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

/* RLS-safe list reordering helper (kept for Steps tab; Board never calls it). */
export async function reorderSteps(projectId, ordered) {
  const items = Array.isArray(ordered) && ordered.length
    ? (typeof ordered[0] === 'string'
       ? ordered.map((id, i) => ({ id, order_num: i + 1 }))
       : ordered.map(o => ({ id: o.id, order_num: o.order_num }))
      )
    : [];
  if (!items.length) return [];

  const tasks = items.map(({ id, order_num }) =>
    supabase.from('steps')
      .update({ order_num, updated_at: nowISO() })
      .eq('id', id)
      .eq('project_id', projectId)
      .select('id,order_num')
      .single()
  );
  const results = await Promise.allSettled(tasks);
  const firstErr = results.find(r => r.status === 'rejected');
  if (firstErr) throw firstErr.reason;
  return results.filter(r => r.status === 'fulfilled').map(r => r.value.data);
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

export async function listProjectMembers(projectId) {
  const { data, error } = await supabase
    .from('project_members')
    .select('user_id,role,status,created_at,removed_at,profiles:profiles!project_members_user_id_fkey(id,email,display_name,avatar_path)')
    .eq('project_id', projectId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data || []).map(r => ({
    user_id: r.user_id,
    role: r.role,
    status: r.status,
    created_at: r.created_at,
    removed_at: r.removed_at,
    profile: r.profiles
  }));
}

export async function listProjectInvites(projectId) {
  const { data, error } = await supabase
    .from('project_invites')
    .select('id,email,role,status,created_at,token')
    .eq('project_id', projectId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

function randomToken(len = 40) {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  return Array.from(bytes, b => alphabet[b % alphabet.length]).join('');
}

export async function inviteMemberByEmail(projectId, email, role = 'member') {
  const token = randomToken(40);
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth?.user?.id;
  if (!uid) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('project_invites')
    .insert({ project_id: projectId, email, role, token, created_by: uid })
    .select('id,email,role,status,created_at,token')
    .single();
  if (error) throw error;

  const link = `${location.origin}/projects/project.html?id=${encodeURIComponent(projectId)}&invite=${encodeURIComponent(token)}`;
  return { ...data, link };
}

export async function updateMemberRole(projectId, userId, role) {
  const { data, error } = await supabase
    .from('project_members')
    .update({ role })
    .eq('project_id', projectId)
    .eq('user_id', userId)
    .select('user_id,role')
    .single();
  if (error) throw error;
  return data;
}

export async function removeMember(projectId, userId) {
  const { data, error } = await supabase
    .from('project_members')
    .update({ status: 'removed', removed_at: nowISO() })
    .eq('project_id', projectId)
    .eq('user_id', userId)
    .select('user_id,status,removed_at')
    .single();
  if (error) throw error;
  return data;
}

export async function acceptInvite(projectId, token) {
  const cli = supabase._withHeaders({ 'x-invite-token': token });
  const { data: invite, error: e1 } = await cli
    .from('project_invites')
    .select('id,email,role,status')
    .eq('project_id', projectId)
    .eq('token', token)
    .maybeSingle();
  if (e1) throw e1;
  if (!invite || invite.status !== 'pending') throw new Error('Invite invalid');

  const { data: auth } = await supabase.auth.getUser();
  const uid = auth?.user?.id;
  if (!uid) throw new Error('Not authenticated');

  const { error: e2 } = await supabase
    .from('project_members')
    .insert({ project_id: projectId, user_id: uid, role: invite.role, status: 'active' });
  if (e2 && !String(e2.message || '').includes('duplicate')) throw e2;

  const { error: e3 } = await supabase
    .from('project_invites')
    .update({ status: 'accepted', accepted_at: nowISO() })
    .eq('id', invite.id);
  if (e3) throw e3;

  return { ok: true };
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
      (_payload) => { try { onEvent(); } catch {} })
    .subscribe();
  return () => supabase.removeChannel(ch);
}

export async function fetchProfilesMap(userIds = []) {
  const ids = Array.from(new Set(userIds)).filter(Boolean);
  if (!ids.length) return new Map();
  const { data, error } = await supabase
    .from('profiles')
    .select('id,display_name,avatar_path,email')
    .in('id', ids);
  if (error) throw error;
  const m = new Map();
  for (const r of data || []) {
    m.set(r.id, {
      name: r.display_name || r.email || 'User',
      avatar: r.avatar_path || ''
    });
  }
  return m;
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
