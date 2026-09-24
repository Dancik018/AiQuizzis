import { z } from 'zod';
import { account, checkDatabase, privateJSON } from '@/lib/account-server';
import { body, apiError } from '@/lib/api';
export async function GET(req: Request) {
  try {
    const { db, profile } = await account(req);
    if (!profile.is_admin) throw new Error('ADMIN_REQUIRED');
    const url = new URL(req.url),
      page = Math.max(0, Math.min(10000, Number(url.searchParams.get('page')) || 0));
    const query = (url.searchParams.get('search') || '')
      .replace(/[^a-zA-Z0-9@._+-]/g, '')
      .slice(0, 100);
    let request = db
      .from('profiles')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(page * 25, page * 25 + 24);
    if (query) request = request.ilike('email', '%' + query + '%');
    const result = await request;
    checkDatabase(result.error);
    return privateJSON({ users: result.data, total: result.count });
  } catch (e) {
    return apiError(e);
  }
}
export async function POST(req: Request) {
  try {
    const { db, profile } = await account(req);
    if (!profile.is_admin) throw new Error('ADMIN_REQUIRED');
    const data = await body(
      req,
      z.object({
        id: z.uuid(),
        credits: z.number().int().min(0).max(1000).default(0),
        disabled: z.boolean().optional(),
      }),
      2048,
    );
    const result = await db.rpc('manage_account', {
      target: data.id,
      extra_credits: data.credits,
      blocked: data.disabled ?? null,
    });
    checkDatabase(result.error);
    return privateJSON({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
