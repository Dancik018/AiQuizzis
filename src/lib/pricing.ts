// USD / million tokens; verified against official model documentation 2026-09-21.
// Unknown models intentionally have no estimate. Cached-input discounts are not estimated.
export const tokenPrices: Record<string, { input: number; output: number }> = {
  'gpt-5.6-luna': { input: 0.2, output: 1.2 },
};
export function estimatedCost(model: string, input: number, output: number) {
  const price = tokenPrices[model];
  return price ? (input * price.input + output * price.output) / 1_000_000 : undefined;
}
