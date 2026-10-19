# Shop API (Cloudflare)

The shop data for Baan 125 and ChudPak: products, sales, settings and photos. It replaces the Google Sheets and Apps Script.

- **Worker** (`src/index.js`): the API. Checks the PIN pass and the role on every request, works out sale totals, and sends the email reports.
- **D1** (`schema.sql`): the database (SQLite). Columns match the old sheet headers.
- **R2**: product photos.

The app is a static site on GitHub Pages. It talks to this API at the address in `app/config.js` (`api`).

| | Address now | With the shop domain |
| --- | --- | --- |
| App | `https://baan125cafe-create.github.io/Ceramics/` | `https://milkyanyong.shop` |
| API | `https://shop-api.milkshops.workers.dev` | `https://api.milkyanyong.shop` |

The site root opens `app/`. The old `owner.html`, `staff.html` and `ChudPak_*.html` pages redirect there too.

## Run it on your computer

This uses a local copy of the database in `worker/.wrangler/`. Nothing here touches Cloudflare or the real data.

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

- **Which data:** on `localhost` the app uses the local API on port 8787 (or `?local=PORT`). It reaches the real API only when the address ends in `?live=1`.
- **PINs:** use test PINs locally, not the real shop PINs. The local `.dev.vars` file is only for this computer.
- **Tests:** `npm test` runs 44 checks against a throwaway database with made-up rows.

## Set up Cloudflare (once)

### Step 1 · Create the account

Go to [dash.cloudflare.com/sign-up](https://dash.cloudflare.com/sign-up) and choose the Free plan.

**Card:** R2 (photos) asks for a card even on the free tier. You're billed only for use above the free amounts, and this setup can't realistically reach them:

- The photo bucket isn't public, so every photo goes through the API.
- The API's free plan stops at 100,000 requests a day. That keeps photo reads well under R2's 10 million free reads a month.
- Uploads need a PIN sign-in and are at most 4 MB each.

**Spending alert:** add one under **Manage Account → Billing → Billable Usage → Create budget alert**, for example at $1. It only sends an email; Cloudflare has no hard spending cap.

**Daily limits:** if a Workers or D1 limit is reached, requests pause until midnight UTC and Cloudflare sends an email. No data is lost.

### Step 2 · Add Milk as a member

Open **Manage account → Members → Invite**. Enter Milk's email and give her the **Super Administrator** role for the whole account. Once she accepts, the business can always reach its own data.

### Step 3 · Sign in from the Mac

In `~/Ideas/Ceramics/worker`, run `npx wrangler login` and approve in the browser window that opens. `npx wrangler whoami` shows which account is in use.

### Step 4 · Create the database and photo bucket

```sh
npx wrangler d1 create shop-db
npx wrangler r2 bucket create shop-photos
npm run db:init:remote
```

Put the printed `database_id` in `wrangler.jsonc`.

**Keep the binding names `DB` and `PHOTOS`.** If Wrangler offers to add the database or bucket to the config for you, it picks other names (like `shop_db`). The API then fails on every request.

R2 asks you to turn it on in the dashboard the first time (**R2 → Get started**).

### Step 5 · Deploy and set the PINs

```sh
npm run deploy                                  # prints the API address
npm run set-pin -- --shop baan --role owner     # then baan staff, chud owner, chud staff
```

Put the printed address in `app/config.js`:

```js
api: 'https://shop-api.milkshops.workers.dev',
```

Commit it on the branch. The live site doesn't change until the branch is merged into `main` (see the switch-over steps).

### Step 6 · Check the real API from your computer

Run the app locally and open `http://localhost:8000/?live=1`. Choose **Live data** and sign in with the real PIN. The shops are empty until the switch-over import.

## Switch-over day

Do this when no one is selling, for example late evening in Phuket. Nothing is written to both places: after the switch, Cloudflare is the only place data is saved.

### Step 1 · Export the sheets

In each Google Sheet, use **File → Download → Comma-separated values (.csv)**, once on the Products tab and once on the Sales tab. Save the files outside the repo.

### Step 2 · Import

```sh
npm run import -- --shop baan --products ~/Downloads/baan-Products.csv --sales ~/Downloads/baan-Sales.csv --remote
npm run import -- --shop chud --products ~/Downloads/chud-Products.csv --sales ~/Downloads/chud-Sales.csv --remote
```

Each import refuses to run if that shop already has data, unless you add `--replace`. It prints the sheet's counts and totals next to the database's, and they must match.

### Step 3 · Copy the photos into R2

Run this in your own Terminal, because it downloads from Google:

```sh
npm run copy-photos -- --shop baan --remote
npm run copy-photos -- --shop chud --remote
```

It's safe to run again. Any photo it can't download (for example, one that's no longer shared) is listed, and that product keeps its Google link. Downloaded copies stay in `worker/.data/photos/` as a backup.

### Step 4 · Check, then merge

1. Open `http://localhost:8000/?live=1` and check both shops: totals, a few photos, and a [TEST] sale that you then clear.
2. Merge the pull request into `main`. GitHub Pages publishes it within a few minutes.

### Step 5 · Retire the old script

In each sheet, open **Extensions → Apps Script → Deploy → Manage deployments** and archive every deployment. The old links stop working, and the sheets stay as a frozen backup.

## Custom domain (milkyanyong.shop)

This puts the app at `milkyanyong.shop` and the API at `api.milkyanyong.shop`, and lets report emails come from the shop's own address. It can happen before or after the switch-over.

### Step 1 · Move the domain's DNS to Cloudflare

1. In Cloudflare, choose **Add a domain**, enter `milkyanyong.shop`, and pick the Free plan.
2. Cloudflare shows two nameservers. In Namecheap, open **Domain List → Manage → Nameservers → Custom DNS** and enter those two.
3. Wait until Cloudflare says the domain is active. It usually takes minutes, sometimes a few hours.

The domain stays registered (and renewed) at Namecheap; only its DNS moves.

### Step 2 · Point the app at GitHub Pages

1. In Cloudflare **DNS → Records**, add four `A` records for `milkyanyong.shop` (name `@`), one for each of these addresses:
   - `185.199.108.153`
   - `185.199.109.153`
   - `185.199.110.153`
   - `185.199.111.153`
2. Set each record to **DNS only** (grey cloud), so GitHub can issue the HTTPS certificate.
3. Add a `CNAME` record: name `www`, target `baan125cafe-create.github.io`, also **DNS only**.
4. In the repo on GitHub, open **Settings → Pages → Custom domain**, enter `milkyanyong.shop`, and save. This adds a `CNAME` file to `main`.
5. Turn on **Enforce HTTPS** once it's offered.
6. Recommended: verify the domain under the GitHub organization's **Settings → Pages → Verified domains**, so no one else can use it on GitHub.

The old `github.io` address then redirects to the new domain.

Phones have to sign in once on the new address, because sign-in passes are saved per address.

### Step 3 · Serve the API on the domain

1. In `wrangler.jsonc`, uncomment the `routes` line (`api.milkyanyong.shop`).
2. Add `https://milkyanyong.shop` to `ALLOWED_ORIGINS`, separated by a comma. Keep the `github.io` one during the move.
3. Run `npm run deploy`. Cloudflare creates the `api` record and its certificate itself.
4. Put `api: 'https://api.milkyanyong.shop',` in `app/config.js`, then commit and merge.

### Step 4 · Send reports from the domain

In Resend, choose **Domains → Add domain** and enter `milkyanyong.shop`. Resend can add its DNS records to Cloudflare for you (**Auto configure**), or you can copy them in by hand. After it shows **Verified**, set the sender in `wrangler.jsonc` and deploy:

```jsonc
"REPORT_FROM": "Baan 125 shop <reports@milkyanyong.shop>"
```

To receive mail at the domain too (for example `hello@milkyanyong.shop` forwarding to Milk's Gmail), turn on **Email → Email Routing** in Cloudflare. It's free.

## Email reports

Reports go out daily at 23:30 and monthly on the 1st at 10:30 (Bangkok time). They leave out [TEST] sales. The same email setup sends the "sign-in paused" warning.

```sh
npx wrangler secret put RESEND_API_KEY     # from resend.com → API Keys
npx wrangler secret put REPORT_TO          # who gets them, comma-separated
```

Until a domain is verified in Resend, it only delivers to the email address on the Resend account itself.

## Watching usage and cost

**Where to look in the dashboard:**

- **Workers & Pages → shop-api:** requests and errors.
- **Storage & Databases → D1 → shop-db → Metrics:** rows read and written.
- **R2 → shop-photos:** storage used.

**Free limits:**

| Resource | Free limit |
| --- | --- |
| Requests | 100,000 a day |
| D1 rows read | 5 million a day |
| D1 rows written | 100,000 a day |
| D1 storage | 5 GB |
| R2 storage | 10 GB |

This shop uses a tiny fraction of each. Loading the app reads about 1,000 rows, so the read limit allows roughly 5,000 loads a day. Cloudflare emails the account when a D1 limit is reached, and more alerts can be added under **Notifications**.

## PINs

`npm run set-pin -- --shop baan|chud --role owner|staff` asks for the PIN twice, hidden. It stores only a salted, scrambled value as a Cloudflare secret. PINs never go in the code, the repo, or the database. After changing a PIN, use **Settings → Sign all out** in the app.

After wrong PINs, sign-in reopens by itself after 15 minutes, then 1 hour, then 24 hours. To clear the pause sooner:

```sh
npx wrangler d1 execute shop-db --remote --command "DELETE FROM login_state"
```

## Files

| File | What it does |
| --- | --- |
| `src/index.js` | The API, photo serving and scheduled email reports |
| `schema.sql` | Tables (safe to run again; never drops anything) |
| `wrangler.jsonc` | Cloudflare settings: database, bucket, allowed sites, report times, domain |
| `scripts/import-csv.mjs` | Copies a shop's sheet CSVs into the database and checks the totals |
| `scripts/copy-photos.mjs` | Copies Drive photos into R2 and points products at them |
| `scripts/set-pin.mjs` | Sets a PIN (hidden input, salted hash) |
| `test/api.test.mjs` | API checks on a throwaway local database |

Ignored by git: `node_modules/`, `.wrangler/` (local database), `.dev.vars` (local PINs), and `.data/` (CSV exports and downloaded photos, which hold real data).
