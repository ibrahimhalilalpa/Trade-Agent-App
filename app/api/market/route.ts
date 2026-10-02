import { NextResponse } from 'next/server';
import { getMarketData } from '@/lib/market-data';
import type { MarketQuote } from '@/lib/types';

const FALLBACK_UNIVERSE = 'AEFES AGHOL AGROT AKBNK AKENR AKFGY AKFYE AKSA AKSEN ALARK ALBRK ALFAS ALGYO ALKA ALKIM ANHYT ANSGR ARCLK ARENA ARDYZ ASELS ASGYO ASTOR ASUZU ATAGY ATAKP ATATP AVHOL AYDEM AYEN AYES BAGFS BANVT BARMA BERA BEYAZ BFREN BIGEN BIMAS BIOEN BJKAS BLCYT BMSCH BNTAS BOBET BORSK BRISA BRKVY BRLSM BRSAN BRYAT BSOKE BTCIM BUCIM BURCE BURVA CANTE CATES CCOLA CELHA CEMAS CEMTS CEOEM CIMSA CLEBI CONSE COSMO CRDFA CRFSA CWENE DAGI DAPGM DARDL DCTTR DENGE DERHL DESA DESPC DEVA DGATE DGNMO DITAS DMRGD DMSAS DNISI DOAS DOBUR DOHOL DURDO DZGYO ECILC ECZYT EDIP EGEEN EGEPO EGGUB EGPRO EGSER EKGYO EMKEL ENERY ENJSA ENKAI EREGL ESCAR ESEN ETILR EUHOL EUPWR EUREN FENER FLAP FMIZP FONET FORMT FORTE FRIGO FROTO GARAN GARFA GEDIK GEDZA GENTS GEREL GESAN GLBMD GLRYH GLYHO GMTAS GOKNR GOLTS GOODY GOZDE GRNYO GSDDE GSDHO GSRAY GUBRF GWIND GZNMI HALKB HATEK HATSN HDFGS HEDEF HEKTS HKTM HTTBT HUBVC HUNER HURGZ ICUGS IDGYO IHEVA IHLAS IHLGM IHYAY IMASM INDES INFO INGRM INTEK INTEM INVEO ISATR ISBIR ISCTR ISDMR ISFIN ISGSY ISGYO ISYAT ITTFH IZFAS JANTS KAPLM KAREL KARSN KARTN KARYE KATMR KAYSE KCAER KCHOL KENT KERVT KFEIN KLGYO KLKIM KLRHO KLSER KMPUR KNFRT KONKA KONTR KONYA KOPOL KORDS KOZAA KOZAL KRDMA KRDMB KRDMD KRGYO KRONT KRVGD KSTUR KTSKR KUTPO KUYAS KZBGY LIDER LINK LKMNH LOGO LUKSK MACKO MAGEN MAKTK MANAS MARKA MARTI MAVI MEDTR MEGAP MEGMT MELSA MEPET MERCN MERIT MERKO METRO MGROS MIATK MIPAZ MMCAS MNDRS MNDTR MOBTL MOGAN MPARK MRSHL MRGYO MTRKS MTRYO NASMED NATEN NETAS NIBAS NTGAZ NTHOL NUHCM ODAS ONCSM ONRYT ORCAY ORGE OSMEN OSTIM OTKAR OYLUM OYAKC OYAYO OZGYO OZKGY OZRDN PAGYO PAPIL PARSN PASEU PCILT PENGD PETKM PETUN PINSU PKART PLTUR PNLSN PNSUT POLHO POLTK PRDGS PRKAB PRKME PRZMA PSDTC PSGYO QNBFL QNBTR QUAGR RALYH RAYSG REEDR RNPOL ROYAL RYGYO RYSAS SANKO SARKY SASA SAYAS SDTTR SEGYO SELEC SELGD SENTE SERC SISE SKBNK SKTAS SMART SNGYO SNKRN SNPAM SOKM SOKE SONME SRVGY SUNTK SUWEN TARKM TATEN TATGD TAVHL TBORG TCELL TDGYO TEKTU TETMT TEZOL TGSAS THYAO TKFEN TKNSA TLMAN TMPOL TMSN TMSN TNKOL TNZTP TOASO TRCAS TRGYO TRILC TSKB TSPOR TTRAK TUCLK TUKAS TUPRS TURSG ULUFA ULUSE ULKER ULUUN UMPAS USAK UZERB VAKBN VAKFN VAKKO VANGD VBTYZ VERUS VKFYO VKING VKING VRGYO YAPRK YATAS YAYLA YBTAS YEOTK YGGYO YKBNK YUNSA YYAPI ZEDUR ZOREN ZRGYO'.split(' ');
const REQUEST_TIMEOUT_MS = 8_000;
const NO_STORE_HEADERS = { 'Cache-Control': 'no-store, max-age=0, must-revalidate' };

function fallbackQuotes(): MarketQuote[] {
    return FALLBACK_UNIVERSE.map((symbol) => ({ symbol, name: `${symbol} BİST`, price: 0, changePercent: 0, volume: 0, marketCap: 0, exchange: 'BIST', updatedAt: new Date().toISOString(), source: 'fallback' as const }));
}

export async function GET(req: Request) {
    const searchParams = new URL(req.url).searchParams;
    const requestedLimit = searchParams.get('limit');
    const requestedSymbol = searchParams.get('symbol')?.trim().toUpperCase();
    if (requestedSymbol && /^[A-Z0-9]{3,6}$/.test(requestedSymbol)) {
        const market = await getMarketData(requestedSymbol);
        const latestClose = market.candles.at(-1)?.close ?? market.price;
        const returnAt = (days: number) => {
            const earlier = market.candles.at(-1 - days)?.close;
            return typeof earlier === 'number' && earlier !== 0 ? ((latestClose - earlier) / earlier) * 100 : null;
        };
        const quote: MarketQuote = { symbol: market.symbol, name: `${market.symbol} BIST`, price: market.price, changePercent: market.changePercent, change1D: market.changePercent, change1W: returnAt(5), change1M: returnAt(21), change1Y: market.source === 'yahoo-finance' ? market.history.return1Y : null, volume: market.candles.at(-1)?.volume ?? 0, marketCap: 0, exchange: 'BIST', updatedAt: market.updatedAt, source: market.source === 'yahoo-finance' ? 'tradingview' : 'fallback' };
        return NextResponse.json({ success: true, data: [quote], provider: market.source }, { headers: NO_STORE_HEADERS });
    }
    const limit = requestedLimit === 'all' ? 2_000 : Math.min(Math.max(Number(requestedLimit) || 20, 20), 500);
    const period = searchParams.get('period') ?? '1D';
    const periodColumn = ({ '1D': 'change', '1W': 'change|1W', '1M': 'change|1M', '6M': 'change|6M', '1Y': 'change|1Y', '5Y': 'change|5Y' } as Record<string, string>)[period] ?? 'change';
    const sortColumn = ({ price: 'close', change: periodColumn, volume: 'volume', marketCap: 'market_cap_basic' } as Record<string, string>)[searchParams.get('sort') ?? 'change'] ?? periodColumn;
    const sortOrder = searchParams.get('direction') === 'asc' ? 'asc' : 'desc';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
        const columns = ['name', 'description', 'close', 'change', 'change|1W', 'change|1M', 'change|1Y', 'change|1', 'change|5', 'change|15', 'change|60', 'change|240', 'volume', 'Value.Traded', 'market_cap_basic', 'exchange'];
        if (!columns.includes(periodColumn)) columns.push(periodColumn);
        type ScannerItem = { s?: string; d?: Array<string | number | null> };
        type ScannerPayload = { totalCount?: number; data?: ScannerItem[] };
        const scanPage = async (start: number, end: number): Promise<ScannerPayload> => {
            const response = await fetch('https://scanner.tradingview.com/turkey/scan', {
                method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, cache: 'no-store',
                body: JSON.stringify({ filter: [], options: { lang: 'tr' }, markets: ['turkey'], symbols: { query: { types: [] }, tickers: [] }, columns, sort: { sortBy: sortColumn, sortOrder }, range: [start, end] }),
            });
            if (!response.ok) throw new Error(`TradingView scanner failed: ${response.status}`);
            return await response.json() as ScannerPayload;
        };
        const firstPageEnd = Math.min(limit, 500);
        const firstPage = await scanPage(0, firstPageEnd);
        const totalCount = typeof firstPage.totalCount === 'number' ? firstPage.totalCount : firstPage.data?.length ?? 0;
        const finalLimit = Math.min(limit, totalCount);
        const pageStarts = [];
        for (let start = firstPageEnd; start < finalLimit; start += 500) pageStarts.push(start);
        const remainingPages = await Promise.all(pageStarts.map((start) => scanPage(start, Math.min(start + 500, finalLimit))));
        const scannerItems = [
            ...(firstPage.data ?? []),
            ...remainingPages.flatMap((page) => page.data ?? []),
        ];
        const quotes = scannerItems.flatMap((item) => {
            const values = item.d ?? [];
            const symbol = item.s?.split(':').pop();
            if (!symbol || typeof values[2] !== 'number') return [];
            const periodChange = values[columns.indexOf(periodColumn)];
            const dayChange = values[columns.indexOf('change')];
            const weekChange = values[columns.indexOf('change|1W')];
            const monthChange = values[columns.indexOf('change|1M')];
            const yearChange = values[columns.indexOf('change|1Y')];
            const intradayChange = (interval: string) => {
                const value = values[columns.indexOf(`change|${interval}`)];
                return typeof value === 'number' && Number.isFinite(value) ? value : null;
            };
            const volume = values[columns.indexOf('volume')];
            const tradedValue = values[columns.indexOf('Value.Traded')];
            return [{ symbol, name: typeof values[1] === 'string' ? values[1] : symbol, price: values[2], changePercent: typeof periodChange === 'number' ? periodChange : 0, change1D: typeof dayChange === 'number' ? dayChange : null, change1W: typeof weekChange === 'number' ? weekChange : null, change1M: typeof monthChange === 'number' ? monthChange : null, change1Y: typeof yearChange === 'number' ? yearChange : null, change1m: intradayChange('1'), change5m: intradayChange('5'), change15m: intradayChange('15'), change1h: intradayChange('60'), change4h: intradayChange('240'), volume: typeof volume === 'number' ? volume : 0, tradedValue: typeof tradedValue === 'number' && Number.isFinite(tradedValue) ? tradedValue : null, marketCap: typeof values[columns.indexOf('market_cap_basic')] === 'number' ? values[columns.indexOf('market_cap_basic')] as number : 0, exchange: typeof values[columns.indexOf('exchange')] === 'string' ? values[columns.indexOf('exchange')] as string : 'BIST', updatedAt: new Date().toISOString(), source: 'tradingview' as const }];
        });
        return NextResponse.json({ success: true, data: quotes.length ? quotes.slice(0, limit) : fallbackQuotes().slice(0, limit), provider: quotes.length ? 'tradingview' : 'fallback', totalCount, fetchedAt: new Date().toISOString() }, { headers: NO_STORE_HEADERS });
    } catch {
        return NextResponse.json({ success: true, data: fallbackQuotes().slice(0, limit), provider: 'fallback' }, { headers: NO_STORE_HEADERS });
    } finally {
        clearTimeout(timeout);
    }
}
