import { authClient, appURL } from '@/lib/account-server';
import { apiError } from '@/lib/api';
export async function GET() {
  try {
    if (process.env.GOOGLE_AUTH_ENABLED !== 'true')
      return Response.json(
        { error: 'Autentificarea Google nu este configurată.' },
        { status: 503 },
      );
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
