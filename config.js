/* ============================================================================
   Ops Console — SaaS configuration (one shared Supabase project).
   ----------------------------------------------------------------------------
   Every company signs up at signup.html and, once approved, signs in here. After
   sign-in the console loads THAT company's own workspace (isolated data) and
   branding (logo, name, letterhead) from their org record — so the values below
   are only a neutral default shown before login and on the ?demo=1 sandbox.

   Publishable/anon key only — never a service_role key (browser-safe by design).
   ========================================================================== */
window.APP_CONFIG = {
  supabase: {
    url:       "https://ikuzliljkcjdglfzdaqd.supabase.co",
    key:       "sb_publishable_P9dMhqOzgTqbQSwerx7LwQ_0M6-8_3w",
    workspace: "default"
  },
  brand: {
    company:     "Ops Console",
    short:       "Ops Console",
    tagline:     "Ops Console",
    logo:        "assets/logo.png",
    contactPerson: "",
    phone:       "",
    phoneDigits: "",
    email:       "",
    web:         "",
    cin:         "",
    address:     ""
  }
};
