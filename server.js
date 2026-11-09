// MyMonday - local task board server (zero dependencies)
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

const STATUSES = ['not_started', 'working', 'stuck', 'done'];
const GROUP_COLORS = ['#579bfc', '#a25ddc', '#00c875', '#fdab3d', '#e2445c', '#037f4c', '#ff158a', '#7f5347'];

const newId = () => crypto.randomBytes(6).toString('hex');

function seed() {
  return {
    groups: [
      {
        id: newId(), name: 'נושא ראשון', color: GROUP_COLORS[0], collapsed: false,
        tasks: [
          { id: newId(), name: 'משימה לדוגמה', status: 'working', dueDate: '', notes: '' },
          { id: newId(), name: 'משימה שהושלמה', status: 'done', dueDate: '', notes: '' },
        ],
      },
    ],
  };
}

function load() {
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch {
    const db = seed();
    save(db);
    return db;
  }
}

function save(db) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf8');
  fs.renameSync(tmp, DB_FILE);
}

let db = load();

function findTask(taskId) {
  for (const g of db.groups) {
    const idx = g.tasks.findIndex(t => t.id === taskId);
    if (idx !== -1) return { group: g, idx, task: g.tasks[idx] };
  }
  return null;
}

function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
}

function validTask(fields) {
  if (fields.status !== undefined && !STATUSES.includes(fields.status)) return 'סטטוס לא חוקי';
  if (fields.dueDate !== undefined && fields.dueDate !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(fields.dueDate)) return 'תאריך לא חוקי';
  if (fields.name !== undefined && typeof fields.name !== 'string') return 'שם לא חוקי';
  return null;
}

// ---- API routes ----
function api(method, parts, body) {
  // parts: ['groups', ':id', 'tasks'] etc.
  const [res, id, sub] = parts;

  if (method === 'GET' && res === 'data') return [200, db];

  if (res === 'groups') {
    if (method === 'POST' && !id) {
      const g = {
        id: newId(),
        name: (body.name || 'נושא חדש').toString().slice(0, 200),
        color: GROUP_COLORS[db.groups.length % GROUP_COLORS.length],
        collapsed: false,
        tasks: [],
      };
      db.groups.unshift(g);
      return [201, g];
    }
    const g = db.groups.find(x => x.id === id);
    if (!g) return [404, { error: 'נושא לא נמצא' }];
    if (method === 'PATCH' && !sub) {
      Object.assign(g, pick(body, ['name', 'color', 'collapsed']));
      return [200, g];
    }
    if (method === 'DELETE' && !sub) {
      db.groups = db.groups.filter(x => x.id !== id);
      return [200, { ok: true }];
    }
    if (method === 'POST' && sub === 'tasks') {
      const fields = { name: 'משימה חדשה', status: 'not_started', dueDate: '', notes: '', ...pick(body, ['name', 'status', 'dueDate', 'notes']) };
      const err = validTask(fields);
      if (err) return [400, { error: err }];
      const t = { id: newId(), ...fields };
      g.tasks.push(t);
      return [201, t];
    }
  }

  if (res === 'tasks' && id) {
    const found = findTask(id);
    if (!found) return [404, { error: 'משימה לא נמצאה' }];
    if (method === 'PATCH') {
      const fields = pick(body, ['name', 'status', 'dueDate', 'notes']);
      const err = validTask(fields);
      if (err) return [400, { error: err }];
      Object.assign(found.task, fields);
      // move to another group
      if (body.groupId && body.groupId !== found.group.id) {
        const target = db.groups.find(x => x.id === body.groupId);
        if (!target) return [404, { error: 'נושא יעד לא נמצא' }];
        found.group.tasks.splice(found.idx, 1);
        target.tasks.push(found.task);
      }
      return [200, found.task];
    }
    if (method === 'DELETE') {
      found.group.tasks.splice(found.idx, 1);
      return [200, { ok: true }];
    }
  }

  return [404, { error: 'not found' }];
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

function serveStatic(req, res) {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, p));
  if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (!url.pathname.startsWith('/api/')) return serveStatic(req, res);

  let raw = '';
  req.on('data', c => { raw += c; if (raw.length > 1e6) req.destroy(); });
  req.on('end', () => {
    let body = {};
    try { body = raw ? JSON.parse(raw) : {}; } catch { body = {}; }
    const parts = url.pathname.slice(5).split('/').filter(Boolean);
    const [status, payload] = api(req.method, parts, body);
    if (req.method !== 'GET' && status < 300) save(db);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(payload));
  });
});

// Bind to localhost only - this is a local, single-user service
server.listen(PORT, '127.0.0.1', () => {
  console.log(`MyMonday פועל בכתובת: http://localhost:${PORT}`);
});
