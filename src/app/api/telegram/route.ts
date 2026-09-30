import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { telegramReply } from '@/lib/telegram';
export const runtime = 'nodejs';
const update = z.object({
  update_id: z.number().int(),
  message: z
    .object({
      chat: z.object({ id: z.number().int().safe(), type: z.string() }),
      from: z.object({ is_bot: z.boolean() }).optional(),
      text: z.string().max(4096).optional(),
    })
    .optional(),
});
export async function POST(req: Request) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret) return new Response(null, { status: 503 });
  const supplied = req.headers.get('x-telegram-bot-api-secret-token') || '';
  const expected = Buffer.from(secret),
    actual = Buffer.from(supplied);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
    return new Response(null, { status: 401 });
  // Read a bounded stream instead of trusting Content-Length.
  const reader = req.body?.getReader();
  if (!reader) return new Response(null, { status: 400 });
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 65536) {
      await reader.cancel();
      return new Response(null, { status: 413 });
    }
    chunks.push(value);
  }
  try {
    const result = update.safeParse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    if (!result.success) return new Response(null, { status: 200 });
    const message = result.data.message;
    if (!message || message.chat.type !== 'private' || message.from?.is_bot)
      return new Response(null, { status: 200 });
    // Telegram executes this method as the webhook response; no bot token is
    // required in the runtime and no messages or personal data are persisted.
    return Response.json({
      method: 'sendMessage',
      chat_id: message.chat.id,
      text: telegramReply(message.text || ''),
      link_preview_options: { is_disabled: true },
      reply_markup: {
        inline_keyboard: [[{ text: '🌐 Deschide AiQuizzis', url: 'https://aiquizzis.online' }]],
      },
    });
  } catch {
    return new Response(null, { status: 200 });
  }
}
