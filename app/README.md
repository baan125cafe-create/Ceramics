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
- **Live sheet:** the shop's real Google Sheet, **read-only**. Paste the shop's Apps Script link once (the same one the current owner page uses). It's saved in that browser only and is never committed. Then choose **View as owner** or **View as staff**.

## Live sheet safety

`core.js` only ever sends `get…` actions (`getAll`, or `getProducts` / `getSales` on older scripts). Every save path is disabled in live mode and refused again in code, so this build can't add, change or delete anything in the sheet. Saving switches on with the new PIN-protected script (v6), which isn't part of this change.

When deployed to GitHub Pages, any browser that already used the old pages has the link saved under the same key (`baan125_api_url` / `chudpak_api_url`), so it connects without setup.

## Files

| File | What it does |
| --- | --- |
| `config.js` | Everything that differs per shop (name, icon, saved-link key, default staff, "running low" level) and the payment types |
| `core.js` | Shared helpers, payment-label mapping, and the two data sources (sample / live read-only) |
| `app.js` | The screens: sign-in, dashboard, stock, sell, add product, sales, settings |
| `demo-data.js` | Sample data generator |
| `index.html` | Layout and styles (light and dark) |

Adding a shop means adding one entry to `config.js`.

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
