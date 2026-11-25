# Baan 125 · ChudPak shop app

| Folder | What it is |
| --- | --- |
| `app/` | The app (GitHub Pages, milkyanyong.shop). See `app/README.md`. |
| `worker/` | The shop API and database on Cloudflare. See `worker/README.md`. |
| `scripts/check.mjs` | Pre-push checks (below). |

## Before every push

```sh
node scripts/check.mjs          # or: cd worker && npm run check
cd worker && npm test           # API checks on a throwaway local database
```

`check.mjs` fails if:

- any JavaScript file doesn't parse;
- a colour is written outside `app/tokens.css`, a `var(--…)` token is used but not defined, or a screen has a fixed inline style;
- a tracked file holds an API key, secret, PIN hash, private key, Apps Script or Sheet link, phone number or personal email, or a secret file (`.dev.vars`, `.env`) is tracked.

## Styling

- `app/tokens.css` holds every colour, size, radius and shadow, for light and dark.
- `app/styles.css` uses only those tokens.
- Controls (text boxes, search bars, dropdowns, date boxes, square icon buttons) share one look: `--control-*` and `--focus-ring`.
- Cards (sections, product rows, sell tiles, KPI boxes) use `--card-*`; dropdown lists use `--pop-*` and `--option-*`.

To change how all of them look, change the token, not the individual rule.
