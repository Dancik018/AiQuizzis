'use client';
/* Full reload deliberately clears per-account caches and pending UI work on identity changes. */
/* eslint-disable @next/next/no-location-assign-relative-destination */
import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import type { Account } from '@/lib/account-server';
import { setStorageAccount } from '@/lib/storage';
const Workspace = dynamic(() => import('./Workspace'));
const AdminPanel = dynamic(() => import('./AdminPanel'));
async function authAction(data: unknown) {
  const r = await fetch('/api/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const result = await r.json();
  if (!r.ok) throw new Error(result.error || 'Acțiunea nu a reușit.');
  return result;
}
export default function AccountGate() {
  const [user, setUser] = useState<Account | null>(null),
    [loaded, setLoaded] = useState(false),
    [error, setError] = useState('');
  const [mode, setMode] = useState<'login' | 'signup' | 'recover'>('login'),
    [google, setGoogle] = useState(false),
    [emailEnabled, setEmailEnabled] = useState(false),
    [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false),
    [admin, setAdmin] = useState(false),
    [password, setPassword] = useState(false);
  useEffect(() => {
    const refresh = () =>
      fetch('/api/account', { cache: 'no-store' })
        .then(async (r) => {
          const v = await r.json();
          if (r.ok) {
            setStorageAccount(v.user.id);
            setUser(v.user);
          } else if (r.status !== 401) setError(v.error);
        })
        .catch(() => setError('Conexiunea nu este disponibilă. Reîncearcă.'))
        .finally(() => setLoaded(true));
    void refresh();
    void fetch('/api/auth')
      .then((r) => r.json())
      .then((v) => {
        setGoogle(v.google);
        setEmailEnabled(v.email);
      })
      .catch(() => {});
    const changed = () => {
      void refresh();
    };
    window.addEventListener('aiquiz-account-changed', changed);
    if (new URLSearchParams(location.search).has('changePassword')) setPassword(true);
    if (new URLSearchParams(location.search).has('authError'))
      setError('Linkul de autentificare nu este valid sau a expirat.');
    return () => window.removeEventListener('aiquiz-account-changed', changed);
  }, []);
  if (!loaded)
    return (
      <main className="auth-shell">
        <p role="status">Se verifică autentificarea...</p>
      </main>
    );
  if (user && (user.must_change_password || password))
    return (
      <main className="auth-shell">
        <section className="auth-card">
          <h1>Schimbă parola</h1>
          <p>
            {user.must_change_password
              ? 'Parola inițială este temporară. Alege o parolă privată înainte de a folosi administrarea.'
              : 'Alege o parolă nouă, de minimum 12 caractere.'}
          </p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              setError('');
              if (f.get('password') !== f.get('confirm')) {
                setError('Parolele nu coincid.');
                return;
              }
              setBusy(true);
              try {
                await authAction({ action: 'password', password: f.get('password') });
                location.assign('/');
              } catch (e) {
                setError((e as Error).message);
                setBusy(false);
              }
            }}
          >
            <label>
              Parolă nouă
              <input
                name="password"
                type="password"
                minLength={12}
                maxLength={128}
                required
                autoComplete="new-password"
              />
            </label>
            <label>
              Confirmă parola
              <input
                name="confirm"
                type="password"
                minLength={12}
                maxLength={128}
                required
                autoComplete="new-password"
              />
            </label>
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
            <button className="primary" disabled={busy}>
              Salvează parola
            </button>
            {!user.must_change_password && (
              <button type="button" onClick={() => setPassword(false)}>
                Înapoi
              </button>
            )}
          </form>
        </section>
      </main>
    );
  if (!user)
    return (
      <main className="auth-shell">
        <section className="auth-card">
          <a href="/privacy">Cum sunt folosite datele tale</a>
          <span className="eyebrow">AIQUIZ · SPAȚIUL TĂU DE ÎNVĂȚARE</span>
          <h1>
            {mode === 'signup'
              ? 'Creează un cont'
              : mode === 'recover'
                ? 'Recuperează accesul'
                : 'Bine ai revenit'}
          </h1>
          <p>
            Documentele și quiz-urile tale, într-un cont privat. Primești două pregătiri gratuite de
            documente.
          </p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError('');
              setMessage('');
              const f = new FormData(e.currentTarget);
              try {
                const result = await authAction({
                  action: mode,
                  email: f.get('email'),
                  password: mode === 'recover' ? undefined : f.get('password'),
                });
                if (result.message) setMessage(result.message);
                else location.assign('/');
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              Email
              <input name="email" type="email" autoComplete="email" maxLength={254} required />
            </label>
            {mode !== 'recover' && (
              <label>
                Parolă
                <input
                  name="password"
                  type="password"
                  autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                  minLength={12}
                  maxLength={128}
                  required
                />
                <small>Minimum 12 caractere.</small>
              </label>
            )}
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            {message && (
              <p className="notice" role="status">
                {message}
              </p>
            )}
            <button className="primary" disabled={busy}>
              {busy
                ? 'Se procesează...'
                : mode === 'signup'
                  ? 'Creează cont'
                  : mode === 'recover'
                    ? 'Trimite instrucțiunile'
                    : 'Autentificare'}
            </button>
          </form>
          {google && (
            <a className="google-login" href="/api/auth/google">
              Continuă cu Google
            </a>
          )}
          {emailEnabled && (
            <div className="button-row">
              <button
                onClick={() => {
                  setMode(mode === 'signup' ? 'login' : 'signup');
                  setError('');
                  setMessage('');
                }}
              >
                {mode === 'signup' ? 'Am deja cont' : 'Creează un cont'}
              </button>
              {mode !== 'recover' && (
                <button onClick={() => setMode('recover')}>Am uitat parola</button>
              )}
            </div>
          )}
          {!emailEnabled && google && (
            <p className="muted">
              Pentru un cont nou, continuă cu Google. Autentificarea cu parolă este disponibilă
              pentru conturile existente.
            </p>
          )}
          <p className="muted">
            O pregătire = un document nou. Reluările automate și quiz-urile din documentele deja
            pregătite nu consumă alte încercări.
          </p>
        </section>
      </main>
    );
  return (
    <>
      <header className="account-bar">
        <span>{user.email}</span>
        <b>
          {user.is_admin ? 'Administrator · nelimitat' : `${user.credits} generări disponibile`}
        </b>
        {user.is_admin && (
          <button onClick={() => setAdmin(!admin)}>
            {admin ? 'Înapoi la documente' : 'Administrare'}
          </button>
        )}
        <button onClick={() => setPassword(true)}>Parolă</button>
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await authAction({ action: 'logout' });
              location.assign('/');
            } catch (e) {
              setError((e as Error).message);
              setBusy(false);
            }
          }}
        >
          Deconectare
        </button>
      </header>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!user.is_admin && user.credits === 0 && (
        <p className="notice account-notice">
          Ai folosit generările disponibile. Poți continua quiz-urile salvate; pentru un document
          nou, cere încercări administratorului.
        </p>
      )}
      {admin && <AdminPanel />}
      <div hidden={admin}>
        <Workspace accountId={user.id} />
      </div>
    </>
  );
}
