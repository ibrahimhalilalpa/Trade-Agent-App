import Groq from 'groq-sdk';

const groq = process.env.GROQ_API_KEY ? new Groq({ apiKey: process.env.GROQ_API_KEY }) : null;
const MODEL = 'llama-3.3-70b-versatile';
const TIMEOUT_MS = 8_000;

export async function analyzeWithGroq(prompt: string, modelName: string = MODEL): Promise<string> {
    if (!groq) return '';

    try {
        const request = groq.chat.completions.create({
            messages: [{ role: 'user', content: prompt }], model: modelName, temperature: 0.2,
        });
        const completion = await Promise.race([
            request,
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Groq timeout')), TIMEOUT_MS)),
        ]);

        return completion.choices[0]?.message?.content || '';
    } catch {
        return '';
    }
}