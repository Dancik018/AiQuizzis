'use client';
/* Full reload deliberately clears per-account caches and pending UI work on identity changes. */
/* eslint-disable @next/next/no-location-assign-relative-destination */
import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { BookOpen, ArrowLeft } from 'lucide-react';
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
    [password, setPassword] = useState(false),
    [showLogin, setShowLogin] = useState(false);
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
    if (new URLSearchParams(location.search).has('authError')) {
      setError('Linkul de autentificare nu este valid sau a expirat.');
      setShowLogin(true);
    }
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
  if (!user && !showLogin)
    return (
      <>
        <header className="account-bar">
          <span>Două pregătiri gratuite pentru fiecare cont nou</span>
          <button onClick={() => setShowLogin(true)}>Autentificare / Creează cont</button>
        </header>
        <Workspace
          accountId=""
          onRequireAccount={() => {
            setMessage(
              'Ai nevoie de un cont pentru a încărca documente și a genera quiz-uri. Autentifică-te sau creează un cont cu Google.',
            );
            setShowLogin(true);
          }}
        />
      </>
    );
  if (!user)
    return (
      <main className="auth-shell login-shell">
        <div className="login-layout">
          <button
            className="auth-back"
            type="button"
            onClick={() => {
              setShowLogin(false);
              setMessage('');
            }}
          >
            <ArrowLeft size={17} aria-hidden="true" /> Înapoi la pagina principală
          </button>
          <section className="auth-card login-card" aria-labelledby="login-title">
            <div className="auth-brand">
              <span className="auth-brand-icon">
                <BookOpen size={23} aria-hidden="true" />
              </span>
              <span>AIQuiz</span>
            </div>
            <h1 id="login-title">
              {mode === 'signup'
                ? 'Creează un cont'
                : mode === 'recover'
                  ? 'Recuperează accesul'
                  : 'Bine ai revenit'}
            </h1>
            <p className="auth-intro">
              {mode === 'recover'
                ? 'Introdu adresa de email pentru a recupera accesul.'
                : 'Conectează-te pentru a continua cu documentele și quiz-urile tale.'}
            </p>
            {message && (
              <p className="notice auth-message" role="status">
                {message}
              </p>
            )}
            {google && mode !== 'recover' && (
              <>
                <a className="google-login" href="/api/auth/google">
                  <span className="google-letter" aria-hidden="true">
                    G
                  </span>
                  Continuă cu Google
                </a>
                <div className="auth-divider">
                  <span>sau cu email</span>
                </div>
              </>
            )}
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
                <input
                  name="email"
                  placeholder="nume@exemplu.ro"
                  type="email"
                  autoComplete="email"
                  maxLength={254}
                  required
                />
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
                  {mode === 'signup' && <small>Minimum 12 caractere.</small>}
                </label>
              )}
              {error && (
                <p className="error" role="alert">
                  {error}
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
              <p className="auth-signup">
                Nu ai cont? <a href="/api/auth/google">Creează unul cu Google</a>
              </p>
            )}
            <div className="auth-benefit">
              <strong>Primele două documente sunt gratuite.</strong>
              <span>Quiz-urile din documentele pregătite pot fi reluate fără alte încercări.</span>
            </div>
          </section>
          <a className="auth-privacy" href="/privacy">
            Cum sunt folosite datele tale
          </a>
        </div>
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
