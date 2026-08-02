// URLs between the app's two pages, worked out at runtime because the app is
// mounted somewhere different in each of its homes: the domain root on Render
// and in the portable pack, /DictationApp/ on GitHub Pages.
//
// The teacher page lives one level down at <root>/create/, so nothing here may
// assume location.pathname is the root — a student link built from the teacher
// page would otherwise come out as …/create/?a=CODE and 404 for the class.
//
// There is no link from the practice page to /create/ and no passage handed
// across: the practice page is what students see, and it should carry nothing
// aimed at the teacher. The teacher types the address.

/** Absolute URL of the app root, with a trailing slash, from either page. */
export function appRoot() {
  // Any path segment after the root is the teacher page; everything else is
  // already at the root (with or without an index.html on the end).
  const path = window.location.pathname;
  const url = /\/create\/?$/.test(path)
    ? new URL('../', window.location.href)
    : new URL('./', window.location.href.replace(/\/index\.html$/, '/'));
  return url.href;
}

/** The link a teacher gives a class for one assignment. */
export function studentLink(code) {
  return `${appRoot()}?a=${code}`;
}

/** The teacher page. */
export function createPageUrl() {
  return `${appRoot()}create/`;
}
