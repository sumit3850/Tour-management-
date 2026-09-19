/* Money-math regression tests for the Ops Console.
   The app is a single file, so the functions under test are lifted out of
   index.html by name and evaluated in a small sandbox with stub globals.
   Run: node --test tests/            (Node 18+)                                */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const script = (html.match(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/i) || [])[1];
assert.ok(script, "inline script found");

/* Extract `function NAME(...){...}` (or `const NAME=...;` one-liners) from the source. */
function fnSource(name) {
  let i = script.indexOf("function " + name + "(");
  if (i < 0) {
    const m = script.match(new RegExp("(?:const|var|let) " + name + "=[^\\n]*\\n"));
    assert.ok(m, "definition of " + name);
    return m[0];
  }
  let depth = 0, j = script.indexOf("{", i);
  for (let k = j; k < script.length; k++) {
    const c = script[k];
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) return script.slice(i, k + 1); }
    else if (c === '"' || c === "'" || c === "`") { const q = c; k++; while (k < script.length && script[k] !== q) { if (script[k] === "\\") k++; k++; } }
    else if (c === "/" && script[k + 1] === "*") { k = script.indexOf("*/", k) + 1; }
    else if (c === "/" && script[k + 1] === "/") { k = script.indexOf("\n", k); }
  }
  throw new Error("unbalanced " + name);
}
const sheetLine = script.match(/const SHEET_DATA_DEFAULT=(\{[\s\S]*?\});\n/);
assert.ok(sheetLine, "SHEET_DATA_DEFAULT literal");

function sandbox(extra) {
  const ctx = Object.assign({
    tours: [], bookings: [], customers: [], TOUR_COSTS: {}, gqOverrides: {},
    todayISO: "2026-09-18", console,
    status: (t) => t.status === "completed" ? "completed" : "open",
    Math, Date, JSON, parseInt, parseFloat, isFinite, String, Number, Object, Array,
  }, extra || {});
  vm.createContext(ctx);
  vm.runInContext("var SHEET_DATA=" + sheetLine[1] + ";", ctx);
  ["quotedTotal", "isIndianCountry", "bookingTotalCost", "bookingDeposit", "bookingPending", "bookingDueDate",
   "applyGqOverrides", "daysBetween", "billableBookings", "receivables",
   "durNights", "tourRevenue", "tourPaxBooked", "tourRateKey", "tourRateKeyAuto", "estimateTourCost", "breakEvenPax", "pad2", "dShort"
  ].forEach((n) => vm.runInContext(fnSource(n), ctx));
  return ctx;
}

test("quoted total is price-per-person × pax for every rate-sheet row, never below cost", () => {
  const c = sandbox();
  let rows = 0;
  for (const key of Object.keys(c.SHEET_DATA)) for (const type of ["indian", "foreign"]) {
    const t = c.SHEET_DATA[key][type]; if (!t) continue;
    for (const n of Object.keys(t)) {
      const d = t[n]; if (!d || !d.perPerson) continue;
      const q = c.quotedTotal(d, n);
      assert.equal(q, d.perPerson * Number(n), `${key}/${type}/${n} pax`);
      assert.ok(q >= d.total, `${key}/${type}/${n}: quoted ${q} < cost ${d.total}`);
      rows++;
    }
  }
  assert.ok(rows > 100, "rate rows checked: " + rows);
});

test("the ₹300 case: South Andaman 5N, 4 Indian pax → 33,800 × 4 = 1,35,200", () => {
  const c = sandbox();
  const d = c.SHEET_DATA.T1.indian["4"];
  assert.equal(d.perPerson, 33800);
  assert.equal(c.quotedTotal(d, 4), 135200);
  assert.equal(Math.round(135200 * 25 / 100), 33800);
  assert.equal(135200 - 33800, 101400);
});

test("group-quote overrides keep per-person ↔ total linked and deposit = % of total", () => {
  const c = sandbox();
  const base = [{ size: 4, d: {}, perPerson: 33800, total: 135200, deposit: 33800 }];
  c.gqOverrides = { 4: { perPerson: 35000 } };
  let r = c.applyGqOverrides(base, 25)[0];
  assert.equal(r.total, 140000); assert.equal(r.deposit, 35000);
  c.gqOverrides = { 4: { total: 150000 } };
  r = c.applyGqOverrides(base, 30)[0];
  assert.equal(r.perPerson, 37500); assert.equal(r.deposit, 45000);
  c.gqOverrides = { 4: { deposit: 10000 } };
  r = c.applyGqOverrides(base, 30)[0];
  assert.equal(r.deposit, 10000); assert.equal(r.total - r.deposit, 125200);
});

test("booking inherits the tour's total / deposit / due date; pending never negative", () => {
  const c = sandbox();
  c.tours.push({ id: "T1", name: "x", tourCost: 100000, tourDeposit: 25000, due: "2026-10-01", cap: 4 });
  c.bookings.push({ id: "B1", tour: "T1", guest: "A", party: 2, country: "India" });
  const b = c.bookings[0];
  assert.equal(c.bookingTotalCost(b), 100000);
  assert.equal(c.bookingDeposit(b), 25000);
  assert.equal(c.bookingPending(b), 75000);
  assert.equal(c.bookingDueDate(b), "2026-10-01");
  b.deposit = 120000;                      // overpaid → clamps at zero
  assert.equal(c.bookingPending(b), 0);
  b.lastPendingDate = "2026-09-20";        // booking's own due date wins
  assert.equal(c.bookingDueDate(b), "2026-09-20");
});

test("receivables bucket by due date: overdue / week / later / nodate, sorted", () => {
  const c = sandbox();
  c.tours.push({ id: "T1", name: "T", tourCost: 10000, tourDeposit: 0, start: "2026-10-10", end: "2026-10-12", pocId: "B1" });
  c.bookings.push(
    { id: "B1", tour: "T1", guest: "Overdue", party: 1, lastPendingDate: "2026-09-10" },
    { id: "B2", tour: "", customTour: "c", guest: "ThisWeek", party: 1, totalOverride: 5000, deposit: 1000, lastPendingDate: "2026-09-21" },
    { id: "B3", tour: "", customTour: "c", guest: "Later", party: 1, totalOverride: 5000, lastPendingDate: "2026-11-01" },
    { id: "B4", tour: "", customTour: "c", guest: "NoDate", party: 1, totalOverride: 5000 },
    { id: "B5", tour: "", customTour: "c", guest: "Settled", party: 1, totalOverride: 5000, deposit: 5000, lastPendingDate: "2026-09-01" }
  );
  const rs = c.receivables();
  assert.deepEqual(Array.from(rs).map((r) => r.b.guest), ["Overdue", "ThisWeek", "Later", "NoDate"]);   // Array.from: vm-realm arrays are not instanceof the host Array
  assert.deepEqual(Array.from(rs).map((r) => r.bucket), ["overdue", "week", "later", "nodate"]);
  assert.equal(rs[0].days, -8);
  assert.equal(rs[1].pend, 4000);
});

test("daysBetween is calendar-exact and signed", () => {
  const c = sandbox();
  assert.equal(c.daysBetween("2026-09-18", "2026-09-21"), 3);
  assert.equal(c.daysBetween("2026-09-18", "2026-09-10"), -8);
  assert.equal(c.daysBetween("2026-02-27", "2026-03-02"), 3);
});

test("break-even pax: actual per-person price must cover the cost-sheet cost at that size", () => {
  const c = sandbox();
  c.tours.push({ id: "T1", name: "South Andaman Endemic Birding Tour", cat: "southandaman", start: "2026-10-10", end: "2026-10-15", tourCost: 135200, cap: 6 });
  c.bookings.push({ id: "B1", tour: "T1", guest: "A", party: 4, country: "India", status: "Confirmed" });
  const t = c.tours[0];
  const be = c.breakEvenPax(t);
  assert.ok(be >= 1 && be <= 10, "break-even in range: " + be);
  const rows = c.SHEET_DATA.T1.indian;
  const pp = 135200 / 4;
  for (let n = 1; n < be; n++) assert.ok(pp * n < rows[String(n)].total, `n=${n} should not yet break even`);
  assert.ok(pp * be >= rows[String(be)].total, "breaks even at " + be);
});
