# Island Explorer Ops Console

> A single-page operations dashboard for [Island Explorer Birding Tours](https://islandexplorer.in) &mdash; Port Blair, Andaman & Nicobar Islands.
> Built and maintained by Dr. Sumit Rao.

![screenshot](assets/screenshot.png)

---

## Quick Start

Open `index.html` in any modern web browser. No build step, no server required.

```bash
# Clone the repo
git clone https://github.com/sumit3850/Tour-management-.git

# Open the app
open index.html
# or
start index.html
```

---

## Modules

| Module | Description |
|--------|-------------|
| **Dashboard** | KPIs, occupancy chart, upcoming ops, pending follow-ups |
| **Tours** | Tour catalog with status filtering (All / Upcoming / Ongoing / Completed) |
| **Calendar** | Visual departure calendar with colour-coded tour spans |
| **Bookings** | Guest bookings, payments, special requirements |
| **Cost Calculator** | Pre-tour costing with category-based rate sheets and group pricing |
| **Quotation Generator** | Professional PDF quotations with WhatsApp / Email share |
| **Logistics** | Vehicle fleet, driver management, operations board with date ranges |
| **Lead Pipeline (CRM)** | Kanban-style pipeline: New &rarr; Proposal &rarr; Follow-Up &rarr; Confirmed / Lost |
| **Customers** | Repeat-guest database, preferences, payment history |
| **Social Media** | Content calendar and media library |
| **AI Assistant** | Draft quotations, emails, WhatsApp replies, itineraries |
| **Drive App** | Google Drive integration for document storage and retrieval |

---

## Tech Stack

- **HTML5** + **CSS3** + **JavaScript (ES6+)**
- No external JS dependencies
- Google Fonts: Inter, JetBrains Mono, Calistoga
- SVG icons (inline, no icon library)
- Data persisted in `localStorage`

---

## File Structure

```
Tour-management-
|-- index.html                  # Landing / redirect page
|-- src/
|   |-- island-explorer-ops.html   # Main ops console (single file)
|-- drive-app.html              # Google Drive integration
|-- assets/
|   |-- screenshot.png          # Dashboard preview
|-- docs/
|   |-- SETUP.md                # Setup & configuration guide
|-- README.md                   # This file
|-- LICENSE                     # MIT License
|-- CONTRIBUTING.md             # Contribution guidelines
|-- .gitignore
```

---

## Data Model

All data is stored in-memory as JavaScript arrays, persisted to `localStorage` on every mutation.

| Collection | Key fields |
|------------|------------|
| `tours` | `id`, `name`, `cat`, `start`, `end`, `cap`, `status`, `guide`, `pickup`, `stay` |
| `bookings` | `id`, `tour`, `guest`, `party`, `country`, `status`, `pay`, `notes` |
| `leads` | `id`, `name`, `tour`, `source`, `stage`, `next` |
| `customers` | `name`, `country`, `tours`, `spend`, `last` |
| `vehicles` | `name`, `type`, `reg`, `cap`, `status`, `odo` |
| `drivers` | `name`, `phone`, `vehicle`, `key`, `trips` |
| `ops` | `id`, `tour`, `start`, `end`, `dateDisplay`, `clients`, `pax`, `veh`, `driver`, `guide`, `status` |
| `tripLogs` | `vehicle`, `odoStart`, `odoEnd`, `tour`, `driver` |
| `posts` | `date`, `content`, `status` |

---

## Data, Offline Saving & Sync

The app runs entirely in the browser — **there is no backend server, database, or Supabase connection.** Every edit (add / edit / delete across all modules) is saved automatically to the browser's `localStorage` under the key `ieo_data_v1`, so your data survives refreshes and works fully **offline** on that device.

Because storage is per-device, data does **not** sync between devices on its own. To move data between a phone and a laptop, use **Settings → Data & Backup**:

- **Export backup** — downloads a `.json` file with all your data and trip logs.
- **Import backup** — restores that file on another device.
- **Reset to sample data** — clears this device's saved data and restores the original demo content.

### Cloud sync (optional, Supabase)

For automatic multi-device sync, the app has a built-in **Supabase** integration (off by default — no server is required to use the app). To enable it:

1. Create a free project at [supabase.com](https://supabase.com).
2. In the Supabase **SQL editor**, run the setup SQL shown under **Settings → Cloud Sync** (creates a `workspaces` table + access policy).
3. Paste your **Project URL** and **anon public key** (Project Settings → API) into **Settings → Cloud Sync**, choose a workspace name, and tick **Auto-sync**.

With auto-sync on, every change is pushed to Supabase and pulled on load, so all devices using the same URL, key and workspace name stay in sync. You can also Push / Pull manually. The anon key is public, so use a hard-to-guess workspace name (or add Supabase Auth) to control access.

---

## Cost Calculator

The calculator supports 6 tour categories with pre-loaded rate sheets:

| Category | Nights | Base Cost (INR) |
|----------|--------|-----------------|
| 5-Night South Andaman | 5 | 77,000 |
| 7-Night South & Little Andaman | 7 | 1,06,000 |
| 8-Night South & Little Andaman | 8 | 1,25,000 |
| 12-Night Great Nicobar | 12 | 2,40,000 |
| Guided Session - Full Day | 1 | 14,500 |
| Guided Session - Night | 1 | 16,500 |

Select a category to auto-populate cost items. Adjust group size (1-12 pax) to see per-person pricing. Click **Generate Quotation** to create a branded PDF with WhatsApp / Email share.

---

## Drive App

The Google Drive integration (`drive-app.html`) allows you to:
- Upload and store tour documents, guest lists, and quotations
- Browse and search files by tour category
- Download stored documents directly
- Link files to specific tours and bookings

See [docs/SETUP.md](docs/SETUP.md) for Google Drive API configuration.

---

## Browser Support

| Browser | Status |
|---------|--------|
| Chrome 90+ | Fully supported |
| Firefox 88+ | Fully supported |
| Safari 14+ | Fully supported |
| Edge 90+ | Fully supported |

---

## License

[MIT](LICENSE) &copy; 2026 Island Explorer Birding Tours.
