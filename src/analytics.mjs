import {pickLatestEvents} from './review.mjs';
// Counts use unique question and event IDs; invalid timestamps never enter date-based views.
export function analyze(questions = [], events = [], now = Date.now()) {
  const clock = Number.isFinite(Number(now)) ? Number(now) : Date.now();
  const qs = new Map();
  for (const q of Array.isArray(questions) ? questions : []) if (q?.id != null && q.id !== '' && !qs.has(q.id)) qs.set(q.id, q);
  const unique = new Map();
  for (const e of Array.isArray(events) ? events : []) if (e?.id != null && e.id !== '' && qs.has(e.questionId) && !unique.has(e.id)) unique.set(e.id, e);
  const time = value => { if (value == null || value === '') return NaN; const t = typeof value === 'number' ? value : Date.parse(value); return Number.isFinite(t) ? t : NaN; };
  const records = [...unique.values()];
  const latest = pickLatestEvents(records);
  const mastery = {known:0, fuzzy:0, forgot:0, unreviewed:0};
  const subjects = Object.create(null), recommendations = [];
  let dueCount = 0;
  for (const q of qs.values()) {
    const e = latest.get(q.id), rating = e?.rating === 'remembered' ? 'known' : ['known','fuzzy','forgot'].includes(e?.rating) ? e.rating : 'unreviewed';
    const subject = String(q.subject || '未分类');
    const group = subjects[subject] ||= {total:0, known:0, fuzzy:0, forgot:0, unreviewed:0, due:0, recommendations:[]};
    group.total++; group[rating]++; mastery[rating]++;
    const due = time(e?.due), isDue = Number.isFinite(due) && due <= clock;
    if (isDue) { dueCount++; group.due++; }
    const reasons = [];
    if (isDue) reasons.push('到期');
    if (rating === 'forgot') reasons.push('不会');
    if (rating === 'fuzzy') reasons.push('模糊');
    if (rating === 'unreviewed') reasons.push('未学习');
    if (reasons.length) recommendations.push({questionId:q.id, subject, reasons, due:isDue ? e.due : null, rating});
  }
  const rank = {forgot:0, fuzzy:1, known:2, unreviewed:3};
  recommendations.sort ( (a,b) => Number(b.reasons.includes('到期'))-Number(a.reasons.includes('到期')) || rank[a.rating]-rank[b.rating] || String(a.questionId).localeCompare(String(b.questionId)) );
  for (const item of recommendations) subjects[item.subject].recommendations.push(item);
  const sourceComparison = {match:0,different:0};
  for (const e of records) if (e.comparedToSource === 'match' || e.comparedToSource === 'different') sourceComparison[e.comparedToSource]++;
  const activity = [];
  const today = new Date(clock);
  for (let offset=6; offset>=0; offset--) {
    const day = new Date(today.getFullYear(),today.getMonth(),today.getDate()-offset);
    const end = new Date(today.getFullYear(),today.getMonth(),today.getDate()-offset+1);
    const date = `${day.getFullYear()}-${String(day.getMonth()+1).padStart(2,'0')}-${String(day.getDate()).padStart(2,'0')}`;
    activity.push({date,count:records.filter(e=>{const t=time(e.at); return t>=day.getTime() && t<end.getTime() && t<=clock}).length});
  }
  const recent = records.filter(e=>Number.isFinite(time(e.at)) && time(e.at)<=clock).sort((a,b)=>time(b.at)-time(a.at)).slice(0,20);
  return {totalQuestions:qs.size,totalEvents:records.length,mastery,dueCount,subjects,recommendations,activity,recent,sourceComparison,objectiveAccuracy:null};
}

