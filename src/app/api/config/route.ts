export async function GET() {
  return Response.json({
    ai: Boolean(process.env.OPENAI_API_KEY),
    ocr: Boolean(process.env.GOOGLE_VISION_API_KEY),
    batchSize: Math.min(10, Math.max(1, Number(process.env.AI_BATCH_SIZE) || 10)),
  });
}
