#!/usr/bin/env python3
"""Build build/ops-console-starter-kit.zip: the console's front end, database
SQL and backend functions in repository layout, with a placeholder config.js
and the STARTER_KIT.md guide as README. Brand-specific files (seed data,
marketing media, CNAME, the live config) are left out.

    python3 tools/make-starter-kit.py [output.zip]
"""
import os, re, sys, zipfile, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "build", "ops-console-starter-kit.zip")

FILES = [
    # front end
    "index.html", "sw.js", "manifest.json", "guide-manifest.json", "driver-manifest.json",
    "ops-guide.html", "driver-app.html", "drive-app.html",
    "register.html", "feedback.html", "respond.html", "signup.html", "admin.html",
    "departures.html", "calendar.html",
    "_headers", "_redirects", "wrangler.toml", "package.json",
    ".github/workflows/deploy.yml", ".github/workflows/test.yml",
    # backend
    "cloudflare/lead-email-worker.js",
]
DIRS = ["assets", "tests", "docs", "supabase/setup", "supabase/saas", "supabase/functions", "n8n"]
EXCLUDE = {"supabase/saas/seed-island-explorer.sql", "assets/screenshot.png"}
EXCLUDE_DIRS = {"supabase/setup/build"}

CONFIG_TEMPLATE = '''/* ============================================================================
   Ops Console — configuration. Edit before the first deploy.
   Publishable (anon) key only — never a service_role key.
   ========================================================================== */
window.APP_CONFIG = {
  supabase: {
    url:       "https://YOUR-PROJECT.supabase.co",
    key:       "sb_publishable_YOUR_KEY",
    workspace: "default"
  },
  brand: {
    company:     "Your Company Name",
    short:       "Your Company",
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
'''


def want(rel):
    if rel in EXCLUDE:
        return False
    return not any(rel == d or rel.startswith(d + "/") for d in EXCLUDE_DIRS)


def collect():
    out = []
    for f in FILES:
        if os.path.exists(os.path.join(ROOT, f)):
            out.append(f)
    for d in DIRS:
        for dp, dn, fn in os.walk(os.path.join(ROOT, d)):
            dn[:] = [x for x in dn if not x.startswith(".") or x == ".gitignore"]
            for name in fn:
                rel = os.path.relpath(os.path.join(dp, name), ROOT).replace(os.sep, "/")
                if want(rel):
                    out.append(rel)
    return sorted(set(out))


def main():
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    files = collect()
    stamp = time.gmtime(0)[:6]  # fixed timestamps: the same tree gives the same zip
    with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as z:
        for rel in files:
            with open(os.path.join(ROOT, rel), "rb") as fh:
                data = fh.read()
            zi = zipfile.ZipInfo(rel, date_time=(1980, 1, 1, 0, 0, 0))
            zi.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(zi, data)
        z.writestr(zipfile.ZipInfo("config.js", (1980, 1, 1, 0, 0, 0)), CONFIG_TEMPLATE)
        with open(os.path.join(ROOT, "STARTER_KIT.md"), "r", encoding="utf-8") as fh:
            z.writestr(zipfile.ZipInfo("README.md", (1980, 1, 1, 0, 0, 0)), fh.read())
    size = os.path.getsize(OUT)
    print("wrote %s (%d files, %.1f MB)" % (OUT, len(files) + 2, size / 1048576))


if __name__ == "__main__":
    main()
