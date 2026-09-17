import { z } from 'zod';
import { body, apiError } from '@/lib/api';
export const runtime = 'nodejs';
export const maxDuration = 60;
export async function POST(req: Request) {
  try {
    const data = await body(
      req,
      z.object({
        image: z
          .string()
          .min(10)
          .max(3500000)
          .regex(/^[A-Za-z0-9+/=]+$/),
      }),
      3600000,
    );
    if (!process.env.GOOGLE_VISION_API_KEY) throw new Error('OCR_MISSING');
    const response = await fetch('https://vision.googleapis.com/v1/images:annotate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': process.env.GOOGLE_VISION_API_KEY,
      },
      body: JSON.stringify({
        requests: [
          {
            image: { content: data.image },
            features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
            imageContext: { languageHints: ['ro'] },
          },
        ],
      }),
      signal: AbortSignal.timeout(45000),
    });
    if (!response.ok) throw new Error('OCR_FAILED');
    const result = await response.json();
    if (result.responses?.[0]?.error) throw new Error('OCR_FAILED');
    return Response.json({ text: result.responses?.[0]?.fullTextAnnotation?.text || '' });
  } catch (error) {
    return apiError(error);
  }
}
