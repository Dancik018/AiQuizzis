import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { telegramReply } from '@/lib/telegram';
export const runtime = 'nodejs';
const person = z.object({
  id: z.number().int().safe(),
  is_bot: z.boolean(),
  username: z.string().optional(),
});
const messageSchema = z.object({
  message_id: z.number().int().optional(),
  chat: z.object({ id: z.number().int().safe(), type: z.string() }),
  from: person.optional(),
  text: z.string().max(4096).optional(),
  reply_to_message: z.object({ text: z.string().optional(), from: person.optional() }).optional(),
});
const update = z.object({
  update_id: z.number().int(),
  message: messageSchema.optional(),
  callback_query: z
    .object({
      id: z.string(),
      from: person,
      data: z.string().optional(),
      message: messageSchema.optional(),
    })
    .optional(),
});
const packages: Record<string, number> = { '1': 20, '7': 100, '20': 200 };
const menu = {
  inline_keyboard: [
    [{ text: '🛒 Cumpără', callback_data: 'buy' }],
    [{ text: '🌐 Deschide AiQuizzis', url: 'https://aiquizzis.online' }],
  ],
};
const choices = {
  inline_keyboard: Object.entries(packages).map(([n, price]) => [
    { text: `${n} încercări — ${price} lei`, callback_data: `pack:${n}` },
  ]),
};
const prompt = (pack: string) =>
  `Pachet: ${pack} încercări — ${packages[pack]} lei.\n\nRăspunde la acest mesaj cu adresa Gmail/email cu care te-ai conectat pe aiquizzis.online. Emailul, pachetul și contactul tău Telegram vor fi trimise administratorului în grupul de comenzi. Cererea nu confirmă plata.\n\nPentru a renunța, nu trimite emailul. /buy — alege alt pachet.`;
const completed = new Map<number, number>();
async function telegram(method: string, data: unknown) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('Telegram unavailable');
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
    signal: AbortSignal.timeout(8000),
  });
  const result = await response.json();
  if (!result.ok) throw new Error('Telegram unavailable');
}
export async function POST(req: Request) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret) return new Response(null, { status: 503 });
  const expected = Buffer.from(secret),
    actual = Buffer.from(req.headers.get('x-telegram-bot-api-secret-token') || '');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
    return new Response(null, { status: 401 });
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
  let parsed: z.infer<typeof update>;
  try {
    parsed = update.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
  } catch {
    return new Response(null, { status: 200 });
  }
  const message = parsed.message;
  const reply = (chat: number, text: string, markup: unknown = menu) =>
    Response.json({
      method: 'sendMessage',
      chat_id: chat,
      text,
      link_preview_options: { is_disabled: true },
      reply_markup: markup,
    });
  const group = process.env.TELEGRAM_ADMIN_CHAT_ID;
  const configured = !!process.env.TELEGRAM_BOT_TOKEN && !!group && /^-\d+$/.test(group);
  const unavailable =
    'Preluarea cererilor este în curs de configurare. Pachetele sunt afișate la /price. Revino în curând.';
  try {
    const cb = parsed.callback_query;
    if (cb) {
      if (
        cb.from.is_bot ||
        cb.message?.chat.type !== 'private' ||
        cb.message.chat.id !== cb.from.id
      )
        return new Response(null, { status: 200 });
      await telegram('answerCallbackQuery', { callback_query_id: cb.id });
      if (!configured) return reply(cb.from.id, unavailable);
      if (cb.data === 'buy') return reply(cb.from.id, 'Alege pachetul dorit:', choices);
      const pack = cb.data?.replace(/^pack:/, '') || '';
      if (cb.data?.startsWith('pack:') && Object.hasOwn(packages, pack))
        return reply(cb.from.id, prompt(pack), {
          force_reply: true,
          input_field_placeholder: 'Emailul contului AiQuizzis',
        });
      return reply(cb.from.id, 'Folosește /buy pentru a alege un pachet.');
    }
    if (!message || message.from?.is_bot) return new Response(null, { status: 200 });
    const command = (message.text || '').trim().split(/\s+/)[0].split('@')[0].toLowerCase();
    if (message.chat.type !== 'private') {
      if (command === '/groupid' && ['group', 'supergroup'].includes(message.chat.type))
        return reply(
          message.chat.id,
          `ID-ul acestui grup: ${message.chat.id}\nTrimite acest ID persoanei care configurează botul.`,
          { inline_keyboard: [] },
        );
      return new Response(null, { status: 200 });
    }
    if (command === '/buy')
      return reply(
        message.chat.id,
        configured ? 'Alege pachetul dorit:' : unavailable,
        configured ? choices : menu,
      );
    if (command === '/groupid')
      return reply(message.chat.id, 'Adaugă botul în grupul tău și scrie acolo /groupid.');
    const original = message.reply_to_message;
    if (!command.startsWith('/') && original?.text?.startsWith('Pachet: ')) {
      if (!configured) return reply(message.chat.id, unavailable);
      const pack = original.text.match(/^Pachet: (1|7|20) încercări — /)?.[1];
      // Only accept a reply to our own bot's exact prompt in this private chat.
      if (
        !pack ||
        original.text !== prompt(pack) ||
        !original.from?.is_bot ||
        String(original.from.id) !== process.env.TELEGRAM_BOT_TOKEN?.split(':')[0] ||
        message.from?.id !== message.chat.id
      )
        return reply(message.chat.id, 'Selecția nu este validă. Începe din nou cu /buy.');
      const email = (message.text || '').trim().toLowerCase();
      if (!z.email().max(254).safeParse(email).success)
        return reply(
          message.chat.id,
          'Adresa de email nu este validă. Răspunde din nou la mesajul cu pachetul ales sau folosește /buy.',
        );
      for (const [id, expires] of completed) if (expires < Date.now()) completed.delete(id);
      const orderId = `AQ-${message.chat.id}-${message.message_id ?? parsed.update_id}`;
      if (!completed.has(parsed.update_id)) {
        await telegram('sendMessage', {
          chat_id: group,
          text: `🛒 Cerere ${orderId}\nPachet: ${pack} încercări\nPreț: ${packages[pack]} lei\nEmail cont: ${email}\nTelegram: ${message.from.username ? '@' + message.from.username : 'fără username'}\nID Telegram: ${message.from.id}\n\nStatus: NEPLĂTIT / de contactat. Verifică plata și contul înainte de a acorda încercări. Nu procesa de două ori același ID de cerere.`,
          link_preview_options: { is_disabled: true },
        });
        completed.set(parsed.update_id, Date.now() + 3600000);
      }
      return reply(
        message.chat.id,
        `✅ Cererea ${orderId} a fost trimisă administratorului.\n${pack} încercări — ${packages[pack]} lei\nEmail: ${email}\n\nAșteaptă confirmarea și instrucțiunile de plată. Încercările nu au fost încă adăugate.`,
      );
    }
    return reply(message.chat.id, telegramReply(message.text || ''));
  } catch {
    return new Response(null, { status: 503 });
  }
}
