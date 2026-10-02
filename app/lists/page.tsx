'use client';

import ResearchLists from '@/components/ResearchLists';
import { useRouter } from 'next/navigation';
import { ArrowRight, BookOpen, Heart, ListChecks, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import StockDetailModal from '@/components/StockDetailModal';
import { useCallback, useEffect, useState } from 'react';
import { BriefcaseBusiness, RefreshCw } from 'lucide-react';
import type { MarketQuote, PortfolioState } from '@/lib/types';

type PnlPeriod = 'day' | 'week' | 'month' | 'year' | 'total';
const PNL_PERIODS: Array<{ value: PnlPeriod; label: string }> = [
    { value: 'day', label: 'Gün' },
    { value: 'week', label: 'Hafta' },
    { value: 'month', label: 'Ay' },
    { value: 'year', label: 'Yıl' },
    { value: 'total', label: 'Toplam' },
];

export default function ListsPage() {
    const router = useRouter();
    const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
    const [portfolio, setPortfolio] = useState<PortfolioState | null>(null);
    const [portfolioLoading, setPortfolioLoading] = useState(true);
    const [portfolioAuthRequired, setPortfolioAuthRequired] = useState(false);
    const [portfolioError, setPortfolioError] = useState('');
    const [pnlPeriod, setPnlPeriod] = useState<PnlPeriod>('total');
    const [marketQuotes, setMarketQuotes] = useState<Record<string, MarketQuote>>({});
    const loadPortfolio = useCallback(async (period: PnlPeriod = 'total') => {
        setPortfolioError('');
        try {
            const apiPeriod = period === 'total' ? 'all' : period;
            const response = await fetch(`/api/portfolio?pnlPeriod=${apiPeriod}`, { cache: 'no-store' });
            const payload = await response.json() as { data?: PortfolioState; error?: string };
            if (response.status === 401) {
                setPortfolioAuthRequired(true);
                setPortfolio(null);
                return;
            }
            if (!response.ok || !payload.data) throw new Error(payload.error ?? 'Portföy pozisyonları yüklenemedi.');
            setPortfolioAuthRequired(false);
            setPortfolio(payload.data);
        } catch (cause) {
            setPortfolioError(cause instanceof Error ? cause.message : 'Portföy pozisyonları yüklenemedi.');
        } finally {
            setPortfolioLoading(false);
        }
    }, []);

    useEffect(() => {
        queueMicrotask(() => void loadPortfolio(pnlPeriod));
        let active = true;
        const loadQuotes = async () => {
            try {
                const response = await fetch('/api/market?limit=all&period=1D', { cache: 'no-store' });
                const payload = await response.json() as { data?: MarketQuote[]; error?: string };
                if (!response.ok || !payload.data) throw new Error(payload.error ?? 'Piyasa fiyatları alınamadı.');
                if (active) setMarketQuotes(Object.fromEntries(payload.data.map((quote) => [quote.symbol, quote])));
            } catch (cause) {
                if (active) console.error('Portfolio list market quote refresh failed.', cause);
            }
        };
        queueMicrotask(() => void loadQuotes());
        const quoteRefresh = window.setInterval(() => void loadQuotes(), 60_000);
        const onVisible = () => {
            if (document.visibilityState === 'visible') {
                void loadPortfolio(pnlPeriod);
                void loadQuotes();
            }
        };
        document.addEventListener('visibilitychange', onVisible);
        return () => {
            active = false;
            window.clearInterval(quoteRefresh);
            document.removeEventListener('visibilitychange', onVisible);
        };
    }, [loadPortfolio, pnlPeriod]);

    useEffect(() => {
        if (pnlPeriod !== 'year' || !portfolio?.positions.length) return;
        let active = true;
        const loadAnnualReturns = async () => {
            const results = await Promise.all(portfolio.positions.map(async ({ symbol }) => {
                const response = await fetch(`/api/market?symbol=${encodeURIComponent(symbol)}`, { cache: 'no-store' });
                const payload = await response.json() as { data?: MarketQuote[]; error?: string };
                if (!response.ok || !payload.data?.[0]) {
                    throw new Error(payload.error ?? `Yıllık fiyat geçmişi alınamadı: ${symbol}`);
                }
                return payload.data[0];
            }));
            if (!active) return;
            setMarketQuotes((current) => ({
                ...current,
                ...Object.fromEntries(results.map((quote) => [quote.symbol, {
                    ...quote,
                    ...current[quote.symbol],
                    change1Y: quote.change1Y,
                }])),
            }));
        };
        void loadAnnualReturns().catch((cause: unknown) => {
            if (active) console.error('Portfolio annual market history refresh failed.', cause);
        });
        return () => {
            active = false;
        };
    }, [pnlPeriod, portfolio?.positions]);

    const money = (value: number) => `${value.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₺`;
    const livePrice = (position: PortfolioState['positions'][number]) => {
        const quotePrice = marketQuotes[position.symbol]?.price;
        return typeof quotePrice === 'number' && Number.isFinite(quotePrice) && quotePrice > 0
            ? quotePrice
            : position.currentPrice;
    };
    const positionsValue = portfolio?.positions.reduce((sum, position) => sum + position.quantity * livePrice(position), 0) ?? 0;
    const getPositionPeriodPnl = (position: PortfolioState['positions'][number]) => {
        const price = livePrice(position);
        if (pnlPeriod === 'total') {
            const cost = position.averagePrice * position.quantity;
            return { pnl: (price - position.averagePrice) * position.quantity, basis: cost };
        }
        const quote = marketQuotes[position.symbol];
        const change = pnlPeriod === 'day' ? quote?.change1D
            : pnlPeriod === 'week' ? quote?.change1W
                : pnlPeriod === 'month' ? quote?.change1M
                    : quote?.change1Y;
        if (typeof quote?.price !== 'number' || !Number.isFinite(quote.price) || quote.price <= 0
            || typeof change !== 'number' || !Number.isFinite(change) || change <= -100) return null;

        const periodStart = new Date();
        if (pnlPeriod === 'day') periodStart.setUTCHours(0, 0, 0, 0);
        else {
            const periodDays = pnlPeriod === 'week' ? 7 : pnlPeriod === 'month' ? 30 : 365;
            periodStart.setTime(periodStart.getTime() - periodDays * 24 * 60 * 60 * 1000);
        }
        const trades = (portfolio?.trades ?? [])
            .filter((trade) => trade.symbol === position.symbol
                && (trade.side === 'buy' || trade.side === 'sell')
                && new Date(trade.createdAt).getTime() >= periodStart.getTime())
            .sort((first, second) => new Date(second.createdAt).getTime() - new Date(first.createdAt).getTime());

        let openingQuantity = position.quantity;
        let openingCost = position.quantity * position.averagePrice;
        for (const trade of trades) {
            if (trade.side === 'buy') {
                openingQuantity -= trade.quantity;
                openingCost -= trade.quantity * trade.price;
            } else {
                openingQuantity += trade.quantity;
                openingCost += trade.quantity * trade.price - trade.realizedPnl;
            }
        }
        if (openingQuantity < -0.000001 || !Number.isFinite(openingCost)) return null;
        openingQuantity = Math.max(0, openingQuantity);
        const openingAverage = openingQuantity > 0 ? openingCost / openingQuantity : 0;
        const startPrice = quote.price / (1 + change / 100);
        const openingPnl = openingQuantity * (startPrice - openingAverage);
        const currentOpenPnl = (price - position.averagePrice) * position.quantity;
        const realizedPnl = trades.reduce((total, trade) => total + (trade.side === 'sell' ? trade.realizedPnl : 0), 0);
        const buyBasis = trades.reduce((total, trade) => total + (trade.side === 'buy' ? trade.quantity * trade.price : 0), 0);
        return {
            pnl: currentOpenPnl - openingPnl + realizedPnl,
            basis: openingQuantity * startPrice + buyBasis,
        };
    };
    const totalPositionPnl = portfolio?.periodPnl ?? null;
    const currentPortfolioValue = (portfolio?.balance ?? 0)
        + (portfolio?.positions.reduce((sum, position) => sum + position.currentPrice * position.quantity, 0) ?? 0);
    const initialPortfolioValue = totalPositionPnl === null ? null : currentPortfolioValue - totalPositionPnl;
    const totalPositionPnlPercent = totalPositionPnl !== null && initialPortfolioValue !== null && initialPortfolioValue > 0
        ? totalPositionPnl / initialPortfolioValue * 100
        : null;
    const pnlColor = (value: number) => value >= 0 ? 'text-emerald-300' : 'text-rose-300';

    return <main className="app-shell ds-shell"><div className="app-container ds-container">
        <header className="ds-page-heading ds-route-heading">
            <span className="ds-eyebrow">TRADE ENGINE / KİŞİSEL ARAŞTIRMA</span>
            <h1><ListChecks aria-hidden="true" /> Çalışma listelerin</h1>
            <p>Hisselerini kendi listelerinde düzenle; fiyatı ve günlük, haftalık, aylık değişimleri takip edip analize geç.</p>
        </header>
        <div className="ds-route-grid ds-list-grid">
            <div className="ds-route-main space-y-5">
                {!portfolioAuthRequired && <section className="overflow-hidden rounded-2xl border border-emerald-500/30 bg-gradient-to-br from-emerald-500/10 via-slate-900 to-slate-900 shadow-xl shadow-emerald-950/20">
                    <div className="flex flex-wrap items-center justify-between gap-4 border-b border-emerald-500/15 px-5 py-4 sm:px-6">
                        <div className="flex min-w-0 items-center gap-3">
                            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-emerald-500/25 bg-emerald-500/10 text-emerald-300"><BriefcaseBusiness size={19} /></span>
                            <div><span className="text-[10px] font-bold tracking-[.16em] text-emerald-300">SANAL PORTFÖY</span><h2 className="mt-0.5 text-base font-extrabold text-white">Sahip olduğun hisseler</h2></div>
                        </div>
                        <div className="flex flex-wrap items-center justify-end gap-3">
                            <div className="text-right"><span className="block text-[10px] text-slate-500">Pozisyon değeri</span><strong className="text-sm text-white">{money(positionsValue)}</strong></div>
                            <div className="min-w-0 rounded-lg border border-slate-700/70 bg-slate-950/60 px-2.5 py-1.5 text-right"><span className="block text-[9px] text-slate-500">{PNL_PERIODS.find((item) => item.value === pnlPeriod)?.label} portföy kâr / zarar</span><strong className={`block text-xs ${totalPositionPnl === null ? 'text-slate-500' : pnlColor(totalPositionPnl)}`}>{totalPositionPnl === null ? 'Dönem verisi yok' : `${totalPositionPnl > 0 ? '+' : ''}${money(totalPositionPnl)}`}</strong><span className={`text-[9px] ${totalPositionPnl === null ? 'text-slate-500' : pnlColor(totalPositionPnl)}`}>{totalPositionPnlPercent === null ? '—' : `${totalPositionPnlPercent > 0 ? '+' : ''}${totalPositionPnlPercent.toLocaleString('tr-TR', { maximumFractionDigits: 2 })}%`}</span></div>
                            <button type="button" onClick={() => void loadPortfolio(pnlPeriod)} disabled={portfolioLoading} aria-label="Portföyü yenile" title="Portföyü yenile" className="rounded-lg border border-slate-700 bg-slate-800 p-2 text-slate-300 transition hover:border-emerald-500/40 hover:text-emerald-300 disabled:opacity-50"><RefreshCw size={14} className={portfolioLoading ? 'animate-spin' : ''} /></button>
                            <Link href="/portfolio" className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white transition hover:bg-emerald-500">Portföyü aç</Link>
                        </div>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 px-4 py-2.5">
                        <span className="text-[10px] font-semibold text-slate-500">Pozisyon kâr / zarar dönemi</span>
                        <div className="flex items-center gap-1 rounded-lg border border-slate-700/70 bg-slate-950/70 p-1" role="group" aria-label="Portföy kâr zarar dönemi">
                            {PNL_PERIODS.map((period) => <button key={period.value} type="button" onClick={() => setPnlPeriod(period.value)} aria-pressed={pnlPeriod === period.value} className={`rounded-md px-2.5 py-1 text-[10px] font-bold transition ${pnlPeriod === period.value ? 'bg-emerald-500/15 text-emerald-300' : 'text-slate-500 hover:text-slate-200'}`}>{period.label}</button>)}
                        </div>
                    </div>
                    <p className="px-4 pt-2 text-[10px] leading-4 text-slate-500">Dönem içinde alınan hisselerde sonuç alış fiyatından; dönem başında zaten elde olanlarda dönem başı fiyatından hesaplanır. Satışların gerçekleşen kâr/zararı da döneme eklenir.</p>
                    {portfolioError ? <div role="alert" className="m-4 rounded-lg border border-rose-500/20 bg-rose-500/10 p-3 text-xs text-rose-300">{portfolioError}</div>
                        : portfolioLoading && !portfolio ? <p className="px-5 py-6 text-xs text-slate-400">Portföy pozisyonları yükleniyor…</p>
                            : portfolio?.positions.length ? <div className="grid gap-2 p-4 sm:grid-cols-2 xl:grid-cols-3">{portfolio.positions.map((position) => {
                                const selectedPeriodPnl = getPositionPeriodPnl(position);
                                const selectedPnl = selectedPeriodPnl?.pnl ?? null;
                                const returnPercent = selectedPeriodPnl && selectedPeriodPnl.basis > 0
                                    ? selectedPeriodPnl.pnl / selectedPeriodPnl.basis * 100
                                    : null;
                                const currentPrice = livePrice(position);
                                return <button key={position.symbol} type="button" onClick={() => setSelectedSymbol(position.symbol)} className="flex min-w-0 items-center justify-between gap-3 rounded-xl border border-slate-700/80 bg-slate-950/70 p-3 text-left transition hover:border-emerald-500/40 hover:bg-slate-950">
                                    <span className="min-w-0"><strong className="block truncate text-sm font-extrabold text-white">{position.symbol}</strong><small className="mt-1 block text-[10px] text-slate-500">{position.quantity.toLocaleString('tr-TR')} adet · Ort. maliyet {money(position.averagePrice)}</small><small className="mt-1 block text-[10px] font-semibold text-slate-300">Anlık fiyat {money(currentPrice)}</small></span>
                                    <span className="shrink-0 text-right"><strong className="block text-xs text-slate-100">{money(currentPrice * position.quantity)}</strong><small className={`mt-1 block text-[10px] font-semibold ${selectedPnl === null ? 'text-slate-500' : pnlColor(selectedPnl)}`}>{selectedPnl === null ? 'Dönem verisi yok' : `${selectedPnl > 0 ? '+' : ''}${money(selectedPnl)}`}</small><small className={`mt-0.5 inline-flex rounded-full px-2 py-0.5 text-[9px] font-semibold ${returnPercent === null ? 'bg-slate-800 text-slate-500' : returnPercent >= 0 ? 'bg-emerald-500/10 text-emerald-300' : 'bg-rose-500/10 text-rose-300'}`}>{returnPercent === null ? '—' : `${returnPercent > 0 ? '+' : ''}${returnPercent.toLocaleString('tr-TR', { maximumFractionDigits: 2 })}%`}</small></span>
                                </button>;
                            })}</div>
                                : <div className="px-5 py-6"><p className="text-sm font-semibold text-slate-200">Henüz açık hisse pozisyonun yok.</p><p className="mt-1 text-xs text-slate-500">Bir alış işlemi gerçekleştiğinde hisse bu alanda otomatik görünür. Bekleyen emirler gerçekleşene kadar burada listelenmez.</p><Link href="/portfolio" className="mt-3 inline-flex items-center gap-1 text-xs font-bold text-emerald-300 hover:text-emerald-200">Portföy ve emirleri görüntüle <ArrowRight size={13} /></Link></div>}
                </section>}
                <ResearchLists selectedSymbol={selectedSymbol ?? 'THYAO'} onSelect={setSelectedSymbol} />
            </div>
            <aside className="ds-route-aside">
                <section className="ds-panel ds-aside-card"><div className="ds-card-heading"><h2><Heart size={18} /> Liste akışı</h2><span className="ds-badge ds-badge-emerald">Kişisel alan</span></div>
                    <ol className="ds-step-list"><li><span>01</span><div><strong>Bir liste oluştur</strong><small>Takip ettiğin hisseleri araştırma amacına göre grupla.</small></div></li><li><span>02</span><div><strong>Hisseleri ekle</strong><small>Fiyat ve dönemsel performansı aynı yerde görüntüle.</small></div></li><li><span>03</span><div><strong>Analize geç</strong><small>Bir hisseyi seçerek şirket araştırmasını aç.</small></div></li></ol>
                </section>
                <section className="ds-panel ds-aside-card"><h2><BookOpen size={18} /> Mikro rehberlik</h2><p>Listeler izleme ve karşılaştırma içindir; alım-satım önerisi oluşturmaz.</p><Link className="ds-aside-link" href="/education">Risk yönetimi derslerine git <ArrowRight size={14} /></Link><div className="ds-guidance"><ShieldCheck size={15} /><span>Fiyatlar sağlayıcı gecikmesine tabi olabilir.</span></div></section>
            </aside>
        </div>
    </div><StockDetailModal symbol={selectedSymbol} onClose={() => setSelectedSymbol(null)} onAnalyze={(symbol) => router.push(`/trade-agent?symbol=${symbol}`)} /></main>;
}
