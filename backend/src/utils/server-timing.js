'use strict';

// Server-Timing shows where a response spent its time in a browser's network panel. Every duration is
// measured from the start of the request, so overlapping sources appear as bars that end when each one did.
const METRIC_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

const createServerTiming = (now = () => performance.now()) => {
  const startedAt = now();
  const marks = new Map();

  // Records when something finished. The first mark under a name wins.
  const mark = (name) => {
    if (METRIC_NAME.test(name) && !marks.has(name)) marks.set(name, now() - startedAt);
  };
  // Marks when a promise settles, however it settles, and returns the promise itself.
  const track = (name, promise) => {
    const done = () => mark(name);
    Promise.resolve(promise).then(done, done);
    return promise;
  };
  const header = () => [...marks, ['total', now() - startedAt]]
    .map(([name, ms]) => `${name};dur=${ms.toFixed(1)}`)
    .join(', ');

  return { mark, track, header };
};

module.exports = { createServerTiming };
