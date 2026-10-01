import { NextResponse } from 'next/server';

type YahooSymbol = {
    symbol?: string;
    shortname?: string;
    longname?: string;
    exchange?: string;
};

type YahooSearchResult = { quotes?: YahooSymbol[] };

export async function GET(request: Request) {
    const query = new URL(request.url).searchParams.get('q')?.trim().toUpperCase() ?? '';
    if (query.length < 2 || query.length > 20 || !/^[A-Z0-9 .&-]+$/.test(query)) {
        return NextResponse.json({ success: true, data: [] });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
        const response = await fetch(
            `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(`${query}.IS`)}&quotesCount=12&newsCount=0&enableFuzzyQuery=true`,
            { cache: 'no-store', signal: controller.signal },
        );
        if (!response.ok) {
            console.error('Yahoo symbol search failed.', response.status);
            return NextResponse.json({ error: 'Hisse önerileri şu anda yüklenemiyor.' }, { status: 502 });
        }
        const payload = await response.json() as YahooSearchResult;
        const results = (payload.quotes ?? []).flatMap((quote) => {
            const symbol = quote.symbol?.toUpperCase() ?? '';
            if (!/^[A-Z0-9]{3,6}\.IS$/.test(symbol)) return [];
            return [{
                symbol: symbol.slice(0, -3),
                name: quote.longname ?? quote.shortname ?? symbol.slice(0, -3),
                exchange: quote.exchange ?? 'BIST',
            }];
        });
        return NextResponse.json({ success: true, data: results.slice(0, 8) }, {
            headers: { 'Cache-Control': 'private, max-age=30' },
        });
    } catch (cause) {
        console.error('Yahoo symbol search request failed.', cause);
        return NextResponse.json({ error: 'Hisse önerileri alınamadı. Lütfen tekrar deneyin.' }, { status: 502 });
    } finally {
        clearTimeout(timeout);
    }
}
