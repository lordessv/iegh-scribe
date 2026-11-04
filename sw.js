
'use strict';

const CACHE = 'iegh-scribe-shell-v2';

const ASSETS = [
  './',
  './index.html',
  './app.js',
  './manifest.webmanifest',
  './icon.svg'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key =>
            key.startsWith('iegh-scribe-shell-') &&
            key !== CACHE
          )
          .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Never intercept Google Apps Script requests.
  if (url.origin !== self.location.origin) return;

  // Always check for an updated app when online.
  // Use the cached copy when offline.
  event.respondWith(
    fetch(request)
      .then(response => {
        if (response.ok) {
          const copy = response.clone();

          event.waitUntil(
            caches.open(CACHE).then(cache =>
              cache.put(request, copy)
            )
          );
        }

        return response;
      })
      .catch(() => caches.match(request))
  );
});
