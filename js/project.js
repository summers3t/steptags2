/* C:\steptags2\js\project.js */
(() => {
    const qs = (s, el = document) => el.querySelector(s);
    const qsa = (s, el = document) => [...el.querySelectorAll(s)];
    const byId = id => document.getElementById(id);

    /* ---------- Demo data ---------- */
    const DEMO = {
        'website-redesign': {
            title: 'Website Redesign',
            members: [
                { id: 'u1', name: 'Alice Lee', initials: 'AL' },
                { id: 'u2', name: 'Ben Kim', initials: 'BK' },
                { id: 'u3', name: 'Chen Yu', initials: 'CY' }
            ],
            steps: [
                { title: 'Audit current site', assignee: 'AL', status: 'backlog', due: '' },
                {
                    title: 'Sitemap', assignee: 'AL', status: 'inprogress', due: '', children: [
                        { title: 'Collect pages', assignee: 'AL', status: 'inprogress' },
                        { title: 'Group sections', assignee: 'BK', status: 'backlog' }
                    ]
                },
                {
                    title: 'Figma wireframes', assignee: 'BK', status: 'review', children: [
                        { title: 'Home', assignee: 'BK', status: 'review' },
                        { title: 'Pricing', assignee: 'BK', status: 'backlog' }
                    ]
                },
                { title: 'Implement Tailwind UI', assignee: 'CY', status: 'backlog' },
                { title: 'SEO baseline', assignee: 'AL', status: 'backlog' }
            ],
            activity: ['Project created', 'Initial steps added']
        },
        'mobile-app': {
            title: 'Mobile App Development',
            members: [
                { id: 'u4', name: 'Dana Ortiz', initials: 'DO' },
                { id: 'u5', name: 'Eli Novak', initials: 'EN' },
                { id: 'u6', name: 'Fatima Rahman', initials: 'FR' }
            ],
            steps: [
                { title: 'Define MVP scope', assignee: 'DO', status: 'inprogress' },
                {
                    title: 'Auth screens', assignee: 'EN', status: 'inprogress', children: [
                        { title: 'Login', assignee: 'EN', status: 'inprogress' },
                        { title: 'Signup', assignee: 'EN', status: 'backlog' }
                    ]
                },
                { title: 'API contract', assignee: 'FR', status: 'review' },
                { title: 'Offline mode', assignee: 'FR', status: 'backlog' }
            ],
            activity: ['Kickoff call scheduled']
        },
        'marketing-campaign': {
            title: 'Marketing Campaign',
            members: [
                { id: 'u7', name: 'Giorgos P.', initials: 'GP' },
                { id: 'u8', name: 'Helena V.', initials: 'HV' }
            ],
            steps: [
                { title: 'Audience research', assignee: 'HV', status: 'inprogress' },
                {
                    title: 'Creative concepts', assignee: 'GP', status: 'backlog', children: [
                        { title: 'Concept A', assignee: 'GP', status: 'backlog' },
                        { title: 'Concept B', assignee: 'GP', status: 'backlog' }
                    ]
                },
                { title: 'Channel plan', assignee: 'HV', status: 'backlog' },
                { title: 'Landing page', assignee: 'GP', status: 'backlog' }
            ],
            activity: ['Budget approved']
        }
    };

    /* ---------- URL + project pick ---------- */
    const params = new URLSearchParams(location.search);
    const projectKey = params.get('id') || 'website-redesign';
    const demo = DEMO[projectKey] || DEMO['website-redesign'];

    byId('projectTitle').textContent = demo.title;
    byId('projectIdLabel').textContent = `id=${projectKey}`;

    /* ---------- Flatpickr Monday-first ---------- */
    const fpCfg = { dateFormat: 'Y-m-d', weekNumbers: true, locale: { firstDayOfWeek: 1 } };
    if (byId('timelineRange')) flatpickr(byId('timelineRange'), { mode: 'range', ...fpCfg });
    flatpickr(byId('m_step_due'), fpCfg);

    /* ---------- Tabs ---------- */
    const switchTab = (tab) => {
        qsa('[id^="tab-"]').forEach(n => n.classList.add('hidden'));
        byId(`tab-${tab}`).classList.remove('hidden');
        qsa('.tab-btn').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === tab ? 'true' : 'false'));
    };
    qsa('.tab-btn').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)));
    switchTab('steps');

    /* ---------- State ---------- */
    let uid = 1;
    const genId = () => `n${uid++}`;
    const now = () => new Date().toISOString();
    const colDefs = [
        { key: 'backlog', title: 'Backlog' },
        { key: 'inprogress', title: 'In Progress' },
        { key: 'review', title: 'Review' },
        { key: 'done', title: 'Done' },
    ];

    /** Node shape: {id,parentId,title,done,assignee,due,order,status} */
    let nodes = [];
    const activity = [];
    const comments = [];
    const files = [];
    const members = demo.members.slice();

    /* seed tree from nested demo.steps */
    const pushStep = (step, parentId = null) => {
        const id = genId();
        const order = (nodes.filter(n => n.parentId === parentId).at(-1)?.order ?? -1) + 1;
        nodes.push({
            id, parentId,
            title: step.title,
            done: !!step.done,
            assignee: step.assignee || '',
            due: step.due || '',
            order,
            status: step.status || 'backlog'
        });
        (step.children || []).forEach(ch => pushStep(ch, id));
    };
    demo.steps.forEach(s => pushStep(s));
    demo.activity.forEach(a => activity.unshift({ id: genId(), text: a, at: now() }));

    /* ---------- Summary / People ---------- */
    const renderSummary = () => {
        const total = nodes.length;
        const done = nodes.filter(n => n.done).length;
        const byCol = colDefs.map(c => {
            const count = nodes.filter(n => n.parentId === null && n.status === c.key).length;
            return `<li>${c.title}: <span class="font-medium">${count}</span></li>`;
        }).join('');
        byId('summaryList').innerHTML = `
      <li>Total: <span class="font-medium">${total}</span></li>
      <li>Done: <span class="font-medium">${done}</span></li>
      <li>Open: <span class="font-medium">${total - done}</span></li>
      <hr class="my-1 border-neutral-200" />
      ${byCol}
    `;
    };
    const renderPeople = () => {
        // members chips (source of truth), not inferred from assignments
        byId('peopleChips').innerHTML = members.map(m => `
      <span class="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-neutral-100 border text-xs" title="${m.name}">
        <span class="inline-flex h-5 w-5 items-center justify-center rounded-full bg-white border">${m.initials}</span>
        <span>${m.name}</span>
      </span>
    `).join('');
    };

    /* ---------- Steps Tree ---------- */
    const stepsTree = byId('stepsTree');
    const childrenOf = (pid) => nodes.filter(n => n.parentId === pid).sort((a, b) => a.order - b.order);

    const renderTree = () => {
        stepsTree.innerHTML = '';
        const renderBranch = (pid, depth = 0, container = stepsTree) => {
            childrenOf(pid).forEach(node => {
                const li = document.createElement('li');
                li.setAttribute('role', 'treeitem');
                li.setAttribute('aria-level', String(depth + 1));
                li.draggable = true;
                li.dataset.id = node.id;

                li.innerHTML = `
          <div class="group flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-neutral-50">
            <button class="toggle w-4 h-4 text-neutral-400" aria-label="expand/collapse"></button>
            <input type="checkbox" class="shrink-0 rounded" ${node.done ? 'checked' : ''} />
            <input class="flex-1 bg-transparent outline-none text-sm px-1 py-0.5 rounded focus:ring"
                   value="${node.title.replace(/"/g, '&quot;')}" />
            <span class="text-[10px] px-1.5 py-0.5 rounded-full bg-neutral-100 border">${node.assignee || '—'}</span>
            <button class="date px-2 py-0.5 text-xs rounded bg-neutral-100 border">${node.due || 'Due'}</button>
            <button class="substep text-xs px-2 py-1 rounded bg-neutral-200">+ substep</button>
            <button class="del text-xs px-2 py-1 rounded bg-red-50 text-red-700 opacity-0 group-hover:opacity-100">Delete</button>
          </div>
          <ul class="ml-5 pl-3 border-l border-neutral-200 space-y-1"></ul>
        `;

                const childUl = li.querySelector('ul');
                const hasKids = childrenOf(node.id).length > 0;
                const toggle = li.querySelector('.toggle');
                toggle.innerHTML = hasKids ? '▾' : '';
                toggle.dataset.state = 'open';
                toggle.addEventListener('click', () => {
                    const open = toggle.dataset.state !== 'closed';
                    toggle.dataset.state = open ? 'closed' : 'open';
                    toggle.textContent = hasKids ? (open ? '▸' : '▾') : '';
                    childUl.classList.toggle('hidden', open);
                });

                li.querySelector('input[type="checkbox"]').addEventListener('change', (e) => {
                    node.done = e.target.checked;
                    addActivity(`${node.title} ${node.done ? 'completed' : 'reopened'}`);
                    renderSummary();
                    renderBoard();
                });

                const titleEl = li.querySelector('input.flex-1');
                titleEl.addEventListener('input', e => node.title = e.target.value);
                li.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        const siblingOrder = (childrenOf(node.parentId).at(-1)?.order ?? -1) + 1;
                        const newNode = { id: genId(), parentId: node.parentId, title: 'New step', done: false, assignee: '', due: '', order: siblingOrder, status: 'backlog' };
                        nodes.push(newNode);
                        addActivity('Added step');
                        renderAll();
                        stepsTree.querySelector(`[data-id="${newNode.id}"] input.flex-1`)?.focus();
                    }
                    if (e.key === 'Tab') {
                        e.preventDefault();
                        const sibs = childrenOf(node.parentId);
                        const myIdx = sibs.findIndex(n => n.id === node.id);
                        const prev = sibs[myIdx - 1];
                        if (e.shiftKey) {
                            if (node.parentId) {
                                const parent = nodes.find(n => n.id === node.parentId);
                                node.parentId = parent.parentId;
                                node.order = (childrenOf(node.parentId).at(-1)?.order ?? -1) + 1;
                                renderAll();
                            }
                        } else if (prev) {
                            node.parentId = prev.id;
                            node.order = (childrenOf(prev.id).at(-1)?.order ?? -1) + 1;
                            renderAll();
                        }
                    }
                });

                li.querySelector('.date').addEventListener('click', (e) => {
                    flatpickr(e.currentTarget, {
                        ...fpCfg,
                        defaultDate: node.due || null,
                        onChange: (sel) => {
                            node.due = sel[0] ? sel[0].toISOString().slice(0, 10) : '';
                            e.currentTarget.textContent = node.due || 'Due';
                            renderTimeline();
                        }
                    }).open();
                });

                li.querySelector('.substep').addEventListener('click', () => {
                    const newNode = { id: genId(), parentId: node.id, title: 'New substep', done: false, assignee: '', due: '', order: (childrenOf(node.id).at(-1)?.order ?? -1) + 1, status: 'backlog' };
                    nodes.push(newNode);
                    addActivity('Added substep');
                    renderAll();
                });

                li.querySelector('.del').addEventListener('click', () => {
                    pendingDeleteId = node.id;
                    modals.delete.showModal();
                });

                li.addEventListener('dragstart', ev => {
                    ev.dataTransfer.setData('text/plain', node.id);
                    ev.dataTransfer.effectAllowed = 'move';
                });
                li.addEventListener('dragover', ev => { ev.preventDefault(); ev.dataTransfer.dropEffect = 'move'; });
                li.addEventListener('drop', ev => {
                    ev.preventDefault();
                    const draggedId = ev.dataTransfer.getData('text/plain');
                    if (!draggedId || draggedId === node.id) return;
                    const dragged = nodes.find(n => n.id === draggedId);
                    dragged.parentId = node.parentId;
                    dragged.order = nodes.filter(n => n.parentId === node.parentId).length;
                    addActivity(`Reordered ${dragged.title}`);
                    renderAll();
                });

                container.appendChild(li);
                renderBranch(node.id, depth + 1, childUl);
            });
        };
        renderBranch(null, 0, stepsTree);
    };

    /* ---------- Board ---------- */
    const boardEl = byId('boardColumns');
    const renderBoard = () => {
        boardEl.innerHTML = colDefs.map(c => `
      <div class="rounded-xl bg-neutral-50 border border-neutral-200 p-2 flex flex-col min-h-[16rem]" data-col="${c.key}">
        <header class="text-xs font-semibold px-1 py-1">${c.title}</header>
        <div class="flex-1 space-y-2" data-dropzone="true"></div>
      </div>
    `).join('');
        colDefs.forEach(c => {
            const dz = boardEl.querySelector(`[data-col="${c.key}"] [data-dropzone]`);
            dz.addEventListener('dragover', e => { e.preventDefault(); });
            dz.addEventListener('drop', e => {
                e.preventDefault();
                const id = e.dataTransfer.getData('text/plain');
                const n = nodes.find(x => x.id === id);
                if (!n) return;
                n.status = c.key;
                addActivity(`Moved "${n.title}" to ${c.title}`);
                renderBoard();
            });
        });
        nodes.filter(n => n.parentId === null).forEach(n => {
            const card = document.createElement('div');
            card.className = 'rounded-lg bg-white shadow p-2 text-sm border';
            card.draggable = true;
            card.dataset.id = n.id;
            card.innerHTML = `
        <div class="flex items-center justify-between gap-2">
          <span class="${n.done ? 'line-through text-neutral-400' : ''}">${n.title}</span>
          <span class="text-[10px] px-1.5 py-0.5 rounded-full bg-neutral-100 border">${n.assignee || '—'}</span>
        </div>`;
            card.addEventListener('dragstart', ev => {
                ev.dataTransfer.setData('text/plain', n.id);
                ev.dataTransfer.effectAllowed = 'move';
            });
            const host = boardEl.querySelector(`[data-col="${n.status}"] [data-dropzone]`);
            host.appendChild(card);
        });
    };

    /* ---------- Timeline ---------- */
    const tlCanvas = byId('timelineCanvas');
    const renderTimeline = () => {
        tlCanvas.innerHTML = '';
        const tops = nodes.filter(n => n.parentId === null);
        const wrap = document.createElement('div');
        wrap.className = 'relative h-full';
        tops.forEach((n, i) => {
            const bar = document.createElement('div');
            bar.className = 'absolute left-0 right-10 h-6 rounded bg-neutral-200 border';
            bar.style.top = `${10 + i * 28}px`;
            const d = n.due ? new Date(n.due) : null;
            const day = d ? ((d.getDay() || 7)) : 7; // Mon=1..Sun=7
            const pct = (day - 1) / 6;
            bar.style.marginLeft = `calc(${pct * 100}% - 0px)`;
            bar.style.width = '30%';
            bar.title = `${n.title}${n.due ? ` • ${n.due}` : ''}`;
            wrap.appendChild(bar);
        });
        tlCanvas.appendChild(wrap);
    };
    qsa('.tl-btn').forEach(b => b.addEventListener('click', () => {
        qsa('.tl-btn').forEach(x => x.classList.toggle('bg-neutral-900', x === b));
        qsa('.tl-btn').forEach(x => x.classList.toggle('text-white', x === b));
        qsa('.tl-btn').forEach(x => x.classList.toggle('bg-neutral-200', x !== b));
        renderTimeline();
    }));

    /* ---------- Notes ---------- */
    byId('notesArea').addEventListener('focus', (e) => {
        if (e.target.textContent.trim() === 'Type notes here…') e.target.textContent = '';
    });

    /* ---------- Files ---------- */
    const dropzone = byId('dropzone');
    dropzone.addEventListener('click', () => {
        const input = document.createElement('input');
        input.type = 'file'; input.multiple = true;
        input.onchange = () => addFiles([...input.files]);
        input.click();
    });
    ['dragover', 'drop'].forEach(evt => {
        dropzone.addEventListener(evt, e => {
            e.preventDefault();
            if (evt === 'drop') addFiles([...e.dataTransfer.files]);
        });
    });
    const addFiles = (fileList) => {
        fileList.forEach(f => files.push({ id: genId(), name: f.name, size: f.size }));
        renderFiles();
        addActivity(`Added ${fileList.length} file(s)`);
    };
    const renderFiles = () => {
        byId('fileList').innerHTML = files.map(f => `
      <li class="flex items-center justify-between rounded-lg bg-neutral-50 border px-3 py-2">
        <span class="text-sm">${f.name}</span>
        <span class="text-xs text-neutral-500">${(f.size / 1024).toFixed(1)} KB</span>
      </li>`).join('');
    };

    /* ---------- Activity & Comments ---------- */
    const addActivity = (text) => {
        activity.unshift({ id: genId(), text, at: now() });
        renderActivity();
    };
    const renderActivity = () => {
        byId('activityFeed').innerHTML = activity.map(a => `
      <li class="flex items-center justify-between">
        <span>${a.text}</span>
        <span class="text-[10px] text-neutral-400">${new Date(a.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
      </li>`).join('');
    };
    byId('commentSend').addEventListener('click', () => {
        const v = byId('commentInput').value.trim();
        if (!v) return;
        comments.push({ id: genId(), text: v, at: now() });
        byId('commentInput').value = '';
        renderComments();
    });
    const renderComments = () => {
        byId('commentsList').innerHTML = comments.map(c => `
      <li class="rounded-lg bg-neutral-50 border px-3 py-2 text-sm">
        <div>${c.text}</div>
        <div class="text-[10px] text-neutral-400 mt-1">${new Date(c.at).toLocaleString()}</div>
      </li>`).join('');
    };

    /* ---------- Modals ---------- */
    const modals = {
        step: byId('modalStep'),
        import: byId('modalImport'),
        assign: byId('modalAssign'),
        delete: byId('modalDelete')
    };
    let editingId = null;
    let pendingDeleteId = null;

    byId('addStepBtn').addEventListener('click', () => {
        editingId = null;
        byId('m_step_title').value = '';
        byId('m_step_assignee').value = '';
        byId('m_step_due').value = '';
        byId('m_step_done').checked = false;
        modals.step.showModal();
    });
    byId('bulkImportBtn').addEventListener('click', () => modals.import.showModal());
    byId('assignBtn').addEventListener('click', () => modals.assign.showModal());

    byId('m_step_save').addEventListener('click', (e) => {
        e.preventDefault();
        const title = byId('m_step_title').value.trim() || 'New step';
        const assignee = byId('m_step_assignee').value.trim();
        const due = byId('m_step_due').value.trim();
        const done = byId('m_step_done').checked;
        if (editingId) {
            const n = nodes.find(n => n.id === editingId); if (!n) return;
            Object.assign(n, { title, assignee, due, done });
            addActivity(`Edited "${title}"`);
        } else {
            const order = (nodes.filter(n => n.parentId === null).at(-1)?.order ?? -1) + 1;
            nodes.push({ id: genId(), parentId: null, title, assignee, due, done, order, status: 'backlog' });
            addActivity(`Added "${title}"`);
        }
        modals.step.close();
        renderAll();
    });

    byId('m_import_apply').addEventListener('click', (e) => {
        e.preventDefault();
        const lines = byId('m_import_text').value.split('\n').map(l => l.replace(/\t/g, '  '));
        const stack = [null];
        lines.forEach(line => {
            if (!line.trim()) return;
            const indent = (line.match(/^(\s*)/)?.[0].length || 0) / 2;
            const title = line.replace(/^\s*[-*]?\s*/, '');
            const parentId = stack[indent] ?? null;
            const id = genId();
            const order = (nodes.filter(n => n.parentId === parentId).at(-1)?.order ?? -1) + 1;
            nodes.push({ id, parentId, title, done: false, assignee: '', due: '', order, status: 'backlog' });
            stack[indent + 1] = id;
            stack.length = indent + 2;
        });
        modals.import.close();
        addActivity('Imported steps');
        renderAll();
    });

    byId('m_assign_apply').addEventListener('click', (e) => {
        e.preventDefault();
        const list = byId('m_assign_names').value.split(',').map(s => s.trim()).filter(Boolean);
        if (!list.length) { modals.assign.close(); return; }
        const tops = nodes.filter(n => n.parentId === null);
        tops.forEach((n, i) => n.assignee = (list[i % list.length] || '').slice(0, 2).toUpperCase());
        modals.assign.close();
        addActivity('Assigned people');
        renderAll();
    });

    byId('m_delete_confirm').addEventListener('click', (e) => {
        e.preventDefault();
        const toDelete = new Set();
        const mark = (id) => {
            toDelete.add(id);
            nodes.filter(n => n.parentId === id).forEach(ch => mark(ch.id));
        };
        if (pendingDeleteId) mark(pendingDeleteId);
        nodes = nodes.filter(n => !toDelete.has(n.id));
        pendingDeleteId = null;
        modals.delete.close();
        addActivity('Deleted step');
        renderAll();
    });

    /* ---------- Renderers ---------- */
    // const renderFiles = () => {
    //     byId('fileList').innerHTML = files.map(f => `
    //   <li class="flex items-center justify-between rounded-lg bg-neutral-50 border px-3 py-2">
    //     <span class="text-sm">${f.name}</span>
    //     <span class="text-xs text-neutral-500">${(f.size / 1024).toFixed(1)} KB</span>
    //   </li>`).join('');
    // };

    const renderAll = () => {
        renderTree();
        renderBoard();
        renderTimeline();
        renderSummary();
        renderPeople();
        renderFiles();
        renderActivity();
        renderComments();
    };
    renderAll();

    /* ---------- Focus rings ---------- */
    qsa('button, [role="treeitem"] input').forEach(el => {
        el.addEventListener('focus', () => el.classList.add('outline-none', 'ring', 'ring-neutral-300'));
        el.addEventListener('blur', () => el.classList.remove('ring', 'ring-neutral-300'));
    });

    /* Enhance feather icons in header */
    window.feather && window.feather.replace();
})();
