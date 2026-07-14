/* Service worker — makes the driver & guide ops apps work offline.

   Strategy:
   - App shell (the HTML pages, the Supabase JS bundle, the logo/icons) is
     precached on install and served cache-first, so the pages OPEN with no
     internet.
   - Navigations are network-first (falling back to cache) so that when the
     device IS online it always gets the freshly-deployed build, and only
     falls back to the cached copy when offline.
   - Supabase API calls (…supabase.co…) are never touched — they go straight
     to the network. The apps queue their writes in localStorage and flush
     them when the connection returns, so a failed API call offline is
     expected and handled by the app, not the cache. */
var CACHE = "ie-ops-v56"; /* v56: interest form auto-creates a booking like the guest form */
var SHELL = [
  "config.js",
  "driver-app.html", "ops-guide.html", "register.html", "respond.html", "departures.html", "feedback.html", "index.html",
  "manifest.json", "driver-manifest.json", "guide-manifest.json",
  "assets/logo.png", "assets/logo.jpg", "assets/icon.svg", "assets/icon-192.png", "assets/icon-512.png",
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"
];

self.addEventListener("install", function(e){
  e.waitUntil(
    caches.open(CACHE).then(function(c){
      /* allSettled + per-item catch: one asset failing to precache (e.g. a
         missing logo variant) must not abort the whole install. */
      return Promise.all(SHELL.map(function(u){ return c.add(u).catch(function(){}); }));
    }).then(function(){ return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function(e){
  e.waitUntil(
    caches.keys().then(function(keys){
      /* Drop only OLD app-shell caches. Never touch "ie_dur" — that's the
         driver/guide offline session store, which must survive SW updates. */
      return Promise.all(keys.filter(function(k){ return k !== CACHE && k !== "ie_dur"; }).map(function(k){ return caches.delete(k); }));
    }).then(function(){ return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function(e){
  var req = e.request;
  if (req.method !== "GET") return;                 /* never cache writes (Supabase inserts) */
  var url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.hostname.indexOf("supabase.co") > -1) return;  /* API → straight to network */

  if (req.mode === "navigate" || req.destination === "document") {
    /* Network-first for pages: fresh when online, cached copy when offline. */
    e.respondWith(
      fetch(req).then(function(res){
        var copy = res.clone();
        caches.open(CACHE).then(function(c){ c.put(req, copy); });
        return res;
      }).catch(function(){
        return caches.match(req).then(function(m){ return m || caches.match("driver-app.html"); });
      })
    );
    return;
  }

  /* config.js (the tenant registry) is network-first like navigations, so a
     branding/tenant/key change reaches online clients immediately; it still
     falls back to the cached copy offline so the field apps keep working. */
  if (url.pathname.split("/").pop() === "config.js") {
    e.respondWith(
      fetch(req).then(function(res){
        var copy = res.clone();
        caches.open(CACHE).then(function(c){ c.put(req, copy); });
        return res;
      }).catch(function(){ return caches.match(req); })
    );
    return;
  }

  /* Everything else (JS bundle, images): cache-first, fall back to network. */
  e.respondWith(
    caches.match(req).then(function(m){
      return m || fetch(req).then(function(res){
        var copy = res.clone();
        caches.open(CACHE).then(function(c){ c.put(req, copy); });
        return res;
      }).catch(function(){ return m; });
    })
  );
});
