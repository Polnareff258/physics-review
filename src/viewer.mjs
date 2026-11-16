export function questionPage(path) {
  const match = String(path).match(/-question-page-(\d+)\.jpe?g$/i);
  return match ? Number(match[1]) : null;
}

// Keep all source pages, but show those with the question text first.
export function orderQuestionImages(paths, pages = []) {
  const pageSet = new Set(pages.map(Number));
  return (paths || []).map((path, index) => ({path, index, page: questionPage(path)}))
    .sort((a, b) => Number(!pageSet.has(a.page)) - Number(!pageSet.has(b.page)) || a.index - b.index)
    .map(x => x.path);
}
