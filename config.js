/* ============================================================================
   Island Explorer Ops Console — MULTI-TENANT (SaaS) CONFIGURATION
   ----------------------------------------------------------------------------
   ONE deployment serves many operators. The correct client's settings are
   chosen at load time from the domain the app is opened on (or ?t=<tenant> for
   testing/previews). The app code is shared, so a single update ships to every
   client — while each client keeps their OWN Supabase project (data isolation)
   and OWN branding.

   To add a client:
     1. Copy the EXAMPLE block below into TENANTS with a new key.
     2. Fill in `match` (the domain[s] they'll open the app on), their own
        Supabase project url/key, a unique `workspace`, and their brand.
     3. Provision their backend:  ./supabase/setup/provision.sh <workspace>
     4. Point their domain at this deployment (see ONBOARDING.md → hosting).

   NEVER put a Supabase service_role key here — only the publishable/anon key,
   which is browser-safe.
   ========================================================================== */
(function () {
  var TENANTS = {

    "island-explorer": {
      // Hostnames that resolve to this tenant (exact host or any subdomain of it).
      match: ["islandexplorer.in", "sumit3850.github.io", "localhost", "127.0.0.1"],
      supabase: {
        url:       "https://tbxzxfjumlnciczizols.supabase.co",
        key:       "sb_publishable_IyJJjmOHgA-dbCMH19oY3Q_GzLoZ2ss",
        workspace: "island-explorer"
      },
      brand: {
        company:     "Island Explorer Birding Tours",
        short:       "Island Explorer",
        tagline:     "Ops Console",
        logo:        "assets/logo.png",
        contactPerson: "Sumit Kumar",
        phone:       "+91 99332 02175",
        phoneDigits: "919933202175",
        email:       "info@islandexplorer.in",
        web:         "www.islandexplorer.in",
        cin:         "U79120AN2026PTC006196",
        address:     "Sri Ram Nagar, Attam Pahad, Garacharma, Opp. Shiv Mandir, Sri Vijaya Puram, South Andaman, Andaman and Nicobar Islands - 744105, India"
      }
    }

    /* ----- EXAMPLE: copy this block for a new client -------------------------
    ,"acme-tours": {
      match: ["acmetours.in"],                       // their domain(s)
      supabase: {
        url:       "https://THEIR-PROJECT.supabase.co",
        key:       "sb_publishable_THEIR_ANON_KEY",
        workspace: "acme-tours"                       // must match provision.sh
      },
      brand: {
        company: "Acme Island Tours Pvt Ltd", short: "Acme Tours", tagline: "Ops Console",
        logo: "assets/logo.png", contactPerson: "Owner Name",
        phone: "+91 ...", phoneDigits: "91...", email: "info@acmetours.in",
        web: "www.acmetours.in", cin: "THEIR-CIN", address: "Their registered office, one line"
      }
    }
    ------------------------------------------------------------------------- */

  };

  // Tenant used when the domain matches nothing (keeps the app from ever breaking).
  var DEFAULT_TENANT = "island-explorer";

  function resolveTenant() {
    try {
      // 1) Explicit override: ?t=<tenant> — for testing a client on any URL.
      var q = new URLSearchParams(location.search).get("t");
      if (q && TENANTS[q]) return q;

      // 2) Match by hostname: exact host, or any subdomain of a listed domain.
      var host = (location.hostname || "").toLowerCase();
      for (var key in TENANTS) {
        if (key === host) return key;
        var pats = TENANTS[key].match || [];
        for (var i = 0; i < pats.length; i++) {
          var p = String(pats[i]).toLowerCase();
          if (host === p || host.slice(-(p.length + 1)) === ("." + p)) return key;
        }
      }
    } catch (e) {}
    return DEFAULT_TENANT;
  }

  var tenantKey = resolveTenant();
  var t = TENANTS[tenantKey] || TENANTS[DEFAULT_TENANT];

  // Everything downstream (console + driver/guide/register/respond) reads
  // window.APP_CONFIG — populated synchronously here before any of it runs.
  window.APP_TENANTS = TENANTS;
  window.APP_TENANT  = tenantKey;
  window.APP_CONFIG  = { supabase: t.supabase, brand: t.brand };
  try { console.info("[config] tenant:", tenantKey, "·", t.brand && t.brand.company); } catch (e) {}
})();
