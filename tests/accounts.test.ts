import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
test('PostgreSQL enforces private ownership, atomic credits, reserved admin and blocked accounts', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role service_role;create role anon;create role authenticated;create schema auth;
 create table auth.users(id uuid primary key,email text,raw_app_meta_data jsonb default '{}',encrypted_password text default 'initial',email_confirmed_at timestamptz default now());
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 grant usage on schema public,auth to authenticated;grant execute on function auth.uid() to authenticated;`);
    await db.exec(readFileSync('supabase/migrations/202609230001_accounts.sql', 'utf8'));
    await db.exec(readFileSync('supabase/migrations/202609230002_admin_bootstrap.sql', 'utf8'));
    await db.exec(readFileSync('supabase/migrations/202609230003_saved_quiz_sources.sql', 'utf8'));
    for (const n of [1, 2])
      await db.query('insert into auth.users(id,email) values($1,$2)', [
        uid(n),
        `user${n}@example.test`,
      ]);
    await assert.rejects(
      db.query('insert into auth.users(id,email) values($1,$2)', [uid(3), 'ursud09@gmail.com']),
      /RESERVED_ACCOUNT/,
    );
    await db.query(
      `insert into auth.users(id,email,raw_app_meta_data) values($1,$2,'{"admin_bootstrap":true}')`,
      [uid(3), 'ursud09@gmail.com'],
    );
    const as = async <T>(n: number, sql: string, args: unknown[] = []) =>
      db.transaction(async (tx) => {
        await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [uid(n)]);
        await tx.exec('set local role authenticated');
        return tx.query<T>(sql, args);
      });
    await assert.rejects(
      as(1, 'select public.bootstrap_administrator($1)', [uid(1)]),
      /permission denied/,
    );
    const doc = (id: string) => ({
      id,
      name: 'sample.pdf',
      lines: [{ text: 'Care este capitala Franței?', page: 1 }],
      questions: [{ id: 'q1', documentId: id }],
    });
    const saved = await as<{ save_document: number }>(1, 'select public.save_document($1,0)', [
      doc('a'),
    ]);
    assert.equal(saved.rows[0].save_document, 1);
    const second = await as(1, 'select public.save_document($1,0)', [doc('b')]);
    assert.ok(second);
    await assert.rejects(as(1, 'select public.save_document($1,0)', [doc('c')]), /NO_CREDITS/);
    await as(1, 'select public.save_document($1,1)', [doc('a')]);
    assert.equal(
      (await as<{ credits: number }>(1, 'select credits from profiles')).rows[0].credits,
      0,
    );
    await assert.rejects(as(1, 'update profiles set credits=99'), /permission denied/);
    await assert.rejects(
      as(1, 'select public.manage_account($1,10,null)', [uid(2)]),
      /ADMIN_REQUIRED/,
    );
    assert.equal((await as(2, 'select * from documents')).rows.length, 0);
    await assert.rejects(as(2, "select public.claim_ai('a',1)"), /DOCUMENT_NOT_FOUND/);
    await assert.rejects(
      as(2, 'select public.save_quiz($1,0)', [{ id: 's', questions: [{ documentId: 'a' }] }]),
      /DOCUMENT_NOT_FOUND/,
    );
    await assert.rejects(
      as(3, 'select public.manage_account($1,10,null)', [uid(1)]),
      /ADMIN_REQUIRED/,
    );
    await assert.rejects(
      as(3, 'select public.finish_password_change()'),
      /PASSWORD_CHANGE_REQUIRED/,
    );
    await db.query("update auth.users set encrypted_password='changed-private' where id=$1", [
      uid(3),
    ]);
    await as(3, 'select public.finish_password_change()');
    await as(3, 'select public.manage_account($1,3,null)', [uid(1)]);
    assert.equal(
      (await as<{ credits: number }>(1, 'select credits from profiles')).rows[0].credits,
      3,
    );
    await as(1, 'select public.save_document($1,0)', [doc('c')]);
    await assert.rejects(
      as(1, 'select public.save_document($1,1)', [{ ...doc('a'), lines: [] }]),
      /WRITE_CONFLICT/,
    );
    await assert.rejects(
      as(1, 'select public.save_document($1,2)', [{ ...doc('a'), lines: [] }]),
      /SOURCE_IMMUTABLE/,
    );
    await as(3, 'select public.manage_account($1,0,true)', [uid(1)]);
    await assert.rejects(as(1, "select public.claim_ai('a',1)"), /ACCOUNT_BLOCKED/);
    assert.equal((await as(1, 'select * from documents')).rows.length, 0);
    await as(3, 'select public.manage_account($1,0,false)', [uid(1)]);
    const results = await Promise.allSettled(
      ['d', 'e', 'f'].map((id) => as(1, 'select public.save_document($1,0)', [doc(id)])),
    );
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 2);
    for (const id of ['admin-a', 'admin-b', 'admin-c'])
      await as(3, 'select public.save_document($1,0)', [doc(id)]);
    const snapshot = { id: 'history-a', questions: [{ id: 'q1', documentId: 'a' }] };
    await as(1, 'select public.save_quiz($1,0)', [snapshot]);
    await as(1, "select public.delete_document('a')");
    await as(1, 'select public.save_quiz($1,1)', [snapshot]);
    await as(1, 'select public.save_quiz($1,0)', [{ ...snapshot, id: 'retry-a' }]);
    await assert.rejects(as(2, 'select public.save_quiz($1,0)', [snapshot]), /DOCUMENT_NOT_FOUND/);
    assert.equal(
      (await as<{ credits: number }>(1, 'select credits from profiles')).rows[0].credits,
      0,
    );
  } finally {
    await db.close();
  }
});
