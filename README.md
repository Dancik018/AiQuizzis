# AIQuiz

Romanian-first, account-protected PDF/DOCX quizzes in one Next.js application. Existing repository: Dancik018/AiQuizzis. Production: https://aiquizzis.online. GitHub main deploys to the existing Vercel project.

## Features and architecture

- PDF.js extracts every selectable-text PDF page; DOCX OOXML parsing preserves paragraphs, lists, tables, original answer options and formatting metadata. Romanian filtering, header/footer removal and conservative deduplication run locally. Color is secondary evidence.
- Free browser Tesseract OCR recognizes scanned PDF pages in Romanian/English. Files and scanned images stay in the browser; only question batches go to AI.
- Token-aware batches default to at most 50 questions. The first buffer defaults to 20. A rolling pool starts up to five OpenAI requests; a freed slot immediately takes the next batch.
- A quiz reserves the complete selected question order, including pending questions. Start playing after the initial ready buffer while preparation continues. Shuffled session order drives queue priority. Pending questions display a waiting state and become playable automatically.
- Quiz answers, position, question/option order, queue and prepared results persist in private Supabase rows. Refresh restores an active quiz and restarts unfinished processing. Keep the tab open; a closed/suspended browser is not a permanent background worker.
- Each successful response saves immediately. Partial output saves valid IDs and retries only missing/invalid IDs. Transient failures retry with 1/2/4-second backoff, then splitting. One isolated bad question is flagged for manual review. OpenAI quota exhaustion pauses with work saved.
- Open questions receive four options in the same solving request by default (toggle off for manual-answer practice). Existing options are never regenerated. Review includes immediate-save individual option generation and bulk generation for missing options only.
- Practice/exam, quick quiz, multi-document selection, editing, paginated review, results, retry mistakes, history, flags/skips, themes and responsive layout remain supported. A verified account is required for uploads, quizzes and AI endpoints.

## Installation and local development

Node.js 24 and npm:

```sh
npm install
cp .env.example .env.local
npm run dev
```

PowerShell: `Copy-Item .env.example .env.local`. Next.js loads environment files automatically; no dotenv package is needed. Never overwrite an existing credential file blindly.

## Environment variables

Use the same names in `.env.local` and Vercel → existing ai-quizzis project → Settings → Environment Variables → Production:

```env
OPENAI_API_KEY=
OPENAI_MODEL=gpt-5.6-luna
QUIZ_BATCH_SIZE=50
QUIZ_CONCURRENCY=5
QUIZ_MIN_READY_QUESTIONS=20
```

- Copy a real OpenAI key into `OPENAI_API_KEY` locally/Vercel only. Never use NEXT_PUBLIC_ or VITE_ for secrets. `.env`, `.env.*` and `.vercel` are ignored; `.env.example` contains no real keys.
- `OPENAI_MODEL` is the single OpenAI model setting. Legacy `AI_MODEL` remains a compatibility fallback; default is gpt-5.6-luna. Change the environment variable and redeploy, without editing code. Model access/billing errors identify the configuration issue without dropping saved work.
- `QUIZ_BATCH_SIZE`: default 50, safety bound 1–100 per request. Long questions reduce the batch automatically by estimated input/output tokens and body size. These are per-request bounds, never document limits.
- `QUIZ_MIN_READY_QUESTIONS`: default 20, accepts 1–100. Smaller documents use their available count.

**Redeploy after changing Vercel environment variables.** Building/manual review do not require any key. OpenAI API usage requires API billing; ChatGPT subscriptions do not provide API credits.

## OpenAI API and model verification

OpenAI SDK 7.17, Responses API, strict Zod JSON Schema, `store: false`, no tools/history, and official `reasoning.effort: low` for supported reasoning model families. Unsupported/nonreasoning families omit that field. Initial solving requests empty explanations and do not repeat original question/option text in output unnecessarily. JSON repair only strips a BOM or complete Markdown wrapper; it never invents truncated answers.

Verified official documentation on 21 September 2026: [gpt-5.6-luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna), [reasoning](https://developers.openai.com/api/docs/guides/reasoning), [structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs). The published ID exists and supports the requested features; actual account access must be verified with its configured key.

## Cache, metrics and cost

A per-account IndexedDB answer cache avoids repeated AI work. Documents and sessions are stored in Supabase, protected by row-level security and optimistic versions. SHA-256 covers exact question text, options, generation mode, provider/model and cache version. Only validated ready results are reused, preserving the new document's IDs/source. Nothing private is put in a shared server cache.

Quiz preparation diagnostics show extraction time, ready/total, requests, questions/request, batch latency, elapsed/wait times, retries, 429 count, questions/minute, first-buffer time, and moving-average ETA from the last five successful completions. Each batch's model, IDs, token usage and duration are saved with the private document. Server logs contain usage metadata, never prompts or keys. Cost estimates use one registry in `src/lib/pricing.ts`; unknown models have no estimate. Estimates exclude cache discounts, special long-context pricing and provider-specific billing adjustments.

## Build, test and deploy

```sh
npm run lint
npm test
npm run build
npm run test:e2e
npm start
```

Tests generate actual PDF/DOCX bytes (150/200/450 questions), mixed language/color/formatting and scanned pages. Unit tests cover 500-question rolling concurrency, partial response recovery, order/identity preservation, bulk options and transport schemas. Browser inference mocks are explicit and do not establish live answer accuracy. Live provider checks are reported separately.

Production is Next.js App Router with short Node.js route handlers `/api/solve`, `/api/analyze`, `/api/evaluate`, `/api/config`. No Redis, Python, Docker, permanent process or server filesystem persistence. `vercel.json` preserves the existing Next.js framework/build/output override. Generated PDF/OCR assets are copied during build.

```sh
git status
git diff
git add .
git push origin main
```

Do not create another repository or Vercel project. Verify GitHub CI and the existing deployment independently after push.

## Limitations and security

- No parser/LLM guarantees every question or correct academic answers. Unusual columns, equations, low-quality scans, ambiguous language and multi-correct questions need manual review. Single-choice generated distractor quality is model-dependent.
- Open questions can remain open when option generation is disabled. Normalized answer matching handles Romanian diacritics; semantic grading uses AI only when needed.
- Source-key/manual-approved answers are retained. Existing completed quiz snapshots are immutable; pending questions are hydrated by stable ID, never reordered by request completion.
- Data is local to browser/device. Clearing site data deletes it; no sync/remote backup. Storage errors are surfaced. Exam mode hides feedback but is not secure proctoring.
- Anonymous API protection is best-effort per-instance. Configure Vercel Firewall and provider spending limits as appropriate for public traffic. Provider exhaustion cannot be fixed by retries.
- Upload MIME/extension/signature/size validation, bounded OOXML decompression, Zod schemas, same-origin requests, bounded timeouts and prompt/data separation protect the pipeline. Uploaded files are never executed. Raw upstream errors and credentials are never returned.

## OpenAI-only verification and answer privacy

Only OPENAI_API_KEY and OPENAI_MODEL configure AI. Set them in Vercel Production (or ignored .env.local) and redeploy after changing values. Defaults: gpt-5.6-luna, QUIZ_BATCH_SIZE=50, QUIZ_CONCURRENCY=5, QUIZ_MIN_READY_QUESTIONS=20. Model account access and credits are required.

Question normalization separates embedded answers and explanations before storage. The same guard sanitizes old documents/sessions and gates quiz rendering. Original source is internal only. Explicit answer keys are deterministic evidence; ambiguous/embedded/technical items receive independent verification. Normalized phrase matching and AI semantic checking reject leaking stems. No heuristic or model guarantees detection of every semantic clue; unresolved items are excluded, not shown as verified.

One server request performs one pass so verification remains serverless-safe. The queue persists the solver result, independently verifies generated options and risky/uncertain items without showing the prior answer, and invokes a judge on disagreement (maximum three semantic passes). Invalid responses have bounded retry/splitting. Only verified items become playable. Multi-select grading compares sets of original option indices, preserving shuffled display order.

All sessions live in the existing IndexedDB sessions store. History includes in-progress/completed sessions sorted by last activity, answered counts, Continue Quiz and confirmed restart. Continue retains the same ID and answers. The former homepage resume card is removed. Existing records gain status/updatedAt when read without discarding data.

### Generation latency and recovery

QUIZ_GENERATION_BATCH_SIZE=16 caps batches that generate options; existing-option solving still uses QUIZ_BATCH_SIZE=50. This is a per-request latency budget, not a document limit. Before optimization, a real 20-question academic generation request took 34 seconds, so 50-item generation risked the 45-second upstream deadline. Independent verification for the initial buffer now takes priority over new solver work. Compact per-request IDs and empty unchanged question fields reduce repeated output. Timeout/truncation/oversized or invalid batches split immediately; transient server errors retain bounded exponential retry. Invalid individual entries are isolated with safe field names. Old-provider requests receive an explicit refresh message; HTTP 413 is distinguished from malformed input.

Generated correct answers are matched against option text instead of trusting positional indices alone. Original-option index/text inconsistencies are rejected for retry. Generated options require an independent verification pass, even when the first model response reports full confidence. Short request IDs use a non-numeric prefix to avoid confusion with question numbers. Cached results from the older validation policy are not reused. Full document benchmarks are reported separately; latency depends on subject, output size, network and account quota.

Verified responses from independent/judge passes are cached under both their current options and original open-question input, so repeating an unchanged document does not regenerate options. Strong verification never reads a cached answer. Priority regrouping respects the generation cap to avoid unnecessary tiny remainder requests.

A real OpenAI run with synthetic, actual PDF and DOCX files of 200 short arithmetic questions each completed extraction, four-option generation, independent verification and quiz refresh/resume: PDF 94.4 seconds (first 20 in 25.0 seconds), DOCX 68.6 seconds (first 20 in 22.6 seconds). All 400 answers matched independently calculated expectations; neither document required retries. These measurements used the local production build and real API, not mocked inference, and are not guarantees for complex academic/scanned documents or Vercel latency.


### Optimized option generation

First-pass option generation uses a dedicated compact schema: one correct answer plus three distractors, with server-assigned option positions. The independent verifier receives only question/options and returns a compact verdict. Existing source options and judge resolution keep their full validation path. Ambiguous or multiple-correct generated sets are escalated and never silently accepted as single-choice. All ready/leakage/schema guards remain active.

Two requests can warm the initial buffer when generation is enabled, then the existing bounded pool handles the remaining document. Adaptive batches now budget output tokens and source-answer length as well as input size; long definitions are split earlier. The best-effort application limit is configurable through QUIZ_API_REQUESTS_PER_MINUTE (default 90, maximum 300). Local throttling returns the actual remaining window, while provider Retry-After and quota errors remain honored. This is per-instance protection, not a distributed rate limiter.

A controlled real-API comparison on the same 20 computing questions measured first-pass generation at 21.6 seconds / 2,494 output tokens before, versus 14.3 seconds / 1,897 output tokens after. A second compact run generated and independently verified all 20 in 21.3 seconds total. These are individual measurements, not guaranteed latency or proof of correctness for every subject. Optimization follows [OpenAI latency guidance](https://developers.openai.com/api/docs/guides/latency-optimization) on reducing output tokens and parallelizing independent work.


### Trilingual medical test documents

The parser recognizes numbered and unnumbered CS/CM blocks, SC/MC variants and Cyrillic lookalikes in those markers. Translation blocks are separated before option collection and repeated question stems are not mistaken for headers. Whole-question language evidence is primary; options help resolve ambiguous short stems. Uncertain language remains subject to AI verification. A Cyrillic lookalike inside an otherwise Romanian word does not make the entire question Russian.

Malformed saved documents with merged lists exceeding 12 choices are rebuilt from their saved source lines on load, rather than truncating choices or requiring upload. Matching question IDs and unchanged validated answers are retained; reviewed additions are preserved. The repaired queue restarts against the clean questions, and the interface explains the repair.

Questions explicitly referring to missing diagrams are marked with their source page, excluded from automatic solving and new quizzes, and available through the review filter “Depind de imagini”. Current extraction does not attach diagram crops. Users must consult the source and rewrite such questions with sufficient textual context; the AI is not allowed to guess unseen figures. Full source pages are not displayed in quizzes because they may include highlighted answer keys.

Regression coverage includes 300 synthetic trilingual question groups, repeated stems, mixed-script CS/CM, preserved five-option sets, saved-data repair and missing-diagram guards. A supplied 218-page PDF was extracted with the actual browser PDF parser: before the fix 503 candidates exceeded the option limit; after the fix every extracted candidate passed the request schema with five options. The private source document is not part of the repository.


Independent choice verification also uses the compact schema for existing single/multiple-answer questions, preserving every original option. Multiple-answer batches budget the possible combined answer length. Foreign-language verdicts are persisted even when the model supplies no answer, avoiding wasteful repeated solving of rejected translations. Processing progress counts completed verification or isolated failures, rather than calling a first-pass answer finished; diagram/foreign exclusions are shown separately. Manual multiple-answer edits recompute the answer from selected options on save.


A real OpenAI end-to-end run on that 218-page medical PDF completed all queued work in 426.6 seconds: 132 HTTP-successful batches, zero invalid-request questions. Of 591 candidates, the final safety classification retained 476 ready questions, excluded 33 foreign-language candidates and 51 figure-dependent questions, and left 31 for manual review. Two of the figure references were identified from this run and added to the arrow/highlighted-structure guard. This is a processing/recovery benchmark, not independent medical validation of every AI answer or a guarantee of latency. Source images are still not attached automatically.

New quizzes exclude exhausted/failed questions; existing saved quiz order is preserved. A completed document therefore starts a playable quiz from ready answers instead of reserving unresolved items indefinitely. Paused preparation no longer displays a misleading countdown.

## Accounts, database and administrator

Apply the SQL files in `supabase/migrations` in filename order to the existing Supabase project. Set `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `APP_URL` in Vercel Production. The deployed app does **not** need a service-role key. Only the public project key is used with verified user sessions; database RLS remains authoritative.

Each verified new user receives two document preparations. One credit is consumed atomically when a new extracted document is first saved, before AI processing. Retries, edits and quizzes from existing documents do not consume another credit. A failed AI request retains the saved document and credit allocation; deleting a document does not refund a credit. Each document also has a finite AI work allowance to prevent unlimited requests using a reused identifier. The administrator has unlimited credits and can add or remove up to 1000 credits per action (removal cannot exceed the current balance; every adjustment is audited), suspend/reactivate ordinary accounts, and search a paginated user list. Admin cannot view another user's private documents through the application.

`ursud09@gmail.com` is reserved for the administrator. Bootstrap once with `node scripts/bootstrap-admin.mjs`, supplying `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and `ADMIN_INITIAL_PASSWORD` through private process environment variables. Never commit these values or put the service key in Vercel. The initial password must be changed at first login; both API and SQL block workspace/admin actions until its stored hash changes. Public signup and user-editable metadata cannot create administrators.

For Google OAuth, configure a Web client with redirect URI `https://jmpgcyuesbznaxdqxmul.supabase.co/auth/v1/callback`, save its ID and secret in Supabase Authentication → Providers → Google, then set `GOOGLE_AUTH_ENABLED=true`. Configure Supabase Site URL as `https://aiquizzis.online` and allow `https://aiquizzis.online/auth/callback`. Google credentials stay in Supabase, never in client code. Only basic identity/email scopes are needed.

Email/password login remains available for existing accounts. Public email signup and password recovery require custom SMTP; leave `EMAIL_AUTH_ENABLED=false` until delivery is configured and tested. Keep email verification enabled. Google signup does not depend on SMTP.

Historical anonymous IndexedDB data is not erased or silently assigned to the next person who logs in. The account workspace loads only authenticated cloud data. Existing browser-only documents require an explicit future migration or a fresh upload; shared-browser caches are never merged between accounts. Cloud writes require connectivity and report conflicts instead of overwriting another device's newer version.

Security tests include actual PostgreSQL execution via PGlite (RLS, concurrent credit consumption, ownership, administrator protection), unauthenticated route checks, and browser regression tests. Browser regression fixtures emulate an authenticated account only inside tests; production has no bypass.

Administratorii pot șterge definitiv un cont obișnuit din Administrare → Șterge definitiv contul, confirmând adresa sa de email. Migrarea `202609240002_delete_accounts.sql` elimină atomic utilizatorul Auth și datele asociate (documente, quiz-uri, istoric, generări); conturile de administrator sunt protejate. Nu se cere o cheie service-role în aplicație. Ștergerea nu împiedică o înregistrare nouă ulterioară cu aceeași adresă.
