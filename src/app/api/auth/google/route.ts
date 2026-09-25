import { authClient, appURL } from '@/lib/account-server';
import { apiError } from '@/lib/api';
export async function GET(req: Request) {
  try {
    if (process.env.GOOGLE_AUTH_ENABLED !== 'true')
      return Response.json(
        { error: 'Autentificarea Google nu este configurată.' },
        { status: 503 },
      );
    // Keep the PKCE cookie and OAuth callback on the same origin.
    const canonical = new URL(appURL());
    if (req.headers.get('host') !== canonical.host)
      return Response.redirect(new URL('/api/auth/google', canonical), 303);
    const db = await authClient();
    const { data, error } = await db.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: appURL() + '/auth/callback', skipBrowserRedirect: true },
    });
    if (error || !data.url) throw new Error('AUTH_SETUP');
    return Response.redirect(data.url, 303);
  } catch (e) {
    return apiError(e);
  }
}
