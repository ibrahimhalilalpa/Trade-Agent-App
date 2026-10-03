import { NextResponse } from 'next/server';

const INSTRUMENTS = [
    { symbol: 'XU100.IS', label: 'BIST 100', currency: 'pts' },
    { symbol: 'XU030.IS', label: 'BIST 30', currency: 'pts' },
    { symbol: 'XU500.IS', label: 'BIST 500', currency: 'pts' },
    { symbol: '^GSPC', label: 'S&P 500', currency: 'pts' },
    { symbol: '^IXIC', label: 'NASDAQ', currency: 'pts' },
    { symbol: '^FTSE', label: 'FTSE 100', currency: 'pts' },
    { symbol: '^GDAXI', label: 'DAX', currency: 'pts' },
    { symbol: 'USDTRY=X', label: 'USD/TRY', currency: '₺' },
    { symbol: 'EURTRY=X', label: 'EUR/TRY', currency: '₺' },
    { symbol: 'GC=F', label: 'ALTIN', currency: 'USD/ons' },
    { symbol: 'BZ=F', label: 'BRENT', currency: 'USD' },
] as const;

type YahooChart = {
    chart?: {
        result?: Array<{
            meta?: { regularMarketPrice?: number; chartPreviousClose?: number; previousClose?: number };
            indicators?: { quote?: Array<{ close?: Array<number | null> }> };
        }>;
        error?: { description?: string };
    };
};

async function loadInstrument(instrument: typeof INSTRUMENTS[number]) {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(instrument.symbol)}?range=1d&interval=1m`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    let response: Response;
    try {
        response = await fetch(url, {
            signal: controller.signal,
            headers: { Accept: 'application/json' },
            next: { revalidate: 15 },
        });
    } finally {
        clearTimeout(timeout);
    }
    if (!response.ok) return null;

    const payload = await response.json() as YahooChart;
    const quote = payload.chart?.result?.[0];
    const price = quote?.meta?.regularMarketPrice ?? quote?.indicators?.quote?.[0]?.close?.filter((value): value is number => typeof value === 'number').at(-1);
    const previousClose = quote?.meta?.chartPreviousClose ?? quote?.meta?.previousClose;
    if (typeof price !== 'number' || !Number.isFinite(price) || typeof previousClose !== 'number' || !Number.isFinite(previousClose) || previousClose === 0) return null;

    return { symbol: instrument.symbol, label: instrument.label, price, changePercent: ((price - previousClose) / previousClose) * 100, currency: instrument.currency };
}

export async function GET() {
    const results = await Promise.allSettled(INSTRUMENTS.map(loadInstrument));
    results.forEach((result, index) => {
        if (result.status === 'rejected') console.warn(`Market ticker quote failed for ${INSTRUMENTS[index].symbol}.`, result.reason);
    });
    const data = results.flatMap((result) => result.status === 'fulfilled' && result.value ? [result.value] : []);
    return NextResponse.json(
        { success: true, data },
        { headers: { 'Cache-Control': 'public, s-maxage=15, stale-while-revalidate=30' } },
    );
}
