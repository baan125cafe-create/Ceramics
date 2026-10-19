# Shop API (Cloudflare)

The shop data for Baan 125 and ChudPak: products, sales, settings and photos. It replaces the Google Sheets and Apps Script.

- **Worker** (`src/index.js`): the API. Checks the PIN pass and the role on every request, works out sale totals, and sends the email reports.
- **D1** (`schema.sql`): the database (SQLite). Columns match the old sheet headers.
- **R2**: product photos.

The app is a static site on GitHub Pages. It talks to this API at the address in `app/config.js` (`api`).

| | Address | Backup address |
| --- | --- | --- |
| App | `https://milkyanyong.shop` | `https://baan125cafe-create.github.io/Ceramics/` (redirects to the domain) |
| API | `https://api.milkyanyong.shop` | `https://shop-api.milkshops.workers.dev` |

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

`app/config.js` points at `https://api.milkyanyong.shop`, which starts working after the switch-over deploy (step 5). The live site doesn't change until the branch is merged into `main`.

## Before switch-over day: start the domain

DNS changes can take a few hours to spread, so do these the day before.

### Step A · Move the domain's DNS to Cloudflare

1. In Cloudflare, choose **Add a domain**, enter `milkyanyong.shop`, and pick the Free plan. Skip importing any existing records.
2. Cloudflare shows two nameservers. In Namecheap, open **Domain List → milkyanyong.shop → Manage → Nameservers → Custom DNS**, enter both, and save (the green tick).
3. Cloudflare emails you when the domain is **Active**. The domain stays registered and renewed at Namecheap; only its DNS moves.

### Step B · Add the records for the app

In Cloudflare, open **milkyanyong.shop → DNS → Records** and add these five records. Set every one to **DNS only** (grey cloud), so GitHub can issue the HTTPS certificate.

| Type | Name | Content |
| --- | --- | --- |
| A | `@` | `185.199.108.153` |
| A | `@` | `185.199.109.153` |
| A | `@` | `185.199.110.153` |
| A | `@` | `185.199.111.153` |
| CNAME | `www` | `baan125cafe-create.github.io` |

Don't add a record for `api`: Cloudflare creates it when the API is deployed.

**Don't set the custom domain in GitHub yet.** The old pages save the script link per web address. Moving them to a new address before the switch-over would make every phone ask for the link again in the middle of a selling day.

### Step C · Set up Resend

1. Create an account at [resend.com](https://resend.com).
2. Under **Domains → Add domain**, enter `milkyanyong.shop`. Use **Auto configure** to let Resend add its DNS records in Cloudflare, or copy them in by hand. These records are fine with the orange cloud or grey.
3. Under **API Keys**, create a key with **Sending access**, and keep it for switch-over day.

## Switch-over day, in order

Pick a time when no one is selling, for example late evening in Phuket. Nothing is written to both places: after the switch, Cloudflare is the only place data is saved. Run commands in `~/Ideas/Ceramics/worker`, on the `shop-app-cloudflare` branch.

### Step 1 · Check the domain is ready

- **Cloudflare:** the domain shows **Active**.
- **Resend:** the domain shows **Verified**.

If Cloudflare isn't active yet, wait; nothing else depends on it until step 5.

### Step 2 · Export the sheets

In each Google Sheet, use **File → Download → Comma-separated values (.csv)**, once on the Products tab and once on the Sales tab. Save the four files outside the repo, for example in `~/Downloads`.

From here until step 9, ask the shop not to record sales. Anything saved in the old pages after the export won't be moved.

### Step 3 · Import

```sh
npm run import -- --shop baan --products ~/Downloads/baan-Products.csv --sales ~/Downloads/baan-Sales.csv --remote
npm run import -- --shop chud --products ~/Downloads/chud-Products.csv --sales ~/Downloads/chud-Sales.csv --remote
```

Each import prints the sheet's counts and totals next to the database's, and they must match. It refuses to run if that shop already has data, unless you add `--replace`.

### Step 4 · Copy the photos into R2

Run this in your own Terminal, because it downloads from Google:

```sh
npm run copy-photos -- --shop baan --remote
npm run copy-photos -- --shop chud --remote
```

It's safe to run again. Any photo it can't download is listed, and that product keeps its Google link. Copies stay in `worker/.data/photos/` as a backup.

### Step 5 · Email settings and deploy

In `wrangler.jsonc`, set the sender:

```jsonc
"REPORT_FROM": "Baan 125 shop <reports@milkyanyong.shop>"
```

Then add the email secrets and deploy:

```sh
npx wrangler secret put RESEND_API_KEY     # the key from Resend
npx wrangler secret put REPORT_TO          # who gets reports, comma-separated
npm run deploy
```

The deploy puts the API on `https://api.milkyanyong.shop`. Check it answers:

```sh
curl -X POST https://api.milkyanyong.shop/baan -d '{"action":"getVersion"}'
```

The answer should include `"version":7`. A brand-new address can take a few minutes to start working.

### Step 6 · Check from your computer

Run the app locally and open `http://localhost:8000/?live=1`. Choose **Live data** and sign in to each shop with the real PINs. Check:

- the totals match the sheets
- photos show
- a **[TEST]** product and sale work, then clear them in **Settings → Test data**

### Step 7 · Commit and merge

1. Commit and push the `REPORT_FROM` change.
2. Merge the redesign pull request, then the Cloudflare one. Use **Create a merge commit** for both (not squash).
3. Before merging the second one, change its base to `main` (or click **Delete branch** after the first merge, which does it for you) and mark it **Ready for review**.

The merge includes a `CNAME` file that moves the site to `milkyanyong.shop`.

### Step 8 · Turn on the domain in GitHub

1. In the repo on GitHub, open **Settings → Pages**. **Custom domain** should show `milkyanyong.shop`; if it's empty, enter it and save.
2. Wait for the DNS check to pass and the certificate to be issued. This can take up to an hour.
3. Tick **Enforce HTTPS**.
4. Recommended: verify the domain under the organization's **Settings → Pages → Verified domains**, so no one else can use it on GitHub.

The old `github.io` address then redirects to `milkyanyong.shop`, and old bookmarks to `owner.html` or `staff.html` land on the app.

### Step 9 · Sign in on the shop phones

Open `https://milkyanyong.shop` on each phone, choose the shop and **Live data**, and enter the PIN. Add it to the home screen. Staff can start selling again.

### Step 10 · Retire the old script

In each sheet, open **Extensions → Apps Script → Deploy → Manage deployments** and archive every deployment. The old links stop working, and the sheets stay as a frozen backup.

## Email reports

Reports go out daily at 23:30 and monthly on the 1st at 10:30 (Bangkok time). They leave out [TEST] sales. The same email setup sends the "sign-in paused" warning.

Setup is in switch-over step 5: `RESEND_API_KEY` and `REPORT_TO` are secrets, and `REPORT_FROM` is in `wrangler.jsonc`.

To receive mail at the domain too (for example `hello@milkyanyong.shop` forwarding to Milk's Gmail), turn on **Email → Email Routing** in Cloudflare. It's free.

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
