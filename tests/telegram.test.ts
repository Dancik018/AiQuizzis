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
        message: { chat: { id: 123, type: chatType }, text: '/link' },
      }),
    });
  try {
    assert.equal((await POST(request('private', 'wrong'))).status, 401);
    assert.equal(await (await POST(request('group'))).text(), '');
    const reply = await (await POST(request('private'))).json();
    assert.equal(reply.method, 'sendMessage');
    assert.equal(reply.chat_id, 123);
    assert.equal(reply.reply_markup.inline_keyboard[1][0].url, 'https://aiquizzis.online');
  } finally {
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
  }
});

test('purchase selection validates email and forwards only to configured admin group', async () => {
  process.env.TELEGRAM_WEBHOOK_SECRET = 'test';
  process.env.TELEGRAM_BOT_TOKEN = '999:test';
  process.env.TELEGRAM_ADMIN_CHAT_ID = '-555';
  const oldFetch = globalThis.fetch;
  const sent: { chat_id?: string; text?: string }[] = [];
  globalThis.fetch = async (_url, init) => {
    sent.push(JSON.parse(String(init?.body)));
    return Response.json({ ok: true });
  };
  const call = async (value: unknown) =>
    POST(
      new Request('https://example.test/api/telegram', {
        method: 'POST',
        headers: { 'x-telegram-bot-api-secret-token': 'test' },
        body: JSON.stringify(value),
      }),
    );
  try {
    const user = { id: 123, is_bot: false, username: 'buyer' };
    const chat = { id: 123, type: 'private' };
    const selection = await (
      await call({
        update_id: 2,
        callback_query: { id: 'cb', from: user, data: 'pack:7', message: { chat } },
      })
    ).json();
    assert.match(selection.text, /7 încercări — 100 lei/);
    assert.equal(selection.reply_markup.force_reply, true);
    const answer = (text: string, bot = 999) => ({
      update_id: 3,
      message: {
        message_id: 42,
        chat,
        from: user,
        text,
        reply_to_message: { text: selection.text, from: { id: bot, is_bot: true } },
      },
    });
    await call(answer('invalid'));
    await call(answer('user@example.com', 998));
    assert.equal(sent.filter((x) => x.chat_id).length, 0);
    const receipt = await (await call(answer('user@example.com'))).json();
    assert.match(receipt.text, /trimisă la administrare/);
    await call(answer('user@example.com'));
    const orders = sent.filter((x) => x.chat_id);
    assert.equal(orders.length, 1);
    assert.equal(orders[0].chat_id, '-555');
    assert.match(orders[0].text!, /NEPLĂTIT/);
    assert.match(orders[0].text!, /user@example.com/);
  } finally {
    globalThis.fetch = oldFetch;
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_ADMIN_CHAT_ID;
  }
});
test('Telegram commands give real site information without inventing purchase availability', () => {
  for (const c of botCommands) assert.ok(telegramReply('/' + c.command).length > 20);
  assert.match(telegramReply('/link@AiQuizzis_bot'), /https:\/\/aiquizzis.online/);
  assert.match(telegramReply('Vreau să procur încercări'), /20 încercări — 200 lei/);
  assert.match(telegramReply('/price'), /2 încercări gratuite/);
  assert.match(telegramReply('salut'), /\/help/);
});
