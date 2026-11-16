const MAX_RECORDS = 100000;
export function buildBackup(events, exportedAt = new Date().toISOString()) {
  if (!Array.isArray(events) || events.length > MAX_RECORDS) throw new Error('学习记录格式不正确或数量过多');
  return {format:'physics-review-backup',version:1,exportedAt,events};
}
export function readBackup(text) {
  let backup;
  try { backup = JSON.parse(text); } catch { throw new Error('备份文件无法解析'); }
  if (!backup || backup.format !== 'physics-review-backup' || backup.version !== 1 || !Array.isArray(backup.events) || backup.events.length > MAX_RECORDS) throw new Error('备份文件格式不正确');
  const ids = new Set();
  for (const event of backup.events) {
    if (!event || typeof event !== 'object' || Array.isArray(event) || typeof event.id !== 'string' || !event.id || event.id.length > 256 || ids.has(event.id)) throw new Error('备份文件中有无效或重复记录');
    ids.add(event.id);
  }
  return backup.events;
}
