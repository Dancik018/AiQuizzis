import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { createCanvas } from '@napi-rs/canvas';
import { openServerDocument } from '../src/lib/scan-server';
import { docxFixture } from './fixtures';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

test('server extraction reads all 501 PDF pages in order with text formatting', async () => {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.HelveticaBold);
  for (let n = 1; n <= 501; n++) {
    const page = pdf.addPage([500, 700]);
    page.drawText(`Pagina ${n}. Protocolul P${n} foloseste portul ${1000 + n}.`, {
      x: 30,
      y: 650,
      font,
      size: 14,
      color: rgb(0, 0, 1),
    });
  }
  const started = Date.now();
  const source = await openServerDocument(await pdf.save(), 'pdf');
  try {
    assert.equal(source.pages, 501);
    for (let n = 1; n <= 501; n++) {
      const lines = await source.read(n, true);
      assert.equal(lines.length, 1);
      assert.equal(lines[0].page, n);
      assert.match(lines[0].text, new RegExp(`Pagina ${n}\\.`));
      assert.ok(lines[0].fontSize);
      assert.ok(lines[0].color);
    }
    console.log(`501 selectable PDF pages: ${Date.now() - started}ms on server`);
  } finally {
    await source.dispose();
  }
});

test('server DOCX preserves all paragraphs, headings and original options', async () => {
  const paragraphs = [
    { text: 'Capitol 1', page: 1 },
    ...Array.from({ length: 510 }, (_, i) => ({
      text: `${i + 1}. Care este protocolul P${i}?`,
      page: 1,
    })),
  ];
  const source = await openServerDocument(docxFixture(paragraphs), 'docx');
  try {
    const lines = await source.read(1);
    assert.equal(lines.length, 511);
    assert.match(lines.at(-1)!.text, /510/);
  } finally {
    await source.dispose();
  }
});

test(
  'server OCR extracts rasterized Romanian course content without browser canvas',
  { timeout: 120000 },
  async () => {
    const canvas = createCanvas(1200, 1500),
      ctx = canvas.getContext('2d');
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, 1200, 1500);
    ctx.fillStyle = 'black';
    ctx.font = '32px Arial';
    ctx.fillText('Protocolul experimental transmite mesaje.', 50, 150);
    ctx.fillText('Portul rezervat pentru laborator este 7788.', 50, 230);
    const pdf = await PDFDocument.create(),
      image = await pdf.embedPng(canvas.toBuffer('image/png'));
    const page = pdf.addPage([600, 750]);
    page.drawImage(image, { x: 0, y: 0, width: 600, height: 750 });
    const source = await openServerDocument(await pdf.save(), 'pdf');
    try {
      const lines = await source.read(1, true);
      assert.match(lines.map((l) => l.text).join(' '), /7788/);
      assert.equal(source.ocrCount, 1);
    } finally {
      await source.dispose();
    }
  },
);

test('durable scan jobs enforce ownership, lease exclusion, recovery and all 501 checkpoints', async () => {
  const db = new PGlite();
  const owner = '00000000-0000-4000-8000-000000000001',
    other = '00000000-0000-4000-8000-000000000002';
  const token = '00000000-0000-4000-8000-000000000003';
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
   create table auth.users(id uuid primary key,email text,raw_app_meta_data jsonb default '{}',encrypted_password text default 'initial',email_confirmed_at timestamptz default now());
   create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
   grant usage on schema public,auth to authenticated;grant execute on function auth.uid() to authenticated;
   create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
   create table storage.objects(name text,bucket_id text);alter table storage.objects enable row level security;
   create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;
   grant usage on schema storage to authenticated;grant select,insert,delete on storage.objects to authenticated;`);
    await db.exec(readFileSync('supabase/migrations/202609230001_accounts.sql', 'utf8'));
    await db.exec(readFileSync('supabase/migrations/202610030001_cloud_scanning.sql', 'utf8'));
    await db.exec(readFileSync('supabase/migrations/202610030002_pending_scan_limit.sql', 'utf8'));
    await db.query('insert into auth.users(id,email) values ($1,$2),($3,$4)', [
      owner,
      'user1@example.test',
      other,
      'user2@example.test',
    ]);
    const as = async <T>(user: string, sql: string, args: unknown[] = []) =>
      db.transaction(async (tx) => {
        await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [user]);
        await tx.exec('set local role authenticated');
        return tx.query<T>(sql, args);
      });
    const job = (
      await as<{ create_scan: string }>(
        owner,
        "select public.create_scan('large.pdf',1000,'pdf',true)",
      )
    ).rows[0].create_scan;
    assert.equal((await as(other, 'select * from scan_jobs')).rows.length, 0);
    assert.equal(
      (await as<{ claim_scan: boolean }>(other, 'select public.claim_scan($1,$2)', [job, token]))
        .rows[0].claim_scan,
      false,
    );
    assert.equal(
      (await as<{ claim_scan: boolean }>(owner, 'select public.claim_scan($1,$2)', [job, token]))
        .rows[0].claim_scan,
      true,
    );
    assert.equal(
      (await as<{ claim_scan: boolean }>(owner, 'select public.claim_scan($1,$2)', [job, other]))
        .rows[0].claim_scan,
      false,
    );
    for (let n = 1; n <= 501; n++)
      await as(owner, 'select public.save_scan_chunk($1,$2,$3,$3,501,$4)', [
        job,
        token,
        n,
        [{ text: `Pagina ${n}`, page: n }],
      ]);
    const saved = (
      await as<{ pages: number; next_page: number; status: string }>(
        owner,
        'select pages,next_page,status from scan_jobs',
      )
    ).rows[0];
    assert.deepEqual(saved, { pages: 501, next_page: 502, status: 'complete' });
    assert.equal((await as(owner, 'select * from scan_chunks')).rows.length, 501);
    assert.equal((await as(other, 'select * from scan_chunks')).rows.length, 0);
    assert.equal(
      (await as<{ credits: number }>(owner, 'select credits from profiles')).rows[0].credits,
      2,
      'scanning must not spend upload credit before quiz save',
    );
    const legacy = {
      id: 'legacy-source',
      name: 'large.pdf',
      lines: [{ text: 'Old extraction', page: 1 }],
      questions: [],
    };
    await as(owner, 'select public.save_document($1,0)', [legacy]);
    await as(owner, 'select public.save_document($1,1)', [
      { ...legacy, lines: [], extractionJob: job },
    ]);
    await assert.rejects(
      as(other, 'select public.save_document($1,0)', [
        { id: 'foreign-source', name: 'large.pdf', lines: [], questions: [], extractionJob: job },
      ]),
      /INVALID_DATA/,
    );
    const next = (
      await as<{ create_scan: string }>(
        owner,
        "select public.create_scan('retry.pdf',1000,'pdf',false)",
      )
    ).rows[0].create_scan;
    await as(owner, "insert into storage.objects(name,bucket_id) values($1,'quiz-sources')", [
      `${owner}/${next}/source.pdf`,
    ]);
    await assert.rejects(
      as(other, "insert into storage.objects(name,bucket_id) values($1,'quiz-sources')", [
        `${owner}/${next}/source.pdf`,
      ]),
      /row-level security/,
    );
    await as(owner, 'select public.claim_scan($1,$2)', [next, token]);
    await as(owner, 'select public.save_scan_chunk($1,$2,1,1,2,$3)', [
      next,
      token,
      [{ text: 'Saved before failure', page: 1 }],
    ]);
    await db.query("update scan_jobs set lease_until=now()-interval '1 second' where id=$1", [
      next,
    ]);
    assert.equal(
      (await as<{ claim_scan: boolean }>(owner, 'select public.claim_scan($1,$2)', [next, other]))
        .rows[0].claim_scan,
      true,
    );
    await assert.rejects(
      as(owner, 'select public.save_scan_chunk($1,$2,2,2,2,$3)', [
        next,
        token,
        [{ text: 'Stale worker', page: 2 }],
      ]),
      /SCAN_LEASE/,
    );
    await as(owner, 'select public.save_scan_chunk($1,$2,2,2,2,$3)', [
      next,
      other,
      [{ text: 'Recovered', page: 2 }],
    ]);
    assert.equal(
      (await as(owner, 'select * from scan_chunks where job_id=$1', [next])).rows.length,
      2,
    );
    for (let i = 0; i < 3; i++) {
      await db.query(
        "insert into scan_jobs(user_id,name,size,extension,study,status,pages,next_page) values($1,$2,1000,'pdf',true,'complete',1,2)",
        [owner, `completed-${i}.pdf`],
      );
    }
    for (let i = 0; i < 3; i++) {
      await as(owner, "select public.create_scan('unfinished.pdf',1000,'pdf',false)");
    }
    await assert.rejects(
      as(owner, "select public.create_scan('fourth.pdf',1000,'pdf',false)"),
      /SCAN_LIMIT/,
    );
  } finally {
    await db.close();
  }
});
