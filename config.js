/* ============================================================================
   Island Explorer Ops Console — SINGLE-FILE CONFIGURATION
   ----------------------------------------------------------------------------
   To white-label this platform for a new client, edit ONLY this file.
   Every page reads it: the console (index.html), the driver app, the guide app,
   the public registration form, and the guide-response page.

   1) supabase — point at the CLIENT'S OWN Supabase project so their data is
      fully isolated from every other operator. (The publishable/anon key is
      browser-safe by design; never put a service_role key here.)
   2) brand    — the client's name, logo, contact details and the registered
      company details printed on every quotation letterhead.

   After editing, also replace the logo image at assets/logo.png (and the PWA
   icons in assets/). See ONBOARDING.md for the full checklist.
   ========================================================================== */
window.APP_CONFIG = {
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
};
