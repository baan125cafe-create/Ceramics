# Shop API (Cloudflare)

The shop data for Baan 125 and ChudPak: products, sales, settings and photos. It replaces the Google Sheets and Apps Script.

- **Worker** (`src/index.js`): the API. Checks the PIN pass and the role on every request, works out sale totals, and sends the email reports.
- **D1** (`schema.sql`): the database (SQLite). Columns match the old sheet headers.
- **R2**: product photos.

The app itself stays on GitHub Pages. It talks to this API at the address in `app/config.js` (`api`).

| | Address |
| --- | --- |
| App | `https://baan125cafe-create.github.io/Ceramics/` (the root opens `app/`; the old `owner.html` and `staff.html` pages redirect there) |
| API | `https://shop-api.<account>.workers.dev` (once deployed) |

## Run it on your computer

Uses a local copy of the database in `worker/.wrangler/`. Nothing here touches Cloudflare or the real data.

```sh
cd ~/Ideas/Ceramics/worker
npm install
npm run db:init:local                      # create the tables
npm run import -- --shop baan --products ~/Downloads/baan-Products.csv --sales ~/Downloads/baan-Sales.csv --local
npm run import -- --shop chud --products ~/Downloads/chud-Products.csv --sales ~/Downloads/chud-Sales.csv --local
npm run set-pin -- --shop baan --role owner --local    # repeat for staff, and for chud
npm run dev                                # API on http://localhost:8787

# in another terminal
cd ~/Ideas/Ceramics && python3 -m http.server 8000
# open http://localhost:8000 → Live data
```

On `localhost` the app always uses the local API on port 8787 (or `?local=PORT`), never the real data.

Use test PINs locally. Don't reuse the real shop PINs here: the local `.dev.vars` file is only for this computer.

`npm test` runs 44 checks against a throwaway database with made-up rows.

## Set up Cloudflare (once)

1. **Create the account.** Go to [dash.cloudflare.com/sign-up](https://dash.cloudflare.com/sign-up). Use an email the shop will keep (Milk's, or a shop address) so the business owns it. The Free plan is enough. **Don't add a payment card**: on the Free plan, Cloudflare can't charge anything. If a daily limit were ever reached, requests would pause until midnight UTC and Cloudflare would send an email. No data is lost.
2. **Add Paul as a member.** In the dashboard, open **Manage account → Members → Invite**. Enter Paul's email and give it the **Super Administrator** role for the whole account. Paul accepts the email invite. Both of you can then see usage and manage everything.
3. **Sign in from the Mac.** In `~/Ideas/Ceramics/worker`, run `npx wrangler login`. A browser window opens to approve access. If you belong to more than one Cloudflare account, `npx wrangler whoami` shows which one is in use.
4. **Create the database and photo bucket:**
   ```sh
   npx wrangler d1 create shop-db        # paste the printed database_id into wrangler.jsonc
   npx wrangler r2 bucket create shop-photos
   npm run db:init:remote
   ```
   R2 asks you to turn it on in the dashboard the first time (**R2 → Get started**). Its free tier is 10 GB.
5. **Deploy and set the PINs:**
   ```sh
   npm run deploy                        # prints the API address
   npm run set-pin -- --shop baan --role owner     # and staff; then chud owner and staff
   ```
   Put the printed address in `app/config.js` as `api`.

## Moving the real data over (the switch-over day)

Do this when no one is selling. Nothing is written to both places; after the switch, Cloudflare is the only place data is saved.

1. In each Google Sheet, download **File → Download → CSV** for both the Products tab and the Sales tab. Save the files outside the repo.
2. Import them:
   ```sh
   npm run import -- --shop baan --products … --sales … --remote
   npm run import -- --shop chud --products … --sales … --remote
   ```
   Each import refuses to run if that shop already has data, unless you add `--replace`. It prints the sheet's counts and totals next to the database's, and they must match.
3. Copy the photos from Google Drive into R2. Run this in your own Terminal: it downloads from Google.
   ```sh
   npm run copy-photos -- --shop baan --remote
   npm run copy-photos -- --shop chud --remote
   ```
   It's safe to run again. Any photo it can't download (for example, one that's no longer shared) is listed, and that product keeps its Google link. Downloaded copies stay in `worker/.data/photos/` as a backup.
4. Merge the app changes so GitHub Pages serves the new version.
5. In each sheet's Apps Script, go to **Deploy → Manage deployments** and archive every deployment. The old links stop working, and the sheets stay as a frozen backup.

## Email reports (optional)

Reports go out daily at 23:30 and monthly on the 1st at 10:30 (Bangkok time). They leave out [TEST] sales. They're also used for the "sign-in paused" warning.

1. Make a free account at [resend.com](https://resend.com) and create an API key.
2. Run `npx wrangler secret put RESEND_API_KEY` and `npx wrangler secret put REPORT_TO`, where REPORT_TO is the address(es) to send to, separated by commas.
3. Without a verified domain, Resend only delivers to the email address on the Resend account itself. Use Milk's email for the Resend account, or verify a domain and set `REPORT_FROM`.

## Watching usage and cost

- **Dashboard:** **Workers & Pages → shop-api** shows requests and errors. **Storage & Databases → D1 → shop-db → Metrics** shows rows read and written. **R2 → shop-photos** shows storage.
- **Free limits per day:**

  | Resource | Free limit |
  | --- | --- |
  | Requests | 100,000 |
  | D1 rows read | 5 million |
  | D1 rows written | 100,000 |
  | D1 storage | 5 GB |
  | R2 storage | 10 GB |

  This shop uses a tiny fraction of each. Loading the app reads about 1,000 rows, so the read limit allows roughly 5,000 loads a day.
- **Alerts:** Cloudflare emails the account when a D1 limit is reached. More alerts can be added under **Notifications**.

## PINs

- `npm run set-pin -- --shop baan|chud --role owner|staff` asks for the PIN twice, hidden. It stores only a salted, scrambled value as a Cloudflare secret. PINs never go in the code, the repo, or the database.
- After changing a PIN, use **Settings → Sign all out** in the app.
- If sign-in is paused after wrong PINs, it reopens by itself after 15 minutes, then 1 hour, then 24 hours. To clear the pause sooner:
  ```sh
  npx wrangler d1 execute shop-db --remote --command "DELETE FROM login_state"
  ```

## Files

| File | What it does |
| --- | --- |
| `src/index.js` | The API, photo serving and scheduled email reports |
| `schema.sql` | Tables (safe to run again; never drops anything) |
| `wrangler.jsonc` | Cloudflare settings: database, bucket, allowed site, report times |
| `scripts/import-csv.mjs` | Copies a shop's sheet CSVs into the database and checks the totals |
| `scripts/copy-photos.mjs` | Copies Drive photos into R2 and points products at them |
| `scripts/set-pin.mjs` | Sets a PIN (hidden input, salted hash) |
| `test/api.test.mjs` | API checks on a throwaway local database |

Ignored by git: `node_modules/`, `.wrangler/` (local database), `.dev.vars` (local PINs), and `.data/` (CSV exports and downloaded photos, which hold real data).
