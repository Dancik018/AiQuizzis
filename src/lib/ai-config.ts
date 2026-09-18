export function apiKey() {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) throw new Error('AI_MISSING');
  if (!/^sk-[A-Za-z0-9_-]+$/.test(key)) throw new Error('AI_KEY_FORMAT');
  return key;
}
