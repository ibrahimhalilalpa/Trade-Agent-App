import { GoogleGenAI } from '@google/genai';

const ai = process.env.GEMINI_API_KEY ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }) : null;
const MODEL = 'gemini-2.0-flash';
const TIMEOUT_MS = 8_000;

export async function analyzeWithGemini(prompt: string, imageBase64?: string): Promise<string> {
    if (!ai) return '';

    try {
        const request = imageBase64
            ? ai.models.generateContent({
                model: MODEL,
                contents: [{ role: 'user', parts: [{ text: prompt }, { inlineData: { mimeType: 'image/png', data: imageBase64 } }] }],
            })
            : ai.models.generateContent({ model: MODEL, contents: prompt });

        const response = await Promise.race([
            request,
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Gemini timeout')), TIMEOUT_MS)),
        ]);
        return response.text ?? '';
    } catch {
        return '';
    }
}