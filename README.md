# Margin

A private paper reader with an adaptive tutor. Upload a PDF or import from arXiv, select a passage, and explore it in the context of the paper and your own background. The same library and conversations work on desktop, phone, and tablet.

## Run locally

Requires Node.js 24 or newer, Poppler (`pdftotext`, `pdfinfo`, `pdftoppm`), and a signed-in Codex CLI. The Codex adapter was exercised with version 0.153.4.

```bash
# Debian/Ubuntu, if Poppler is missing:
sudo apt-get install poppler-utils

npm ci
codex login
npm run dev
```

Open http://127.0.0.1:4317. By default this is a loopback-only development instance. It uses the current server user's Codex login. In the workspace where this app was built, the example paper and one real explanatory conversation have already been imported into the ignored `data/` directory.

For production:

```bash
npm run build
npm start
```

`npm start` does not load `.env` automatically. For a configured native deployment, copy `.env.example` to `.env`, fill it in, and run:

```bash
node --env-file=.env --import tsx server/index.ts
```

## Use it

1. Upload a text-based PDF, or enter an arXiv URL/identifier. PDFs are limited to 30 MB and 500 pages. Scanned documents require OCR first.
2. Scroll through the PDF and select text, including across page breaks, then choose **Explain selection**. The tutor receives the passage and its page range, paper text, an image of the starting page when available, your recent conversation, your reading path, and relevant learning history.
3. Replies start concise and conversational. Open **Reply style** above the conversation to save a preferred length and writing instructions. Use **Go deeper** or **Give an example** for more help. Long replies, including existing ones, have a **Show full answer** control. Ask follow-ups, request historical context, or explore reading suggestions; source links and page citations are clickable.
4. Request a quiz anytime, or accept a dismissible suggestion after a challenging explanation. Reply in the conversation to receive feedback.
5. Edit your learning profile and correct or remove inferred learning notes. Export the profile, messages, and recommendations as JSON.

On phones and portrait tablets, the **Paper / Tutor** bar switches between reading and conversation. Landscape/wide screens show the two together. Zoom controls allow reading dense PDFs. Tutor jobs continue on the server when you switch apps or the browser suspends; reopen the paper to recover the answer. Reading position is saved server-side.

## Deploy on an always-on private server

The application backend, PDFs, SQLite database, and Codex process run together. Phones and tablets only need access to the web reader. They do not receive provider credentials or need a Codex installation.

Use a dedicated service user or the included container so Codex has its own account/configuration and does not inherit unrelated personal integrations. The server starts read-only tutor threads, disables shell/edit/agent-spawning features, and rejects agent-initiated approval requests. Reproduction and command execution are outside this version's scope.

### Container

1. Install Docker with Compose. Copy this directory to the private server.
2. Copy `.env.example` to `.env`. Set a unique `APP_PASSWORD` and your actual `PUBLIC_ORIGIN`, such as `https://margin.your-private-domain.example` (no trailing slash).
3. Build and start:

```bash
docker compose up -d --build
docker compose exec app codex login --device-auth
```

Open the verification URL from the login command on any browser and complete the account login. The login stays in the `margin-codex` volume. Account settings may require enabling device-code authentication; the [official authentication guide](https://learn.chatgpt.com/docs/auth) describes alternatives.

4. Place an HTTPS reverse proxy in front of `127.0.0.1:4317`. Restrict access using your private network/VPN as appropriate. Keep the raw Codex app-server private; Margin speaks to it over process pipes, not a public port.
5. Open the HTTPS reader address on your phone/tablet and enter the **reader password**. The session cookie is separate from the provider login. It is HttpOnly, SameSite=Strict, and Secure in the supplied deployment configuration.

The Compose file binds only to server loopback and enables secure cookies. A plain HTTP browser session will not stay signed in with that configuration. Configure HTTPS before using it from other devices; do not remove those protections to expose it publicly. The local development default remains available for loopback testing.

If your reverse proxy is on another machine, adapt the bind/network configuration to your private network. `PUBLIC_ORIGIN` must exactly match the browser origin; state-changing cross-origin requests are rejected.

### Persistence and backups

- `margin-data` contains `margin.sqlite`, uploaded PDFs, and cached page images.
- `margin-codex` contains the provider login. Treat backups of this volume as credentials.
- Back up the data volume while the service is stopped, or use SQLite's backup facilities plus a copy of the PDFs. Copying only a live `.sqlite` file can omit data still in its WAL file.
- To move providers, preserve `margin-data`. It contains the canonical conversation and learning history; it is not tied to Codex thread identifiers.
- A server restart marks unfinished tutor jobs as interrupted. Questions are preserved; ask again to retry.

## Agent integration

`server/tutor.ts` defines `AgentProvider`, the request context, and the structured result. `server/codex.ts` is the initial adapter, using the documented [Codex app-server protocol](https://learn.chatgpt.com/docs/app-server). `server/app.ts` owns persistence and learning updates. To add another agent, implement the interface and choose the implementation at server startup. Authentication, supported models, and tool access are provider-specific; adding an adapter does not make subscriptions interchangeable.

The initial integration uses Codex with a ChatGPT login and its available models/usage allowances. Click the **model name and effort** beside Reply style to change them. Options come from the connected provider; only supported effort levels are offered. Choices persist across the library, and each new reply records the model and effort requested. Changing settings affects future requests. Text-only models receive extracted paper text without page images. API-key authentication instead follows API billing. This is not an integration with every ChatGPT web mode. Claude Max support is on the roadmap and needs its supported personal-integration authentication path checked when implemented.

Before an explicit model selection is saved, Margin uses `CODEX_MODEL` if set, otherwise the effective Codex configuration/default. Existing libraries retain medium effort where supported. Saved choices override that initial default within Margin and do not change the server user's Codex configuration.

For long papers, context is limited to approximately 160,000 characters, preferring initial pages, current/neighboring pages, references, and pages matching the question. The interface displays a notice, and the tutor receives an explicit list of included pages. The newest 24 conversation messages and 60 learning notes are supplied, alongside the library and reading-path decisions. This is an initial context-selection policy, not full-library semantic retrieval.

The built-in profile is initialized from the background described during this project's design; edit it for another reader. Inferred notes are evidence, not a calibrated mastery score. You can inspect and correct them. Explanations and recommendations are model-generated; source links make them inspectable, but citation correctness is not independently guaranteed by the application.

## Verification

```bash
npm test
npm run build
npx playwright install chromium
npm run test:browser
```

Server tests cover authentication/session persistence, request-origin checks, PDF validation, saved progress, idempotent background jobs, quiz feedback, corrections, recommendation overrides, provider failures, long-document context labeling, reply styles, selected page ranges, and model settings. A protocol fixture verifies paginated model discovery, model/effort forwarding, and text-only input handling. Browser tests exercise the reading workflow and model controls at desktop, phone, and tablet sizes using Chromium device emulation. Fixtures use explicitly test-only providers; production has no simulated-answer mode. Real Codex checks against arXiv:2311.03658v2 include the concise style and a request using a different model and effort.

Real iOS/iPadOS selection gestures, browser suspension, the target server environment, and remote HTTPS routing still need checks on the actual devices/deployment.

See [docs/SPEC.md](docs/SPEC.md) for the agreed requirements, acceptance passage, and roadmap. Reproduction assistance, additional agents, OCR, offline reading, and richer concept/retention tracking are deferred.
