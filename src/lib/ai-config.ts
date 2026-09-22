export type ProviderName = 'openai';
export function apiKey() {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) throw new Error('AI_MISSING');
  if (!/^sk-[A-Za-z0-9_-]+$/.test(key)) throw new Error('AI_KEY_FORMAT');
  return key;
}
export const aiProviderName = (): ProviderName => 'openai';
export const aiConfigured = () => Boolean(process.env.OPENAI_API_KEY?.trim());
export const availableProviders = (): ProviderName[] => (aiConfigured() ? ['openai'] : []);
