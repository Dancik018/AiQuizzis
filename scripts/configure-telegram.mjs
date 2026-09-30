import { botCommands } from '../src/lib/telegram.ts';
const token = process.env.TELEGRAM_BOT_TOKEN;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
if (!token || !secret)
  throw new Error('Set TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET privately.');
async function api(method, data = {}) {
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
      signal: AbortSignal.timeout(15000),
    });
    const result = await r.json();
    if (!result.ok) throw new Error('Rejected');
    return result.result;
  } catch {
    throw new Error(`Telegram ${method} failed; credentials were not logged.`);
  }
}
const me = await api('getMe');
if (me.username?.toLowerCase() !== 'aiquizzis_bot') throw new Error('Unexpected bot identity.');
await api('setMyCommands', { commands: botCommands });
await api('setMyDescription', {
  description:
    '📚 Transformă documentele PDF și Word în quiz-uri interactive în română! Descoperă AiQuizzis, află despre încercări și intră direct pe aiquizzis.online. Începe cu /start.',
});
await api('setMyShortDescription', {
  short_description:
    '📚 Documentele tale, quiz-uri interactive. Informații și încercări AiQuizzis: aiquizzis.online',
});
await api('setChatMenuButton', { menu_button: { type: 'commands' } });
await api('setWebhook', {
  url: 'https://aiquizzis.online/api/telegram',
  secret_token: secret,
  allowed_updates: ['message'],
  max_connections: 5,
});
const info = await api('getWebhookInfo');
console.log(
  JSON.stringify({
    bot: me.username,
    webhook: info.url,
    pending: info.pending_update_count,
    commands: (await api('getMyCommands')).map((c) => c.command),
  }),
);
