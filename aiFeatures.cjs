'use strict';
// Deterministic domain AI over workers-comp records. Provider is only
// attempted when OPENROUTER_API_KEY+OPENROUTER_MODEL are configured;
// otherwise a clearly labelled deterministic fallback (aiGenerated:false).
function sections(title, rows){ return {title, rows}; }
function claimTriage(rows=[]){
  const open=rows.filter(r=>r.status!=='Complete');
  const blocked=rows.filter(r=>r.status==='Blocked').length;
  const overdue=rows.filter(r=>r.dueDate && r.dueDate < new Date().toISOString().slice(0,10) && r.status!=='Complete').length;
  const high=open.filter(r=>['High','Escalate'].includes(r.priority)).length;
  const score=rows.length? Math.round(rows.reduce((s,r)=>s+Number(r.riskScore||0),0)/rows.length):0;
  return {aiGenerated:false,mode:'deterministic-fallback',feature:'claim-triage',
    summary:`${open.length} open claims, ${blocked} blocked, ${overdue} overdue, average risk ${score}.`,
    sections:[sections('Counts',{total:rows.length,open:open.length,blocked,overdue,highPriority:high,averageRisk:score}),
      sections('Priority queue', open.slice().sort((a,b)=>Number(b.riskScore||0)-Number(a.riskScore||0)).slice(0,5).map(r=>({id:r.id,item:r.item,riskScore:r.riskScore??0,blocked:r.status==='Blocked'})))],
    disclaimer:'Deterministic rules over stored records — not a model generation. Human review required.'};
}
function billReview(rows=[]){
  const total=rows.length; const review=rows.filter(r=>r.status==='Review').length;
  const blocked=rows.filter(r=>r.status==='Blocked').length;
  return {aiGenerated:false,mode:'deterministic-fallback',feature:'bill-review',
    summary:`${total} bills, ${review} in review, ${blocked} blocked.`,
    sections:[sections('Counts',{total,review,blocked,complete:rows.filter(r=>r.status==='Complete').length}),
      sections('Needs attention', rows.filter(r=>r.status!=='Complete').slice(0,5).map(r=>({id:r.id,item:r.item,status:r.status,value:r.value??''})))],
    disclaimer:'Deterministic rules over stored records — not a model generation.'};
}
function litigationRisk(rows=[]){
  const esc=rows.filter(r=>r.priority==='Escalate').length;
  const avg=rows.length? Math.round(rows.reduce((s,r)=>s+Number(r.riskScore||0),0)/rows.length):0;
  return {aiGenerated:false,mode:'deterministic-fallback',feature:'litigation-risk',
    summary:`${esc} escalated records, average risk ${avg}.`,
    sections:[sections('Risk',{total:rows.length,escalated:esc,averageRisk:avg,anyEscalated:esc>0}),
      sections('Top risks', rows.slice().sort((a,b)=>Number(b.riskScore||0)-Number(a.riskScore||0)).slice(0,5).map(r=>({id:r.id,item:r.item,riskScore:r.riskScore??0})))],
    disclaimer:'Deterministic rules over stored records — not a model generation.'};
}
function providerConfig(env){
  if(env.OPENROUTER_API_KEY && !/changeme|your[_-]?key|placeholder/i.test(env.OPENROUTER_API_KEY)) return {name:'openrouter',key:env.OPENROUTER_API_KEY,model:env.OPENROUTER_MODEL||'openai/gpt-4o-mini',url:'https://openrouter.ai/api/v1/chat/completions'};
  if(env.OPENAI_API_KEY && !/changeme|your[_-]?key|placeholder/i.test(env.OPENAI_API_KEY)) return {name:'openai',key:env.OPENAI_API_KEY,model:env.OPENAI_MODEL||'gpt-4o-mini',url:'https://api.openai.com/v1/chat/completions'};
  return null;
}
async function maybeProvider(feature, fallback, env=process.env, fetchImpl=globalThis.fetch){
  const cfg=providerConfig(env);
  if(!cfg || typeof fetchImpl!=='function') return fallback;
  try{
    const r=await fetchImpl(cfg.url,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+cfg.key},body:JSON.stringify({model:cfg.model,messages:[{role:'system',content:'Return concise JSON sections for workers-comp review. Ground every claim in the supplied records.'},{role:'user',content:feature+': '+JSON.stringify(fallback).slice(0,4000)}]})});
    if(!r.ok) return fallback; const j=await r.json(); const text=j.choices?.[0]?.message?.content;
    if(!text) return fallback; return {...fallback,aiGenerated:true,mode:'provider',provider:cfg.name,model:j.model||cfg.model,providerText:text};
  }catch{ return fallback; }
}
module.exports={claimTriage,billReview,litigationRisk,maybeProvider,providerConfig};
