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
var CACHE = "ie-ops-v175"; /* v175: profit calculator — compact stat strip, "label : amount +" expense lines with add-on costs, uniform buttons on phones. */ /* v174: instruction texts removed; sub-tab rows keep the chosen tab in view; calculator "+" adds to a line; dark-mode chips and op buttons readable; phone dropdown sheet; Billing & instructions under Tour costing; calendar redesign. */ /* v173: phone layout — tab rows scroll instead of widening the page, lighter headings and folder rows, invoice preview header no longer wraps the number. */ /* v172: guide payments log (console tab + guide app Payments tab); guide app banners removed; motion on touch. */ /* v171: console-wide motion — buttons spring / press, tab rows ripple, cards pop in and lift. */ /* v170: sidebar menu 3D wave-pop motion. */ /* v169: only a Lead guide sets the operation status; an assistant status is recorded against their name. */ /* v168: renaming a guide in the directory renames them on every tour, operation, allotment and reservation. */ /* v167: guide directory "Test app" backend check; apps tag submissions with the workspace the backend served; SQL fix for the frozen guide/driver login. */ /* v166: guide shadow operations are built on boot, on every cloud pull and before every push (not only after an edit); guide app shows the console build. */ /* v165: additional guides get their own operation copy in the guide app; phone cards use label : value rows everywhere. */ /* v164: operation session dates carry a per-guide allotment (role + amount per date); tour dialog session dates with pickup; bookings as label : value cards with actions on top. */ /* v163: guide contacts from the directory; console op card without amounts; guide app sign-in redesigned with motion + instant offline restore. */ /* v162: tour dialog guide blocks (guide, role, working dates, session type, auto fee, phone / email); guide app shows each guide their own dated plan + amount. */ /* v161: operations carry a tour type (group / session / mixed), guides with roles + fees, and per-date session rows shown in the guide app. */ /* v160: operation cards (console + guide app) show code / name / dates with aligned "label : value" rows and the guide fee; tours carry guide role + fee. */ /* v159: quotation / invoice figures edited as text recalculate (pending = total - deposit) and are saved to the record; existing documents repaired at boot. */ /* v158: invoices start with the five standard categories (blank), plus deposit / pending rows auto-filled from the quotation. */ /* v157: quotation / invoice dialogs fit a phone screen (header reflows, policy tables wrap); boot sync pulls before flushing; 7-day keep window for unpushed records */
var SHELL = [
  "config.js",
  "driver-app.html", "ops-guide.html", "register.html", "respond.html", "departures.html", "feedback.html", "index.html",
  "manifest.json", "driver-manifest.json", "guide-manifest.json",
  "assets/logo.png", "assets/logo.jpg", "assets/icon.svg", "assets/icon-192.png", "assets/icon-512.png", "assets/apple-touch-icon.png",
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
