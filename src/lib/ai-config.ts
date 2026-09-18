export function apiKey() {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) throw new Error('AI_MISSING');
  if (!/^sk-[A-Za-z0-9_-]+$/.test(key)) throw new Error('AI_KEY_FORMAT');
  return key;
}

export function aiProviderName(): 'openai' | 'gemini' {
  const name =
    process.env.AI_PROVIDER?.trim() || (process.env.GEMINI_API_KEY ? 'gemini' : 'openai');
  if (name !== 'openai' && name !== 'gemini') throw new Error('AI_PROVIDER_INVALID');
  return name;
}

export function aiConfigured() {
  try {
    return Boolean(
      aiProviderName() === 'gemini'
        ? process.env.GEMINI_API_KEY?.trim()
        : process.env.OPENAI_API_KEY?.trim(),
    );
  } catch {
    return false;
  }
}
