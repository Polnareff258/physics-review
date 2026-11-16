import {pickLatestEvents} from './review.mjs';

// Legacy records with invalid timestamps count as attempts, but never as dated activity.
export function buildLearningInsights(questions = [], events = [], now = Date.now()) {
  const clock = Number.isFinite(Number(now)) && Math.abs(Number(now)) <= 8640000000000000 ? Number(now) : Date.now();
  const time = v => { const t = v == null || v === '' ? NaN : typeof v === 'number' ? v : Date.parse(v); return Number.isFinite(t) && Math.abs(t) <= 8640000000000000 ? t : NaN; };
  const date = new Date(clock);
  const day = offset => new Date(date.getFullYear(), date.getMonth(), date.getDate() + offset);
  const key = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const qs = new Map();
  for (const q of Array.isArray(questions) ? questions : []) if (q?.id != null && q.id !== '' && !qs.has(q.id)) qs.set(q.id,q);
  const unique = new Map();
  for (const e of Array.isArray(events) ? events : []) {
    if (e?.id == null || e.id === '' || !qs.has(e.questionId) || unique.has(e.id)) continue;
    unique.set(e.id,e);
  }
  const records = [...unique.values()].filter(e => !Number.isFinite(time(e.at)) || time(e.at) <= clock);
  const latest = pickLatestEvents(records);
  const daily14 = Array.from({length:14},(_,i)=>({date:key(day(i-13)),count:0,unique:0}));
  const daySets = daily14.map(()=>new Set());
  const upcoming7 = Array.from({length:7},(_,i)=>({date:key(day(i+1)),count:0}));
  const stats = new Map(), groups = new Map();
  let eligible=0, success=0;
  for (const e of records) {
    const s = stats.get(e.questionId) || {attempts:0,mismatch:0}; s.attempts++; if(e.comparedToSource==='different') s.mismatch++; stats.set(e.questionId,s);
    if(e.answeredBeforeReveal===true && e.usedHint===false && ['remembered','known','fuzzy','forgot'].includes(e.rating)) {eligible++; if(e.rating==='remembered'||e.rating==='known') success++;}
    const t=time(e.at); if(Number.isFinite(t)) {const k=key(new Date(t)), i=daily14.findIndex(x=>x.date===k); if(i>=0){daily14[i].count++;daySets[i].add(e.questionId);}}
  }
  daily14.forEach((x,i)=>{x.unique=daySets[i].size;});
  let dueNow=0, overdueDayPlus=0; const targets=[];
  for(const q of qs.values()) {
    const subject=String(q.subject || '未分类');
    if(!groups.has(subject)) groups.set(subject,{subject,total:0,covered:0,attempts:0,due:0,weak:0});
    const g=groups.get(subject), e=latest.get(q.id), s=stats.get(q.id), t=time(e?.due), due=Number.isFinite(t)&&t<=clock;
    g.total++; if(s){g.covered++;g.attempts+=s.attempts;} if(due){g.due++;dueNow++;if(t<day(0).getTime())overdueDayPlus++;} if(['forgot','fuzzy'].includes(e?.rating))g.weak++;
    if(Number.isFinite(t) && t>clock) {const i=upcoming7.findIndex(x=>x.date===key(new Date(t)));if(i>=0)upcoming7[i].count++;}
    if(e) targets.push({id:q.id,subject,number:q.number ?? null,latestRating:e.rating ?? null,due:Number.isFinite(t)?new Date(t).toISOString():null,attempts:s.attempts,sourceMismatchCount:s.mismatch});
  }
  const rank={forgot:0,fuzzy:1};
  targets.sort((a,b)=>Number(Number.isFinite(time(b.due))&&time(b.due)<=clock)-Number(Number.isFinite(time(a.due))&&time(a.due)<=clock) || (rank[a.latestRating]??2)-(rank[b.latestRating]??2) || String(a.id).localeCompare(String(b.id)));
  return {asOf:new Date(clock).toISOString(),totalQuestions:qs.size,coveredQuestions:stats.size,totalAttempts:records.length,dueNow,overdueDayPlus,activeDays7:daily14.slice(-7).filter(d=>d.count>0).length,daily14,subjects:[...groups.values()],upcoming7,independentRecall:{success,eligible},reviewTargets:targets.slice(0,20)};
}

