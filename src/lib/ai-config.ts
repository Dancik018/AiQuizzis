export function apiKey() {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) throw new Error('AI_MISSING');
  if (!/^sk-[A-Za-z0-9_-]+$/.test(key)) throw new Error('AI_KEY_FORMAT');
  return key;
}

export type ProviderName = 'groq' | 'gemini' | 'openai';
export function aiProviderName(): ProviderName {
  const name =
    process.env.AI_PROVIDER?.trim() ||
    (process.env.GROQ_API_KEY ? 'groq' : process.env.GEMINI_API_KEY ? 'gemini' : 'openai');
  if (name !== 'openai' && name !== 'gemini' && name !== 'groq')
    throw new Error('AI_PROVIDER_INVALID');
  return name;
}

export function aiConfigured() {
  try {
    return Boolean(
      aiProviderName() === 'groq'
        ? process.env.GROQ_API_KEY?.trim()
        : aiProviderName() === 'gemini'
          ? process.env.GEMINI_API_KEY?.trim()
          : process.env.OPENAI_API_KEY?.trim(),
    );
  } catch {
    return false;
  }
}

export function availableProviders(): ProviderName[] {
  const primary = aiProviderName();
  const enabled = (name: ProviderName) =>
    Boolean(
      process.env[
        name === 'groq' ? 'GROQ_API_KEY' : name === 'gemini' ? 'GEMINI_API_KEY' : 'OPENAI_API_KEY'
      ]?.trim(),
    );
  return [...new Set([primary, ...(['groq', 'gemini'] as ProviderName[])])].filter(enabled);
}
