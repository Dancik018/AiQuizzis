export const botCommands = [
  { command: 'start', description: 'Bun venit și meniul principal' },
  { command: 'info', description: 'Descoperă AiQuizzis' },
  { command: 'price', description: 'Prețuri și încercări suplimentare' },
  { command: 'web', description: 'Deschide aiquizzis.online' },
  { command: 'link', description: 'Link direct către site' },
  { command: 'help', description: 'Cum folosești botul' },
  { command: 'buy', description: 'Alege un pachet de încercări' },
  { command: 'groupid', description: 'Află ID-ul grupului de administrare' },
];
const info =
  '📚 Învață activ cu AiQuizzis! Transformă documentele PDF și Word în quiz-uri interactive în limba română. Exersează, descoperă ce mai ai de repetat și urmărește-ți progresul.\n\n🌐 https://aiquizzis.online';
const price =
  '🎟 Pachete AiQuizzis\n\n1 încercare — 20 lei\n7 încercări — 100 lei\n20 încercări — 200 lei\n\nUn cont nou primește 2 încercări gratuite. O încercare pregătește un document nou; reluarea quiz-urilor deja pregătite nu consumă alte încercări.\n\nApasă Cumpără pentru a alege pachetul. Cererea se trimite administratorului; plata și activarea sunt confirmate separat.';
export function telegramReply(text: string) {
  const command = text.trim().split(/\s+/)[0].split('@')[0].toLowerCase();
  if (command === '/info') return info;
  if (command === '/price' || /preț|pret|cump|procur|încerc|incerc|cost|tarif/i.test(text))
    return price;
  if (command === '/web' || command === '/link')
    return '🌐 Deschide AiQuizzis: https://aiquizzis.online\nConectează-te și transformă documentele tale în quiz-uri!';
  if (command === '/start')
    return (
      '👋 Bun venit la AiQuizzis!\n\n' +
      info +
      '\n\nAflă despre încercări cu /price sau vezi toate comenzile cu /help.'
    );
  if (command === '/help')
    return (
      botCommands.map((c) => `/${c.command} — ${c.description}`).join('\n') +
      '\n\nPentru cumpărare: /buy, alege pachetul și răspunde cu emailul contului. Emailul și contactul Telegram sunt trimise administratorului. Nu trimite parole sau date bancare.'
    );
  return '👋 Te pot ajuta cu informații despre AiQuizzis și încercări.\n\n/info — Despre platformă\n/price — Încercări și prețuri\n/buy — Cumpără încercări\n/web — Deschide site-ul\n/help — Toate comenzile';
}
