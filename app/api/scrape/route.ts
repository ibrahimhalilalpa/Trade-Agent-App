import { NextResponse } from 'next/server';
import { getMarketData } from '@/lib/market-data';
import type { Candle, Timeframe } from '@/lib/types';

const PERIODS: Record<string, { range: string; interval: Timeframe; bucketHours?: number }> = {
    '1m': { range: '1d', interval: '1m' },
    '5m': { range: '5d', interval: '5m' },
    '15m': { range: '1mo', interval: '15m' },
    '30m': { range: '3mo', interval: '30m' },
    '1h': { range: '6mo', interval: '1h' },
    '3h': { range: '2y', interval: '1h', bucketHours: 3 },
    '6h': { range: '2y', interval: '1h', bucketHours: 6 },
    '1d': { range: '1d', interval: '5m' },
    '1wk': { range: '5d', interval: '30m' },
    '1mo': { range: '1mo', interval: '1h' },
    '1y': { range: '1y', interval: '1d' },
    '5y': { range: '5y', interval: '1wk' },
};

function aggregateCandles(candles: Candle[], bucketHours: number): Candle[] {
    if (!candles.some((candle) => typeof candle.time === 'number')) return candles;
    const bucketSeconds = bucketHours * 60 * 60;
    const grouped = new Map<number, Candle>();
    for (const candle of candles) {
        if (typeof candle.time !== 'number') continue;
        const bucket = Math.floor(candle.time / bucketSeconds) * bucketSeconds;
        const existing = grouped.get(bucket);
        if (existing) {
            existing.high = Math.max(existing.high, candle.high);
            existing.low = Math.min(existing.low, candle.low);
            existing.close = candle.close;
            existing.volume += candle.volume;
        } else {
            grouped.set(bucket, { ...candle, time: bucket });
        }
    }
    return [...grouped.values()];
}

export async function GET(req: Request) {
    const searchParams = new URL(req.url).searchParams;
    const symbol = searchParams.get('symbol')?.trim().toUpperCase();
    const requestedPeriod = searchParams.get('period');
    const configuration = requestedPeriod ? PERIODS[requestedPeriod] : null;
    if (requestedPeriod && !configuration) return NextResponse.json({ error: 'Geçersiz grafik dönemi.' }, { status: 400 });
    const ranges = ['1d', '5d', '1mo', '3mo', '6mo', '1y', '2y', '5y', '10y', 'max'];
    const intervals: Timeframe[] = ['1m', '5m', '15m', '30m', '1h', '1d', '1wk', '1mo'];
    const requestedRange = searchParams.get('range') ?? '';
    const requestedInterval = searchParams.get('interval') ?? '';
    const range = configuration?.range ?? (ranges.includes(requestedRange) ? requestedRange : '1y');
    const interval = configuration?.interval ?? (intervals.includes(requestedInterval as Timeframe) ? requestedInterval as Timeframe : '1d');

    if (!symbol || !/^[A-Z0-9]{3,6}$/.test(symbol)) {
        return NextResponse.json({ error: 'Geçerli bir BİST hisse kodu gereklidir.' }, { status: 400 });
    }

    try {
        const data = await getMarketData(symbol, range, interval, { includeNews: !requestedPeriod });
        const candles = configuration?.bucketHours
            ? aggregateCandles(data.candles, configuration.bucketHours)
            : data.candles;
        return NextResponse.json({ success: true, data: { ...data, candles } });
    } catch {
        return NextResponse.json({
            error: 'Piyasa verisi alınamadı.'
        }, { status: 502 });
    }
}