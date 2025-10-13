// C:\steptags2\js\newproject.js
import { supabase, requireAuth } from './supabase.js'
// Import createProject if you want to use the function from api.js, but since
// the logic is simple and requires immediate project_members insert, we keep it here.

const session = await requireAuth()
const userId = session.user.id

const form = document.querySelector('#new-project-form')
form?.addEventListener('submit', async (e) => {
    e.preventDefault()

    // Disable form elements to prevent double submission
    form.querySelectorAll('button, input').forEach(el => el.disabled = true);

    const fd = new FormData(form)
    const title = (fd.get('title') || '').toString().trim() || 'Untitled'
    const description = (fd.get('description') || '').toString().trim() || null
    const due_date = fd.get('due_date') || null

    // 1. Create the Project
    const { data: projectData, error: projectError } = await supabase.from('projects')
        .insert({
            title,
            description,
            due_date,
            created_by: userId,
            // Ensure updated_at is set for dashboard sorting
            updated_at: new Date().toISOString()
        })
        .select('id')
        .single()

    if (projectError) {
        alert(`Error creating project: ${projectError.message}`);
        form.querySelectorAll('button, input').forEach(el => el.disabled = false); // Re-enable form
        return;
    }

    const projectId = projectData.id;

    // 2. IMPORTANT: Insert the project creator as an 'owner' in project_members
    // This satisfies the RLS policy and grants the creator full access.
    const { error: memberError } = await supabase.from('project_members')
        .insert({
            project_id: projectId,
            user_id: userId,
            role: 'owner', // Default role for the creator
            status: 'active'
        });

    if (memberError) {
        console.error("Failed to insert owner membership:", memberError);
        // Alert the user, but still navigate as the project is technically created.
        // The user will be the creator, so they might still see it. RLS will ensure access.
        alert(`Warning: Project created, but failed to set you as explicit owner. Please check the database. Error: ${memberError.message}`);
    }

    // 3. Navigate to the new project page
    location.replace(`/projects/project.html?id=${projectId}`);
})