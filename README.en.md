# Visibilidade Aberta

An open-source, local application for discovering search terms from a website, checking Google results and identifying practical accessibility and contact improvements.

**Start with a domain.** Website discovery and diagnostics work without an API key. Google ranking checks are optional and require your own compatible SerpApi Free account.

[Português](README.md) · [Methodology, in Portuguese](docs/METODOLOGIA.md) · [Enable ranking checks](docs/ATIVAR-POSICOES.md)

## Run locally

Install [Node.js](https://nodejs.org/) **22, starting at 22.13, or 24 LTS**, and Git. Other major versions are not part of the declared compatibility range.

```sh
git clone https://github.com/felipercmb/visibilidade-aberta.git
cd visibilidade-aberta
npm ci
npm start
```

Open [http://localhost:8794](http://localhost:8794). Stop the server with `Ctrl+C`.

No build or cloud account is needed. The server binds to `127.0.0.1`; SQLite and its migrations are initialized automatically at `data/visibilidade.sqlite`.

## Optional Google results

Copy `.env.example` to `.env`, set `SERPAPI_KEY` to your own key and restart the server. Leave it empty to use website discovery and diagnostics only.

```sh
cp .env.example .env
```

PowerShell:

```powershell
Copy-Item .env.example .env
```

`PORT` defaults to `8794`. `DATA_DIR` defaults to the project's `data` directory; relative paths are resolved from the project root. Keep `.env` and the database private.

Local execution is not offline. Collection uses external DNS services (Google/Cloudflare), the system resolver and requests to the target website. When enabled, SerpApi receives the search terms, context and authentication key. Those services may log requests under their own policies.

Visitors do not need an account. The person running the application needs a provider account for Google checks. The default code refuses paid plans and extra credits; it does not switch to a paid fallback.

## Scope and limits

- Discover up to 100 candidate terms from up to 12 public pages. Candidates are not proof of search demand or ranking.
- Read up to five Google pages per term, in batches of up to four pages. The actual coverage may be smaller.
- Preserve each page's source, observation time and context. The displayed position adds the confirmed pagination offset to the page-local position; it is not a universal ranking.
- Pause and resume while following the report. Hiding or closing the page stops automatic continuation; an already submitted batch may finish.
- Print or save the loaded report as PDF without making more search requests.

This installation limits new search requests to 200 per month, 40 per hour and 20 Google pages per domain in 24 hours, subject to the provider's remaining allowance. The counters live in this installation's SQLite database; they are not shared across everyone's installations. Sharing an API key still shares that provider account's allowance.

Progress is reusable for up to seven days. A Google capture confirms a current observation only within its one-hour validity. Website reread failures preserve the original candidate dates instead of presenting old evidence as new.

The tool does not discover every keyword, guarantee rankings, certify accessibility or measure ad waste, sales or revenue. No live-ranking accuracy benchmark is claimed for this release.

## Contribute

```sh
npm test
npm run check
```

Tests use controlled responses and must not use real API keys or live search calls. See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).

Licensed under [MIT](LICENSE). Third-party services and websites retain their own terms.
