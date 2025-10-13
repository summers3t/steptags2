import { supabase } from './supabase.js';

/* ---------- Profile ---------- */
export async function getProfile(userId) {
    const { data, error } = await supabase
        .from('profiles')
        .select('id,email,display_name,avatar_path')
        .eq('id', userId)
        .maybeSingle();
    if (error) throw error;
    return data || null;
}

/* ---------- Resolvers for header ---------- */
export function resolveDisplayName(user, profile) {
    const meta = user?.user_metadata || {};
    const id0 = Array.isArray(user?.identities) ? user.identities[0]?.identity_data || {} : {};
    return (
        profile?.display_name ||
        meta.full_name || meta.name ||
        id0.full_name || id0.name ||
        (user?.email ? user.email.split('@')[0] : 'User')
    );
}

export function resolveAvatarUrl(user, profile) {
    // Prefer OAuth avatar if present. Fallback to identities.picture.
    const meta = user?.user_metadata || {};
    const id0 = Array.isArray(user?.identities) ? user.identities[0]?.identity_data || {} : {};
    return meta.avatar_url || meta.picture || id0.avatar_url || id0.picture || '';
}

/* ---------- Projects (RLS filters visibility) ---------- */
/* Remove ORDER to avoid timeouts first. Keep columns minimal. Limit rows. */
export function listProjectsQuery() {
    return supabase
        .from('projects')
        .select('id,title,description,created_at,created_by')
        .is('deleted_at', null)
        .limit(100);
}

/* Create + owner membership */
export async function createProject({ title, description = null }) {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id;
    if (!uid) throw new Error('Not authenticated');

    const { data: proj, error: e1 } = await supabase
        .from('projects')
        .insert([{ title, description, created_by: uid }])
        .select('id,title,description,created_by,created_at')
        .single();
    if (e1) throw e1;

    const { error: e2 } = await supabase.from('project_members').insert([
        { project_id: proj.id, user_id: uid, role: 'owner', status: 'active' }
    ]);
    if (e2 && !String(e2.message || '').includes('duplicate')) throw e2;

    return proj;
}

export async function softDeleteProject(projectId) {
    const { error } = await supabase
        .from('projects')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', projectId);
    if (error) throw error;
}

export async function getSignedFileURL(bucket, path, expiresInSeconds = 3600) {
    if (!path) return null;
    const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, expiresInSeconds);
    if (error) throw error;
    return data?.signedUrl || null;
}
