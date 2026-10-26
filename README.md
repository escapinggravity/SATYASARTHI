# 🛡️ SATYASARTHI — Agentic Evidence Verification Platform

> *Satyasarthi* (सत्यसारथी) — "the charioteer of truth."
> Don't forward. Verify.

SATYASARTHI investigates suspicious text, URLs and screenshots. It breaks the input into individual factual claims, investigates each claim independently with real web search, hunts for both supporting and contradicting evidence, and produces a claim-by-claim verdict with real citations, a list of what evidence is still missing, and an action checklist.

**Status:** hackathon prototype. The code has been written but not yet run end to end by its author, so follow the [test plan](#10-testing) before demoing.

---

## Table of contents

1. [Project overview](#1-project-overview)
2. [Features](#2-features)
3. [Architecture](#3-architecture)
4. [Project structure](#4-project-structure)
5. [Setup and run](#5-setup-and-run)
6. [How to use](#6-how-to-use)
7. [How verdicts work](#7-how-verdicts-work)
8. [Anti-fabrication and integrity design](#8-anti-fabrication-and-integrity-design)
9. [Security and privacy](#9-security-and-privacy)
10. [Testing](#10-testing)
11. [Configuration reference](#11-configuration-reference)
12. [Known limitations](#12-known-limitations)
13. [Troubleshooting](#13-troubleshooting)
14. [Next.js production version](#14-nextjs-production-version)
15. [Roadmap](#15-roadmap)
16. [FAQ](#16-faq)
17. [Credits and disclaimer](#17-credits-and-disclaimer)

---

## 1. Project overview

### The problem
Misinformation spreads as screenshots, forwarded messages and links. Checking them by hand means identifying each claim, searching, reading sources, noticing when sources disagree, and deciding what is still unknown. Most people skip this. Simple "true/false" classifiers make it worse by presenting guesses as facts.

### The approach
SATYASARTHI is an **agent**, not a one-shot classifier. For every claim it:

1. **Plans** its own search queries (one aimed at supporting evidence, one at contradicting evidence).
2. **Uses tools** (web search, URL extraction).
3. **Analyzes** the retrieved sources with a Gemma model.
4. **Detects insufficient evidence** (no verified quotes, or the model asks for more).
5. **Investigates again** with follow-up queries, up to 3 rounds.
6. **Verifies** the model's output against the raw sources before showing anything.

### Design principles
- **Never fabricate** sources, URLs, quotes, dates or tool results.
- **Absence of evidence is not evidence of falsehood.** "No evidence found" never becomes "false."
- **Show your work:** every verdict links to the sources and exact quotes behind it, and states what is missing.
- **Treat model output as untrusted** until it has been checked against retrieved text.

---

## 2. Features

| Area | Feature |
|---|---|
| Input | Paste text, enter a URL, or upload a screenshot (PNG/JPEG/WebP, max 3.5 MB) |
| Extraction | Gemma (multimodal) extracts up to 5 distinct, checkable factual claims; opinions are ignored |
| Investigation | Each claim is investigated independently with its own queries and sources |
| Evidence | Supporting **and** contradicting evidence, with real source links |
| Verdicts | `SUPPORTED`, `CONTRADICTED`, `UNVERIFIED`, `INCONCLUSIVE` |
| Gap analysis | "What's missing?" lists evidence needed for a stronger verdict |
| Transparency | Live agent activity timeline shows every plan, search and analysis step |
| Visualization | Evidence graph: Claims → Sources → Evidence quotes (green = supports, red = contradicts) |
| Output | Final report with verdict counts and an actionable checklist |
| UX | Responsive layout, dark/light theme, accessible error messages |

---

## 3. Architecture

### Pipeline

```
 User input (text | URL | screenshot)
        │
        ▼
 ┌──────────────────┐   URL input: Tavily Extract pulls page text
 │ Claim extraction │   Gemma returns {"claims":[...]} (max 5)
 └────────┬─────────┘
          ▼          (repeated independently for every claim)
 ┌──────────────────┐
 │ Investigation    │   Gemma writes 2 queries: support + contradict
 │ planning         │
 └────────┬─────────┘
          ▼
 ┌──────────────────┐   Tavily search (advanced depth, 5 results/query)
 │ Web search       │   de-duplicates sources by URL
 └────────┬─────────┘
          ▼
 ┌──────────────────┐   Gemma reads all sources, returns verdict,
 │ Evidence analysis│   evidence quotes, missing items, follow-ups
 │ + contradiction  │
 │ detection        │
 └────────┬─────────┘
          ▼
 ┌──────────────────┐   Quotes kept only if they appear verbatim
 │ Verification     │   in the cited source. Verdict decided by code.
 └────────┬─────────┘
          │ insufficient? ──► follow-up queries ──► back to Web search (max 3 rounds)
          ▼
 ┌──────────────────┐
 │ Report           │   Counts, checklist, graph, per-claim cards
 └──────────────────┘
```

### Components

| Component | Responsibility | Where (static version) |
|---|---|---|
| Model client | Calls Gemma through the Gemini API (`generateContent`), supports image input | `gemma()` in `script.js` |
| Search client | Tavily `search` and `extract` | `tavily()` in `script.js` |
| Agent loop | Plan → search → analyze → retry → verify | `investigate()` in `script.js` |
| Verdict logic | Evidence checking and verdict rules | `verifyEvidence()`, `decide()` |
| UI renderer | Timeline, claim cards, detail view, graph, report | `render()`, `drawGraph()`, `finish()` |

### Technology
- **Static version (this folder):** HTML, CSS, vanilla JavaScript. Calls Gemma and Tavily directly from the browser.
- **Production version:** Next.js, TypeScript, React, Tailwind CSS, Supabase/PostgreSQL, React Flow, zod, Vitest (see [section 14](#14-nextjs-production-version)).
- **Model:** Gemma (default `gemma-3-27b-it`) via the Gemini API, with temperature 0.1 for stable analysis.
- **Search/URL tools:** Tavily Search and Extract.

---

## 4. Project structure

```
satyasarthi-web/
├── index.html   # Page structure: settings, input tabs, timeline, dashboard, graph, report
├── style.css    # Theme variables (light/dark), responsive grid, verdict badge colors
├── script.js    # Agent pipeline, verdict logic, rendering, SVG graph, event wiring
└── README.md    # This documentation
```

### `index.html`
Sections: header with theme toggle; hero banner; collapsible **API keys** panel; **input card** (Text / URL / Screenshot tabs); **live agent activity** list; **dashboard** (claim list + detail card); **evidence graph**; **report** with checklist.

### `style.css`
CSS variables in `:root` and `:root.dark` drive both themes. The dashboard is one column on phones and a 1:2 two-column grid from 800 px upward. Verdict colors: green `SUPPORTED`, red `CONTRADICTED`, grey `UNVERIFIED`, amber `INCONCLUSIVE`.

### `script.js` (key constants and functions)

| Item | Value / purpose |
|---|---|
| `MAX_CLAIMS` | 5 claims per submission |
| `MAX_ROUNDS` | 3 search-and-analyze rounds per claim |
| `gemma(prompt, image)` | Gemini API call, temperature 0.1 |
| `parseJSON(text)` | Extracts the first JSON object from model text (Gemma has no JSON mode) |
| `tavily(path, body)` | Authenticated Tavily call |
| `verifyEvidence()` | Drops evidence whose source does not exist or whose quote is not in that source |
| `decide()` | Final verdict rules |
| `investigate()` | The agent loop |
| `render()` | Rebuilds claim list and detail card using `textContent` only |
| `drawGraph()` | Builds the SVG evidence graph |

---

## 5. Setup and run

### Requirements
- A modern browser (Chrome, Edge, Firefox, Safari).
- Python 3 or any static file server (opening `index.html` directly may work, but serving over HTTP is recommended).
- A **Gemini API key** from Google AI Studio (this serves Gemma).
- A **Tavily API key** from tavily.com.

### Steps
1. Put the four files in one folder.
2. Start a server in that folder:
   ```bash
   python3 -m http.server 8000
   ```
3. Open `http://localhost:8000`.
4. Expand **⚙️ API keys**, paste both keys, confirm the model name, click **Save**.
5. Submit something to investigate.

Keys are saved to the browser's `localStorage` on your machine only and are sent only to Google (Gemini) and Tavily.

---

## 6. How to use

### Investigating text
1. Choose the **Text** tab and paste a message or claim.
2. Click **Investigate**.

### Investigating a URL
1. Choose **URL** and enter a full `http://` or `https://` address.
2. The agent calls Tavily Extract to read the page (first 8,000 characters), then extracts claims from it. If the page cannot be read, you are told to paste the text instead.

### Investigating a screenshot
1. Choose **Screenshot** and select a PNG, JPEG or WebP under 3.5 MB.
2. Gemma reads the image directly and extracts the claims it contains.

### Reading the results
- **Live agent activity:** a running log such as `[C2] Round 1: searching "..."`. `C2` means claim 2.
- **Claim list (left):** each claim with its verdict badge. Click one to open it.
- **Detail card (right):** verdict, reasoning, quoted evidence with source links (green border = supports, red = contradicts), **What's missing?**, and a collapsible list of every source inspected.
- **Evidence graph:** claim → cited sources → evidence quotes. Only sources that contributed verified evidence appear.
- **Report:** verdict counts and a checkbox checklist of next steps.

### Acting on the checklist
The checklist is generated from the "missing evidence" items of every claim that is not `SUPPORTED`, plus a warning for any `CONTRADICTED` claim ("Do not share, cite the contradicting sources"). Use it as a to-do list for further verification: for example, finding an official statement, a primary document, or a dated original source.

---

## 7. How verdicts work

| Verdict | Meaning | Rule in code |
|---|---|---|
| **SUPPORTED** | At least one verified quote supports the claim, none contradict it, and the model's judgment agrees | `sup > 0`, `con == 0`, model said `SUPPORTED` |
| **CONTRADICTED** | At least one verified quote contradicts the claim, none support it, and the model's judgment agrees | `con > 0`, `sup == 0`, model said `CONTRADICTED` |
| **INCONCLUSIVE** | Sources were found but evidence is missing, mixed, or the model's judgment disagrees with the verified evidence | Sources exist and the above rules did not match, including supporting **and** contradicting evidence together |
| **UNVERIFIED** | The search returned no sources at all, so nothing could be checked | `sources == 0` and no evidence |

**Important:** a verdict is derived by code from *verified* evidence. The model's own verdict can only confirm a verdict that the evidence already allows; it can never create one.

**What a verdict is not:** `UNVERIFIED` and `INCONCLUSIVE` do **not** mean the claim is false. They mean the agent could not establish it with the evidence available.

---

## 8. Anti-fabrication and integrity design

| Risk | Safeguard |
|---|---|
| Model invents a source | Evidence must reference a source ID (`S1`, `S2`, …) that the search tool actually returned; unknown IDs are dropped |
| Model invents or alters a quote | A quote is kept only if it is at least 12 characters and appears in the cited source's text after whitespace/case normalization |
| Links are made up | Every link shown comes from a Tavily result. URLs are validated to `http(s)` before being rendered, and opened with `rel="noopener noreferrer"` |
| "No results" treated as "false" | `decide()` returns `UNVERIFIED` or `INCONCLUSIVE`, never `CONTRADICTED`, when verified contradicting evidence is absent |
| Overconfident model | The final verdict is computed in code; conflicting verified evidence forces `INCONCLUSIVE` |
| Tool failure hidden | Search and analysis failures are logged in the timeline and reduce confidence rather than being silently ignored |
| Fabricated dates/results | The app shows only data returned by tools or quoted from sources; it adds no dates of its own to claims |

**What this does not prove:** a verified quote shows that the *source says something*, not that the source is correct. The model's judgment about whether a quote supports or contradicts the claim is also not independently checked. Always read the quotes and sources yourself for anything important.

---

## 9. Security and privacy

### Static version (this folder)
- **API keys live in the browser** (`localStorage`). Anyone with access to your browser profile or devtools can read them. Use this version for demos and personal use, with keys that have spending limits, and never deploy it publicly with real keys embedded.
- **XSS protection:** all model-generated and web-derived text is inserted with `textContent` or `createElement`, never `innerHTML`.
- **Input validation:** screenshot type and size are checked; URLs must start with `http://` or `https://`.
- **Data sent out:** your submitted text/image and generated queries go to Google (Gemini API) and Tavily. Do not submit sensitive personal data.
- **Prompt injection:** retrieved web text could contain instructions aimed at the model. Mitigation is partial: the model only outputs JSON that is then verified against sources, and verdicts are decided by code.
- **No persistence:** results are held in memory and lost on refresh.

### Production version
Server-side API calls (keys never reach the browser), Supabase authentication, row-level security, request validation with zod, per-user rate limiting, and SSRF-protected page fetching. Details in [section 14](#14-nextjs-production-version).

---

## 10. Testing

### Automated (production version)
`tests/verdict.test.ts` (Vitest) covers:
- fabricated quotes are dropped;
- unknown source IDs are dropped;
- real quotes are kept;
- no evidence never yields `CONTRADICTED`;
- conflicting evidence yields `INCONCLUSIVE`.

Run with `npm test` in the Next.js project.

### Manual test plan (static version)

| # | Test | Expected |
|---|---|---|
| 1 | Click Investigate with no keys | Message asks for keys; settings panel opens |
| 2 | Click Investigate with empty input | "Provide something to investigate." |
| 3 | URL tab with `ftp://x` or plain text | "Enter a valid http(s) URL." |
| 4 | Upload a `.gif` or a file over 3.5 MB | Rejected with a type/size message |
| 5 | Paste a well-documented fact (e.g. a famous historical date) | Claim extracted; likely `SUPPORTED` with quotes and links |
| 6 | Paste a widely debunked claim | Likely `CONTRADICTED` or `INCONCLUSIVE` with sources |
| 7 | Paste an obscure or invented local claim | `UNVERIFIED` or `INCONCLUSIVE`, with "What's missing?" filled in, **not** "false" |
| 8 | Use a wrong API key | A clear error such as `Gemma API error 400/403`, not a blank page |
| 9 | Toggle theme, resize to phone width | Layout stays usable, colors readable |
| 10 | Open a cited link | Opens in a new tab; page exists and matches the quote |

Results from tests 5 to 7 depend on live search and model output and will vary.

---

## 11. Configuration reference

### Static version
Set in the **API keys** panel (stored in `localStorage` keys `gkey`, `tkey`, `gmodel`, `theme`):

| Setting | Default | Notes |
|---|---|---|
| Gemini API key | none | Required |
| Gemma model | `gemma-3-27b-it` | Use any Gemma model your key can access that accepts image input if you want screenshot support |
| Tavily API key | none | Required |

Tunable constants at the top of `script.js`: `MAX_ROUNDS` (3) and `MAX_CLAIMS` (5). Other fixed values: search returns 5 results per query; each source contributes up to 2,500 characters to the analysis prompt; extracted URL content is capped at 8,000 characters; model temperature is 0.1.

### Production version environment variables

| Variable | Purpose |
|---|---|
| `GEMINI_API_KEY` | Gemini API key (serves Gemma) |
| `GEMMA_MODEL` | Model name, default `gemma-3-27b-it` |
| `TAVILY_API_KEY` | Web search |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key |

---

## 12. Known limitations

- **Snippets, not full pages (static version):** browsers cannot fetch arbitrary websites (CORS), so the agent analyzes the content snippets Tavily returns. Evidence is therefore shallower than in the production version, which fetches and reads full pages.
- **Tavily from the browser:** if Tavily rejects calls from your origin, the static version cannot search. Use the Next.js version.
- **Model judgment:** Gemma can misread a quote's meaning or stance. Quote verification catches fabricated text, not misinterpretation.
- **Source quality is not scored:** a low-quality site and an official source are treated alike. The agent does not yet rank source credibility.
- **Single quote can be enough:** `SUPPORTED` requires one verified supporting quote, not independent corroboration from multiple sources.
- **Time-sensitive claims:** results reflect whatever the search index returns at that moment; the agent does not reason explicitly about publication dates.
- **Images:** text inside screenshots is read by the model and may be misread; image forensics (edited or AI-generated images) is not performed.
- **Language:** extraction and search work best in English; other languages depend on model and search coverage.
- **Scale:** at most 5 claims per submission; runs are sequential, so a 5-claim investigation can take a few minutes.
- **No history in the static version:** refreshing the page clears results.
- **Untested prototype:** not yet run end to end by the author; expect small bugs.

---

## 13. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `Gemma API error 400` | Bad key, unknown model name, or model does not accept images | Check key and model name; use a text-only input to isolate |
| `Gemma API error 403/429` | Key lacks access, or quota/rate limit reached | Check Google AI Studio quota; wait and retry |
| `Tavily error 401` | Invalid Tavily key | Re-enter the key |
| `Failed to fetch` / CORS error in console | Browser blocked the API call | Serve over `http://localhost`, not `file://`; if Tavily still blocks, use the Next.js version |
| `Model returned no JSON` | Gemma replied with prose | Retry; shorten the input; try a larger Gemma model |
| "No checkable factual claims found" | Input is opinion or too vague | Provide a concrete statement with names, dates or figures |
| Everything `UNVERIFIED` | Searches returned nothing | Rephrase, add specifics, or check your Tavily quota |
| URL tab fails | Page blocks extraction or is paywalled | Paste the page text into the Text tab |
| Blank graph | No source contributed verified evidence | Expected for `UNVERIFIED`/`INCONCLUSIVE` claims with no verified quotes |

Open the browser console (F12) for detailed error messages.

---

## 14. Next.js production version

The companion project (`satyasarthi.zip`) moves everything sensitive to the server.

### Stack
Next.js 15, React 19, TypeScript, Tailwind CSS 4, Supabase (Auth + PostgreSQL), React Flow, zod, Vitest.

### Structure
```
lib/gemma.ts           Gemma client (server-side)
lib/tools.ts           Tavily search + SSRF-safe page fetch
lib/verdict.ts         verifyEvidence() and decide()
lib/agent.ts           Agent loop, emits progress events
app/api/investigate/   Authenticated, rate-limited streaming endpoint
app/page.tsx           UI: auth, input, timeline, cards, React Flow graph, report
supabase/schema.sql    investigations table + row-level security
tests/verdict.test.ts  Unit tests
```

### Setup
1. Create a Supabase project, enable email auth, run `supabase/schema.sql` in the SQL editor.
2. `cp .env.example .env.local` and fill in the variables from section 11.
3. `npm install`, then `npm run dev` (open `http://localhost:3000`), and `npm test` for unit tests.

### API: `POST /api/investigate`
- **Auth:** `Authorization: Bearer <Supabase access token>`; missing or invalid returns 401.
- **Body:** `{ "kind": "text|url|image", "text": "...", "image": { "mime": "image/png|jpeg|webp", "data": "<base64>" } }`
- **Validation:** text up to 10,000 characters; image base64 up to 5,000,000 characters; URL must be `http(s)`; invalid returns 400.
- **Rate limit:** 4 investigations per minute per user; exceeding returns 429. The limiter is in memory, so replace it with Redis or Upstash for multi-instance deployments.
- **Response:** server-sent events (`text/event-stream`), one JSON object per `data:` line:

| Event `t` | Payload |
|---|---|
| `step` | `msg`, optional `claim` index |
| `claims` | `claims: [{text}]` |
| `result` | `index`, `result` (verdict, reasoning, evidence, missing, sources) |
| `done` | `report`, `saved` (whether the database insert succeeded) |
| `error` | `msg` |

### Database
```sql
investigations(id uuid pk, user_id uuid -> auth.users, input_kind text,
               input_preview text, report jsonb, created_at timestamptz)
```
Row-level security allows users to select, insert and delete only their own rows (`auth.uid() = user_id`).

### Server-side safeguards
- API keys never reach the browser.
- **SSRF protection:** only `http`/`https`; the hostname is resolved and private, loopback and link-local addresses are blocked; redirects (max 3) are re-validated; responses are capped at 1.5 MB; 15 s timeout.
- Page text capped at 6,000 characters per source for analysis.
- Errors are returned as structured events, not raw stack traces.

### Not yet implemented in the production version
Investigation history list, shadcn/ui components, dedicated landing page, end-to-end tests, distributed rate limiting.

---

## 15. Roadmap

1. Source credibility scoring (official, primary, news, social, unknown).
2. Require independent corroboration (two or more distinct domains) for `SUPPORTED`.
3. Date-aware analysis: extract publication dates and flag outdated sources.
4. Reverse image search and basic image-manipulation checks for screenshots.
5. Investigation history, sharing and PDF export of reports.
6. Multilingual claim extraction and search.
7. Parallel claim investigation and caching of repeated searches.
8. End-to-end and evaluation tests against a labeled claim set.

---

## 16. FAQ

**Is this a fact-checker that tells me what is true?**
No. It gathers and organizes evidence and tells you how well the claim is established. You make the final judgment.

**Why does a claim show `INCONCLUSIVE` when it seems obviously true or false?**
Either no retrieved source contained a verifiable quote, or sources disagreed. Check "What's missing?" for what would resolve it.

**Why does it not say "FALSE"?**
Because lack of evidence is not proof of falsehood. `CONTRADICTED` is used only when a real source quote contradicts the claim.

**Does it work offline?**
No. It needs live access to the Gemini API and Tavily.

**Can I use a different search provider or model?**
Yes. Replace `tavily()` and `gemma()` in the static version (or `lib/tools.ts` and `lib/gemma.ts` in Next.js), keeping the same return shapes.

**Is my data stored?**
Static version: only your API keys and theme preference, in your browser. Production version: reports are stored in your Supabase database, visible only to the signed-in user.

---

## 17. Credits and disclaimer

Built for a hackathon using Google's Gemma models (through the Gemini API), Tavily for search and extraction, Supabase, Next.js and React Flow.

**Disclaimer:** SATYASARTHI is an assistive research tool. Its output may be incomplete or wrong. Do not rely on it alone for legal, medical, financial or safety-critical decisions, and always read the cited sources.
