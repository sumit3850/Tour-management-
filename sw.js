/* Minimal service worker — exists so the browser considers this an installable app.
   Deliberately does no caching (the app already reads live data from Supabase on
   every load), it just needs a fetch handler present. */
self.addEventListener("install", function(e){ self.skipWaiting(); });
self.addEventListener("activate", function(e){ self.clients.claim(); });
self.addEventListener("fetch", function(e){ /* pass-through — always hit the network */ });
