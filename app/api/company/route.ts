import { NextResponse } from 'next/server';
import type { CompanyProfile } from '@/lib/types';

function numberOrNull(value: unknown): number | null { return typeof value === 'number' && Number.isFinite(value) ? value : null; }
function metric(value: unknown): number | null {
    return numberOrNull(value) ?? (value && typeof value === 'object' && 'raw' in value
        ? numberOrNull((value as { raw?: unknown }).raw)
        : null);
}

export async function GET(req: Request) {
    const symbol = new URL(req.url).searchParams.get('symbol')?.trim().toUpperCase() ?? '';
    if (!/^[A-Z0-9]{3,6}$/.test(symbol)) return NextResponse.json({ error: 'Geçersiz hisse kodu.' }, { status: 400 });
    try {
        const searchResponse = await fetch(`https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(`${symbol}.IS`)}&quotesCount=1&newsCount=0`, { cache: 'no-store' });
        const searchPayload = await searchResponse.json() as { quotes?: Array<Record<string, unknown>> };
        const quote = searchPayload.quotes?.[0] ?? {};
        const chartResponse = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}.IS?range=1y&interval=1d`, { cache: 'no-store' });
        const chartPayload = chartResponse.ok ? await chartResponse.json() as { chart?: { result?: Array<{ meta?: Record<string, unknown>; timestamp?: number[]; indicators?: { quote?: Array<Record<string, Array<number | null>>> } }> } } : {};
        const chartResult = chartPayload.chart?.result?.[0];
        const chartMeta = chartResult?.meta ?? {};
        const latestBarIndex = Math.max(0, (chartResult?.timestamp?.length ?? 0) - 1);
        const chartQuote = chartResult?.indicators?.quote?.[0] ?? {};
        const latestBarValue = (field: string) => numberOrNull(chartQuote[field]?.[latestBarIndex]);
        const previousBarClose = numberOrNull(chartQuote.close?.[latestBarIndex - 1]);
        const profileResponse = await fetch(`https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}.IS?modules=assetProfile,price,summaryDetail,defaultKeyStatistics,financialData,balanceSheetHistory,cashflowStatementHistory,incomeStatementHistory`, { cache: 'no-store' });
        const profilePayload = profileResponse.ok ? await profileResponse.json() as { quoteSummary?: { result?: Array<Record<string, Record<string, unknown>>> } } : {};
        const result = profilePayload.quoteSummary?.result?.[0] ?? {};
        const profile = result.assetProfile ?? {};
        const price = result.price ?? {};
        const summary = result.summaryDetail ?? {};
        const stats = result.defaultKeyStatistics ?? {};
        const financials = result.financialData ?? {};
        const balanceSheet = (result.balanceSheetHistory as { balanceSheetStatements?: Array<Record<string, unknown>> } | undefined)?.balanceSheetStatements?.[0] ?? {};
        const cashFlow = (result.cashflowStatementHistory as { cashflowStatements?: Array<Record<string, unknown>> } | undefined)?.cashflowStatements?.[0] ?? {};
        const incomeStatement = (result.incomeStatementHistory as { incomeStatementHistory?: Array<Record<string, unknown>> } | undefined)?.incomeStatementHistory?.[0] ?? {};
        const currentPrice = numberOrNull(price.regularMarketPrice) ?? numberOrNull(quote.regularMarketPrice) ?? numberOrNull(chartMeta.regularMarketPrice) ?? 0;
        const previousClose = numberOrNull(chartMeta.regularMarketPreviousClose) ?? numberOrNull(quote.regularMarketPreviousClose) ?? previousBarClose ?? numberOrNull(chartMeta.previousClose) ?? numberOrNull(chartMeta.chartPreviousClose);
        const volumes = (chartQuote.volume ?? []).filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
        const averageVolume = volumes.length
            ? volumes.slice(-60).reduce((sum, value) => sum + value, 0) / Math.min(volumes.length, 60)
            : null;
        const estimatedFloor = previousClose === null ? null : Number((previousClose * 0.9).toFixed(2));
        const estimatedCeiling = previousClose === null ? null : Number((previousClose * 1.1).toFixed(2));
        const data: CompanyProfile = {
            symbol, companyName: String(quote.longname ?? quote.shortname ?? `${symbol} BİST`), exchange: String(quote.fullExchangeName ?? 'Borsa İstanbul'),
            sector: String(profile.sector ?? 'Sektör bilgisi bulunamadı'), industry: String(profile.industry ?? 'Endüstri bilgisi bulunamadı'), country: String(profile.country ?? 'Türkiye'),
            foundedYear: numberOrNull(profile.founded), employees: numberOrNull(profile.fullTimeEmployees), website: typeof profile.website === 'string' ? profile.website : null,
            summary: typeof profile.longBusinessSummary === 'string' ? profile.longBusinessSummary : `${symbol}, Borsa İstanbul'da işlem gören bir şirkettir. Şirketin detaylı faaliyet tanımı veri sağlayıcıda bulunamadı.`,
            price: currentPrice,
            changePercent: metric(price.regularMarketChangePercent) ?? numberOrNull(quote.regularMarketChangePercent)
                ?? (previousClose && currentPrice ? Number(((currentPrice - previousClose) / previousClose * 100).toFixed(2)) : 0),
            open: numberOrNull(chartMeta.regularMarketOpen) ?? latestBarValue('open'), previousClose,
            dayLow: numberOrNull(chartMeta.regularMarketDayLow) ?? latestBarValue('low'), dayHigh: numberOrNull(chartMeta.regularMarketDayHigh) ?? latestBarValue('high'),
            estimatedFloor, estimatedCeiling,
            marketCap: metric(price.marketCap) ?? numberOrNull(quote.marketCap) ?? 0,
            trailingPe: metric(summary.trailingPE), dividendYield: metric(summary.dividendYield),
            priceToBook: metric(stats.priceToBook), bookValue: metric(stats.bookValue),
            totalStockholderEquity: metric(balanceSheet.totalStockholderEquity),
            averageVolume: metric(summary.averageVolume) ?? averageVolume, ebitda: metric(financials.ebitda),
            netIncome: metric(incomeStatement.netIncome), netProfitMargin: metric(financials.profitMargins),
            grossProfitMargin: metric(financials.grossMargins), operatingCashFlow: metric(cashFlow.totalCashFromOperatingActivities),
            freeCashFlow: metric(financials.freeCashflow), cashRatio: metric(financials.cashRatio),
            currentRatio: metric(financials.currentRatio), quickRatio: metric(financials.quickRatio),
            exportRatio: null, cashConversionCycle: null,
            financialsAvailable: Object.keys(result).length > 0,
            high52W: numberOrNull(summary.fiftyTwoWeekHigh) ?? numberOrNull(chartMeta.fiftyTwoWeekHigh), low52W: numberOrNull(summary.fiftyTwoWeekLow) ?? numberOrNull(chartMeta.fiftyTwoWeekLow), updatedAt: new Date().toISOString(),
        };
        return NextResponse.json({ success: true, data });
    } catch {
        return NextResponse.json({ error: 'Şirket verisi sağlayıcıdan alınamadı. Lütfen tekrar deneyin.' }, { status: 502 });
    }
}
