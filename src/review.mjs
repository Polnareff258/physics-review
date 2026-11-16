const intervals = [1, 3, 7, 14];

export function nextDue(at, rating, previous = 0, usedHint = false, previousDue = null) {
  const atMs = new Date(at).getTime();
  const dueMs = Date.parse(previousDue);
  if (!usedHint && rating === 'remembered' && previous > 0 && Number.isFinite(dueMs) && atMs < dueMs) {
    return {interval: previous, due: new Date(dueMs).toISOString()};
  }
  const index = Math.max(0, intervals.indexOf(previous));
  const interval = usedHint || rating === 'forgot' ? 1 : rating === 'fuzzy' ? Math.min(3, Math.max(1, previous || 1)) : intervals[Math.min(index + (previous ? 1 : 0), intervals.length - 1)];
  let nextMs = atMs + interval * 86400000;
  if ((['forgot','fuzzy'].includes(rating) || usedHint) && Number.isFinite(dueMs) && dueMs > atMs) nextMs = Math.min(nextMs, dueMs);
  return {interval, due: new Date(nextMs).toISOString()};
}

export function pickLatestEvents(events = []) {
  const latest = new Map();
  for (const event of Array.isArray(events) ? events : []) {
    if (!event || !event.questionId) continue;
    const old = latest.get(event.questionId), t = Date.parse(event.at), previous = old ? Date.parse(old.at) : NaN;
    const tie = (!Number.isFinite(t) && !Number.isFinite(previous)) || (Number.isFinite(t) && t === previous);
    if (!old || (Number.isFinite(t) && (!Number.isFinite(previous) || t > previous)) || (tie && String(event.id || '') > String(old.id || ''))) latest.set(event.questionId, event);
  }
  return latest;
}

export function chooseQuestions(questions, events, options = {}, random = Math.random, now = Date.now()) {
  const filtered = questions.filter(q => (!options.subject || options.subject === 'all' || q.subject === options.subject) && (!options.type || options.type === 'all' || q.type === options.type));
  const latest = pickLatestEvents(events);
  let ranked = filtered.map(q => ({ q, random: random(), event: latest.get(q.id) }));
  if (options.mode === 'due') ranked = ranked.filter(x => Number.isFinite(Date.parse(x.event?.due)) && Date.parse(x.event.due) <= now);
  if (options.mode === 'recent') ranked = ranked.filter(x => x.event);
  if (options.mode === 'difficult') ranked = ranked.filter(x => x.event && (['forgot','fuzzy'].includes(x.event.rating) || x.event.comparedToSource === 'different'));
  const weight = e => { if (!e) return 4; const due = Date.parse(e.due); if (!Number.isFinite(due)) return e.rating === 'forgot' ? 3 : e.rating === 'fuzzy' ? 3.1 : 3.2; if (due > now) return 5; return e.rating === 'forgot' ? 0 : e.rating === 'fuzzy' ? 1 : 2; };
  ranked.sort((a, b) => (options.mode === 'recent' || options.mode === 'difficult' ? String(b.event.at).localeCompare(String(a.event.at)) : options.mode === 'weak' || options.mode === 'due' ? weight(a.event) - weight(b.event) || Date.parse(a.event?.due || 0)-Date.parse(b.event?.due || 0) : 0) || a.random - b.random);
  const count = Math.max(0, Math.min(ranked.length, Number(options.count ?? 10) || 0));
  return ranked.slice(0, count).map(x => x.q);
}
