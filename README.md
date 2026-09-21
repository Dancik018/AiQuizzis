# AIQuiz

Romanian-first, anonymous PDF/DOCX quizzes in one Next.js application. Existing repository: Dancik018/AiQuizzis. Production: https://ai-quizzis.vercel.app. GitHub main deploys to the existing Vercel project.

## Features and architecture

- PDF.js extracts every selectable-text PDF page; DOCX OOXML parsing preserves paragraphs, lists, tables, original answer options and formatting metadata. Romanian filtering, header/footer removal and conservative deduplication run locally. Color is secondary evidence.
- Free browser Tesseract OCR recognizes scanned PDF pages in Romanian/English. Files and scanned images stay in the browser; only question batches go to AI.
- All candidates are extracted first, without a document question-count cap. OpenAI is the primary configured provider, with Groq and Gemini fallbacks. Keys stay in server-side route handlers.
- Token-aware batches default to at most 50 questions. The first buffer defaults to 20. A rolling pool starts up to five OpenAI requests; a freed slot immediately takes the next batch. Free fallbacks use conservative sequential pacing.
- A quiz reserves the complete selected question order, including pending questions. Start playing after the initial ready buffer while preparation continues. Shuffled session order drives queue priority. Pending questions display a waiting state and become playable automatically.
- Quiz answers, position, question/option order, queue and prepared results persist in IndexedDB. Refresh restores an active quiz and restarts unfinished processing. Keep the tab open; a closed/suspended browser is not a permanent background worker.
- Each successful response saves immediately. Partial output saves valid IDs and retries only missing/invalid IDs. Transient failures retry with 1/2/4-second backoff, then configured fallback and splitting. One isolated bad question is flagged for manual review. Exhausted providers pause with work saved.
- Open questions receive four options in the same solving request by default (toggle off for manual-answer practice). Existing options are never regenerated. Review includes immediate-save individual option generation and bulk generation for missing options only.
- Practice/exam, quick quiz, multi-document selection, editing, paginated review, results, retry mistakes, history, flags/skips, themes and responsive layout remain supported. No account required.

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
AI_PROVIDER=openai
OPENAI_API_KEY=
OPENAI_MODEL=gpt-5.6-luna
QUIZ_BATCH_SIZE=50
QUIZ_CONCURRENCY=5
QUIZ_MIN_READY_QUESTIONS=20
GROQ_API_KEY=
GROQ_MODEL=openai/gpt-oss-120b
GEMINI_API_KEY=
GEMINI_MODEL=gemini-3.5-flash
```

- Copy a real OpenAI key into `OPENAI_API_KEY` locally/Vercel only. Never use NEXT_PUBLIC_ or VITE_ for secrets. `.env`, `.env.*` and `.vercel` are ignored; `.env.example` contains no real keys.
- `OPENAI_MODEL` is the single OpenAI model setting. Legacy `AI_MODEL` remains a compatibility fallback; default is gpt-5.6-luna. Change the environment variable and redeploy, without editing code. Model access/billing errors identify the configuration issue and allow fallback.
- `QUIZ_BATCH_SIZE`: default 50, safety bound 1–100 per request. Long questions reduce the batch automatically by estimated input/output tokens and body size. These are per-request bounds, never document limits.
- `QUIZ_CONCURRENCY`: default 5; accepts 1–10. OpenAI uses a rolling pool and halves concurrency after 429. Groq/Gemini remain at one worker because their free token quotas are much smaller.
- `QUIZ_MIN_READY_QUESTIONS`: default 20, accepts 1–100. Smaller documents use their available count.
- If AI_PROVIDER is absent, a configured OpenAI key is preferred, then Groq, then Gemini. Set AI_PROVIDER=groq to select Groq explicitly. Additional configured Groq/Gemini keys are solving fallbacks; successful questions are not sent again.
- Optional AI_REQUEST_INTERVAL_MS overrides batch-start spacing. Normally leave blank: OpenAI 0 ms (bounded pool), Groq 55000 ms, Gemini 13000 ms. Account quotas still apply; multiple users/tabs share organization limits.
- Optional GROQ_FAST_MODEL / GROQ_STRONG_MODEL override Groq routing. Default remains openai/gpt-oss-120b. Low-confidence answers get at most one stronger pass.

**Redeploy after changing Vercel environment variables.** Building/manual review do not require any key. OpenAI API usage requires API billing; ChatGPT subscriptions do not provide API credits.

## OpenAI API and model verification

OpenAI SDK 7.17, Responses API, strict Zod JSON Schema, `store: false`, no tools/history, and official `reasoning.effort: low` for supported reasoning model families. Unsupported/nonreasoning families omit that field. Initial solving requests empty explanations and do not repeat original question/option text in output unnecessarily. JSON repair only strips a BOM or complete Markdown wrapper; it never invents truncated answers.

Verified official documentation on 21 September 2026: [gpt-5.6-luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna), [reasoning](https://developers.openai.com/api/docs/guides/reasoning), [structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs). The published ID exists and supports the requested features; actual account access must be verified with its configured key.

## Cache, metrics and cost

An independent IndexedDB answer cache preserves the existing document/session database unchanged and avoids blocking older open tabs on an upgrade. SHA-256 covers exact question text, options, generation mode, provider/model and cache version. Only validated ready results are reused, preserving the new document's IDs/source. Nothing private is put in a shared server cache.

Quiz preparation diagnostics show extraction time, ready/total, requests, questions/request, batch latency, elapsed/wait times, retries, 429 count, questions/minute, first-buffer time, and moving-average ETA from the last five successful completions. Each batch's model, IDs, token usage and duration are saved locally. Server logs contain usage metadata, never prompts or keys. Cost estimates use one registry in `src/lib/pricing.ts`; unknown models have no estimate. Estimates exclude cache discounts, special long-context pricing and provider-specific billing adjustments.

Baseline measurement before this change: the live Groq endpoint solved 20 short arithmetic questions in 4.5 seconds; the previous queue imposed 55 seconds between batch starts. Progressive start removes the need to wait for the full document; it does not bypass provider token quotas. [Groq limits](https://console.groq.com/docs/rate-limits) remain the source of truth for free-plan throughput.

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
git commit -m "Add progressive AI quiz processing and optimize Groq"
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
