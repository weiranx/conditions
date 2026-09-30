// Build-time hints that shorten the first load. Both are added to index.html:
//  - a preconnect to the API origin, so its DNS lookup and TLS handshake overlap the page's own downloads;
//  - for visits that open the planner, preloads of the planner's code and styles, so they download beside the
//    entry script instead of after it has downloaded and run.
//
// A first-time visitor to "/" gets the landing page, which needs none of the planner, so the preloads are
// added by a small script that makes the same decision as shouldShowLanding (src/app/landing-gate.ts).
// tests/load-hints.test.jsx keeps the two in step.

/** Storage keys that show a browser has used the planner: the same keys shouldShowLanding checks. */
export const RETURNING_VISITOR_KEYS = [
  'summitsafe:landing-seen:v1',
  'summitsafe:user-preferences:v1',
  'summitsafe:persisted-report:v1',
  'summitsafe:guest-report-count:v1',
];
export const WRITE_PROBE_KEY = 'summitsafe:landing-probe';

const PLANNER_ENTRY = /[\\/]src[\\/]field[\\/]FieldApp\.tsx$/;

/** The origin of an absolute API URL, or null when the API is served from the page's own origin. */
export function apiOriginOf(apiBaseUrl) {
  try {
    const url = new URL(String(apiBaseUrl ?? '').trim());
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : null;
  } catch {
    return null;
  }
}

/**
 * The files the planner needs the moment it opens: its own chunk, the chunks it imports statically and their
 * stylesheets. The entry chunk is left out because the page loads it anyway, and so are the screens the
 * planner loads on demand. Returns null when the bundle has no planner chunk.
 */
export function plannerPreloads(bundle, base = '/') {
  const chunks = Object.values(bundle).filter((item) => item.type === 'chunk');
  const byFile = new Map(chunks.map((chunk) => [chunk.fileName, chunk]));
  // The chunk that holds the planner's module. Rollup does not always name a facade for a chunk loaded on demand.
  const planner = chunks.find((chunk) => (
    PLANNER_ENTRY.test(chunk.facadeModuleId || '') || (chunk.moduleIds ?? []).some((id) => PLANNER_ENTRY.test(id))
  ));
  if (!planner) return null;
  const js = [];
  const css = [];
  const seen = new Set();
  const visit = (chunk) => {
    if (seen.has(chunk.fileName)) return;
    seen.add(chunk.fileName);
    if (!chunk.isEntry) {
      js.push(chunk.fileName);
      css.push(...(chunk.viteMetadata?.importedCss ?? []));
    }
    for (const file of chunk.imports ?? []) {
      const dependency = byFile.get(file);
      if (dependency) visit(dependency);
    }
  };
  visit(planner);
  const prefix = base.endsWith('/') ? base : `${base}/`;
  return { js: js.map((file) => `${prefix}${file}`), css: [...new Set(css)].map((file) => `${prefix}${file}`) };
}

/**
 * The inline script. It adds the preloads unless the visit opens the landing page or the connect page,
 * deciding as shouldShowLanding does, and does nothing at all if anything goes wrong.
 */
export function plannerPreloadScript({ js, css }) {
  return `(function () {
  try {
    var path = location.pathname;
    var landing = /^\\/welcome\\/?$/.test(path);
    if (!landing && path === '/' && !location.search && !location.hash) {
      try {
        var storage = window.localStorage;
        var returning = ${JSON.stringify(RETURNING_VISITOR_KEYS)}.some(function (key) { return storage.getItem(key) !== null; });
        if (!returning) {
          storage.setItem(${JSON.stringify(WRITE_PROBE_KEY)}, '1');
          storage.removeItem(${JSON.stringify(WRITE_PROBE_KEY)});
          landing = true;
        }
      } catch (error) {
        landing = false;
      }
    }
    if (landing || path === '/connect') return;
    function hint(attributes, href) {
      var link = document.createElement('link');
      for (var name in attributes) link.setAttribute(name, attributes[name]);
      link.setAttribute('href', href);
      document.head.appendChild(link);
    }
    ${JSON.stringify(js)}.forEach(function (href) { hint({ rel: 'modulepreload', crossorigin: '' }, href); });
    ${JSON.stringify(css)}.forEach(function (href) { hint({ rel: 'preload', as: 'style', crossorigin: '' }, href); });
  } catch (error) {}
})();`;
}

export function plannerLoadHints() {
  let base = '/';
  let apiOrigin = null;
  return {
    name: 'planner-load-hints',
    apply: 'build',
    configResolved(config) {
      base = config.base || '/';
      apiOrigin = apiOriginOf(config.env?.VITE_API_BASE_URL);
    },
    transformIndexHtml: {
      order: 'post',
      handler(_html, context) {
        const tags = [];
        // The app calls the API with credentials, so the connection is opened for credentialed requests: no crossorigin.
        if (apiOrigin) tags.push({ tag: 'link', attrs: { rel: 'preconnect', href: apiOrigin }, injectTo: 'head-prepend' });
        const preloads = context.bundle ? plannerPreloads(context.bundle, base) : null;
        if (preloads && (preloads.js.length || preloads.css.length)) {
          tags.push({ tag: 'script', children: plannerPreloadScript(preloads), injectTo: 'head-prepend' });
        }
        return tags;
      },
    },
  };
}
