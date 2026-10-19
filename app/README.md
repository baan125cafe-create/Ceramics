# Shop app (Baan 125 · ChudPak)

One app for both shops. The old pages (`owner.html`, `staff.html`, `ChudPak_*.html`) are untouched and keep working.

## Run it locally

```sh
cd ~/Ideas/Ceramics
python3 -m http.server 8000
# open http://localhost:8000/app/
```

On the sign-in screen, pick a shop, then a data source:

- **Sample data:** made-up products and sales. Owner PIN `222222`, staff PIN `111111`. Changes stay in the browser tab and reset on refresh.
- **Live sheet:** the shop's real Google Sheet. Paste the shop's Apps Script link once. It's saved in that browser only and never committed.
  - On the **current script (v5)** this is a **read-only preview**: choose View as owner / View as staff. Nothing can be saved.
  - On the **new script (v6)** you sign in with the shop's PIN, and saving works.

### Try the new script without touching Google

`apps-script/local-sheet.js` runs `apps-script/Code.gs` on your computer against a pretend sheet:

```sh
node apps-script/local-sheet.js          # pretend sheet on http://localhost:8787
python3 -m http.server 8000              # in another terminal
# open http://localhost:8000/app/?local=8787 and choose Live sheet
# pretend-sheet PINs: owner 246810, staff 135791
```

## Install the new script (v6) on a shop's sheet

1. Open the shop's Google Sheet → Extensions → Apps Script. Replace the code with `apps-script/Code.gs` and save.
2. Deploy → **New deployment** → Web app (Execute as: Me, Who has access: Anyone). This creates a **new** link. The old links keep running the old version, so the old pages keep working.
3. Reload the sheet. Use the new **Shop app** menu to set the owner PIN and the staff PIN (6 digits each). PINs are stored only as scrambled values in the script's settings, never in this repo.
4. In the app: Live sheet → Use a different link → paste the new link → sign in with a PIN.
5. When everyone has moved over: Deploy → Manage deployments → archive the old deployments, so the old public links stop working.

## Live sheet safety

- On v5, `core.js` only sends `get…` requests (`getVersion`, `getAll`, or `getProducts` / `getSales`). Save actions are disabled and refused again in code.
- On v6, every request needs a sign-in pass from a PIN. Staff get stock and sales dates (no costs or totals) and can sell and add products. Restock, edit, remove, settings, clearing test data and "sign all out" are owner-only, and the script checks this on every request.
- 5 wrong PINs in a row pause sign-in for everyone (15 min, then 1 h, then 24 h) and email the owner. Phones already signed in keep working.
- Sales: the script works out price and total and saves the cost price on each new row. "+ Stock" adds to the count. "Remove" hides a product (its row stays, so old sales keep their cost).

## Test data

Start a product name with **[TEST]** to try things out. Test products and their sales are left out of every total, chart and email report. A test sale is refused on a real product, so real stock never changes in a test. **Settings → Test data → Clear** lists exactly what will be removed and asks first. Only [TEST] rows can be removed.

## Files

| File | What it does |
| --- | --- |
| `config.js` | Everything that differs per shop (name, icon, saved-link key, default staff, "running low" level, or `lowStock: false` to show only sold out, as ChudPak does) and the payment types |
| `core.js` | Shared helpers, payment-label mapping, and the data sources (sample / live sheet) |
| `app.js` | The screens: sign-in, dashboard, stock, sell, add product, sales, settings |
| `demo-data.js` | Sample data generator |
| `index.html` | Layout and styles (light and dark) |
| `../apps-script/Code.gs` | The new PIN-protected script (v6), same file for both shops |
| `../apps-script/local-sheet.js` | Pretend sheet for local testing |

Adding a shop means adding one entry to `config.js` and installing the same `Code.gs` on its sheet.

## Payment labels

New sales use **Cash**, **Card** or **QR code**. Older rows are mapped on display only (the sheet isn't changed):

| Saved as | Shown as |
| --- | --- |
| `cash`, `Cash` | Cash |
| `card`, `visa`, `debit`… | Card |
| `qr`, `promptpay`, `transfer`… | QR code |
| `credit` (the old single "Card / QR" button) | Card or QR (older) |
| blank | Not recorded |
| anything else | Other (shows the original text) |

**Settings → Data check** lists exactly which labels exist in the sheet, with counts and totals.
