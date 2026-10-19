# Shop app (Baan 125 · ChudPak)

One app for both shops, served by GitHub Pages. The data lives in the shop API on Cloudflare (`../worker`).

- **Site root:** opens the app. The old `owner.html`, `staff.html` and `ChudPak_*.html` pages now redirect here too.
- **Switching shops:** tap the shop name at the top of the menu. Each shop has its own PINs, so it asks for the other shop's PIN unless this device already has a pass for it.

## Run it locally

See `../worker/README.md` for loading a local copy of the data first. Then:

```sh
cd ~/Ideas/Ceramics/worker && npm run dev     # local API on :8787
cd ~/Ideas/Ceramics && python3 -m http.server 8000
# open http://localhost:8000
```

On the sign-in screen, pick a shop, then a data source:

- **Sample data:** made-up products and sales. Owner PIN `222222`, staff PIN `111111`. Changes stay in the browser tab and reset on refresh.
- **Live data:** the shop API. On `localhost` this is always the local API on your computer (port 8787, or `?local=PORT`), never the real shop data. On GitHub Pages it uses the address in `config.js` (`api`).

## Who sees what

- **Signing in:** a PIN gives this device (phone or computer) a sign-in pass (staff 30 days, owner 7 days).
  - The server checks the pass and the role on **every** request.
  - The app takes the role from the server's answer, never from what the browser remembers. Editing the browser's storage can't open the owner screens or reveal costs.
- **Staff:** see inventory and when things last sold (no costs or money totals). They can record sales and add products, but can't set a cost price, and only the owner can edit a product after it's saved.
- **Owner only:** dashboard, sales, settings, restocking, editing, removing, clearing test data and "sign all out".
- **Wrong PINs:** 5 in a row pause that shop's sign-in for 15 minutes, then 1 hour, then 24 hours, and email the owner. Devices already signed in keep working.
- **Sales:** the server works out the price and total, saves the cost price on each new sale, and refuses to sell more than is on the shelf (even from two devices at once).
- **Adding inventory:** "+ Add" adds to the count. **Remove** hides a product; its row stays, so old sales keep their cost.

## Payment types

The owner edits them in **Settings → Payment types**: rename, switch off, or add (e.g. "Alipay").

Each sale keeps the type it was saved with as plain text, so editing the list never changes past sales. A type that's switched off stays in the list, so older sales still show its name.

Older labels in the data are shown like this, with no data changed:

| Saved as | Shown as |
| --- | --- |
| `cash` | Cash |
| `card`, `visa`, `debit`… | Card |
| `qr`, `scan`, `alipay`, `promptpay`, `transfer`… | QR code, unless a type with that exact id exists (adding "Alipay" makes `alipay` sales show as Alipay) |
| `credit` (the old single "Card / QR" button) | Card or QR (older) |
| blank | Not recorded |
| anything else | the saved text |

**Settings → Data check** lists exactly which labels exist, with counts and totals.

## Test data

Start a product name with **[TEST]** to try things out.

- Test products and their sales are left out of every total, chart and email report.
- A test sale is refused on a real product, so real inventory never changes in a test.
- **Settings → Test data → Clear** lists exactly what will be removed and asks first. Only [TEST] rows can be removed.

## Files

| File | What it does |
| --- | --- |
| `config.js` | API address, everything that differs per shop (name, icon, default staff, running-low level or `lowStock: false`), starting payment types |
| `core.js` | Shared helpers, payment-label mapping, and the data sources (sample / live API) |
| `app.js` | The screens: sign-in, dashboard, inventory, sell, add product, sales, settings |
| `demo-data.js` | Sample data generator |
| `index.html` | Layout and styles (light and dark) |
| `../worker/` | The shop API on Cloudflare: database, photos, PINs, email reports |
| `../apps-script/` | The Google Apps Script version (v6). It was never installed and is replaced by `../worker`; kept for reference until the switch-over is done. |

Adding a shop means one entry in `config.js` and one in `SHOPS` in `worker/src/index.js`.
