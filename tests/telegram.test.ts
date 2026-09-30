import test from 'node:test';
import assert from 'node:assert/strict';
import { telegramReply, botCommands } from '../src/lib/telegram';
import { POST } from '../src/app/api/telegram/route';
test('Telegram webhook rejects unauthenticated traffic and responds only in private chats', async () => {
  process.env.TELEGRAM_WEBHOOK_SECRET = 'local-test-secret';
  const request = (chatType: string, secret = 'local-test-secret') =>
    new Request('https://example.test/api/telegram', {
      method: 'POST',
      headers: { 'x-telegram-bot-api-secret-token': secret },
      body: JSON.stringify({
        update_id: 1,
        message: { chat: { id: 123, type: chatType }, text: '/web' },
      }),
    });
  try {
    assert.equal((await POST(request('private', 'wrong'))).status, 401);
    assert.equal(await (await POST(request('group'))).text(), '');
    const reply = await (await POST(request('private'))).json();
    assert.equal(reply.method, 'sendMessage');
    assert.equal(reply.chat_id, 123);
    assert.equal(reply.reply_markup.inline_keyboard[0][0].url, 'https://aiquizzis.online');
  } finally {
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
  }
});
test('Telegram commands give real site information without inventing purchase availability', () => {
  for (const c of botCommands) assert.ok(telegramReply('/' + c.command).length > 20);
  assert.match(telegramReply('/web@AiQuizzis_bot'), /https:\/\/aiquizzis.online/);
  assert.match(telegramReply('Vreau să procur încercări'), /nu preia comenzi sau plăți/);
  assert.match(telegramReply('/price'), /2 încercări gratuite/);
  assert.match(telegramReply('salut'), /\/help/);
});
