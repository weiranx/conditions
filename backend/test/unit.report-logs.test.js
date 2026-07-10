const { isRouteWaypointEntry } = require('../src/routes/report-logs');

test('identifies internal route waypoint log entries', () => {
  expect(isRouteWaypointEntry({ name: 'Route waypoint: Trailhead' })).toBe(true);
  expect(isRouteWaypointEntry({ name: 'Mount Rainier' })).toBe(false);
  expect(isRouteWaypointEntry({ name: null })).toBe(false);
});
