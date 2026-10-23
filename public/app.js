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


function logout() {
  cancelAIReview(false); reviewState.reports = []; reviewState.result = null; reviewState.selectedReport = null; reviewState.loaded = false;
  localStorage.removeItem(location.pathname + ':user');
  localStorage.removeItem(location.pathname + ':token');
  state.user = null;
  state.token = '';
  state.boot = null;
  renderLogin();
}

function setActive(id) {
  cancelAIReview(false); reviewState.selectedReport = null;
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
  document.getElementById('app').className = 'auth-screen';
  document.getElementById('app').innerHTML = '<main class="login-panel"><div class="brand-mark">AI</div><h1>' + esc(state.publicConfig.title) + '</h1><p class="muted">Sign in to open the sidebar app.</p><form class="login-form" onsubmit="login(event)"><label>Email<input name="email" autocomplete="username"></label><label>Password<input name="password" type="password" autocomplete="current-password"></label><button class="button">Sign In</button><div class="login-error" role="status"></div></form></main>';
}

function shell(inner) {
  const nav = [{ id: 'dashboard', label: 'Dashboard' }, ...state.boot.modules, { id: 'ai-center', label: 'AI Center' }, { id: 'rules', label: 'Rules & Jobs' }, { id: 'reports', label: 'Reports' }];
  document.getElementById('app').className = 'shell';
  document.getElementById('app').innerHTML = '<aside class="sidebar"><div class="brand"><div class="brand-mark">AI</div><h1>' + esc(state.boot.config.title) + '</h1><p>' + esc(state.boot.config.description) + '</p></div><div class="user-box"><strong>' + esc(state.user.name) + '</strong><span>' + esc(state.user.role) + '</span><button onclick="logout()">Sign out</button></div><div class="nav-label">Workspace</div><nav class="nav">' + nav.map((item) => '<button class="' + (state.active === item.id ? 'active' : '') + '" onclick="setActive(&quot;' + item.id + '&quot;)"><span class="nav-initial">' + esc(initial(item.label)) + '</span><span>' + esc(item.label) + '</span></button>').join('') + '</nav></aside><main class="main">' + inner + operationsDialog() + '</main>';
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
    return '<div class="button-row">' + add + edit + del + integration + '<a class="button secondary" href="/api/export/' + module.table + '">CSV Export</a>' + '<button type="button" class="button secondary" onclick="exportJson(&quot;' + module.table + '&quot;)">JSON Export</button></div>';
  }
  const keys = Object.keys(state.form).filter((k) => !['createdAt', 'updatedAt', 'riskScore'].includes(k));
  return '<div class="edit-form"><h3>' + (state.formMode === 'new' ? 'Add Record' : 'Edit Record') + '</h3><div class="form-grid">' + keys.map((k) => '<label>' + esc(k) + '<input ' + (k === 'id' || k === 'version' || k === 'expectedVersion' ? 'readonly' : '') + ' value="' + esc(Array.isArray(state.form[k]) ? state.form[k].join(', ') : state.form[k]) + '" oninput="updateForm(&quot;' + k + '&quot;, this.value)"></label>').join('') + '</div><div class="button-row"><button class="button" onclick="saveForm(&quot;' + module.table + '&quot;)">Save</button><button class="button secondary" onclick="state.formMode=&quot;view&quot;;state.form={};render();">Cancel</button></div></div>';
}

function moduleView(module) {
  const rows = getRows(module);
  const selected = rows.find((r) => r.id === state.selected);
  const keys = rows[0] ? Object.keys(rows[0]).slice(0, 9) : [];
  const upload = module.table === 'documents' && can('write') ? '<article class="panel"><h3>Upload Document Metadata</h3><form class="form-grid compact" onsubmit="uploadDocument(event)"><label>File Name<input name="fileName" placeholder="evidence.pdf"></label><label>Document Type<input name="documentType" placeholder="Policy"></label><label>Owner<input name="owner" placeholder="Reviewer"></label><label>Notes<input name="notes" placeholder="Context"></label><button class="button">Add Upload</button></form></article>' : '';
  return topbar(module.label, module.description, 'Feature Workspace') + '<section class="content grid"><div class="panel"><div class="subfeatures">' + module.subfeatures.map((s) => '<span class="sub-pill">' + esc(s) + '</span>').join('') + '</div><div class="toolbar"><input placeholder="Search records" value="' + esc(state.query) + '" oninput="state.query=this.value;render();"><select onchange="state.status=this.value;render();">' + ['all', 'open', 'progress', 'review', 'blocked', 'complete', 'high'].map((x) => '<option value="' + x + '" ' + (state.status === x ? 'selected' : '') + '>' + x + '</option>').join('') + '</select>' + (can('write') ? '<button class="button" onclick="addNew(&quot;' + module.id + '&quot;)">Add</button>' : '<span class="pill">Read only</span>') + '</div><div class="table-wrap"><table><thead><tr>' + keys.map((k) => '<th>' + esc(k) + '</th>').join('') + '</tr></thead><tbody>' + rows.map((row) => '<tr class="' + (selected && selected.id === row.id ? 'selected' : '') + '" onclick="selectRow(&quot;' + row.id + '&quot;)">' + keys.map((k) => '<td>' + (/status|priority|riskScore/i.test(k) ? '<span class="pill ' + statusClass(row[k]) + '">' + esc(row[k]) + '</span>' : esc(Array.isArray(row[k]) ? row[k].join(', ') : row[k])) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div></div>' + upload + '</section>';
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
  const dialog = document.querySelector('.operations-dialog');
  document.body.style.overflow = dialog ? 'hidden' : '';
  if (dialog) dialog.focus();
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

const reviewState = { fields: Object.fromEntries(['input', 'goal', 'context', 'audience', 'source_data', 'constraints', 'budget', 'deadline', 'tone', 'output_format'].map(key => [key, ''])), reports: [], selectedReport: null, result: null, controller: null, message: '', error: false, loaded: false };
const reviewLabels = { input: 'Review request', goal: 'Goal', context: 'Context (optional)', audience: 'Audience (optional)', source_data: 'Additional source data (optional)', constraints: 'Constraints (optional)', budget: 'Budget (optional)', deadline: 'Deadline (optional)', tone: 'Tone (optional)', output_format: 'Report format (optional)' };

function fillReviewPreset(index) {
  if (reviewState.controller) return;
  const title = state.boot.config.title;
  reviewState.fields = {
    input: ['Prepare an operational risk review', 'Prepare a team improvement plan', 'Compare operational priorities and review options'][index] + ' for ' + title,
    goal: ['Identify the three most urgent review tasks.', 'Assign practical next steps, owners and success measures.', 'Compare options using source evidence, tradeoffs and uncertainties.'][index],
    context: ['First review of the current stored operations.', 'Planning discussion for the operations team.', 'Detailed review for leadership and domain specialists.'][index],
    audience: ['Operations owner', 'Operations team and responsible reviewers', 'Leadership and domain specialists'][index],
    source_data: 'Use the current authorized record sample supplied by the server. No additional verified evidence is supplied in this example.',
    constraints: 'Do not invent facts or completed actions. Preserve required approvals and identify missing evidence before recommending action.',
    budget: ['Budget not yet approved; prioritize low cost review actions.', 'Example planning limit: $500; confirm before committing costs.', 'Compare low cost and resource intensive options; no spending authorized.'][index],
    deadline: ['Within the next week', 'Within two weeks', 'Within the next month'][index],
    tone: ['Clear and concise', 'Professional and collaborative', 'Detailed and evidence based'][index],
    output_format: ['Executive summary and prioritized action list', 'Summary, risk review and owner/action/timing table', 'Detailed report with assumptions, comparison table, risks and next steps'][index]
  };
  reviewState.message = 'All 10 brief fields filled. Review the example before generating.'; reviewState.error = false; render();
}

function cancelAIReview(update = true) {
  reviewState.controller?.abort(); reviewState.controller = null;
  if (update) { reviewState.message = 'Request canceled.'; reviewState.error = false; render(); }
}

async function generateAiReview(event) {
  event?.preventDefault();
  if (reviewState.controller) return;
  const form = document.getElementById('operations-ai-form');
  if (form && !form.reportValidity()) return;
  const controller = new AbortController(); reviewState.controller = controller;
  reviewState.message = 'OpenRouter is preparing your review…'; reviewState.error = false; render();
  try {
    const result = await api('/api/ai-center', { method: 'POST', signal: controller.signal, body: JSON.stringify({ fields: reviewState.fields }) });
    if (controller.signal.aborted) return;
    reviewState.result = result; reviewState.reports = [result, ...reviewState.reports]; reviewState.message = 'Review saved to your report history.';
  } catch (error) {
    if (!controller.signal.aborted) { reviewState.message = error.message; reviewState.error = true; }
  } finally { if (reviewState.controller === controller) reviewState.controller = null; if (!controller.signal.aborted) render(); }
}

async function loadReviewHistory() {
  try { const result = await api('/api/ai-center/reports'); reviewState.reports = result.reports || []; reviewState.loaded = true; if (state.active === 'ai-center') render(); }
  catch (error) { reviewState.loaded = true; reviewState.message = error.message; reviewState.error = true; if (state.active === 'ai-center') render(); }
}

function openReview(id) { reviewState.selectedReport = reviewState.reports.find(row => row.id === id) || null; render(); }
function editReviewBrief() { reviewState.fields = { ...reviewState.selectedReport.fields }; reviewState.selectedReport = null; reviewState.message = 'Saved brief opened for editing. Generate to save a new review.'; render(); }
async function renameReview() {
  const report = reviewState.selectedReport;
  if (!report) return;
  const title = document.getElementById('operations-report-title').value;
  try { const updated = await api('/api/ai-center/reports/' + encodeURIComponent(report.id), { method: 'PUT', body: JSON.stringify({ title }) }); reviewState.reports = reviewState.reports.map(row => row.id === updated.id ? updated : row); reviewState.selectedReport = updated; reviewState.error = false; render(); }
  catch (error) { document.getElementById('operations-dialog-status').textContent = error.message; }
}
async function deleteReview() {
  const report = reviewState.selectedReport;
  if (!report || !confirm('Delete this saved AI review?')) return;
  try { await api('/api/ai-center/reports/' + encodeURIComponent(report.id), { method: 'DELETE' }); reviewState.reports = reviewState.reports.filter(row => row.id !== report.id); reviewState.selectedReport = null; if (reviewState.result?.id === report.id) reviewState.result = null; render(); }
  catch (error) { document.getElementById('operations-dialog-status').textContent = error.message; }
}
function closeOperationsDialog() { state.selected = null; state.formMode = 'view'; state.form = {}; reviewState.selectedReport = null; render(); }

const domainAiState = { result: null, message: '' };
const domainAiFeatures = [{ id: 'claim-triage', title: 'Claim triage' }, { id: 'bill-review', title: 'Bill review savings review' }, { id: 'litigation-risk', title: 'Litigation risk review' }];
async function runDomainAI(id) { domainAiState.message = 'Running domain analysis…'; render(); try { domainAiState.result = await api('/api/ai/' + encodeURIComponent(id), { method: 'POST', body: JSON.stringify({}) }); domainAiState.message = domainAiState.result.aiGenerated ? 'AI-generated result.' : 'Deterministic fallback — no AI provider configured (aiGenerated: false).'; } catch (e) { domainAiState.message = e.message; } render(); }
function domainAiPanel() { const buttons = domainAiFeatures.map(f => '<button type="button" class="button secondary" onclick="runDomainAI(&quot;' + esc(f.id) + '&quot;)">' + esc(f.title) + '</button>').join(''); const result = domainAiState.result ? '<article class="panel"><p class="eyebrow">' + esc(domainAiState.result.aiGenerated ? 'AI-generated via ' + (domainAiState.result.provider || 'provider') : 'Deterministic fallback — no AI provider configured (aiGenerated: false)') + '</p>' + BrowserAIReport.render(domainAiState.result) + '</article>' : ''; return '<article class="panel"><h3>Domain AI (app records)</h3><p class="muted">Domain-grounded analysis over this app\'s own claims, bill-review, and litigation records. Without a provider key it returns a clearly labelled deterministic fallback (aiGenerated: false).</p><div class="button-row">' + buttons + '</div><p role="status" class="operations-ai-message">' + esc(domainAiState.message) + '</p></article>' + result; }
async function exportJson(table) { const data = await api('/api/export/' + table + '?format=json'); const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = table + '.json'; a.click(); URL.revokeObjectURL(url); }

function aiCenter() {
  if (!reviewState.loaded) { reviewState.loaded = true; loadReviewHistory(); }
  const ai = state.boot.aiCenter;
  const fields = Object.entries(reviewLabels).map(([key, label]) => '<label for="operations-ai-' + key + '">' + esc(label) + '<textarea id="operations-ai-' + key + '" name="' + key + '" maxlength="6000" ' + (['input', 'goal'].includes(key) ? 'required' : '') + ' ' + (reviewState.controller ? 'disabled' : '') + ' oninput="reviewState.fields[&quot;' + key + '&quot;]=this.value">' + esc(reviewState.fields[key]) + '</textarea></label>').join('');
  const result = reviewState.result ? '<article class="panel operations-ai-result"><p class="eyebrow">Saved OpenRouter review · ' + esc(reviewState.result.model) + '</p><h3>' + esc(reviewState.result.title) + '</h3>' + BrowserAIReport.render(reviewState.result.text) + '</article>' : '';
  const history = reviewState.reports.map(row => '<button class="button secondary" onclick="openReview(&quot;' + esc(row.id) + '&quot;)"><strong>' + esc(row.title) + '</strong><br><span>' + esc(new Date(row.createdAt).toLocaleString()) + ' · ' + esc(row.model) + '</span></button>').join('');
  return topbar('AI Center', 'Review the complete brief, generate once with OpenRouter, and manage your saved reports.', 'AI Review') + '<section class="content grid">' + domainAiPanel() + '<article class="panel"><h3>Review brief</h3><p class="muted">Presets fill every brief field. They do not change operational records or grant approvals.</p><div class="operations-ai-presets">' + ['Quick review', 'Team plan', 'Detailed review'].map((label, index) => '<button type="button" class="button secondary" onclick="fillReviewPreset(' + index + ')" ' + (reviewState.controller ? 'disabled' : '') + '>' + label + '</button>').join('') + '</div><form id="operations-ai-form" onsubmit="generateAiReview(event)"><div class="operations-ai-fields">' + fields + '</div><div class="button-row"><button type="submit" class="button" ' + (!can('ai') || reviewState.controller ? 'disabled' : '') + '>' + (reviewState.controller ? 'Generating…' : 'Generate with OpenRouter') + '</button>' + (reviewState.controller ? '<button type="button" class="button secondary" onclick="cancelAIReview()">Cancel request</button>' : '') + '</div></form><p role="status" class="operations-ai-message ' + (reviewState.error ? 'error' : '') + '">' + esc(reviewState.message) + '</p></article>' + result + '<article class="panel"><h3>Your saved reviews</h3><div class="operations-ai-history">' + (history || '<p class="muted">No saved OpenRouter reviews yet.</p>') + '</div></article><article class="panel"><p class="eyebrow">Fixed rule snapshot · no model call</p><h3>' + esc(ai.headline) + '</h3><p>' + esc(ai.summary) + '</p><p class="muted">' + esc(ai.disclaimer) + '</p></article></section>';
}

function operationsDialog() {
  const report = reviewState.selectedReport;
  let body = '', title = '', footer = '';
  if (report) {
    title = report.title;
    body = '<label for="operations-report-title">Report title<input id="operations-report-title" maxlength="140" value="' + esc(report.title) + '"></label><p class="muted">OpenRouter · ' + esc(report.model) + ' · ' + esc(new Date(report.createdAt).toLocaleString()) + '</p><p id="operations-dialog-status" role="status"></p>' + BrowserAIReport.render(report.text);
    footer = '<button class="button secondary" onclick="editReviewBrief()">Edit brief</button><button class="button" onclick="renameReview()">Save title</button><button class="button danger" onclick="deleteReview()">Delete</button>';
  } else {
    const module = moduleById(state.active);
    if (!module || (!state.selected && state.formMode === 'view')) return '';
    const row = (state.boot.data[module.table] || []).find(item => item.id === state.selected);
    if (!row && state.formMode !== 'new') return '';
    title = state.formMode === 'new' ? 'Add ' + module.label + ' record' : row.item || module.label;
    body = state.formMode === 'view' ? '<div class="detail-grid">' + Object.entries(row).map(([key, value]) => '<div class="field"><span>' + esc(key) + '</span>' + esc(Array.isArray(value) ? value.join(', ') : value) + '</div>').join('') + '</div>' : formPanel(module, row);
    if (state.formMode === 'view') footer = (can('write') ? '<button class="button" onclick="editSelected(moduleById(state.active),state.boot.data[moduleById(state.active).table].find(row=>row.id===state.selected))">Edit</button>' : '') + (can('delete') ? '<button class="button danger" onclick="deleteSelected(moduleById(state.active).table,state.boot.data[moduleById(state.active).table].find(row=>row.id===state.selected))">Delete</button>' : '');
  }
  return '<div class="operations-dialog-backdrop" onclick="if(event.target===this)closeOperationsDialog()"><section class="operations-dialog" role="dialog" aria-modal="true" aria-labelledby="operations-dialog-heading" tabindex="-1"><header class="operations-dialog-header"><h2 class="operations-dialog-title" id="operations-dialog-heading">' + esc(title) + '</h2><button type="button" class="button secondary" onclick="closeOperationsDialog()" aria-label="Cancel dialog">Cancel</button></header><div class="operations-dialog-body">' + body + '</div><footer class="operations-dialog-footer"><div class="button-row">' + footer + '</div><button class="button secondary" onclick="closeOperationsDialog()">Cancel</button></footer></section></div>';
}

document.addEventListener('keydown', event => {
  const dialog = document.querySelector('.operations-dialog');
  if (!dialog) return;
  if (event.key === 'Escape') closeOperationsDialog();
  if (event.key === 'Tab') {
    const controls = [...dialog.querySelectorAll('button,input,textarea,select,a[href],[tabindex]')].filter(node => !node.disabled && node.tabIndex >= 0);
    const first = controls[0], last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
});
window.addEventListener('beforeunload', () => cancelAIReview(false));


load().catch((err) => { document.getElementById('app').innerHTML = '<div class="loading">Failed to load app: ' + esc(err.message) + '</div>'; });
