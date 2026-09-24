import { z } from 'zod';
import { body, apiError } from '@/lib/api';
import { account, authClient, appURL, checkDatabase, privateJSON } from '@/lib/account-server';
const schema = z.object({
  action: z.enum(['login', 'signup', 'logout', 'recover', 'password']),
  email: z.email().max(254).optional(),
  password: z.string().min(12).max(128).optional(),
});
export async function POST(req: Request) {
  try {
    const data = await body(req, schema, 4096);
    const db = await authClient();
    if (data.action === 'logout') {
      await db.auth.signOut();
      return privateJSON({ ok: true });
    }
    if (data.action === 'password') {
      if (!data.password) throw new Error('INVALID_DATA');
      await account(req, true);
      const updated = await db.auth.updateUser({ password: data.password });
      if (updated.error)
        return Response.json(
          {
            error: 'Parola nu a putut fi schimbată. Alege o parolă nouă, de minimum 12 caractere.',
          },
          { status: 400 },
        );
      const finished = await db.rpc('finish_password_change');
      checkDatabase(finished.error);
      return privateJSON({ ok: true });
    }
    if (!data.email) throw new Error('INVALID_DATA');
    const email = data.email.trim().toLowerCase();
    if (
      (data.action === 'recover' || data.action === 'signup') &&
      process.env.EMAIL_AUTH_ENABLED !== 'true' &&
      email !== 'ursud09@gmail.com'
    )
      return Response.json(
        {
          error: 'Înregistrarea și recuperarea prin email nu sunt configurate. Continuă cu Google.',
        },
        { status: 503 },
      );
    if (data.action === 'recover') {
      await db.auth.resetPasswordForEmail(email, {
        redirectTo: appURL() + '/auth/callback?next=/password',
      });
      return privateJSON({
        message: 'Dacă adresa are un cont, vei primi instrucțiunile de recuperare.',
      });
    }
    if (!data.password) throw new Error('INVALID_DATA');
    if (data.action === 'signup') {
      if (email === 'ursud09@gmail.com')
        return Response.json(
          { error: 'Această adresă nu este disponibilă pentru înregistrare.' },
          { status: 400 },
        );
      const result = await db.auth.signUp({
        email,
        password: data.password,
        options: { emailRedirectTo: appURL() + '/auth/callback' },
      });
      if (result.error)
        return Response.json(
          { error: 'Înregistrarea nu a reușit. Verifică datele sau încearcă mai târziu.' },
          { status: 400 },
        );
      return privateJSON({
        message: 'Verifică emailul și confirmă adresa pentru a activa cele două generări gratuite.',
      });
    }
    const result = await db.auth.signInWithPassword({ email, password: data.password });
    if (result.error)
      return Response.json(
        { error: 'Emailul sau parola nu sunt corecte, ori adresa nu este confirmată.' },
        { status: 401 },
      );
    return privateJSON({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}

export async function GET() {
  return privateJSON({
    google: process.env.GOOGLE_AUTH_ENABLED === 'true',
    email: process.env.EMAIL_AUTH_ENABLED === 'true',
    configured: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_PUBLISHABLE_KEY),
  });
}
