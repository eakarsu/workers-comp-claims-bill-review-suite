const state = {
  boot: null,
  publicConfig: null,
  active: 'dashboard',
  selected: null,
  query: '',
  status: 'all',
  formMode: 'view',
  form: {},
  user: JSON.parse(localStorage.getItem(location.pathname + ':user') || 'null'),
  token: localStorage.getItem(location.pathname + ':token') || ''
};

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[ch]);
}

async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (state.token) headers.Authorization = 'Bearer ' + state.token;
  const res = await fetch(path, { ...options, headers });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(json.error || (json.errors || []).join(', ') || 'Request failed');
  return json;
}

async function login(event) {
  event.preventDefault();
  const form = new FormData(event.target);
  try {
    const result = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: form.get('email'), password: form.get('password') }) });
    state.user = result.user;
    state.token = result.token;
    localStorage.setItem(location.pathname + ':user', JSON.stringify(result.user));
    localStorage.setItem(location.pathname + ':token', result.token);
    await load();
  } catch (err) {
    document.querySelector('.login-error').textContent = err.message;
  }
}

function fillDemoCredentials() {
  const slug = state.publicConfig?.slug || 'app';
  const email = document.querySelector('.login-form input[name="email"]');
  const password = document.querySelector('.login-form input[name="password"]');
  if (email) email.value = 'admin@' + slug + '.local';
  if (password) password.value = 'admin123';
  const error = document.querySelector('.login-error');
  if (error) error.textContent = '';
}

function logout() {
  localStorage.removeItem(location.pathname + ':user');
  localStorage.removeItem(location.pathname + ':token');
  state.user = null;
  state.token = '';
  state.boot = null;
  renderLogin();
}

function setActive(id) {
  state.active = id;
  state.selected = null;
  state.query = '';
  state.status = 'all';
  state.formMode = 'view';
  state.form = {};
  render();
}

function initial(label) {
  return label.split(/\s+/).map((x) => x[0]).join('').slice(0, 2).toUpperCase();
}

function moduleById(id) {
  return state.boot.modules.find((m) => m.id === id);
}

function can(permission) {
  return (state.boot.permissions || []).includes(permission);
}

function getRows(module) {
  if (!module) return [];
  let rows = state.boot.data[module.table] || [];
  if (state.query) {
    const q = state.query.toLowerCase();
    rows = rows.filter((row) => Object.values(row).some((value) => String(Array.isArray(value) ? value.join(' ') : value).toLowerCase().includes(q)));
  }
  if (state.status !== 'all') {
    rows = rows.filter((row) => Object.values(row).some((value) => String(value).toLowerCase().includes(state.status)));
  }
  return rows;
}

function statusClass(value) {
  const text = String(value || '').toLowerCase();
  if (text.includes('escalate') || text.includes('high') || text.includes('blocked')) return 'risk';
  if (text.includes('review') || text.includes('progress') || text.includes('medium') || text.includes('open')) return 'warn';
  if (text.includes('complete') || text.includes('low')) return 'ok';
  return '';
}

async function renderLogin() {
  if (!state.publicConfig) {
    try { state.publicConfig = await api('/api/public-config'); } catch { state.publicConfig = { slug: 'app', title: 'Operations Suite' }; }
  }
  const slug = state.publicConfig.slug;
  document.getElementById('app').className = 'auth-screen';
  document.getElementById('app').innerHTML = '<main class="login-panel"><div class="brand-mark">AI</div><h1>' + esc(state.publicConfig.title) + '</h1><p class="muted">Sign in to open the sidebar app.</p><form class="login-form" onsubmit="login(event)"><label>Email<input name="email" value="admin@' + esc(slug) + '.local"></label><label>Password<input name="password" type="password" value="admin123"></label><button type="button" class="button" onclick="fillDemoCredentials()">Auto Fill Demo Credentials</button><button class="button">Sign In</button><div class="login-error"></div></form><p class="muted small">Demo users use admin123, manager123, or analyst123.</p></main>';
}

function shell(inner) {
  const nav = [{ id: 'dashboard', label: 'Dashboard' }, ...state.boot.modules, { id: 'ai-center', label: 'AI Center' }, { id: 'rules', label: 'Rules & Jobs' }, { id: 'reports', label: 'Reports' }];
  document.getElementById('app').className = 'shell';
  document.getElementById('app').innerHTML = '<aside class="sidebar"><div class="brand"><div class="brand-mark">AI</div><h1>' + esc(state.boot.config.title) + '</h1><p>' + esc(state.boot.config.description) + '</p></div><div class="user-box"><strong>' + esc(state.user.name) + '</strong><span>' + esc(state.user.role) + '</span><button onclick="logout()">Sign out</button></div><div class="nav-label">Workspace</div><nav class="nav">' + nav.map((item) => '<button class="' + (state.active === item.id ? 'active' : '') + '" onclick="setActive(&quot;' + item.id + '&quot;)"><span class="nav-initial">' + esc(initial(item.label)) + '</span><span>' + esc(item.label) + '</span></button>').join('') + '</nav></aside><main class="main">' + inner + '</main>';
}

function topbar(title, description, eyebrow = 'Operations') {
  return '<section class="topbar"><div><p class="eyebrow">' + esc(eyebrow) + '</p><h2>' + esc(title) + '</h2><p>' + esc(description) + '</p></div><div class="notice">RBAC, audit logging, validation, backups, and human review are active in this local app.</div></section>';
}

function dashboard() {
  const s = state.boot.summary;
  return topbar('Dashboard', state.boot.config.description, 'Command Center') + '<section class="content grid"><div class="grid columns-5">' + s.metrics.map((m) => '<article class="metric"><div class="label">' + esc(m.label) + '</div><div class="value">' + esc(m.value) + '</div><div class="detail">' + esc(m.detail) + '</div></article>').join('') + '</div><div class="grid columns-2"><article class="panel"><h3>Priority Work Queue</h3><ul class="work-list">' + s.workQueue.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul></article><article class="panel"><h3>Production Features</h3><p class="muted">RBAC sessions, write authorization, optimistic versioning, validation, backup/restore/reset APIs, domain rules, scheduled jobs, integrations, automations, approvals, readiness checks, and audit logging are implemented.</p></article></div></section>';
}

function selectRow(id) {
  state.selected = id;
  state.formMode = 'view';
  render();
}

function addNew(moduleId) {
  const module = moduleById(moduleId);
  const sample = (state.boot.data[module.table] || [])[0] || {};
  state.formMode = 'new';
  state.form = {};
  Object.keys(sample).forEach((k) => { if (!['id', 'createdAt', 'updatedAt', 'version', 'riskScore'].includes(k)) state.form[k] = k === 'dueDate' ? new Date().toISOString().slice(0, 10) : ''; });
  render();
}

function editSelected(module, row) {
  if (!row) return;
  state.formMode = 'edit';
  state.form = { ...row, expectedVersion: row.version };
  render();
}

function updateForm(key, value) {
  state.form[key] = value;
}

async function saveForm(table) {
  const body = { ...state.form };
  if (state.formMode === 'new') await api('/api/table/' + table, { method: 'POST', body: JSON.stringify(body) });
  else await api('/api/table/' + table + '/' + encodeURIComponent(state.form.id), { method: 'PUT', body: JSON.stringify(body) });
  state.formMode = 'view';
  state.form = {};
  await refresh();
}

async function deleteSelected(table, row) {
  if (!row || !confirm('Delete ' + row.id + '?')) return;
  await api('/api/table/' + table + '/' + encodeURIComponent(row.id), { method: 'DELETE' });
  state.selected = null;
  await refresh();
}

async function uploadDocument(event) {
  event.preventDefault();
  const form = new FormData(event.target);
  await api('/api/upload', { method: 'POST', body: JSON.stringify({ fileName: form.get('fileName'), documentType: form.get('documentType'), owner: form.get('owner'), notes: form.get('notes') }) });
  event.target.reset();
  await refresh();
}

async function testIntegration(id) {
  await api('/api/integrations/test/' + encodeURIComponent(id), { method: 'POST', body: JSON.stringify({}) });
  await refresh();
}

function formPanel(module, selected) {
  if (state.formMode === 'view') {
    const edit = can('write') ? '<button class="button secondary" onclick="editSelected(moduleById(&quot;' + module.id + '&quot;), state.boot.data[&quot;' + module.table + '&quot;].find(r=>r.id===&quot;' + (selected ? selected.id : '') + '&quot;))">Edit</button>' : '';
    const add = can('write') ? '<button class="button" onclick="addNew(&quot;' + module.id + '&quot;)">Add Record</button>' : '';
    const del = can('delete') ? '<button class="button danger" onclick="deleteSelected(&quot;' + module.table + '&quot;, state.boot.data[&quot;' + module.table + '&quot;].find(r=>r.id===&quot;' + (selected ? selected.id : '') + '&quot;))">Delete</button>' : '';
    const integration = module.table === 'integrations' && selected && can('write') ? '<button class="button secondary" onclick="testIntegration(&quot;' + selected.id + '&quot;)">Test Integration</button>' : '';
    return '<div class="button-row">' + add + edit + del + integration + '<a class="button secondary" href="/api/export/' + module.table + '">CSV Export</a></div>';
  }
  const keys = Object.keys(state.form).filter((k) => !['createdAt', 'updatedAt', 'riskScore'].includes(k));
  return '<div class="edit-form"><h3>' + (state.formMode === 'new' ? 'Add Record' : 'Edit Record') + '</h3><div class="form-grid">' + keys.map((k) => '<label>' + esc(k) + '<input ' + (k === 'id' || k === 'version' || k === 'expectedVersion' ? 'readonly' : '') + ' value="' + esc(Array.isArray(state.form[k]) ? state.form[k].join(', ') : state.form[k]) + '" oninput="updateForm(&quot;' + k + '&quot;, this.value)"></label>').join('') + '</div><div class="button-row"><button class="button" onclick="saveForm(&quot;' + module.table + '&quot;)">Save</button><button class="button secondary" onclick="state.formMode=&quot;view&quot;;state.form={};render();">Cancel</button></div></div>';
}

function moduleView(module) {
  const rows = getRows(module);
  const selected = rows.find((r) => r.id === state.selected) || rows[0];
  const keys = rows[0] ? Object.keys(rows[0]).slice(0, 9) : [];
  const upload = module.table === 'documents' && can('write') ? '<article class="panel"><h3>Upload Document Metadata</h3><form class="form-grid compact" onsubmit="uploadDocument(event)"><label>File Name<input name="fileName" placeholder="evidence.pdf"></label><label>Document Type<input name="documentType" placeholder="Policy"></label><label>Owner<input name="owner" placeholder="Reviewer"></label><label>Notes<input name="notes" placeholder="Context"></label><button class="button">Add Upload</button></form></article>' : '';
  return topbar(module.label, module.description, 'Feature Workspace') + '<section class="content grid"><div class="panel"><div class="subfeatures">' + module.subfeatures.map((s) => '<span class="sub-pill">' + esc(s) + '</span>').join('') + '</div><div class="toolbar"><input placeholder="Search records" value="' + esc(state.query) + '" oninput="state.query=this.value;render();"><select onchange="state.status=this.value;render();">' + ['all', 'open', 'progress', 'review', 'blocked', 'complete', 'high'].map((x) => '<option value="' + x + '" ' + (state.status === x ? 'selected' : '') + '>' + x + '</option>').join('') + '</select>' + (can('write') ? '<button class="button" onclick="addNew(&quot;' + module.id + '&quot;)">Add</button>' : '<span class="pill">Read only</span>') + '</div><div class="table-wrap"><table><thead><tr>' + keys.map((k) => '<th>' + esc(k) + '</th>').join('') + '</tr></thead><tbody>' + rows.map((row) => '<tr class="' + (selected && selected.id === row.id ? 'selected' : '') + '" onclick="selectRow(&quot;' + row.id + '&quot;)">' + keys.map((k) => '<td>' + (/status|priority|riskScore/i.test(k) ? '<span class="pill ' + statusClass(row[k]) + '">' + esc(row[k]) + '</span>' : esc(Array.isArray(row[k]) ? row[k].join(', ') : row[k])) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div></div>' + upload + '<div class="grid columns-2"><article class="panel"><h3>Record Detail</h3><div class="detail-grid">' + (selected ? Object.keys(selected).map((k) => '<div class="field"><span>' + esc(k) + '</span>' + esc(Array.isArray(selected[k]) ? selected[k].join(', ') : selected[k]) + '</div>').join('') : '') + '</div></article><article class="panel">' + formPanel(module, selected) + '</article></div></section>';
}

async function generateAiReview() {
  const result = await api('/api/ai-center', { method: 'POST', body: JSON.stringify({ user: state.user, data: state.boot.data }) });
  alert(result.text || result.note || 'AI review generated.');
}

async function runDueJobs() {
  const result = await api('/api/jobs/run-due', { method: 'POST', body: JSON.stringify({}) });
  alert(result.created + ' notifications generated.');
  await refresh();
}

async function downloadBackup() {
  const backup = await api('/api/admin/backup');
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = state.boot.config.slug + '-backup.json';
  a.click();
  URL.revokeObjectURL(url);
}

async function resetData() {
  if (!confirm('Reset this app to seeded data?')) return;
  await api('/api/admin/reset', { method: 'POST', body: JSON.stringify({}) });
  await refresh();
}

function aiCenter() {
  const ai = state.boot.aiCenter;
  return topbar('AI Center', 'Professional AI review for operational risks, work queues, and next actions.', 'AI Review') + '<section class="content"><div class="button-row ai-actions"><button class="button" onclick="generateAiReview()">Generate Review</button><span class="pill">' + esc(ai.mode) + '</span><span class="muted">Model: ' + esc(ai.model) + '</span></div><div class="ai-layout"><article class="ai-section"><h3>' + esc(ai.headline) + '</h3><p>' + esc(ai.summary) + '</p><h3>Recommendations</h3><ul class="ai-list">' + ai.recommendations.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul></article><article class="ai-section"><h3>Risks</h3><ul class="ai-list">' + ai.risks.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul><p class="muted">' + esc(ai.disclaimer) + '</p></article></div></section>';
}

function rulesAndJobs() {
  return topbar('Rules & Jobs', 'Rules-based risk scoring, readiness checks, scheduled jobs, and backup controls.', 'Governance') + '<section class="content grid"><div class="grid columns-2"><article class="panel"><h3>Domain Analysis</h3><div class="table-wrap"><table><thead><tr><th>Module</th><th>Risk</th><th>Blocked</th><th>Overdue</th><th>Recommendation</th></tr></thead><tbody>' + state.boot.domainAnalysis.map((r) => '<tr><td>' + esc(r.module) + '</td><td><span class="pill ' + statusClass(r.avgRisk >= 70 ? 'High' : r.avgRisk >= 40 ? 'Review' : 'Low') + '">' + esc(r.avgRisk) + '</span></td><td>' + esc(r.blocked) + '</td><td>' + esc(r.overdue) + '</td><td>' + esc(r.recommendation) + '</td></tr>').join('') + '</tbody></table></div></article><article class="panel"><h3>Readiness</h3><ul class="work-list">' + state.boot.readiness.checks.map((c) => '<li><strong>' + esc(c.name) + '</strong><br><span class="pill ' + (c.pass ? 'ok' : 'warn') + '">' + (c.pass ? 'Pass' : 'Needs setup') + '</span> <span class="muted">' + esc(c.detail) + '</span></li>').join('') + '</ul></article></div><article class="panel"><h3>Admin Actions</h3><div class="button-row">' + (can('jobs') ? '<button class="button" onclick="runDueJobs()">Run Due-Notification Job</button>' : '') + '<button class="button secondary" onclick="downloadBackup()">Download Backup</button>' + (can('admin') ? '<button class="button danger" onclick="resetData()">Reset Seed Data</button>' : '') + '</div></article></section>';
}

function reports() {
  return topbar('Reports', 'Export-ready reporting across every operational table.', 'Reporting') + '<section class="content grid"><div class="grid columns-3">' + Object.entries(state.boot.data).map(([name, rows]) => '<article class="metric"><div class="label">' + esc(name) + '</div><div class="value">' + rows.length + '</div><div class="detail"><a href="/api/export/' + name + '">Download CSV</a></div></article>').join('') + '</div><article class="panel"><h3>Readiness Summary</h3><p class="muted">This app includes sidebar navigation, domain modules, persisted records, RBAC, validation, versioning, exports, AI Center, audit logs, tasks, notifications, integrations, automations, approvals, backup/reset, and document metadata.</p><button class="button" onclick="window.print()">Print Report</button></article></section>';
}

function render() {
  if (!state.user || !state.token) return renderLogin();
  if (!state.boot) return;
  let inner = '';
  if (state.active === 'dashboard') inner = dashboard();
  else if (state.active === 'ai-center') inner = aiCenter();
  else if (state.active === 'rules') inner = rulesAndJobs();
  else if (state.active === 'reports') inner = reports();
  else inner = moduleView(moduleById(state.active));
  shell(inner);
}

async function refresh() {
  state.boot = await api('/api/bootstrap');
  render();
}

async function load() {
  if (!state.user || !state.token) return renderLogin();
  try {
    await refresh();
  } catch (err) {
    logout();
  }
}

load().catch((err) => { document.getElementById('app').innerHTML = '<div class="loading">Failed to load app: ' + esc(err.message) + '</div>'; });
