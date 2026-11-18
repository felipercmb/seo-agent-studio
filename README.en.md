# Visibilidade Aberta

An optional **local AI training pilot** fine-tunes Qwen2.5-1.5B with QLoRA and can review up to three contexts from a local report. Once a compatible environment, model and locally selected adapter are present, the experimental option appears in the interface. Experiments include synthetic cases and public website captures with weak technical labels, not independent expert review. Training currently targets Apple Silicon Macs. Outputs require human review; the benchmark does not establish SEO or revenue gains. See the [training guide (Portuguese)](docs/TREINAR-IA.md).

The first run passed all mechanical criteria on only **3 of 16 reserved cases** and is not ready for autonomous client recommendations. [Full results and failures](ia/resultados/piloto-v1/README.md) are included.

A [second local experiment (Portuguese)](docs/EXPERIMENTOS-IA-V2.md) adds cautionary scenarios, constrained decision output, and an experimental comparison of opportunities. It does not estimate financial returns.

[![Testes](https://github.com/felipercmb/visibilidade-aberta/actions/workflows/ci.yml/badge.svg)](https://github.com/felipercmb/visibilidade-aberta/actions/workflows/ci.yml)

An open-source, local application for discovering search terms from a website, checking Google results and identifying practical accessibility and contact improvements.

**Start with a domain.** Website discovery and diagnostics work without an API key. An [assisted browser capture](docs/GOOGLE-LOCAL.md) can import links from a Google page you have opened, without a provider account. It reports recognized order within that page, not an absolute Google position. The optional ranking connector requires your own compatible SerpApi Free account.

[Português](README.md) · [Methodology, in Portuguese](docs/METODOLOGIA.md) · [Opportunity agent](docs/AGENTE.md) · [Enable ranking checks](docs/ATIVAR-POSICOES.md)

## Run locally

Download the [r4.3.4 local ZIP](https://github.com/felipercmb/visibilidade-aberta/releases/tag/r4.3.4) and follow the [quick start guide](COMECE-AQUI.md), in Portuguese.

Install [Node.js](https://nodejs.org/) **22, starting at 22.13, or 24 LTS**, and Git. Other major versions are not part of the declared compatibility range.

```sh
git clone https://github.com/felipercmb/visibilidade-aberta.git
cd visibilidade-aberta
npm ci
npm start
```

Open [http://localhost:8794](http://localhost:8794). Stop the server with `Ctrl+C`.

No build or cloud account is needed. The server binds to `127.0.0.1`; SQLite and its migrations are initialized automatically at `data/visibilidade.sqlite`.

## Turn observations into next steps

The opportunity agent combines discovered terms, available rankings and page diagnostics to organize what to investigate and improve. It explains its evidence, decision rules and missing measurements. A promising observed position is a hypothesis to test, not proof that a keyword will produce more sales.

The agent runs locally with open, deterministic rules. It does not use a generative model, send reports to an external AI service or make new Google requests to generate its analysis. Without valid ranking evidence, it keeps the opportunity in investigation. See the [criteria and limitations](docs/AGENTE.md), in Portuguese.

## Optional Google results

The local [capture guide](http://127.0.0.1:8794/google-local) provides a Chrome/Edge extension ZIP. Click to capture an already-open Web results page, then import its JSON or send it directly to the local app with a temporary project-scoped code. Extension 0.4.1 requests optional loopback access for direct delivery; download-only capture remains available. Pages are grouped by requested context and preserved continuation links, with gaps and repeats shown explicitly. This does not automate searches, turn pagination offsets into ranks or authenticate the operator's observation. Imported evidence stays in `DATA_DIR/google-local/capturas`; it has no automatic cleanup and does not enter training or spending recommendations. See the [format and limitations](docs/GOOGLE-LOCAL.md), in Portuguese.

The parser records domains shown in result citations and keeps opaque redirect destinations unknown. The [local project workflow](docs/USO-LOCAL-INTEGRADO.md) connects these observations to a reviewed offer, with source excerpts for the roles, deadlines and conditions a person needs to verify. Optional local AI readers are experimental and require human review.

For the separate ranking connector:

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

SQLite stores profiles, declared assumptions, task history, structured diagnostic reports and evidence excerpts. The modular local workflow also preserves complete public HTML captures and AI job artifacts under `DATA_DIR/evidencias-negocio/`, even when the optional model is not installed. These files have no automatic cleanup; deleting a project from the interface removes its database record but leaves the evidence files on disk. Keeping a file does not renew the validity of its observations. The browser keeps a separate, minimal diagnostic comparison history; clearing it does not remove the local database or snapshots. See the [integrated local workflow and retention guide](docs/USO-LOCAL-INTEGRADO.md).

Visitors do not need an account. The person running the application needs a provider account for the ranking connector. The default code refuses paid plans and extra credits; it does not switch to a paid fallback. Assisted capture does not use that connector.

## Scope and limits

- Discover up to 100 candidate terms from up to 12 public pages. Candidates are not proof of search demand or ranking.
- With the optional connector, read up to five Google pages per term, in batches of up to four pages. The actual coverage may be smaller.
- Preserve each page's source, observation time and context. Connector positions use the source's confirmed pagination context; assisted captures show only recognized page-local order. Neither is a universal ranking.
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
