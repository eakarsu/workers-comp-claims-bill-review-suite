const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

loadEnv();
const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'app.config.json'), 'utf8'));
const PORT = Number(process.env.PORT || config.port || 5500);
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC_DIR = path.join(__dirname, 'public');
const STORE_FILE = path.join(__dirname, 'data', 'store.local.json');
const sessions = new Map();

const standardModules = [
  { id: 'documents', table: 'documents', label: 'Document Vault', description: 'Document metadata, evidence packages, review status, and retention tracking.', subfeatures: ['Intake', 'Review', 'Retention'], prefix: 'DOC', seedValues: ['Policy file', 'Evidence package', 'Signed form', 'Report'] },
  { id: 'tasks', table: 'tasks', label: 'Task Queue', description: 'Owner-based work queue with due dates, priorities, blocked items, and completion status.', subfeatures: ['Assignment', 'SLA', 'Escalation'], prefix: 'TASK', seedValues: ['Follow up', 'Review', 'Approve', 'Resolve'] },
  { id: 'notifications', table: 'notifications', label: 'Notifications', description: 'Scheduled notices, approvals, failed sends, and stakeholder communication queue.', subfeatures: ['Message', 'Approval', 'Delivery'], prefix: 'NTF', seedValues: ['Email', 'Portal', 'SMS', 'Call'] },
  { id: 'integrations', table: 'integrations', label: 'Integrations', description: 'External system connections, API status, sync cadence, and ownership.', subfeatures: ['API keys', 'Sync status', 'Error handling'], prefix: 'INT', seedValues: ['CRM', 'ERP', 'EHR', 'Data warehouse'] },
  { id: 'automations', table: 'automations', label: 'Automations', description: 'Scheduled jobs, routing rules, exception handling, and last-run results.', subfeatures: ['Schedules', 'Rules', 'Exceptions'], prefix: 'AUTO', seedValues: ['Daily digest', 'Escalation', 'Data sync', 'Audit pack'] },
  { id: 'approvals', table: 'approvals', label: 'Approvals', description: 'Human-in-the-loop approvals for high-risk, regulated, or financial actions.', subfeatures: ['Review', 'Sign-off', 'Exception'], prefix: 'APR', seedValues: ['Manager approval', 'Compliance approval', 'Finance approval', 'Clinical approval'] },
  { id: 'audit-logs', table: 'auditLogs', label: 'Audit Logs', description: 'Immutable-style event history for access, exports, mutations, and admin actions.', subfeatures: ['Access', 'Change', 'Export'], prefix: 'AUD', seedValues: ['Login', 'Create', 'Update', 'Export'] }
];

const allModules = [...config.modules, ...standardModules];

function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  fs.readFileSync(envPath, 'utf8').split(/\r?\n/).forEach((line) => {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
  });
}

function now() {
  return new Date().toISOString();
}

function today() {
  return now().slice(0, 10);
}

function dayOffset(n) {
  const d = new Date(Date.UTC(2026, 5, 7));
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function titleize(value) {
  return String(value).replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
}

function statusFor(i) {
  return ['Open', 'In progress', 'Review', 'Blocked', 'Complete'][i % 5];
}

function riskScore(row) {
  let score = 10;
  if (row.priority === 'Medium') score += 15;
  if (row.priority === 'High') score += 30;
  if (row.priority === 'Escalate') score += 45;
  if (row.status === 'Blocked') score += 25;
  if (row.status === 'Open') score += 10;
  if (row.dueDate && row.dueDate < today() && row.status !== 'Complete') score += 20;
  return Math.min(score, 100);
}

function normalizeRow(row) {
  const createdAt = row.createdAt || now();
  const normalized = {
    id: row.id,
    item: row.item || 'Untitled record',
    owner: row.owner || 'Unassigned',
    priority: row.priority || 'Medium',
    status: row.status || 'Open',
    dueDate: row.dueDate || today(),
    value: row.value || '',
    notes: row.notes || '',
    tags: Array.isArray(row.tags) ? row.tags : String(row.tags || '').split(',').map((x) => x.trim()).filter(Boolean),
    source: row.source || 'manual',
    createdAt,
    updatedAt: row.updatedAt || createdAt,
    version: Number(row.version || row._version || 1)
  };
  normalized.riskScore = Number(row.riskScore || riskScore(normalized));
  return normalized;
}

function seedRows(module, count = 15) {
  return Array.from({ length: count }, (_, i) => normalizeRow({
    id: module.prefix + '-' + String(i + 1).padStart(3, '0'),
    item: module.label + ' ' + String(i + 1).padStart(2, '0'),
    owner: ['Operations Lead', 'Compliance Owner', 'Finance Reviewer', 'Clinical Lead', 'Field Manager'][i % 5],
    priority: ['Low', 'Medium', 'High', 'Escalate'][i % 4],
    status: statusFor(i),
    dueDate: dayOffset(i - 5),
    value: module.seedValues[i % module.seedValues.length],
    notes: module.subfeatures[i % module.subfeatures.length] + ' workflow record for ' + config.title,
    tags: [module.label, module.subfeatures[i % module.subfeatures.length]]
  }));
}

function seedStore() {
  const data = {};
  allModules.forEach((module) => {
    data[module.table] = seedRows(module);
  });
  return {
    version: 3,
    settings: {
      appTitle: config.title,
      storage: 'local-json',
      databaseUrlConfigured: Boolean(process.env.DATABASE_URL),
      aiModel: process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini',
      notificationsEnabled: true,
      backupRetentionDays: 30
    },
    users: [
      { id: 'USR-001', name: 'Admin User', email: 'admin@' + config.slug + '.local', password: 'admin123', role: 'Admin', active: true },
      { id: 'USR-002', name: 'Manager User', email: 'manager@' + config.slug + '.local', password: 'manager123', role: 'Manager', active: true },
      { id: 'USR-003', name: 'Analyst User', email: 'analyst@' + config.slug + '.local', password: 'analyst123', role: 'Analyst', active: true }
    ],
    data
  };
}

function migrateStore(stored, seeded) {
  stored.version = 3;
  stored.settings = { ...seeded.settings, ...(stored.settings || {}) };
  stored.users = Array.isArray(stored.users) ? stored.users : seeded.users;
  stored.users = stored.users.map((user) => ({ active: true, ...user }));
  stored.data = stored.data || {};
  Object.entries(seeded.data).forEach(([table, rows]) => {
    if (!Array.isArray(stored.data[table])) stored.data[table] = rows;
    else stored.data[table] = stored.data[table].map(normalizeRow);
  });
  return stored;
}

function saveStore() {
  fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2));
}

function loadStore() {
  fs.mkdirSync(path.dirname(STORE_FILE), { recursive: true });
  const seeded = seedStore();
  if (!fs.existsSync(STORE_FILE)) {
    fs.writeFileSync(STORE_FILE, JSON.stringify(seeded, null, 2));
    return seeded;
  }
  const stored = migrateStore(JSON.parse(fs.readFileSync(STORE_FILE, 'utf8')), seeded);
  fs.writeFileSync(STORE_FILE, JSON.stringify(stored, null, 2));
  return stored;
}

let store = loadStore();

const rolePermissions = {
  Admin: ['read', 'write', 'delete', 'export', 'ai', 'admin', 'jobs'],
  Manager: ['read', 'write', 'export', 'ai', 'jobs'],
  Analyst: ['read', 'export', 'ai']
};

function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email, role: user.role, active: user.active !== false };
}

function makeToken(user) {
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, { user: publicUser(user), createdAt: Date.now() });
  return token;
}

function getAuth(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  return sessions.get(token) || null;
}

function requireAuth(req, res, permission = 'read') {
  const session = getAuth(req);
  if (!session) {
    sendJson(res, { error: 'Unauthorized' }, 401);
    return null;
  }
  const permissions = rolePermissions[session.user.role] || [];
  if (!permissions.includes(permission)) {
    sendJson(res, { error: 'Forbidden for role ' + session.user.role }, 403);
    return null;
  }
  return session;
}

function summary() {
  const tables = Object.values(store.data);
  const allRows = tables.flat();
  return {
    metrics: [
      { label: 'Operational records', value: allRows.length, detail: 'Persisted across all modules' },
      { label: 'Open work', value: allRows.filter((r) => r.status === 'Open').length, detail: 'Needs owner action' },
      { label: 'Blocked items', value: allRows.filter((r) => r.status === 'Blocked').length, detail: 'Escalation or exception queue' },
      { label: 'High priority', value: allRows.filter((r) => r.priority === 'High' || r.priority === 'Escalate').length, detail: 'Management attention' },
      { label: 'Average risk', value: Math.round(allRows.reduce((sum, r) => sum + Number(r.riskScore || 0), 0) / Math.max(1, allRows.length)), detail: 'Rules-based risk score' }
    ],
    workQueue: allModules.slice(0, 5).map((m) => 'Review ' + m.label + ' records due this week')
  };
}

function analyzeDomain() {
  return allModules.map((module) => {
    const rows = store.data[module.table] || [];
    const blocked = rows.filter((r) => r.status === 'Blocked').length;
    const overdue = rows.filter((r) => r.dueDate < today() && r.status !== 'Complete').length;
    const avgRisk = Math.round(rows.reduce((sum, r) => sum + Number(r.riskScore || riskScore(r)), 0) / Math.max(1, rows.length));
    return {
      module: module.label,
      table: module.table,
      records: rows.length,
      blocked,
      overdue,
      avgRisk,
      recommendation: blocked || overdue ? 'Prioritize exception review and owner follow-up.' : 'Maintain current workflow cadence.'
    };
  });
}

function readiness() {
  return {
    app: config.slug,
    checks: [
      { name: 'Persistent local store', pass: fs.existsSync(STORE_FILE), detail: STORE_FILE },
      { name: 'Domain modules', pass: config.modules.length >= 8, detail: config.modules.length + ' domain modules' },
      { name: 'Standard operations modules', pass: standardModules.every((m) => store.data[m.table]), detail: standardModules.map((m) => m.label).join(', ') },
      { name: 'RBAC sessions', pass: true, detail: 'Admin, Manager, Analyst permissions enforced on API' },
      { name: 'AI fallback', pass: true, detail: process.env.OPENROUTER_API_KEY ? 'OpenRouter key configured' : 'Local fallback active' },
      { name: 'Database URL', pass: Boolean(process.env.DATABASE_URL), detail: process.env.DATABASE_URL ? 'Configured' : 'Not configured; using local JSON' }
    ]
  };
}

function aiCenter() {
  const analysis = analyzeDomain().sort((a, b) => b.avgRisk - a.avgRisk)[0];
  return {
    generatedAt: now(),
    model: process.env.OPENROUTER_MODEL || 'local-rule-based-demo',
    mode: process.env.OPENROUTER_API_KEY && !process.env.OPENROUTER_API_KEY.includes('changeme') ? 'OpenRouter ready' : 'Local safety fallback',
    headline: config.title + ' operational review',
    summary: 'The highest-risk workflow is ' + analysis.module + ' with average risk ' + analysis.avgRisk + ', ' + analysis.blocked + ' blocked records, and ' + analysis.overdue + ' overdue records.',
    recommendations: [
      'Resolve blocked and escalated records first',
      'Run due-notification jobs before leadership reviews',
      'Export weekly module reports for owners',
      'Use audit logs and backups before bulk changes'
    ],
    risks: ['Incomplete source evidence', 'Aging open tasks', 'Manual approval bottlenecks'],
    disclaimer: 'AI output is operational support only. Human review is required before regulated, financial, clinical, legal, or safety decisions.'
  };
}

function validateRow(row) {
  const errors = [];
  if (!String(row.item || '').trim()) errors.push('item is required');
  if (!String(row.owner || '').trim()) errors.push('owner is required');
  if (!String(row.status || '').trim()) errors.push('status is required');
  if (!String(row.priority || '').trim()) errors.push('priority is required');
  return errors;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; if (body.length > 8_000_000) reject(new Error('Request too large')); });
    req.on('end', () => {
      if (!body) return resolve({});
      try { resolve(JSON.parse(body)); } catch (err) { reject(err); }
    });
    req.on('error', reject);
  });
}

function sendJson(res, payload, status = 200) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY'
  });
  res.end(JSON.stringify(payload, null, 2));
}

function sendCsv(res, table, rows) {
  const keys = rows[0] ? Object.keys(rows[0]) : ['id'];
  const quote = (value) => '"' + String(Array.isArray(value) ? value.join('|') : value ?? '').replace(/"/g, '""') + '"';
  const csv = [keys.join(','), ...rows.map((row) => keys.map((k) => quote(row[k])).join(','))].join('\n');
  res.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': 'attachment; filename="' + table + '.csv"',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(csv);
}

function audit(actor, event, item = 'System') {
  store.data.auditLogs.unshift(normalizeRow({
    id: 'AUD-' + Date.now(),
    item,
    owner: actor || 'system',
    priority: 'Low',
    status: 'Complete',
    dueDate: today(),
    value: event,
    notes: 'Audit event captured by application runtime',
    tags: ['audit', event]
  }));
  saveStore();
}

function nextId(table) {
  const module = allModules.find((m) => m.table === table);
  const prefix = module ? module.prefix : table.slice(0, 4).toUpperCase();
  return prefix + '-' + Date.now();
}

function runDueJobs(actor) {
  const created = [];
  Object.entries(store.data).forEach(([table, rows]) => {
    if (['notifications', 'auditLogs'].includes(table)) return;
    rows.forEach((row) => {
      if (row.dueDate < today() && row.status !== 'Complete' && Number(row.riskScore || 0) >= 50) {
        const notification = normalizeRow({
          id: 'NTF-' + Date.now() + '-' + created.length,
          item: 'Due follow-up for ' + row.item,
          owner: row.owner,
          priority: row.priority,
          status: 'Open',
          dueDate: today(),
          value: table,
          notes: 'Generated by due-notification job for overdue/high-risk record ' + row.id,
          tags: ['job', table]
        });
        store.data.notifications.unshift(notification);
        created.push(notification);
      }
    });
  });
  store.data.automations.unshift(normalizeRow({
    id: 'AUTO-' + Date.now(),
    item: 'Due notification job',
    owner: actor || 'system',
    priority: created.length ? 'High' : 'Low',
    status: 'Complete',
    dueDate: today(),
    value: created.length + ' notifications generated',
    notes: 'Scheduled job executed manually or by interval',
    tags: ['job', 'notifications']
  }));
  audit(actor, 'Ran due-notification job', created.length + ' notifications');
  saveStore();
  return { created: created.length, notifications: created };
}

setInterval(() => {
  if (store.settings.notificationsEnabled) runDueJobs('scheduler');
}, 60 * 60 * 1000).unref();

async function generateAiReview(payload) {
  if (!process.env.OPENROUTER_API_KEY || process.env.OPENROUTER_API_KEY.includes('changeme')) {
    return { source: 'local-fallback', review: aiCenter(), note: 'Set OPENROUTER_API_KEY in .env to use live AI generation.' };
  }
  const body = JSON.stringify({
    model: process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini',
    messages: [
      { role: 'system', content: 'You are an operations copilot. Provide concise, safe workflow recommendations.' },
      { role: 'user', content: JSON.stringify(payload).slice(0, 12000) }
    ]
  });
  return new Promise((resolve) => {
    const request = https.request({
      hostname: 'openrouter.ai',
      path: '/api/v1/chat/completions',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + process.env.OPENROUTER_API_KEY, 'Content-Length': Buffer.byteLength(body) },
      timeout: 12000
    }, (response) => {
      let text = '';
      response.on('data', (chunk) => { text += chunk; });
      response.on('end', () => {
        try {
          const parsed = JSON.parse(text);
          resolve({ source: 'openrouter', text: parsed.choices?.[0]?.message?.content || text });
        } catch {
          resolve({ source: 'openrouter', text });
        }
      });
    });
    request.on('timeout', () => { request.destroy(); resolve({ source: 'local-fallback', review: aiCenter(), note: 'AI request timed out.' }); });
    request.on('error', () => resolve({ source: 'local-fallback', review: aiCenter(), note: 'AI request failed.' }));
    request.write(body);
    request.end();
  });
}

function serveStatic(req, res) {
  const parsed = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  const pathname = decodeURIComponent(parsed.pathname === '/' ? '/index.html' : parsed.pathname);
  const safePath = path.normalize(path.join(PUBLIC_DIR, pathname));
  if (!safePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end('Forbidden'); return; }
  fs.readFile(safePath, (err, file) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    const ext = path.extname(safePath);
    const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8' };
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' });
    res.end(file);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const parsed = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
    const parts = parsed.pathname.split('/').filter(Boolean);

    if (parsed.pathname === '/api/health') return sendJson(res, { ok: true, app: config.slug, title: config.title, persisted: fs.existsSync(STORE_FILE), records: Object.fromEntries(Object.entries(store.data).map(([k, v]) => [k, v.length])) });
    if (parsed.pathname === '/api/public-config') return sendJson(res, { slug: config.slug, title: config.title, description: config.description, port: PORT });
    if (parsed.pathname === '/api/auth/login' && req.method === 'POST') {
      const body = await readBody(req);
      const user = store.users.find((u) => u.email === body.email && u.password === body.password && u.active !== false);
      if (!user) return sendJson(res, { error: 'Invalid login' }, 401);
      const token = makeToken(user);
      audit(user.email, 'User login');
      return sendJson(res, { user: publicUser(user), token, permissions: rolePermissions[user.role] || [] });
    }

    if (parsed.pathname === '/api/bootstrap') {
      const session = requireAuth(req, res, 'read');
      if (!session) return;
      return sendJson(res, { config, modules: allModules, summary: summary(), readiness: readiness(), domainAnalysis: analyzeDomain(), data: store.data, aiCenter: aiCenter(), settings: store.settings, users: store.users.map(publicUser), user: session.user, permissions: rolePermissions[session.user.role] || [] });
    }
    if (parsed.pathname === '/api/readiness') {
      const session = requireAuth(req, res, 'read');
      if (!session) return;
      return sendJson(res, readiness());
    }
    if (parsed.pathname === '/api/domain/rules') {
      const session = requireAuth(req, res, 'read');
      if (!session) return;
      return sendJson(res, { rules: ['Priority + overdue date increases risk', 'Blocked status increases risk', 'High risk records generate due notifications', 'Human approval is required for escalated records'] });
    }
    if (parsed.pathname === '/api/domain/analyze') {
      const session = requireAuth(req, res, 'read');
      if (!session) return;
      return sendJson(res, { analysis: analyzeDomain() });
    }
    if (parsed.pathname === '/api/jobs/run-due' && req.method === 'POST') {
      const session = requireAuth(req, res, 'jobs');
      if (!session) return;
      return sendJson(res, runDueJobs(session.user.email));
    }
    if (parsed.pathname === '/api/admin/backup' && req.method === 'GET') {
      const session = requireAuth(req, res, 'export');
      if (!session) return;
      audit(session.user.email, 'Downloaded backup');
      return sendJson(res, { config, exportedAt: now(), store });
    }
    if (parsed.pathname === '/api/admin/restore' && req.method === 'POST') {
      const session = requireAuth(req, res, 'admin');
      if (!session) return;
      const body = await readBody(req);
      if (!body.store || !body.store.data) return sendJson(res, { error: 'Invalid backup payload' }, 400);
      store = migrateStore(body.store, seedStore());
      audit(session.user.email, 'Restored backup');
      saveStore();
      return sendJson(res, { ok: true });
    }
    if (parsed.pathname === '/api/admin/reset' && req.method === 'POST') {
      const session = requireAuth(req, res, 'admin');
      if (!session) return;
      store = seedStore();
      audit(session.user.email, 'Reset data store');
      saveStore();
      return sendJson(res, { ok: true, store });
    }
    if (parsed.pathname === '/api/ai-center' && req.method === 'GET') {
      const session = requireAuth(req, res, 'ai');
      if (!session) return;
      return sendJson(res, aiCenter());
    }
    if (parsed.pathname === '/api/ai-center' && req.method === 'POST') {
      const session = requireAuth(req, res, 'ai');
      if (!session) return;
      return sendJson(res, await generateAiReview(await readBody(req)));
    }
    if (parts[0] === 'api' && parts[1] === 'integrations' && parts[2] === 'test' && req.method === 'POST') {
      const session = requireAuth(req, res, 'write');
      if (!session) return;
      const id = decodeURIComponent(parts[3] || '');
      const row = store.data.integrations.find((r) => r.id === id);
      if (!row) return sendJson(res, { error: 'Integration not found' }, 404);
      row.status = 'Review';
      row.value = 'Connection check queued';
      row.updatedAt = now();
      row.version += 1;
      audit(session.user.email, 'Tested integration', row.item);
      saveStore();
      return sendJson(res, { row });
    }
    if (parts[0] === 'api' && parts[1] === 'export' && req.method === 'GET') {
      const session = requireAuth(req, res, 'export');
      if (!session) return;
      const table = parts[2];
      if (!store.data[table]) return sendJson(res, { error: 'Unknown table' }, 404);
      audit(session.user.email, 'Exported ' + table);
      return sendCsv(res, table, store.data[table]);
    }
    if (parsed.pathname === '/api/upload' && req.method === 'POST') {
      const session = requireAuth(req, res, 'write');
      if (!session) return;
      const body = await readBody(req);
      const row = normalizeRow({
        id: nextId('documents'),
        item: body.fileName || 'uploaded-file',
        owner: body.owner || session.user.email,
        priority: 'Medium',
        status: 'Review',
        dueDate: today(),
        value: body.documentType || 'Document',
        notes: body.notes || 'Uploaded document metadata',
        tags: ['document', body.documentType || 'upload']
      });
      store.data.documents.unshift(row);
      audit(session.user.email, 'Uploaded document', row.item);
      saveStore();
      return sendJson(res, { row }, 201);
    }
    if (parts[0] === 'api' && parts[1] === 'table') {
      const table = parts[2];
      const id = decodeURIComponent(parts[3] || '');
      if (!store.data[table]) return sendJson(res, { error: 'Unknown table' }, 404);
      if (req.method === 'GET') {
        const session = requireAuth(req, res, 'read');
        if (!session) return;
        return sendJson(res, { table, rows: store.data[table] });
      }
      const permission = req.method === 'DELETE' ? 'delete' : 'write';
      const session = requireAuth(req, res, permission);
      if (!session) return;
      const body = await readBody(req);
      if (req.method === 'POST') {
        const row = normalizeRow({ ...body, id: body.id || nextId(table), source: body.source || 'manual' });
        const errors = validateRow(row);
        if (errors.length) return sendJson(res, { errors }, 422);
        store.data[table].unshift(row);
        audit(session.user.email, 'Created ' + titleize(table) + ' record', row.item);
        saveStore();
        return sendJson(res, { row }, 201);
      }
      const index = store.data[table].findIndex((row) => row.id === id);
      if (index < 0) return sendJson(res, { error: 'Record not found' }, 404);
      if (req.method === 'PUT') {
        const current = store.data[table][index];
        if (body.expectedVersion && Number(body.expectedVersion) !== Number(current.version)) return sendJson(res, { error: 'Version conflict', current }, 409);
        const row = normalizeRow({ ...current, ...body, id, version: Number(current.version) + 1, updatedAt: now() });
        row.riskScore = riskScore(row);
        const errors = validateRow(row);
        if (errors.length) return sendJson(res, { errors }, 422);
        store.data[table][index] = row;
        audit(session.user.email, 'Updated ' + titleize(table) + ' record', row.item);
        saveStore();
        return sendJson(res, { row });
      }
      if (req.method === 'DELETE') {
        const [row] = store.data[table].splice(index, 1);
        audit(session.user.email, 'Deleted ' + titleize(table) + ' record', row.item);
        saveStore();
        return sendJson(res, { row });
      }
    }
    return serveStatic(req, res);
  } catch (err) {
    return sendJson(res, { error: err.message || 'Server error' }, 500);
  }
});

server.listen(PORT, HOST, () => console.log(config.title + ' running at http://' + HOST + ':' + PORT));
