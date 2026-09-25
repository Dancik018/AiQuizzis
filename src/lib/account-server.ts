import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { accountErrors } from './account-errors';
export type Account = {
  id: string;
  email: string;
  is_admin: boolean;
  credits: number;
  disabled: boolean;
  must_change_password: boolean;
  created_at: string;
};
export async function authClient() {
  const url = process.env.SUPABASE_URL,
    key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error('AUTH_SETUP');
  const jar = await cookies();
  return createServerClient(url, key, {
    cookieOptions: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
    },
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (values) => {
        for (const { name, value, options } of values) jar.set(name, value, options);
      },
    },
  });
}
export async function account(req?: Request, allowPasswordChange = false) {
  const db = await authClient();
  const {
    data: { user },
    error,
  } = await db.auth.getUser();
  if (error || !user) throw new Error('AUTH_REQUIRED');
  if (!user.email_confirmed_at) throw new Error('EMAIL_UNVERIFIED');
  if (req?.headers.get('x-aiquiz-account') && req.headers.get('x-aiquiz-account') !== user.id)
    throw new Error('AUTH_REQUIRED');
  const result = await db
    .from('profiles')
    .select('id,email,is_admin,credits,disabled,must_change_password,created_at')
    .eq('id', user.id)
    .single();
  if (result.error || !result.data) throw new Error('AUTH_SETUP');
  const profile = result.data as Account;
  if (profile.disabled) throw new Error('ACCOUNT_BLOCKED');
  if (profile.must_change_password && !allowPasswordChange)
    throw new Error('PASSWORD_CHANGE_REQUIRED');
  return { db, user, profile };
}
export function checkDatabase(error: { message: string } | null) {
  if (!error) return;
  const code = Object.keys(accountErrors).find((c) => error.message.includes(c));
  throw new Error(code || 'AUTH_SETUP');
}
export const privateJSON = (value: unknown) =>
  Response.json(value, { headers: { 'Cache-Control': 'private, no-store' } });
export const appURL = () => (process.env.APP_URL || 'https://aiquizzis.online').replace(/\/+$/, '');
export async function requireDocument(
  req: Request,
  id: string,
  units: number,
  verified?: Awaited<ReturnType<typeof account>>,
) {
  const context = verified || (await account(req));
  const result = await context.db
    .from('documents')
    .select('data')
    .eq('user_id', context.user.id)
    .eq('id', id)
    .single();
  if (result.error || !result.data) throw new Error('DOCUMENT_NOT_FOUND');
  const claim = await context.db.rpc('claim_ai', { doc_id: id, units });
  checkDatabase(claim.error);
  return { ...context, document: result.data.data };
}
