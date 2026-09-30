import { NextResponse } from 'next/server';
import { analyzeWithGemini } from '@/lib/ai/gemini';
import { analyzeWithGroq } from '@/lib/ai/groq';
import type { AgentAnalysis, AnalysisMethod, Candle, DrawingLine, HistoricalStats, Indicators, MarketNews, PriceForecast } from '@/lib/types';

const METHODS: AnalysisMethod[] = ['SUPPORT_RESISTANCE', 'FIBONACCI', 'TREND', 'MOVING_AVERAGES', 'RSI_MACD', 'BOLLINGER_BANDS', 'VOLUME_BREAKOUT'];
const METHOD_GUIDANCE: Record<AnalysisMethod, string> = {
    SUPPORT_RESISTANCE: 'Yatay destek/direnç tepki bölgeleri, kırılım kapanışı ve retest kalitesini incele.',
    FIBONACCI: 'Son belirgin salınımın Fibonacci 0.382, 0.5 ve 0.618 geri çekilme bölgelerini değerlendir.',
    TREND: 'Trend yönü, kanal yapısı, daha yüksek dip/tepe dizilimi ve kırılım/retest davranışını değerlendir.',
    MOVING_AVERAGES: 'SMA20/50/200 sıralaması, fiyatın ortalamalara göre konumu ve kesişimlerin gecikmeli doğasını değerlendir.',
    RSI_MACD: 'RSI aşırı alım/satım seviyeleri, MACD histogram yönü ve iki momentum göstergesinin teyit/uyumsuzluğunu incele.',
    BOLLINGER_BANDS: '20 dönem Bollinger üst/orta/alt bantlarını, volatilite sıkışmasını ve bant dışı kapanışların teyit ihtiyacını değerlendir.',
    VOLUME_BREAKOUT: 'Son 20 tamamlanmış mumun tepe/dip seviyelerini ve son hacmin önceki 20 mum ortalamasına oranını kırılım teyidi için kullan.',
};

type AnalysisBody = { symbol?: unknown; price?: unknown; method?: unknown; timeframe?: unknown; indicators?: Partial<Indicators>; history?: Partial<HistoricalStats>; news?: MarketNews[]; candles?: Candle[] };

function methodContext(method: AnalysisMethod, candles: Candle[], indicators: Indicators): { summary: string; drawings: DrawingLine[] } {
    const completed = candles.filter((candle) => Number.isFinite(candle.close) && Number.isFinite(candle.volume));
    const last20 = completed.slice(-20);
    if (method === 'BOLLINGER_BANDS' && last20.length >= 20) {
        const closes = last20.map((candle) => candle.close);
        const average = closes.reduce((sum, value) => sum + value, 0) / closes.length;
        const deviation = Math.sqrt(closes.reduce((sum, value) => sum + (value - average) ** 2, 0) / closes.length);
        const upper = Number((average + deviation * 2).toFixed(2));
        const lower = Number((average - deviation * 2).toFixed(2));
        return {
            summary: `Bollinger(20,2) üst/orta/alt: ${upper}/${average.toFixed(2)}/${lower} TL.`,
            drawings: [
                { title: 'Bollinger üst', price: upper, color: '#fb7185', style: 2 },
                { title: 'Bollinger orta', price: Number(average.toFixed(2)), color: '#f4c95d', style: 1 },
                { title: 'Bollinger alt', price: lower, color: '#34d399', style: 2 },
            ],
        };
    }
    if (method === 'VOLUME_BREAKOUT' && completed.length >= 21) {
        const reference = completed.slice(-21, -1);
        const recent = reference.slice(-20);
        const high = Math.max(...recent.map((candle) => candle.high));
        const low = Math.min(...recent.map((candle) => candle.low));
        const averageVolume = recent.reduce((sum, candle) => sum + candle.volume, 0) / recent.length;
        const currentVolume = completed.at(-1)?.volume ?? 0;
        return {
            summary: `Önceki 20 mum tepe/dip: ${high.toFixed(2)}/${low.toFixed(2)} TL; son mum hacmi / 20 mum ortalaması: ${averageVolume > 0 ? (currentVolume / averageVolume).toFixed(2) : 'veri yok'}x.`,
            drawings: [
                { title: '20 mum tepe', price: high, color: '#fb7185', style: 2 },
                { title: '20 mum dip', price: low, color: '#34d399', style: 2 },
            ],
        };
    }
    if (method === 'RSI_MACD') {
        const state = indicators.rsi >= 70 ? 'aşırı alım bölgesinde'
            : indicators.rsi <= 30 ? 'aşırı satım bölgesinde' : 'nötr momentum aralığında';
        return {
            summary: `RSI ${indicators.rsi.toFixed(1)} (${state}); MACD histogram ${indicators.macdHistogram >= 0 ? 'pozitif' : 'negatif'} ve ${indicators.macdHistogram.toFixed(3)}.`,
            drawings: [],
        };
    }
    return { summary: METHOD_GUIDANCE[method], drawings: [] };
}

function numberValue(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function rangeValue(value: unknown, fallback: [number, number]): [number, number] {
    if (!Array.isArray(value) || value.length !== 2 || value.some((item) => typeof item !== 'number' || !Number.isFinite(item))) return fallback;
    return [value[0] as number, value[1] as number];
}

function stringList(value: unknown, fallback: string[]): string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').slice(0, 5) : fallback;
}

function forecastList(value: unknown, fallback: PriceForecast[]): PriceForecast[] {
    if (!Array.isArray(value)) return fallback;
    const forecasts = value.flatMap((item) => {
        if (typeof item !== 'object' || item === null) return [];
        const forecast = item as Partial<PriceForecast>;
        if (typeof forecast.horizon !== 'string') return [];
        return [{
            horizon: forecast.horizon,
            low: numberValue(forecast.low, 0),
            expected: numberValue(forecast.expected, 0),
            high: numberValue(forecast.high, 0),
            confidence: Math.max(0, Math.min(100, numberValue(forecast.confidence, 0))),
        }];
    });
    const distinctExpectedPrices = new Set(forecasts.map((forecast) => forecast.expected.toFixed(2))).size >= 3;
    const wideningUncertainty = forecasts[5]?.high - forecasts[5]?.low > forecasts[0]?.high - forecasts[0]?.low;
    return forecasts.length === 6 && forecasts.every((forecast) => forecast.low > 0 && forecast.expected > 0 && forecast.high > forecast.expected && forecast.low < forecast.expected) && distinctExpectedPrices && wideningUncertainty ? forecasts : fallback;
}

function parseAgent(raw: string, fallback: AgentAnalysis): AgentAnalysis {
    try {
        const clean = raw.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
        const parsed = JSON.parse(clean) as Partial<AgentAnalysis>;
        const action = parsed.action === 'AL' || parsed.action === 'SAT' || parsed.action === 'TUT' ? parsed.action : fallback.action;
        const drawings = Array.isArray(parsed.drawings) ? parsed.drawings.filter((drawing): drawing is DrawingLine => (
            typeof drawing === 'object' && drawing !== null && typeof (drawing as DrawingLine).title === 'string' &&
            typeof (drawing as DrawingLine).price === 'number' && typeof (drawing as DrawingLine).color === 'string'
        )) : fallback.drawings;
        const scenarios = typeof parsed.scenarios === 'object' && parsed.scenarios !== null ? parsed.scenarios : fallback.scenarios;
        return {
            ...fallback, ...parsed,
            agentName: typeof parsed.agentName === 'string' ? parsed.agentName : fallback.agentName,
            action, targetPrice: numberValue(parsed.targetPrice, fallback.targetPrice), stopLoss: numberValue(parsed.stopLoss, fallback.stopLoss),
            confidence: numberValue(parsed.confidence, fallback.confidence), reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : fallback.reasoning,
            drawings, buyRange: rangeValue(parsed.buyRange, fallback.buyRange), sellRange: rangeValue(parsed.sellRange, fallback.sellRange),
            support: numberValue(parsed.support, fallback.support), resistance: numberValue(parsed.resistance, fallback.resistance),
            horizon: typeof parsed.horizon === 'string' ? parsed.horizon : fallback.horizon, riskNotes: stringList(parsed.riskNotes, fallback.riskNotes),
            priceForecasts: forecastList(parsed.priceForecasts, fallback.priceForecasts),
            scenarios: {
                bullish: typeof scenarios.bullish === 'string' ? scenarios.bullish : fallback.scenarios.bullish,
                neutral: typeof scenarios.neutral === 'string' ? scenarios.neutral : fallback.scenarios.neutral,
                bearish: typeof scenarios.bearish === 'string' ? scenarios.bearish : fallback.scenarios.bearish,
            },
        };
    } catch {
        return fallback;
    }
}

function buildForecasts(price: number, indicators: Indicators, history: HistoricalStats, profile: 'technical' | 'risk'): PriceForecast[] {
    const trendSignal = history.trend === 'YUKARI' ? 1 : history.trend === 'ASAGI' ? -1 : 0;
    const momentumSignal = Math.max(-1, Math.min(1, ((indicators.rsi - 50) / 25) * 0.45 + Math.sign(indicators.macdHistogram) * 0.55));
    const signal = Math.max(-1, Math.min(1, trendSignal * 0.35 + momentumSignal * 0.65));
    const annualVolatility = Math.max(0.12, Math.min(0.8, history.volatility / 100));
    const horizons: Array<[string, number, number]> = [
        ['15 dk', 15, 0.0015], ['30 dk', 30, 0.002], ['1 saat', 60, 0.003],
        ['3 saat', 180, 0.005], ['6 saat', 360, 0.0075], ['Gün sonu', 390, 0.012],
    ];
    const directionWeight = profile === 'technical' ? 0.55 : 0.3;
    const spreadWeight = profile === 'technical' ? 1.35 : 1.6;
    return horizons.map(([horizon, minutes, minimumSpread], index) => {
        const volatilitySpread = annualVolatility * Math.sqrt(minutes / (252 * 390));
        const spread = Math.max(minimumSpread, volatilitySpread) * spreadWeight;
        const expected = price * (1 + signal * Math.max(minimumSpread, volatilitySpread) * directionWeight);
        return {
            horizon,
            low: Number(Math.max(0, expected * (1 - spread)).toFixed(2)),
            expected: Number(expected.toFixed(2)),
            high: Number((expected * (1 + spread)).toFixed(2)),
            confidence: Math.max(38, Math.round((profile === 'technical' ? 68 : 58) - index * 5 - Math.abs(signal) * 4)),
        };
    });
}

function fallbackAgents(symbol: string, price: number, indicators: Indicators, history: HistoricalStats, method: AnalysisMethod, methodDetails: { summary: string; drawings: DrawingLine[] }): AgentAnalysis[] {
    const bullish = indicators.rsi < 68 && indicators.macdHistogram >= 0;
    const action = bullish ? 'AL' : indicators.rsi > 72 ? 'SAT' : 'TUT';
    const support = Number((price * 0.945).toFixed(2));
    const resistance = Number((price * 1.055).toFixed(2));
    const buyRange: [number, number] = [Number((price * 0.95).toFixed(2)), Number((price * 0.985).toFixed(2))];
    const sellRange: [number, number] = [Number((price * 1.04).toFixed(2)), Number((price * 1.08).toFixed(2))];
    const technicalForecasts = buildForecasts(price, indicators, history, 'technical');
    const riskForecasts = buildForecasts(price, indicators, history, 'risk');
    const common = {
        targetPrice: Number((price * 1.075).toFixed(2)), stopLoss: Number((price * 0.945).toFixed(2)), confidence: 64,
        buyRange, sellRange, support, resistance, horizon: '1-4 hafta',
        riskNotes: ['Stop seviyesinde günlük kapanış görülürse senaryo geçersiz olur.', 'Tek pozisyonda portföyün %10-15’inden fazlası riske edilmemeli.', 'Haber akışı ve BİST endeks yönü teknik sinyali teyit etmeyebilir.'],
        scenarios: {
            bullish: `${resistance} TL üzerindeki kapanışın hacimle teyit edilmesi, satıcı arzının aşıldığını ve 1-4 hafta içinde ${Number((price * 1.075).toFixed(2))} TL hedefinin test edilebileceğini düşündürür. Kırılım sonrası fiyat tekrar ${resistance} TL altına dönerse bu senaryo zayıflar; retest ve hacim takibi gerekir.`,
            neutral: `${support} - ${resistance} TL arasında kalmak, alıcı ve satıcının henüz yön konusunda üstünlük kuramadığı anlamına gelir. Bu bölgede orta fiyatlardan kovalamak yerine desteğe yaklaşma, dirençten reddedilme veya hacimli kırılım beklenmeli; RSI ${indicators.rsi} seviyesinde olduğu için momentum teyidi ayrıca izlenmelidir.`,
            bearish: `${support} TL altında günlük kapanış ve artan satış hacmi, mevcut yükseliş varsayımını geçersiz kılar. Bu durumda ${Number((price * 0.945).toFixed(2))} TL stop planı korunmalı, yeni alım için eski desteğin yeniden kazanılması beklenmeli ve daha düşük desteklerde volatilite artabileceği için pozisyon küçültülmelidir.`,
        },
    };
    const riskSupport = Number((price * 0.91).toFixed(2));
    const riskResistance = Number((price * 1.085).toFixed(2));
    const riskBuyRange: [number, number] = [Number((price * 0.92).toFixed(2)), Number((price * 0.965).toFixed(2))];
    const riskSellRange: [number, number] = [Number((price * 1.045).toFixed(2)), Number((price * 1.12).toFixed(2))];
    return [
        {
            agentName: 'Gemini Grafik & Çizim Analisti', action, ...common, priceForecasts: technicalForecasts,
            reasoning: `${symbol} için ${method} yaklaşımında ${methodDetails.summary} Fiyatın SMA20/50/200 konumu ve genel trend teyidiyle birlikte değerlendirildi.`,
            drawings: methodDetails.drawings.length ? methodDetails.drawings : [
                { title: 'AI Direnç', price: resistance, color: '#fb7185', style: 2 },
                { title: 'AI Destek', price: support, color: '#34d399', style: 2 },
                ...(method === 'FIBONACCI' ? [{ title: 'Fib 0.618', price: Number((price * 1.018).toFixed(2)), color: '#f4c95d', style: 2 as const }] : []),
            ],
        },
        {
            agentName: 'Llama Risk & Strateji Yöneticisi', action: bullish ? 'TUT' : action, ...common, priceForecasts: riskForecasts,
            targetPrice: Number((price * 1.06).toFixed(2)), stopLoss: Number((price * 0.95).toFixed(2)), confidence: 58,
            buyRange: riskBuyRange, sellRange: riskSellRange, support: riskSupport, resistance: riskResistance,
            scenarios: {
                bullish: `${riskResistance} TL üzerinde kalıcılık sağlanır ve portföy riski işlem başına sınırlanırsa pozisyon kademeli büyütülebilir. İlk hedef ${Number((price * 1.06).toFixed(2))} TL; hedefe yaklaşırken stop yukarı taşınmalıdır.`,
                neutral: `${riskSupport} - ${riskResistance} TL bandında beklenen getiri belirsizdir. Bu bölgede tam pozisyon yerine küçük deneme, nakit payı ve fiyat teyidi korunmalı; işlem maliyeti kazanç beklentisine eklenmelidir.`,
                bearish: `${riskSupport} TL altında kapanış veya haber kaynaklı volatilite, sermaye korumayı önceliklendirir. Stop çalışırsa pozisyon azaltılmalı; yeni giriş için kaybedilen seviye ve piyasa likiditesi yeniden değerlendirilmelidir.`,
            },
            reasoning: `${symbol} pozisyonu için risk/ödül dengesi, alım-satım bölgeleri ve ${method} sinyali (${methodDetails.summary}) birlikte ele alındı. Kademeli işlem, sabit stop ve haber riskine karşı pozisyon boyutu önerilir.`,
            drawings: [],
        },
    ];
}

async function askProvider(prompt: string, primary: 'gemini' | 'groq'): Promise<string> {
    return primary === 'gemini' ? analyzeWithGemini(prompt) : analyzeWithGroq(prompt);
}

export async function POST(req: Request) {
    try {
        const body = await req.json() as AnalysisBody;
        const symbol = typeof body.symbol === 'string' ? body.symbol.trim().toUpperCase() : '';
        if (!/^[A-Z0-9]{3,6}$/.test(symbol)) return NextResponse.json({ error: 'Geçerli bir BİST hisse kodu gereklidir.' }, { status: 400 });
        const price = numberValue(body.price, 35);
        const method = METHODS.includes(body.method as AnalysisMethod) ? body.method as AnalysisMethod : 'SUPPORT_RESISTANCE';
        const indicators: Indicators = {
            rsi: numberValue(body.indicators?.rsi, 50), macd: numberValue(body.indicators?.macd, 0), macdSignal: numberValue(body.indicators?.macdSignal, 0), macdHistogram: numberValue(body.indicators?.macdHistogram, 0),
            sma20: numberValue(body.indicators?.sma20, price), sma50: numberValue(body.indicators?.sma50, price), sma200: numberValue(body.indicators?.sma200, price),
        };
        const history: HistoricalStats = {
            return1M: numberValue(body.history?.return1M, 0), return3M: numberValue(body.history?.return3M, 0), return1Y: numberValue(body.history?.return1Y, 0),
            high52W: numberValue(body.history?.high52W, price), low52W: numberValue(body.history?.low52W, price), volatility: numberValue(body.history?.volatility, 0),
            trend: body.history?.trend === 'YUKARI' || body.history?.trend === 'ASAGI' || body.history?.trend === 'YATAY' ? body.history.trend : 'YATAY',
        };
        const candles = Array.isArray(body.candles) ? body.candles.filter((candle): candle is Candle => (
            typeof candle === 'object' && candle !== null
            && (typeof candle.time === 'string' || typeof candle.time === 'number')
            && [candle.open, candle.high, candle.low, candle.close, candle.volume]
                .every((value) => typeof value === 'number' && Number.isFinite(value))
        )).slice(-500) : [];
        const methodDetails = methodContext(method, candles, indicators);
        const fallbacks = fallbackAgents(symbol, price, indicators, history, method, methodDetails);
        const newsContext = (body.news ?? []).slice(0, 6).map((item) => `- ${item.title} (${item.publisher})`).join('\n');
        const context = `Hisse: ${symbol}; fiyat: ${price} TL; analiz zaman dilimi: ${typeof body.timeframe === 'string' ? body.timeframe : '1d'}; yöntem: ${method}; yöntem talimatı: ${METHOD_GUIDANCE[method]}; yöntem verisi: ${methodDetails.summary}; RSI: ${indicators.rsi}; MACD: ${indicators.macd}; histogram: ${indicators.macdHistogram}; SMA20/50/200: ${indicators.sma20}/${indicators.sma50}/${indicators.sma200}; geçmiş getiriler 1A/3A/1Y: ${history.return1M}%/${history.return3M}%/${history.return1Y}%; 52H yüksek/düşük: ${history.high52W}/${history.low52W}; yıllıklandırılmış volatilite: ${history.volatility}%; trend: ${history.trend}. Haberler:\n${newsContext || 'Haber verisi yok.'}`;
        const schema = '{"agentName": string, "action": "AL"|"SAT"|"TUT", "targetPrice": number, "stopLoss": number, "confidence": number, "reasoning": string, "buyRange": [number,number], "sellRange": [number,number], "support": number, "resistance": number, "horizon": string, "riskNotes": string[], "priceForecasts": [{"horizon": "15 dk"|"30 dk"|"1 saat"|"3 saat"|"6 saat"|"Gün sonu", "low": number, "expected": number, "high": number, "confidence": number}], "scenarios": {"bullish": string, "neutral": string, "bearish": string}, "drawings": [{"title": string, "price": number, "color": string, "style": 0|1|2|3}]}';
        const forecastInstruction = 'priceForecasts alanında tam olarak 6 kayıt üret: 15 dk, 30 dk, 1 saat, 3 saat, 6 saat ve Gün sonu. Her kayıtta mevcut fiyata göre makul düşük-yüksek aralık, en olası fiyat ve 0-100 güven ver. Bunlar kesinlik değil senaryodur; volatilite, destek/direnç, momentum ve haber riskini hesaba kat.';
        const prompt = `${context}\nBİST kıdemli teknik analisti olarak ${method} yöntemine göre ayrıntılı, sembol bazlı rapor üret. Haberleri teknik görünümle ilişkilendir. ${forecastInstruction} Yalnızca JSON döndür: ${schema}`;
        const riskPrompt = `${context}\nBİST risk ve strateji yöneticisi olarak alım aralığı, satım aralığı, hedef, stop, portföy riski, haber riskleri ve üç senaryoyu açıkla. ${forecastInstruction} Yalnızca JSON döndür: ${schema}`;
        const [technicalRaw, riskRaw] = await Promise.all([askProvider(prompt, 'gemini'), askProvider(riskPrompt, 'groq')]);
        const technical = parseAgent(technicalRaw, fallbacks[0]);
        const risk = parseAgent(riskRaw, fallbacks[1]);
        return NextResponse.json({ success: true, data: { symbol, price, drawings: technical.drawings, analyses: [technical, risk] } });
    } catch {
        return NextResponse.json({ error: 'Analiz ajanları şu anda yanıt veremiyor.' }, { status: 502 });
    }
}
