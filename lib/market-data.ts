import type { Candle, HistoricalStats, Indicators, MarketData, MarketNews, Timeframe } from '@/lib/types';

const REQUEST_TIMEOUT_MS = 8_000;
const FALLBACK_PRICES: Record<string, number> = {
    AKBNK: 68.5,
    ASELS: 64.1,
    BIMAS: 552,
    EREGL: 48.2,
    GARAN: 112.4,
    HEKTS: 4.9,
    KCHOL: 185,
    MANAS: 25.4,
    SASA: 4.35,
    SISE: 49.8,
    THYAO: 305.5,
    TUPRS: 178,
    YKBNK: 31.2,
};

function fallbackNews(symbol: string): MarketNews[] {
    return [
        { title: `${symbol} için teknik görünüm ve fiyat seviyeleri izleniyor`, publisher: 'Trade Agent teknik akış', url: '#', publishedAt: new Date().toISOString() },
        { title: `BİST genel görünümü: endeks hareketi ${symbol} risk primini etkileyebilir`, publisher: 'BİST piyasa özeti', url: '#', publishedAt: new Date(Date.now() - 3_600_000).toISOString() },
        { title: `${symbol} KAP bildirimlerini görüntüle`, publisher: 'KAP', url: `https://www.kap.org.tr/tr/bildirim-sorgu`, publishedAt: new Date().toISOString() },
    ];
}

function round(value: number): number {
    return Number(value.toFixed(2));
}

function average(values: number[]): number {
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function sma(closes: number[], period: number): number {
    return average(closes.slice(-period));
}

function calculateRsi(closes: number[]): number {
    const changes = closes.slice(1).map((close, index) => close - closes[index]);
    const recent = changes.slice(-14);
    const gains = average(recent.filter((change) => change > 0));
    const losses = average(recent.filter((change) => change < 0).map((change) => Math.abs(change)));
    if (!losses) return 50;
    return round(100 - 100 / (1 + gains / losses));
}

function calculateIndicators(candles: Candle[]): Indicators {
    const closes = candles.map((candle) => candle.close);
    const shortAverage = sma(closes, 12);
    const longAverage = sma(closes, 26);
    const macd = round(shortAverage - longAverage);
    const signal = round(macd * 0.8);

    return {
        rsi: calculateRsi(closes),
        macd,
        macdSignal: signal,
        macdHistogram: round(macd - signal),
        sma20: round(sma(closes, 20)),
        sma50: round(sma(closes, 50)),
        sma200: round(sma(closes, 200)),
    };
}

function calculateHistory(candles: Candle[]): HistoricalStats {
    const closes = candles.map((candle) => candle.close);
    const current = closes.at(-1) ?? 0;
    const valueAt = (daysAgo: number) => closes[Math.max(0, closes.length - 1 - daysAgo)] ?? current;
    const returns = closes.slice(1).map((close, index) => (close - closes[index]) / closes[index]);
    const volatility = Math.sqrt(returns.reduce((sum, value) => sum + value ** 2, 0) / Math.max(returns.length, 1)) * Math.sqrt(252) * 100;
    const returnFor = (daysAgo: number) => round(((current - valueAt(daysAgo)) / valueAt(daysAgo)) * 100);
    const high52W = Math.max(...closes);
    const low52W = Math.min(...closes);
    const return3M = returnFor(63);
    return {
        return1M: returnFor(21), return3M, return1Y: returnFor(252), high52W: round(high52W), low52W: round(low52W),
        volatility: round(volatility), trend: return3M > 5 ? 'YUKARI' : return3M < -5 ? 'ASAGI' : 'YATAY',
    };
}

function makeFallbackCandles(symbol: string, price: number): Candle[] {
    let close = price * 0.82;
    const seed = [...symbol].reduce((sum, character) => sum + character.charCodeAt(0), 0);
    const candles: Candle[] = [];
    const now = Date.now();

    for (let index = 199; index >= 0; index -= 1) {
        const wave = Math.sin((index + seed) / 8) * price * 0.006;
        const drift = price * 0.0011;
        const open = close;
        close = Math.max(price * 0.55, close + drift + wave);
        const high = Math.max(open, close) + price * (0.004 + ((index + seed) % 5) * 0.001);
        const low = Math.min(open, close) - price * (0.004 + ((index + seed) % 3) * 0.001);
        candles.push({
            time: new Date(now - index * 86_400_000).toISOString().slice(0, 10),
            open: round(open),
            high: round(high),
            low: round(low),
            close: round(close),
            volume: 100_000 + ((seed + index) % 15) * 10_000,
        });
    }

    const scale = price / (candles.at(-1)?.close || price);
    return candles.map((candle) => ({
        ...candle,
        open: round(candle.open * scale),
        high: round(candle.high * scale),
        low: round(candle.low * scale),
        close: round(candle.close * scale),
    }));
}

type YahooPayload = {
    chart?: {
        result?: Array<{
            timestamp?: number[];
            indicators?: { quote?: Array<Record<string, Array<number | null>>> };
        }>;
    };
};

function parseYahooCandles(payload: unknown, interval: Timeframe): Candle[] {
    const result = (payload as YahooPayload).chart?.result?.[0];
    const timestamps = result?.timestamp ?? [];
    const quote = result?.indicators?.quote?.[0];
    if (!quote) return [];

    return timestamps.flatMap((timestamp, index) => {
        const open = quote.open?.[index];
        const high = quote.high?.[index];
        const low = quote.low?.[index];
        const close = quote.close?.[index];
        const volume = quote.volume?.[index];
        if ([open, high, low, close].some((value) => typeof value !== 'number')) return [];
        return [{
            time: ['1m', '5m', '15m', '30m', '1h'].includes(interval) ? timestamp : new Date(timestamp * 1000).toISOString().slice(0, 10),
            open: round(open as number),
            high: round(high as number),
            low: round(low as number),
            close: round(close as number),
            volume: typeof volume === 'number' ? volume : 0,
        }];
    });
}

async function fetchWithTimeout(url: string): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
        return await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' }, cache: 'no-store' });
    } finally {
        clearTimeout(timeout);
    }
}

async function fetchNews(symbol: string): Promise<MarketNews[]> {
    try {
        const [response, kapResponse] = await Promise.all([
            fetchWithTimeout(`https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(`${symbol}.IS`)}&newsCount=6`),
            fetchWithTimeout(`https://news.google.com/rss/search?q=${encodeURIComponent(`${symbol} site:kap.org.tr`)}&hl=tr&gl=TR&ceid=TR:tr`),
        ]);
        const payload = response.ok ? await response.json() as { news?: Array<{ title?: string; publisher?: string; link?: string; providerPublishTime?: number }> } : {};
        const news = (payload.news ?? []).filter((item) => item.title && item.link).map((item) => ({
            title: item.title as string,
            publisher: item.publisher ?? 'Piyasa haber akışı',
            url: item.link as string,
            publishedAt: new Date((item.providerPublishTime ?? Date.now() / 1000) * 1000).toISOString(),
        }));
        const kapXml = kapResponse.ok ? await kapResponse.text() : '';
        const kapNews: MarketNews[] = [...kapXml.matchAll(/<item>[\s\S]*?<title>([\s\S]*?)<\/title>[\s\S]*?<link>([\s\S]*?)<\/link>[\s\S]*?<pubDate>([\s\S]*?)<\/pubDate>[\s\S]*?<\/item>/g)].slice(0, 6).map((match) => ({
            title: match[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim(), publisher: 'KAP haber araması', url: match[2].trim(), publishedAt: new Date(match[3].trim()).toISOString(),
        }));
        return [...kapNews, ...news].length ? [...kapNews, ...news] : fallbackNews(symbol);
    } catch {
        return fallbackNews(symbol);
    }
}

export async function getMarketData(
    symbolInput: string,
    range = '1y',
    interval: Timeframe = '1d',
    options: { includeNews?: boolean } = {},
): Promise<MarketData> {
    const symbol = symbolInput.trim().toUpperCase();
    const fallbackPrice = FALLBACK_PRICES[symbol] ?? 35;
    const fetchedAt = new Date().toISOString();

    try {
        const [response, news] = await Promise.all([
            fetchWithTimeout(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}.IS?range=${encodeURIComponent(range)}&interval=${encodeURIComponent(interval)}`),
            options.includeNews === false ? Promise.resolve([]) : fetchNews(symbol),
        ]);
        if (!response.ok) throw new Error(`Market data request failed: ${response.status}`);
        const candles = parseYahooCandles(await response.json(), interval);
        if (candles.length < 30) throw new Error('Market data did not contain enough candles');
        const price = candles.at(-1)?.close ?? fallbackPrice;
        const previous = candles.at(-2)?.close ?? price;
        return {
            symbol,
            price,
            changePercent: round(((price - previous) / previous) * 100),
            currency: 'TRY',
            candles,
            indicators: calculateIndicators(candles),
            history: calculateHistory(candles),
            news,
            updatedAt: typeof candles.at(-1)?.time === 'number' ? new Date((candles.at(-1)?.time as number) * 1000).toISOString() : fetchedAt,
            fetchedAt,
            source: 'yahoo-finance',
        };
    } catch {
        const candles = makeFallbackCandles(symbol, fallbackPrice);
        const price = candles.at(-1)?.close ?? fallbackPrice;
        const previous = candles.at(-2)?.close ?? price;
        return {
            symbol,
            price,
            changePercent: round(((price - previous) / previous) * 100),
            currency: 'TRY',
            candles,
            indicators: calculateIndicators(candles),
            history: calculateHistory(candles),
            news: fallbackNews(symbol),
            updatedAt: fetchedAt,
            fetchedAt,
            source: 'fallback',
        };
    }
}
