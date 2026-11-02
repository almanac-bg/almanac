// The code a page the server drew needs to come alive, fetched as the page starts (the server lists it on this
// script's tag: apps/server/src/index.ts → pageCode) instead of each file only once the one before it has run: it
// waits in the browser's cache for the app's own imports (the 31 October review, WEB-6). A plain fetch, not a
// preload link, which WebKit keeps failed for the tab after one failed download, even through a reload (WEB-2). Not
// in Apple's WebKit (Safari, and every browser on an iPhone), whose imports don't take a fetched file from the cache:
// it would download each twice. A file of its own: the page's security policy runs no inline script.
if (navigator.vendor !== 'Apple Computer, Inc.') {
  for (const url of document.currentScript?.dataset.code?.split(' ') ?? []) {
    if (url) fetch(url).catch(() => {});
  }
}
