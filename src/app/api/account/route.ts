import { account, privateJSON } from '@/lib/account-server';
import { apiError } from '@/lib/api';
export async function GET(req: Request) {
  try {
    const { profile } = await account(req, true);
    return privateJSON({ user: profile, google: process.env.GOOGLE_AUTH_ENABLED === 'true' });
  } catch (e) {
    return apiError(e);
  }
}
