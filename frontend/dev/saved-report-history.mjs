// Match the account history API's stable save order, filters, and page boundary.
export function paginateReportHistory(reports, params) {
  const query = (params.get('q') || '').trim().toLocaleLowerCase();
  const aiOnly = params.get('aiOnly') === 'true';
  const sorted = [...reports].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  const cursor = params.get('cursor');
  const start = cursor ? sorted.findIndex(report => report.id === cursor) + 1 : 0;
  if (cursor && start === 0) return { reports: [], nextCursor: null };
  const matches = sorted.slice(start).filter(report =>
    (!aiOnly || report.hasAi) && `${report.title} ${report.objectiveName} ${report.forecastDate || ''}`.toLocaleLowerCase().includes(query),
  );
  const page = matches.slice(0, 100);
  return { reports: page, nextCursor: matches.length > 100 ? page.at(-1).id : null };
}
