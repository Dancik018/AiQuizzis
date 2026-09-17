export async function GET() {
  return Response.json({
    ai: Boolean(process.env.OPENAI_API_KEY),
    ocr: true,
    ocrProvider: 'browser',
    batchSize: Math.min(10, Math.max(1, Number(process.env.AI_BATCH_SIZE) || 10)),
  });
}
