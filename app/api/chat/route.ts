import { NextResponse } from 'next/server';
import { analyzeWithGemini } from '@/lib/ai/gemini';
import { analyzeWithGroq } from '@/lib/ai/groq';
import type { AgentAnalysis, HistoricalStats, Indicators, MarketNews } from '@/lib/types';

type ChatBody = { symbol?: unknown; question?: unknown; price?: unknown; indicators?: Indicators; history?: HistoricalStats; news?: MarketNews[]; analyses?: AgentAnalysis[]; messages?: Array<{ role?: unknown; text?: unknown }> };

export async function POST(req: Request) {
    try {
        const body = await req.json() as ChatBody;
        const symbol = typeof body.symbol === 'string' ? body.symbol.toUpperCase() : 'BİST hissesi';
        const question = typeof body.question === 'string' ? body.question.trim() : '';
        if (!question) return NextResponse.json({ error: 'Bir soru yazın.' }, { status: 400 });
        const conversation = (body.messages ?? []).slice(-8).map((message) => `${message.role === 'user' ? 'Kullanıcı' : 'Asistan'}: ${typeof message.text === 'string' ? message.text : ''}`).join('\n');
        const context = `Sembol: ${symbol}; fiyat: ${body.price ?? 'bilinmiyor'} TL; indikatörler: ${JSON.stringify(body.indicators ?? {})}; geçmiş: ${JSON.stringify(body.history ?? {})}; haberler: ${(body.news ?? []).slice(0, 8).map((item) => item.title).join(' | ')}; mevcut ajan özetleri: ${(body.analyses ?? []).map((item) => `${item.agentName}: ${item.action}, ${item.reasoning}`).join(' | ')}`;
        const prompt = `Sen BİST konusunda deneyimli, bağlamı takip eden bir araştırma asistanısın. ${context}\nÖnceki sohbet:\n${conversation || 'Bu ilk soru.'}\nKullanıcının yeni sorusu: ${question}\nÖnceki mesajlarla çelişme; soru yeni bir konu açıyorsa doğrudan onu yanıtla. Yanıtı Türkçe ver. Veriye dayalı olanı varsayımdan ayır, mümkünse fiyat seviyesi/zaman ufku/risk koşuluyla somutlaştır. Yatırım tavsiyesi verme; eğitim ve karar desteği sun.`;
        const answer = (await analyzeWithGemini(prompt)) || (await analyzeWithGroq(prompt));
        return NextResponse.json({ success: true, answer: answer || `${symbol} için bu soruyu yanıtlayacak AI sağlayıcısı şu anda erişilebilir değil. Mevcut fiyat, teknik seviyeler ve haber akışını birlikte kontrol edin.` });
    } catch {
        return NextResponse.json({ error: 'AI sohbeti şu anda yanıt veremiyor.' }, { status: 502 });
    }
}
