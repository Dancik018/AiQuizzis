import { authClient, appURL } from '@/lib/account-server';
export async function GET(req: Request) {
  const url = new URL(req.url),
    code = url.searchParams.get('code');
  if (code) {
    try {
      const db = await authClient();
      const { error } = await db.auth.exchangeCodeForSession(code);
      if (!error)
        return Response.redirect(
          appURL() + (url.searchParams.get('next') === '/password' ? '/?changePassword=1' : '/'),
          303,
        );
    } catch {}
  }
  return Response.redirect(appURL() + '/?authError=1', 303);
}
