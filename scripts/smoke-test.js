const { spawn } = require('child_process');
const port = Number(process.env.SMOKE_PORT || 5999);
const base = 'http://127.0.0.1:' + port;
const child = spawn(process.execPath, ['server.js'], { cwd: process.cwd(), env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', OPENROUTER_API_KEY: '', OPENAI_API_KEY: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let token = '';
async function req(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (!headers['Content-Type'] && options.body) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch(base + path, { ...options, headers });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(path + ' failed: ' + res.status + ' ' + text);
  return json;
}
(async () => {
  await wait(700);
  const health = await req('/api/health');
  if (!health.ok) throw new Error('health failed');
  const slug = health.app;
  const login = await req('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'admin@' + slug + '.local', password: 'admin123' }) });
  if (!login.user || !login.token) throw new Error('login failed');
  token = login.token;
  const boot = await req('/api/bootstrap');
  if (!boot.modules || boot.modules.length < 10) throw new Error('bootstrap modules missing');
  const table = boot.config.modules[0].table;
  const created = await req('/api/table/' + table, { method: 'POST', body: JSON.stringify({ item: 'Smoke Test', owner: 'QA', priority: 'Low', status: 'Open', dueDate: '2026-06-07', value: 'Test', notes: 'Created by smoke test' }) });
  const updated = await req('/api/table/' + table + '/' + encodeURIComponent(created.row.id), { method: 'PUT', body: JSON.stringify({ status: 'Complete', expectedVersion: created.row.version }) });
  if (updated.row.status !== 'Complete' || updated.row.version <= created.row.version) throw new Error('versioned update failed');
  const analysis = await req('/api/domain/analyze');
  if (!analysis.analysis.length) throw new Error('domain analysis failed');
  await req('/api/jobs/run-due', { method: 'POST', body: JSON.stringify({}) });
  const backup = await req('/api/admin/backup');
  if (!backup.store || !backup.store.data) throw new Error('backup failed');
  const exported = await fetch(base + '/api/export/' + table, { headers: { Authorization: 'Bearer ' + token } });
  if (!exported.ok || !(await exported.text()).includes('Smoke Test')) throw new Error('export failed');
  await req('/api/table/' + table + '/' + encodeURIComponent(created.row.id), { method: 'DELETE' });
  const analystLogin = await req('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'analyst@' + slug + '.local', password: 'analyst123' }) });
  token = analystLogin.token;
  let blocked = false;
  try {
    await req('/api/table/' + table, { method: 'POST', body: JSON.stringify({ item: 'Should Fail', owner: 'QA', priority: 'Low', status: 'Open' }) });
  } catch {
    blocked = true;
  }
  if (!blocked) throw new Error('RBAC write block failed');
  const filtered = await req('/api/table/' + table + '?status=Complete');
  if (!filtered.rows.every((r) => r.status === 'Complete')) throw new Error('server filter failed');
  const jsonExport = await req('/api/export/' + table + '?format=json');
  if (!Array.isArray(jsonExport.rows)) throw new Error('json export failed');
  const triage = await req('/api/ai/claim-triage', { method: 'POST', body: JSON.stringify({ rows: [{ id:'C-1', item:'x', status:'Blocked', priority:'High', riskScore:0, dueDate:'2020-01-01' }] }) });
  if (triage.aiGenerated !== false || !triage.sections?.length) throw new Error('ai fallback failed');
  // wave5c: authenticated tasks CRUD + remaining domain AI fallbacks
  const adminAgain = await req('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'admin@' + slug + '.local', password: 'admin123' }) }); token = adminAgain.token;
  const unauth = await fetch(base + '/api/table/tasks'); if (unauth.status !== 401) throw new Error('tasks unauthenticated not 401');
  const task = await req('/api/table/tasks', { method: 'POST', body: JSON.stringify({ item: 'Wave5C Task', owner: 'QA', priority: 'High', status: 'Open', dueDate: '2026-06-07', value: 'Test', notes: 'wave5c' }) });
  const taskUpd = await req('/api/table/tasks/' + encodeURIComponent(task.row.id), { method: 'PUT', body: JSON.stringify({ status: 'Complete', expectedVersion: task.row.version }) });
  if (taskUpd.row.status !== 'Complete') throw new Error('tasks update failed');
  for (const fid of ['bill-review', 'litigation-risk']) {
    const aiRes = await req('/api/ai/' + fid, { method: 'POST', body: JSON.stringify({}) });
    if (aiRes.aiGenerated !== false || aiRes.mode !== 'deterministic-fallback' || !aiRes.sections?.length) throw new Error('domain AI fallback labelling failed for ' + fid);
  }
  await req('/api/table/tasks/' + encodeURIComponent(task.row.id), { method: 'DELETE' });
  console.log('Smoke test passed for ' + slug);
})().catch((err) => { console.error(err); process.exitCode = 1; }).finally(() => child.kill());
