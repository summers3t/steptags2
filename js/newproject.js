// C:\steptags2\js\newproject.js
import { supabase, requireAuth } from './supabase.js'
import { uploadBackgroundFile, setProjectBackground } from './api.js'

const session = await requireAuth()
const userId = session.user.id

const form = document.querySelector('#project-form')
const statusBox = document.getElementById('project-status')
const showStatus = (msg) => {
    if (!statusBox) return
    statusBox.textContent = msg
    statusBox.classList.remove('hidden')
    statusBox.focus()
}

form?.addEventListener('submit', async (e) => {
    e.preventDefault()

    // AI route
    if (document.getElementById('use-ai')?.checked) {
        location.replace('/project-ai.html')
        return
    }

    // Read values BEFORE disabling (disabled fields are not included in FormData)
    const fd = new FormData(form)
    const title = (fd.get('title') || '').toString().trim()
    if (!title) { showStatus('Project name is required.'); return }

    const description = (fd.get('description') || '').toString().trim() || null
    const start_date = (fd.get('start_date') || '').toString().trim() || null
    const due_date = (fd.get('due_date') || '').toString().trim() || null

    // Now disable to prevent double-submit
    const toDisable = form.querySelectorAll('button, input, textarea, select')
    toDisable.forEach(el => { el.disabled = true })

    try {
        // 1) Create project. created_by defaults to auth.uid(); RLS with_check enforces it
        const { data: proj, error: insErr } = await supabase
            .from('projects')
            .insert({ title, description, start_date, due_date })
            .select('id')
            .single()

        if (insErr) { showStatus(`Error creating project: ${insErr.message}`); return }

        const projectId = proj.id

        // 2) Creator membership via AFTER INSERT trigger (ensure_creator_is_admin)
        // No client insert into project_members needed.

        // 3) Optional background upload if chosen
        const bgFileInput = document.getElementById('bgFile')
        const file = bgFileInput?.files?.[0]
        if (file) {
            if (!/^image\//.test(file.type) || file.size > 5 * 1024 * 1024) {
                showStatus('Invalid background. Use PNG/JPG up to 5 MB.')
            } else {
                try {
                    const stored = await uploadBackgroundFile(projectId, file) // { path }
                    await setProjectBackground(projectId, stored.path)
                } catch (bgErr) {
                    console.warn('Background upload failed', bgErr) // non-fatal
                }
            }
        }

        // 4) Navigate to project
        location.replace(`/projects/project.html?id=${projectId}`)
    } catch (err) {
        showStatus(err?.message || 'Unexpected error.')
    } finally {
        toDisable.forEach(el => { el.disabled = false })
    }
})
