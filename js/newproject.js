// C:\steptags2\js\newproject.js
import { supabase, requireAuth } from './supabase.js'

const session = await requireAuth()
const userId = session.user.id

const form = document.querySelector('#new-project-form')
form?.addEventListener('submit', async (e) => {
    e.preventDefault()
    const fd = new FormData(form)
    const title = (fd.get('title') || '').toString().trim() || 'Untitled'
    const description = (fd.get('description') || '').toString().trim() || null
    const due_date = fd.get('due_date') || null

    const { data, error } = await supabase.from('projects')
        .insert({ title, description, due_date, created_by: userId })
        .select('id')
        .single()

    if (error) { alert(error.message); return }
    location.replace(`/project.html?id=${data.id}`)
})
