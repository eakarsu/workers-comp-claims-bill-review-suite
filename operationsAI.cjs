'use strict';
const https = require('node:https');
const crypto = require('node:crypto');

const FIELD_KEYS = ['input', 'goal', 'context', 'audience', 'source_data', 'constraints', 'budget', 'deadline', 'tone', 'output_format'];
function validateFields(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Object.assign(new Error('Provide an editable review brief.'), { status: 422 });
  const fields = {};
  for (const key of FIELD_KEYS) {
    if (value[key] != null && typeof value[key] !== 'string') throw Object.assign(new Error(`${key} must be text.`), { status: 422 });
    fields[key] = String(value[key] || '').trim();
    if (fields[key].length > 6000) throw Object.assign(new Error(`${key} is too long.`), { status: 422 });
  }
  if (!fields.input || !fields.goal) throw Object.assign(new Error('Review request and goal are required.'), { status: 422 });
  return fields;
}

function createOperationsAI({ config, env = process.env, requestImpl = https.request, timeoutMs = 60000, quota = 20 }) {
  const requests = new Map();
  function generate(fields, data, signal) {
    if (!env.OPENROUTER_API_KEY || /changeme|your[_-]?key|placeholder/i.test(env.OPENROUTER_API_KEY) || !env.OPENROUTER_MODEL) throw Object.assign(new Error('Configure OPENROUTER_API_KEY and OPENROUTER_MODEL before generating a review.'), { status: 503 });
    if (signal.aborted) throw Object.assign(new Error('Request canceled.'), { name: 'AbortError', status: 499 });
    const body = JSON.stringify({ model: env.OPENROUTER_MODEL, messages: [
      { role: 'system', content: `You assist reviewers in ${config.title}. Today is ${new Date().toISOString().slice(0, 10)}. Produce a professional report with an executive summary, evidence, prioritized recommendations, risks, and next steps. Use headings, bullets and tables rather than raw JSON. Distinguish illustrative brief data from stored operational records. Do not invent facts, diagnoses, confidence scores, completed actions, integrations, approvals or external execution. Recommendations require the responsible human reviewer.` },
      { role: 'user', content: `Editable review brief:\n${JSON.stringify(fields)}\nCurrent authorized operational record sample:\n${JSON.stringify(data).slice(0, 18000)}` }
    ] });
    return new Promise((resolve, reject) => {
      let settled = false;
      let timer;
      const finish = (error, answer) => { if (settled) return; settled = true; clearTimeout(timer); signal.removeEventListener('abort', abort); error ? reject(error) : resolve(answer); };
      const fail = (message, status = 502) => Object.assign(new Error(message), { status });
      let request;
      const abort = () => { request?.destroy(); finish(Object.assign(new Error('Request canceled.'), { name: 'AbortError', status: 499 })); };
      try {
        request = requestImpl({ hostname: 'openrouter.ai', path: '/api/v1/chat/completions', method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + env.OPENROUTER_API_KEY, 'Content-Length': Buffer.byteLength(body) } }, response => {
          let text = '';
          response.on('data', chunk => { text += chunk; if (text.length > 2_000_000) { request.destroy(); finish(fail('OpenRouter response was too large.')); } });
          response.on('error', () => finish(fail('OpenRouter response was interrupted.')));
          response.on('end', () => {
            if (response.statusCode < 200 || response.statusCode >= 300) return finish(fail('OpenRouter rejected the request. Check provider configuration or try again.'));
            let parsed; try { parsed = JSON.parse(text); } catch { return finish(fail('OpenRouter returned an unreadable response.')); }
            const answer = parsed.choices?.[0]?.message?.content;
            if (typeof answer !== 'string' || !answer.trim()) return finish(fail('OpenRouter returned an empty response.'));
            if (signal.aborted) return abort();
            finish(null, { source: 'openrouter', model: parsed.model || env.OPENROUTER_MODEL, text: answer.trim() });
          });
        });
        request.on('error', () => finish(fail('OpenRouter could not be reached.')));
        signal.addEventListener('abort', abort, { once: true });
        timer = setTimeout(() => { request.destroy(); finish(fail('OpenRouter request timed out.', 504)); }, timeoutMs);
        request.write(body); request.end();
        if (signal.aborted) abort();
      } catch { finish(fail('OpenRouter could not be reached.')); }
    });
  }
  async function handle(req, res, pathname, { requireAuth, readBody, sendJson, store, saveStore, audit }) {
    if (pathname !== '/api/ai-center' && !pathname.startsWith('/api/ai-center/reports')) return false;
    if (pathname === '/api/ai-center' && req.method !== 'POST') return false;
    const session = requireAuth(req, res, 'ai');
    if (!session) return true;
    const actor = store.users.find(user => String(user.id) === String(session.user.id));
    if (!actor || actor.active === false) { sendJson(res, { error: 'Account is inactive.' }, 401); return true; }
    const owner = String(actor.id);
    const reports = store.aiReviews || [];
    try {
      if (pathname === '/api/ai-center/reports' && req.method === 'GET') { sendJson(res, { reports: reports.filter(row => row.owner === owner).slice(0, 100) }); return true; }
      const id = pathname.match(/^\/api\/ai-center\/reports\/([^/]+)$/)?.[1];
      if (id) {
        const index = reports.findIndex(row => row.id === decodeURIComponent(id) && row.owner === owner);
        if (index < 0) { sendJson(res, { error: 'Report not found.' }, 404); return true; }
        if (req.method === 'DELETE') { reports.splice(index, 1); store.aiReviews = reports; saveStore(); sendJson(res, { ok: true }); return true; }
        if (req.method === 'PUT') {
          const body = await readBody(req);
          const title = typeof body.title === 'string' ? body.title.trim() : '';
          if (!title || title.length > 140) throw Object.assign(new Error('Report title must contain 1–140 characters.'), { status: 422 });
          reports[index] = { ...reports[index], title, updatedAt: new Date().toISOString() }; store.aiReviews = reports; saveStore(); sendJson(res, reports[index]); return true;
        }
      }
      if (pathname !== '/api/ai-center' || req.method !== 'POST') { sendJson(res, { error: 'Route not found.' }, 404); return true; }
      const fields = validateFields((await readBody(req)).fields);
      const windowStart = Date.now() - 15 * 60 * 1000;
      const attempts = (requests.get(owner) || []).filter(time => time > windowStart);
      if (attempts.length >= quota) throw Object.assign(new Error('AI request limit reached. Try again later.'), { status: 429 });
      requests.set(owner, [...attempts, Date.now()]);
      const controller = new AbortController();
      const abort = () => { if (!res.writableEnded) controller.abort(); };
      req.on('aborted', abort); res.on('close', abort);
      try {
        const sample = Object.fromEntries((config.modules || []).map(module => [module.table, (store.data[module.table] || []).slice(0, 12)]));
        const answer = await generate(fields, sample, controller.signal);
        if (controller.signal.aborted || res.destroyed) return true;
        const report = { id: crypto.randomUUID(), owner, title: fields.input.slice(0, 140), fields, ...answer, createdAt: new Date().toISOString() };
        store.aiReviews = [report, ...(store.aiReviews || [])]; saveStore();
        audit(actor.email, 'Generated owned OpenRouter review', report.title);
        sendJson(res, report, 201);
      } finally { req.off('aborted', abort); res.off('close', abort); }
      return true;
    } catch (error) {
      if (!res.destroyed && !res.writableEnded) sendJson(res, { error: error.message }, error.status || 500);
      return true;
    }
  }
  return { handle, generate };
}
module.exports = { createOperationsAI, FIELD_KEYS, validateFields };
