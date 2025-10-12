// Central helpers for profiles/avatars
import { supabase } from '/js/supabase.js';

const AVATAR_BUCKET = 'avatars';

export async function getProfile(userId) {
    // Select * to be resilient to column-name differences (display_name/name/email/…)
    const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle();
    if (error) throw error;
    return data || null;
}

function isUrl(s) { return typeof s === 'string' && /^https?:\/\//i.test(s); }
function firstTruthy(...vals) { return vals.find(v => typeof v === 'string' ? v.trim() : v) || ''; }

export function resolveDisplayName(user, profile) {
    const m = user?.user_metadata || {};
    // Try many candidates; trim + join when needed
    const name = firstTruthy(
        profile?.display_name,
        profile?.name,
        profile?.full_name,
        profile?.username,
        `${firstTruthy(profile?.first_name)} ${firstTruthy(profile?.last_name)}`.trim(),
        m.full_name,
        m.name,
        m.user_name,
        m.preferred_username,
        `${firstTruthy(m.given_name)} ${firstTruthy(m.family_name)}`.trim(),
        user?.email
    );
    return name || 'User';
}

export async function resolveAvatarUrl(user, profile) {
    const meta = user?.user_metadata || {};

    // 1) Storage path in a variety of possible profile fields
    const storagePath = firstTruthy(
        profile?.avatar_path,
        profile?.avatar,        // sometimes stored as "avatar"
        profile?.photo_path
    );
    if (storagePath) {
        try {
            const { data, error } = await supabase.storage.from(AVATAR_BUCKET).createSignedUrl(storagePath, 3600);
            if (!error && data?.signedUrl) return data.signedUrl;
        } catch { }
    }

    // 2) Direct URL on profile (various field names)
    const directProfileUrl = firstTruthy(
        profile?.avatar_url,
        profile?.photo_url,
        profile?.image_url,
        profile?.picture
    );
    if (isUrl(directProfileUrl)) return directProfileUrl;

    // 3) OAuth / user metadata (Google etc.)
    const oauthUrl = firstTruthy(
        meta.avatar_url,
        meta.picture,
        meta.photo_url,
        meta.image_url
    );
    if (isUrl(oauthUrl)) return oauthUrl;

    // 4) Fallback (seeded)
    return `https://i.pravatar.cc/64?u=${encodeURIComponent(user?.id || 'anon')}`;
}



/* ---------- Projects ---------- */
export const listProjects = () =>
    supabase.from('projects')
        .select('*')
        .neq('is_deleted', true)
        .order('created_at', { ascending: false });

export const createProject = (payload) =>
    supabase.from('projects').insert([payload]).select().single();

export const updateProject = (id, patch) =>
    supabase.from('projects').update(patch).eq('id', id).select().single();

export const softDeleteProject = (id) =>
    supabase.from('projects').update({ deleted_at: new Date().toISOString(), is_deleted: true }).eq('id', id);

/* ---------- Steps / Substeps ---------- */
export const listSteps = (project_id) =>
    supabase.from('steps').select('*').eq('project_id', project_id).order('idx');

export const createStep = (row) =>
    supabase.from('steps').insert([row]).select().single(); // idx via trigger

export const updateStep = (id, patch) =>
    supabase.from('steps').update(patch).eq('id', id).select().single();

export const softDeleteStep = (id) =>
    supabase.from('steps').update({ deleted_at: new Date().toISOString() }).eq('id', id);

export const moveStep = (project_id, step_id, dir /* 'up'|'down' */) =>
    supabase.rpc('move_step', { p_project_id: project_id, p_step_id: step_id, p_dir: dir });

export const listSubsteps = (parent_step_id) =>
    supabase.from('substeps').select('*').eq('parent_step_id', parent_step_id).order('idx');

export const createSubstep = (row) =>
    supabase.from('substeps').insert([row]).select().single(); // project_id via trigger

/* ---------- Items + linking ---------- */
export const listItems = (project_id) =>
    supabase.rpc('list_project_items', { p_project_id: project_id });

export const upsertItem = (row) =>
    supabase.from('items').upsert(row, { onConflict: 'id' }).select().single();

export const attachItem = (step_id, item_id) =>
    supabase.rpc('attach_item', { p_step_id: step_id, p_item_id: item_id });

export const detachItem = (step_id, item_id) =>
    supabase.rpc('detach_item', { p_step_id: step_id, p_item_id: item_id });

export const setItemStatus = (project_id, item_id, status) =>
    supabase.rpc('set_item_status', { p_project_id: project_id, p_item_id: item_id, p_status: status });

/* ---------- Comments ---------- */
export const listComments = (project_id, { step_id, substep_id } = {}) => {
    let q = supabase.from('comments').select('*').eq('project_id', project_id)
        .order('created_at', { ascending: false });
    if (step_id) q = q.eq('step_id', step_id);
    if (substep_id) q = q.eq('substep_id', substep_id);
    return q;
};
export const addComment = (row) =>
    supabase.from('comments').insert([row]).select().single();

/* ---------- Chat ---------- */
export const fetchChat = (project_id, recipient_id = null) =>
    supabase.from('chat_messages')
        .select('*')
        .eq('project_id', project_id)
        .is('recipient_id', recipient_id)
        .order('created_at');

export const sendChat = (row /* {project_id, sender_id, recipient_id?, body} */) =>
    supabase.from('chat_messages').insert([row]).select().single();

/* ---------- Flags ---------- */
export const toggleFlag = (step_id, on = null) =>
    supabase.rpc('toggle_step_flag', { p_step_id: step_id, p_on: on });

export const listMyFlaggedStepIds = (project_id) =>
    supabase.rpc('list_flagged_step_ids', { p_project_id: project_id });

/* ---------- Members / Invites ---------- */
export const listMembers = (project_id) =>
    supabase.from('project_members').select('*').eq('project_id', project_id);

export const inviteByEmail = (project_id, email, role = 'guest') =>
    supabase.rpc('invite_member_by_email', { p_project_id: project_id, p_email: email, p_role: role });

export const resendInvite = (invite_id) =>
    supabase.rpc('resend_project_invite', { p_invite_id: invite_id });

export const revokeInvite = (invite_id) =>
    supabase.rpc('revoke_project_invite', { p_invite_id: invite_id });

export const acceptInvite = (token) =>
    supabase.rpc('accept_invite', { p_token: token });

export const leaveProject = (project_id) =>
    supabase.rpc('leave_project', { p_project_id: project_id });

export const updateMemberRole = (project_id, user_id, role) =>
    supabase.rpc('update_project_member_role', { p_project_id: project_id, p_user_id: user_id, p_role: role });

/* ---------- Storage ---------- */
export const uploadAvatar = (userId, file) =>
    supabase.storage.from('avatars').upload(`${userId}/${crypto.randomUUID()}`, file);

export const uploadProjectBg = (projectId, file) =>
    supabase.storage.from('project-backgrounds').upload(`${projectId}/${crypto.randomUUID()}`, file);

export const uploadProjectItem = (projectId, file) =>
    supabase.storage.from('project-items').upload(`${projectId}/${crypto.randomUUID()}`, file);
