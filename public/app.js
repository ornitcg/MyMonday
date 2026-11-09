// MyMonday - frontend
const STATUS = {
  not_started: { label: 'לא התחיל', color: '#c4c4c4' },
  working:     { label: 'בעבודה',   color: '#fdab3d' },
  stuck:       { label: 'תקוע',     color: '#e2445c' },
  done:        { label: 'הושלם',    color: '#00c875' },
};

let state = { groups: [] };
const board = document.getElementById('board');
const statusMenu = document.getElementById('statusMenu');
const search = document.getElementById('search');
const statusFilter = document.getElementById('statusFilter');
const hideDone = document.getElementById('hideDone');

// ---------- API ----------
async function api(method, url, body) {
  const res = await fetch('/api' + url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) { alert(data.error || 'שגיאה'); throw new Error(data.error); }
  return data;
}

async function reload() {
  state = await api('GET', '/data');
  render();
}

// ---------- helpers ----------
const el = (tag, attrs = {}, ...children) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'class') e.className = v;
    else if (k === 'style') e.style.cssText = v;
    else if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null) e.append(c);
  return e;
};

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dateBadge(task) {
  if (!task.dueDate || task.status === 'done') return null;
  const t = todayStr();
  if (task.dueDate < t) return el('span', { class: 'date-badge overdue' }, 'באיחור');
  if (task.dueDate === t) return el('span', { class: 'date-badge today' }, 'היום');
  return null;
}

function visible(task) {
  const q = search.value.trim().toLowerCase();
  if (q && !task.name.toLowerCase().includes(q)) return false;
  if (statusFilter.value && task.status !== statusFilter.value) return false;
  if (hideDone.checked && task.status === 'done') return false;
  return true;
}

// ---------- render ----------
function render() {
  board.innerHTML = '';
  if (!state.groups.length) {
    board.append(el('div', { class: 'empty-board' }, 'אין עדיין נושאים. לחצו על "+ נושא חדש" כדי להתחיל.'));
    return;
  }
  for (const g of state.groups) board.append(renderGroup(g));
}

function renderGroup(g) {
  const tasks = g.tasks.filter(visible);

  const header = el('div', { class: 'group-header' },
    el('button', { class: 'icon', title: 'כווץ / הרחב', onclick: () => patchGroup(g, { collapsed: !g.collapsed }) },
      el('span', { class: 'toggle', style: `color:${g.color}` }, '▼')),
    el('input', {
      class: 'group-title', value: g.name, style: `color:${g.color}`,
      onchange: e => patchGroup(g, { name: e.target.value.trim() || g.name }),
      onkeydown: e => { if (e.key === 'Enter') e.target.blur(); },
    }),
    el('span', { class: 'group-count' }, `${g.tasks.length} משימות`),
    el('div', { class: 'group-actions' },
      el('input', { type: 'color', class: 'color-input', value: g.color, title: 'צבע הנושא',
        onchange: e => patchGroup(g, { color: e.target.value }) }),
      el('button', { class: 'icon', title: 'מחק נושא', onclick: () => deleteGroup(g) }, '🗑'),
    ),
  );

  const table = el('table', { class: 'tasks' },
    el('thead', {}, el('tr', {},
      el('th', { class: 'col-bar', style: `background:${g.color}` }),
      el('th', { class: 'col-name' }, 'משימה'),
      el('th', { class: 'col-status' }, 'סטטוס'),
      el('th', { class: 'col-date' }, 'תאריך יעד'),
      el('th', { class: 'col-actions' }),
    )),
    el('tbody', {},
      tasks.map(t => renderTask(g, t)),
      el('tr', { class: 'add-row' },
        el('td', { class: 'col-bar', style: `background:${g.color};opacity:.4` }),
        el('td', { colspan: 4 },
          el('input', {
            class: 'cell-input', placeholder: '+ הוסף משימה',
            onkeydown: e => { if (e.key === 'Enter' && e.target.value.trim()) addTask(g, e.target.value.trim()); },
          })),
      ),
    ),
  );

  return el('section', { class: 'group' + (g.collapsed ? ' collapsed' : '') },
    header, table, renderSummary(g));
}

function renderTask(g, t) {
  return el('tr', {},
    el('td', { class: 'col-bar', style: `background:${g.color}` }),
    el('td', { class: 'col-name' },
      el('input', {
        class: 'cell-input', value: t.name,
        onchange: e => patchTask(t, { name: e.target.value.trim() || t.name }),
        onkeydown: e => { if (e.key === 'Enter') e.target.blur(); },
      })),
    el('td', { class: 'col-status' },
      el('button', {
        class: 'status-cell', style: `background:${STATUS[t.status].color}`,
        onclick: e => openStatusMenu(e.currentTarget, t),
      }, STATUS[t.status].label)),
    el('td', { class: 'col-date' },
      el('div', { class: 'date-wrap' },
        el('input', { type: 'date', value: t.dueDate || '',
          onchange: e => patchTask(t, { dueDate: e.target.value }) }),
        dateBadge(t))),
    el('td', { class: 'col-actions' },
      el('button', { class: 'icon', title: 'מחק משימה', onclick: () => deleteTask(t) }, '✕')),
  );
}

function renderSummary(g) {
  const total = g.tasks.length;
  if (!total) return el('div', { class: 'summary empty summary-row' });
  const bar = el('div', { class: 'summary summary-row', title: 'פילוח סטטוסים' });
  for (const [key, s] of Object.entries(STATUS)) {
    const n = g.tasks.filter(t => t.status === key).length;
    if (n) bar.append(el('span', { style: `background:${s.color};width:${(n / total) * 100}%`, title: `${s.label}: ${n}` }));
  }
  return bar;
}

// ---------- status menu ----------
function openStatusMenu(anchor, task) {
  statusMenu.innerHTML = '';
  for (const [key, s] of Object.entries(STATUS)) {
    statusMenu.append(el('button', {
      style: `background:${s.color}`,
      onclick: () => { closeStatusMenu(); patchTask(task, { status: key }); },
    }, s.label));
  }
  const r = anchor.getBoundingClientRect();
  statusMenu.style.top = `${r.bottom + window.scrollY + 4}px`;
  statusMenu.style.left = `${r.left + window.scrollX + r.width / 2 - 85}px`;
  statusMenu.hidden = false;
}
function closeStatusMenu() { statusMenu.hidden = true; }
document.addEventListener('click', e => {
  if (!statusMenu.hidden && !statusMenu.contains(e.target) && !e.target.classList.contains('status-cell')) closeStatusMenu();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeStatusMenu(); });

// ---------- actions ----------
async function patchGroup(g, fields) { await api('PATCH', `/groups/${g.id}`, fields); await reload(); }
async function deleteGroup(g) {
  if (!confirm(`למחוק את הנושא "${g.name}" וכל ${g.tasks.length} המשימות שבו?`)) return;
  await api('DELETE', `/groups/${g.id}`); await reload();
}
async function addTask(g, name) { await api('POST', `/groups/${g.id}/tasks`, { name }); await reload(); focusAddRow(g.id); }
async function patchTask(t, fields) { await api('PATCH', `/tasks/${t.id}`, fields); await reload(); }
async function deleteTask(t) {
  if (!confirm(`למחוק את המשימה "${t.name}"?`)) return;
  await api('DELETE', `/tasks/${t.id}`); await reload();
}

function focusAddRow(groupId) {
  const idx = state.groups.findIndex(g => g.id === groupId);
  const input = board.querySelectorAll('.group')[idx]?.querySelector('.add-row input');
  input?.focus();
}

document.getElementById('addGroupBtn').addEventListener('click', async () => {
  const name = prompt('שם הנושא החדש:');
  if (!name || !name.trim()) return;
  await api('POST', '/groups', { name: name.trim() });
  await reload();
});

for (const [key, s] of Object.entries(STATUS)) statusFilter.append(el('option', { value: key }, s.label));
search.addEventListener('input', render);
statusFilter.addEventListener('change', render);
hideDone.addEventListener('change', render);

reload();
