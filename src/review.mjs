const intervals = [1, 3, 7, 14];

export function nextDue(at, rating, previous = 0) {
  const index = Math.max(0, intervals.indexOf(previous));
  const interval = rating === 'forgot' ? 1 : rating === 'fuzzy' ? Math.max(1, previous || 1) : intervals[Math.min(index + (previous ? 1 : 0), intervals.length - 1)];
  return { interval, due: new Date(new Date(at).getTime() + interval * 86400000).toISOString() };
}

export function chooseQuestions(questions, events, options = {}, random = Math.random, now = Date.now()) {
  const filtered = questions.filter(q => (!options.subject || options.subject === 'all' || q.subject === options.subject) && (!options.type || options.type === 'all' || q.type === options.type));
  const latest = new Map();
  for (const event of events) {
    const old = latest.get(event.questionId);
    if (!old || String(event.at) > String(old.at)) latest.set(event.questionId, event);
  }
  let ranked = filtered.map(q => ({ q, random: random(), event: latest.get(q.id) }));
  if (options.mode === 'recent') ranked = ranked.filter(x => x.event);
  if (options.mode === 'difficult') ranked = ranked.filter(x => x.event && ['forgot','fuzzy'].includes(x.event.rating));
  const weight = e => { if (!e) return 1; const due = e.due && Date.parse(e.due); if (due && due > now) return 5; return e.rating === 'forgot' ? 0 : e.rating === 'fuzzy' ? 2 : 3; };
  ranked.sort((a, b) => (options.mode === 'recent' || options.mode === 'difficult' ? String(b.event.at).localeCompare(String(a.event.at)) : options.mode === 'weak' ? weight(a.event) - weight(b.event) : 0) || a.random - b.random);
  const count = Math.max(0, Math.min(ranked.length, Number(options.count ?? 10) || 0));
  return ranked.slice(0, count).map(x => x.q);
}
