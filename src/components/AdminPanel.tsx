'use client';
import { useEffect, useState, useCallback } from 'react';
import type { Account } from '@/lib/account-server';
import { accountFetch } from '@/lib/storage';
export default function AdminPanel() {
  const [users, setUsers] = useState<Account[]>([]),
    [page, setPage] = useState(0),
    [search, setSearch] = useState(''),
    [query, setQuery] = useState(''),
    [total, setTotal] = useState(0),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState('');
  const load = useCallback(async () => {
    const r = await accountFetch(`/api/admin?page=${page}&search=${encodeURIComponent(query)}`);
    const v = await r.json();
    if (!r.ok) throw new Error(v.error);
    setUsers(v.users);
    setTotal(v.total);
  }, [page, query]);
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, [load]);
  const change = async (data: unknown, deleting = false) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const r = await accountFetch('/api/admin', {
        method: deleting ? 'DELETE' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const v = await r.json();
      if (!r.ok) throw new Error(v.error);
      if (deleting && users.length === 1 && page > 0) setPage(page - 1);
      else await load();
      setNotice(
        deleting
          ? 'Contul și toate documentele, quiz-urile și istoricul său au fost șterse.'
          : 'Modificarea a fost salvată.',
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="admin-shell">
      <div className="page-heading">
        <div>
          <span className="eyebrow">ADMINISTRARE</span>
          <h1>Utilizatori și generări</h1>
          <p>Fiecare utilizator nou primește două generări. Quiz-urile sale rămân private.</p>
        </div>
      </div>
      <form
        className="toolbar"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(0);
          setQuery(search);
        }}
      >
        <input
          aria-label="Caută utilizator după email"
          placeholder="Caută după email"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button>Caută</button>
      </form>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      <p>{total} conturi</p>
      <div className="admin-users">
        {users.map((u) => (
          <article key={u.id} className="admin-user">
            <div>
              <h3>{u.email}</h3>
              <p>
                {u.is_admin ? 'Administrator · nelimitat' : `${u.credits} generări disponibile`}
                {u.disabled ? ' · Suspendat' : ''}
              </p>
              <small>Creat la {new Date(u.created_at).toLocaleDateString('ro-RO')}</small>
            </div>
            {!u.is_admin && (
              <div>
                <form
                  className="button-row"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const amount = Number(new FormData(e.currentTarget).get('credits'));
                    const removing =
                      (e.nativeEvent as SubmitEvent).submitter?.getAttribute('value') === 'remove';
                    if (removing && amount > u.credits) {
                      setNotice('');
                      setError(`Poți elimina cel mult ${u.credits} generări pentru ${u.email}.`);
                      return;
                    }
                    void change({ id: u.id, credits: removing ? -amount : amount });
                  }}
                >
                  <input
                    aria-label={`Număr de generări pentru ${u.email}`}
                    name="credits"
                    type="number"
                    min={1}
                    max={1000}
                    defaultValue={2}
                    required
                  />
                  <button type="submit" name="operation" value="add" disabled={busy}>
                    Adaugă generări
                  </button>
                  <button
                    type="submit"
                    name="operation"
                    value="remove"
                    disabled={busy || u.credits === 0}
                  >
                    Elimină generări
                  </button>
                </form>
                <button
                  disabled={busy}
                  onClick={() => {
                    if (confirm(`${u.disabled ? 'Reactivezi' : 'Suspendi'} contul ${u.email}?`))
                      void change({ id: u.id, disabled: !u.disabled });
                  }}
                >
                  {u.disabled ? 'Reactivează contul' : 'Suspendă contul'}
                </button>
                <button
                  className="danger"
                  disabled={busy}
                  onClick={() => {
                    const email = prompt(
                      `Ștergi definitiv contul ${u.email}? Documentele, quiz-urile, istoricul și accesul acestui utilizator vor fi eliminate. Acțiunea nu poate fi anulată. Pentru confirmare, scrie adresa de email a utilizatorului:`,
                    );
                    if (email === null) return;
                    if (email.trim().toLowerCase() !== u.email.toLowerCase()) {
                      setNotice('');
                      setError('Adresa introdusă nu corespunde. Contul nu a fost șters.');
                      return;
                    }
                    void change({ id: u.id, email: email.trim() }, true);
                  }}
                >
                  Șterge definitiv contul
                </button>
              </div>
            )}
          </article>
        ))}
      </div>
      <div className="pagination">
        <button disabled={page === 0 || busy} onClick={() => setPage((p) => p - 1)}>
          Înapoi
        </button>
        <span>
          Pagina {page + 1} / {Math.max(1, Math.ceil(total / 25))}
        </span>
        <button disabled={(page + 1) * 25 >= total || busy} onClick={() => setPage((p) => p + 1)}>
          Următoarea
        </button>
      </div>
    </main>
  );
}
