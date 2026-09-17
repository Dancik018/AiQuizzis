# AIQuiz

Anonymous Romanian-first PDF/DOCX quizzes, built with Next.js, React and TypeScript. Uses the existing **Dancik018/AiQuizzis** repository and GitHub → Vercel integration.

## Features

- Real browser PDF/DOCX extraction; drag/drop; extension, MIME, signature and 30 MB size validation.
- Romanian filtering, header/footer cleanup, conservative deduplication, original option preservation and explicit answer keys.
- Server-side AI answers, optional four-option generation, confidence scores and Zod structured outputs.
- Incremental saved AI batches and retries; optional semantic structure recovery with a persistent cursor.
- Paginated question editing, regeneration, manual approval, duplicate/delete actions.
- Existing saved documents generate quizzes without reuploading; combine multiple documents.
- Quick quiz, counts, practice/exam, open answers, shuffling, flags/skips, navigation, refresh/resume, history, results and retry incorrect questions.
- Responsive Romanian UI, Light/Dark/System, IndexedDB data and localStorage preferences. No login.

## Architecture

One Next.js App Router application. No Python server, Redis, permanent worker or persistent server filesystem.

1. Browser extracts all pages with PDF.js and a bundled worker, or DOCX OOXML paragraphs/tables/lists/formatting. Text and metadata are saved in IndexedDB.
2. Deterministic parsing filters language and duplicates without a global question-count cap. Color is secondary metadata; blue Romanian is retained.
3. At most 10 questions per `/api/solve` request; each response is saved before advancing. Refresh preserves work; **Reîncearcă loturile rămase** continues.
4. Optional **Caută întrebări suplimentare** sends bounded overlapping chunks to `/api/analyze` for unusual layouts, preserving existing questions/options. Each chunk saves its cursor. This action makes additional paid requests.
5. Scanned pages are rendered locally and recognized by Tesseract.js in a browser Web Worker, using Romanian and English models. OCR is free and needs no API key. Engine and models are served by this application and cached locally; scanned images never leave the browser.
6. Quiz snapshots retain questions, orders, answers, flags/skips, position and timestamps. Editing source documents does not rewrite quiz history.

Modules: `src/lib/extract.ts`, `detection.ts`, `processing.ts`, `ai.ts`, `quiz.ts`, `storage.ts`. `AIProvider` isolates solving/evaluation for future providers.

## Installation / development

Node.js 24 and npm (`engines.node` pins Vercel to the same major version):

```sh
npm install
cp .env.example .env.local
npm run dev
```

Windows: `Copy-Item .env.example .env.local`. Never commit real keys.

## Environment variables / AI configuration

Set variables in the **existing Vercel project**, Settings → Environment Variables (Production, optionally Preview):

| Variable         | Meaning                                                                             |
| ---------------- | ----------------------------------------------------------------------------------- |
| `AI_PROVIDER`    | `openai` (default)                                                                  |
| `OPENAI_API_KEY` | Server-only key for automatic answers, structure analysis and semantic evaluation   |
| `AI_MODEL`       | Responses structured-output model available to your project; default `gpt-4.1-mini` |
| `AI_BATCH_SIZE`  | 1–10, default 10                                                                    |

Never use `NEXT_PUBLIC_` for credentials. Building and manual/source-key review require no key. Missing services return clear Romanian messages. Live requests require provider accounts and may incur charges.

Integration follows [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs). Confidence is an estimate, not a guarantee; specialized/uncertain answers need review.

## Production build / Vercel deployment

```sh
npm run lint
npm test
npm run build
npm start
```

Build copies the matching PDF.js worker to `public/` (generated, not committed). API routes use Node.js. Provider routes declare a 60-second duration and bounded upstream timeouts; verify your Vercel plan limits.

`vercel.json` explicitly sets the **Next.js** framework, `npm run build` and `.next` output. This is necessary because the existing project's previous static deployment settings served only `public/` assets and returned 404 for pages/API routes. Keep the repository root as the project root. No Python entrypoints, manual uploads or Vercel CLI dependency are needed. Git deployment integration is unchanged.

```sh
git status
git diff
git add .
git commit -m "Update AIQuiz application"
git push origin main
```

Successful push is distinct from verified deployment: inspect existing Vercel deployment logs. Configure Vercel Firewall rate limits and provider spending limits for anonymous paid endpoints; in-code per-instance throttling is best effort, not distributed enforcement.

## Tests

```sh
npm test
npx playwright install chromium
npm run build
npm run test:e2e
```

`tests/fixtures.ts` generates actual PDF/DOCX containing **450 Romanian questions**, 30 English questions, an exact duplicate, headers/footers, mixed numbering, multiple choice/open questions and colored text. DOCX includes tables/formatting. These are synthetic test fixtures, never fake application results.

Unit tests check counts, options, Romanian/English/Russian/French handling, diacritics, 10/100/450-question configurations, order/source invariants and scores. Browser tests exercise uploads, pagination, saved-file reuse, exam feedback hiding, refresh/resume, practice/open answers, results/retry, corrupt files, real two-page scanned PDF OCR, mobile layout and themes. Batch-recovery tests mock the provider explicitly; they do not verify live answer accuracy.

## Supported documents / known limitations

- PDF/DOCX only; TXT/images can extend the extraction interface. Unlock password-protected PDFs before uploading.
- DOCX page numbers approximate Word page-break markers. Complex list restarts, nested lists and unusual tables need review. External headers/footers are omitted.
- PDF content-stream order may differ from visual reading order (columns, equations, images, fragmented fonts). Position/color/font metadata is best effort; subset-font names may not expose bold/italic. OCR yields text rather than faithful layout. Blank/low-text pages can trigger OCR.
- No parser guarantees every question from arbitrary layouts. Use semantic analysis and manual review when counts differ. Very long chunk-boundary questions may need correction. The 450-question fixture is tested; 1000+ practicality depends on memory, complexity and provider limits, not an extraction cap.
- Multiple-choice supports exactly one correct answer. Multiple-correct/ambiguous questions require adaptation or open-answer format.
- Open answers use normalized equality, then semantic AI. Unavailable/low-confidence grading remains pending; practice/results allow manual assessment. Pending scores are provisional.
- Data is browser/device-local. Clearing site data removes it; no sync or remote backup. Private browsing/quota restrictions can prevent saving; errors are displayed.
- Files remain local, but AI sends question text to OpenAI while OCR stays entirely in the browser. OpenAI requests use `store: false`.
- Exam mode hides UI feedback; it is personal practice, not secure proctoring. Answers exist in local quiz data.

## Security

Request schemas, body bounds, same-origin checks, structured AI validation, unique-ID reconciliation, timeouts and safe errors protect routes. DOCX rejects DTD/entities and caps decompression. Uploaded content/PDF actions are never executed. No user-controlled URLs are fetched server-side. Keys remain server-only and never enter prompts. Environment files, private data, caches and build artifacts are ignored.

### Free scanned PDF OCR

Tesseract.js and its language models are copied from locked npm dependencies during build. The first scanned upload downloads the engine and models; subsequent use can reuse browser caches. OCR runs sequentially with one worker per document and actual recognition progress. Slow devices and hundreds of scanned pages can take substantial time. Blurry images, handwriting and complicated layouts require manual review. OpenAI answer generation is separate and still requires a server-side API key and API billing.
