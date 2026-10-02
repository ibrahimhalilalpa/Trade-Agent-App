'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Activity, ArrowUpRight, BriefcaseBusiness, RefreshCw, RotateCcw, Wallet } from 'lucide-react';
import StockDetailModal from '@/components/StockDetailModal';
import { getBistPriceStep } from '@/lib/bist-market';
import type { PortfolioOrder, PortfolioSnapshot, PortfolioState, PortfolioTrade, PriceAlertEvent } from '@/lib/types';
import { useAppPreferences } from '@/components/AppProviders';

type Range = 'day' | 'week' | 'month' | 'year' | 'all';
type LedgerEntry =
    | { kind: 'trade'; data: PortfolioTrade; createdAt: string }
    | { kind: 'alert'; data: PriceAlertEvent; createdAt: string };
const ORDER_EXPIRY_OPTIONS = [
    { minutes: 60, label: '1 saat' },
    { minutes: 1_440, label: '1 gün' },
    { minutes: 10_080, label: '7 gün' },
    { minutes: 43_200, label: '30 gün' },
    { minutes: 0, label: 'Süresiz' },
];

function expiryDuration(expiresAt: string | null): number {
    if (!expiresAt) return 0;
    const remainingMinutes = (Date.parse(expiresAt) - Date.now()) / 60_000;
    return ORDER_EXPIRY_OPTIONS.find((option) => option.minutes > 0 && remainingMinutes <= option.minutes)?.minutes
        ?? 43_200;
}

function money(value: number): string {
    return `${value.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} TL`;
}

function dayLabel(value: string): string {
    return new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' });
}

function historyPoints(snapshots: PortfolioSnapshot[], range: Range): PortfolioSnapshot[] {
    if (range === 'all' || !snapshots.length) return snapshots;
    const days = range === 'day' ? 2 : range === 'week' ? 7 : range === 'month' ? 30 : 365;
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    return snapshots.filter((snapshot) => new Date(snapshot.createdAt).getTime() >= cutoff);
}

function PortfolioChart({ points }: { points: PortfolioSnapshot[] }) {
    if (points.length < 2) return <div className="portfolio-chart-empty">Performans grafiği, en az iki ayrı günde portföyünüz görüntülendikten sonra oluşur.</div>;
    const values = points.map((point) => point.totalValue);
    const minimum = Math.min(...values);
    const maximum = Math.max(...values);
    const spread = maximum - minimum || 1;
    const line = values.map((value, index) => {
        const x = 16 + (index / (values.length - 1)) * 968;
        const y = 216 - ((value - minimum) / spread) * 188;
        return `${index ? 'L' : 'M'} ${x.toFixed(1)} ${y.toFixed(1)}`;
    }).join(' ');
    const fill = `${line} L 984 232 L 16 232 Z`;
    const rising = values.at(-1)! >= values[0];
    const stroke = rising ? '#34d399' : '#fb7185';
    return <div className="portfolio-chart-wrap">
        <svg className="portfolio-chart" viewBox="0 0 1000 240" role="img" aria-label="Portföy değerinin seçili dönemdeki değişim grafiği" preserveAspectRatio="none">
            <defs><linearGradient id="portfolio-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor={stroke} stopOpacity=".25" /><stop offset="100%" stopColor={stroke} stopOpacity="0" /></linearGradient></defs>
            {[35, 95, 155, 215].map((y) => <line key={y} x1="16" y1={y} x2="984" y2={y} stroke="#1e293b" strokeWidth="1" />)}
            <path d={fill} fill="url(#portfolio-fill)" />
            <path d={line} fill="none" stroke={stroke} strokeWidth="3" vectorEffect="non-scaling-stroke" />
        </svg>
        <div className="portfolio-chart-labels"><span>{dayLabel(points[0].createdAt)}</span><span>{dayLabel(points.at(-1)!.createdAt)}</span></div>
    </div>;
}

function tradeKind(trade: PortfolioTrade): string {
    if (trade.side === 'buy') return 'ALIM';
    if (trade.side === 'sell') return 'SATIM';
    return 'NAKİT AYARI';
}

function orderTypeLabel(orderType: PortfolioOrder['orderType']): string {
    if (orderType === 'limit') return 'Limit';
    if (orderType === 'take_profit') return 'Kâr al';
    if (orderType === 'stop_loss') return 'Zarar durdur';
    return 'Zincir (OCO)';
}

function orderLabel(order: PortfolioOrder): string {
    return orderTypeLabel(order.orderType);
}

function orderEventLabel(eventType: NonNullable<PortfolioState['orderEvents']>[number]['eventType']): string {
    if (eventType === 'created') return 'Oluşturuldu';
    if (eventType === 'updated') return 'Güncellendi';
    if (eventType === 'filled') return 'Gerçekleşti';
    if (eventType === 'cancelled') return 'İptal edildi';
    if (eventType === 'expired') return 'Süresi doldu';
    return 'Başarısız';
}

function alertEventLabel(eventType: PriceAlertEvent['eventType']): string {
    if (eventType === 'created') return 'Alarm kuruldu';
    if (eventType === 'price_changed') return 'Alarm fiyatı değişti';
    if (eventType === 'triggered') return 'Alarm gerçekleşti';
    if (eventType === 'expired') return 'Alarm süresi doldu';
    return 'Alarm iptal edildi';
}

export default function PortfolioWorkspace() {
    const { confirmDialog } = useAppPreferences();
    const router = useRouter();
    const [portfolio, setPortfolio] = useState<PortfolioState | null>(null);
    const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
    const [staleSymbols, setStaleSymbols] = useState<string[]>([]);
    const [range, setRange] = useState<Range>('day');
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [resetting, setResetting] = useState(false);
    const [error, setError] = useState('');
    const [editingOrderId, setEditingOrderId] = useState<string | null>(null);
    const [editQuantity, setEditQuantity] = useState('');
    const [editTriggerPrice, setEditTriggerPrice] = useState('');
    const [editTakeProfit, setEditTakeProfit] = useState('');
    const [editStopLoss, setEditStopLoss] = useState('');
    const [editExpiryMinutes, setEditExpiryMinutes] = useState(43_200);
    const [savingOrder, setSavingOrder] = useState(false);
    const loadInFlight = useRef(false);

    const load = useCallback(async (quiet = false) => {
        if (loadInFlight.current) return;
        loadInFlight.current = true;
        if (quiet) setRefreshing(true);
        else setLoading(true);
        setError('');
        try {
            const response = await fetch(`/api/portfolio?pnlPeriod=${range}`, { cache: 'no-store' });
            const payload = await response.json() as { data?: PortfolioState; staleSymbols?: string[]; error?: string };
            if (!response.ok || !payload.data) {
                if (response.status === 401) throw new Error('Portföyü görüntülemek için giriş yapın.');
                throw new Error(payload.error ?? 'Portföy verileri yüklenemedi.');
            }
            setPortfolio(payload.data);
            setStaleSymbols(payload.staleSymbols ?? []);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'Portföy verileri yüklenemedi.');
        } finally {
            loadInFlight.current = false;
            setLoading(false);
            setRefreshing(false);
        }
    }, [range]);

    const beginEditOrder = (order: PortfolioOrder) => {
        setEditingOrderId(order.id);
        setEditQuantity(String(order.quantity));
        setEditTriggerPrice(order.triggerPrice === null ? '' : String(order.triggerPrice));
        setEditTakeProfit(order.takeProfitPrice === null ? '' : String(order.takeProfitPrice));
        setEditStopLoss(order.stopLossPrice === null ? '' : String(order.stopLossPrice));
        setEditExpiryMinutes(expiryDuration(order.expiresAt));
        setError('');
    };

    const saveOrder = async (order: PortfolioOrder) => {
        if (savingOrder) return;
        const quantity = Number(editQuantity);
        const triggerPrice = Number(editTriggerPrice);
        const takeProfitPrice = Number(editTakeProfit);
        const stopLossPrice = Number(editStopLoss);
        if (!Number.isFinite(quantity) || quantity <= 0
            || (order.orderType !== 'chain' && (!Number.isFinite(triggerPrice) || triggerPrice <= 0))
            || (order.orderType === 'chain'
                && (!Number.isFinite(takeProfitPrice) || !Number.isFinite(stopLossPrice)
                    || takeProfitPrice <= stopLossPrice || stopLossPrice <= 0))) {
            setError('Emir adedi ve fiyatlarını kontrol edin; zincir emirde kâr-al fiyatı zarar-durdur fiyatından yüksek olmalıdır.');
            return;
        }
        setSavingOrder(true);
        setError('');
        try {
            const response = await fetch('/api/portfolio', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'update_order',
                    orderId: order.id,
                    quantity,
                    triggerPrice: order.orderType === 'chain' ? null : triggerPrice,
                    takeProfitPrice: order.orderType === 'chain' ? takeProfitPrice : null,
                    stopLossPrice: order.orderType === 'chain' ? stopLossPrice : null,
                    expiresInMinutes: editExpiryMinutes,
                }),
            });
            const payload = await response.json() as { data?: PortfolioState; error?: string };
            if (!response.ok || !payload.data) throw new Error(payload.error ?? 'Emir güncellenemedi.');
            setPortfolio(payload.data);
            setEditingOrderId(null);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'Emir güncellenemedi.');
        } finally {
            setSavingOrder(false);
        }
    };

    const cancelOrder = async (orderId: string) => {
        setError('');
        try {
            const response = await fetch(`/api/portfolio?orderId=${encodeURIComponent(orderId)}`, { method: 'DELETE' });
            const payload = await response.json() as { data?: PortfolioState; error?: string };
            if (!response.ok || !payload.data) throw new Error(payload.error ?? 'Emir iptal edilemedi.');
            setPortfolio(payload.data);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'Emir iptal edilemedi.');
        }
    };

    const resetPortfolio = async () => {
        const confirmed = await confirmDialog({
            title: 'Portföyü sıfırla?',
            message: 'Tüm pozisyonlar, bekleyen emirler, işlem geçmişi ve performans kayıtları silinir. Bakiye 100.000 TL olur. Bu işlem geri alınamaz.',
            confirmLabel: 'Portföyü sıfırla',
            danger: true,
        });
        if (!confirmed) return;
        setResetting(true);
        setError('');
        try {
            const response = await fetch('/api/portfolio', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'reset' }),
            });
            const payload = await response.json() as { data?: PortfolioState; error?: string };
            if (!response.ok || !payload.data) throw new Error(payload.error ?? 'Portföy sıfırlanamadı.');
            setPortfolio(payload.data);
            setStaleSymbols([]);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'Portföy sıfırlanamadı.');
        } finally {
            setResetting(false);
        }
    };

    useEffect(() => {
        const timer = window.setTimeout(() => void load(), 0);
        return () => window.clearTimeout(timer);
    }, [load]);

    useEffect(() => {
        const interval = window.setInterval(() => void load(true), 20_000);
        return () => window.clearInterval(interval);
    }, [load]);

    const currentValue = portfolio
        ? portfolio.balance + portfolio.positions.reduce((total, position) => total + position.currentPrice * position.quantity, 0)
        : 0;
    const openPnl = portfolio?.positions.reduce((total, position) => total + position.pnl, 0) ?? 0;
    const realizedPnl = portfolio?.realizedPnl ?? 0;
    const totalNetPnl = openPnl + realizedPnl;
    const visiblePoints = useMemo(() => historyPoints(portfolio?.snapshots ?? [], range), [portfolio?.snapshots, range]);
    const ledgerEntries = useMemo<LedgerEntry[]>(() => [
        ...(portfolio?.trades ?? []).map((data) => ({ kind: 'trade' as const, data, createdAt: data.createdAt })),
        ...(portfolio?.priceAlertEvents ?? []).map((data) => ({ kind: 'alert' as const, data, createdAt: data.createdAt })),
    ].sort((first, second) => new Date(second.createdAt).getTime() - new Date(first.createdAt).getTime()), [
        portfolio?.priceAlertEvents, portfolio?.trades,
    ]);
    const periodPnl = portfolio?.periodPnl ?? null;
    const initialPeriodValue = periodPnl === null ? null : currentValue - periodPnl;
    const periodPnlPercent = periodPnl !== null && initialPeriodValue !== null && initialPeriodValue > 0
        ? periodPnl / initialPeriodValue * 100 : null;
    const positionsByReturn = [...(portfolio?.positions ?? [])]
        .filter((position) => position.quantity > 0 && position.averagePrice > 0)
        .map((position) => ({
            symbol: position.symbol,
            returnPercent: position.pnl / (position.quantity * position.averagePrice) * 100,
            value: position.quantity * position.currentPrice,
        }))
        .sort((first, second) => second.returnPercent - first.returnPercent);
    const bestPosition = positionsByReturn[0] ?? null;
    const worstPosition = positionsByReturn.at(-1) ?? null;
    const cashRatio = currentValue > 0 && portfolio ? portfolio.balance / currentValue * 100 : null;
    const largestPositionShare = currentValue > 0 && positionsByReturn.length
        ? Math.max(...positionsByReturn.map((position) => position.value)) / currentValue * 100
        : null;
    const orderedSnapshots = [...(portfolio?.snapshots ?? [])]
        .sort((first, second) => first.createdAt.localeCompare(second.createdAt));
    let peakValue = 0;
    let maximumDrawdown = 0;
    for (const snapshot of orderedSnapshots) {
        peakValue = Math.max(peakValue, snapshot.totalValue);
        if (peakValue > 0) maximumDrawdown = Math.max(maximumDrawdown, (peakValue - snapshot.totalValue) / peakValue * 100);
    }
    const dailyReturns = orderedSnapshots.slice(1).flatMap((snapshot, index) => {
        const previous = orderedSnapshots[index].totalValue;
        return previous > 0 ? [(snapshot.totalValue - previous) / previous] : [];
    });
    const averageDailyReturn = dailyReturns.length
        ? dailyReturns.reduce((sum, value) => sum + value, 0) / dailyReturns.length
        : 0;
    const annualizedVolatility = dailyReturns.length >= 20
        ? Math.sqrt(dailyReturns.reduce((sum, value) => sum + (value - averageDailyReturn) ** 2, 0) / (dailyReturns.length - 1)) * Math.sqrt(252) * 100
        : null;
    const ranges: Array<{ id: Range; label: string }> = [
        { id: 'day', label: 'Günlük' }, { id: 'week', label: 'Haftalık' },
        { id: 'month', label: 'Aylık' }, { id: 'year', label: 'Yıllık' }, { id: 'all', label: 'Tümü' },
    ];

    return <main className="app-shell ds-shell"><div className="app-container ds-container portfolio-workspace">
        <header className="ds-page-heading ds-route-heading">
            <span className="ds-eyebrow">TRADE ENGINE / SANAL PORTFÖY</span>
            <div className="portfolio-page-heading">
                <div><h1><BriefcaseBusiness aria-hidden="true" /> Sanal portföyüm</h1><p>Alım-satım simülasyonlarını, kullanılabilir bakiyeyi ve portföy performansını takip et.</p></div>
                <button className="portfolio-reset-button" onClick={() => void resetPortfolio()} disabled={resetting || loading || !portfolio}>
                    <RotateCcw size={15} /> {resetting ? 'Sıfırlanıyor…' : 'Portföyü sıfırla'}
                </button>
            </div>
        </header>
        {error && <div className="portfolio-alert" role="alert"><span>{error}</span><div>{error.includes('giriş yapın') && <Link href="/auth?next=%2Fportfolio">Giriş yap</Link>}<button onClick={() => void load()}>Tekrar dene</button></div></div>}
        {loading && !portfolio ? <div className="ds-panel portfolio-loading">Portföy yükleniyor…</div> : portfolio && <>
            {staleSymbols.length > 0 && <p className="portfolio-alert" role="status">Anlık fiyat alınamayan semboller eski kapanış fiyatıyla gösteriliyor: {staleSymbols.join(', ')}.</p>}
            <section className="portfolio-summary-grid">
                <article className="ds-panel portfolio-stat"><span><Wallet size={16} /> Kullanılabilir bakiye</span><strong>{money(portfolio.availableBalance ?? portfolio.balance)}</strong><small>{money(portfolio.reservedCash ?? 0)} bekleyen alış emirlerinde rezerve · Toplam nakit {money(portfolio.balance)}</small></article>
                <article className="ds-panel portfolio-stat"><span><BriefcaseBusiness size={16} /> Portföy toplam değeri</span><strong>{money(currentValue)}</strong><small>Nakit + mevcut pozisyonlar</small></article>
                <article className="ds-panel portfolio-stat portfolio-net-pnl">
                    <span><Activity size={16} /> Toplam net kâr / zarar</span>
                    <strong className={totalNetPnl >= 0 ? 'positive' : 'negative'}>
                        {totalNetPnl > 0 ? '+' : ''}{money(totalNetPnl)}
                    </strong>
                    <small>Açık pozisyonlar + satışlarla gerçekleşen sonuç</small>
                </article>
                <article className="ds-panel portfolio-stat portfolio-period-pnl">
                    <span><Activity size={16} /> Dönem net kâr / zarar · {ranges.find((item) => item.id === range)?.label}</span>
                    <strong className={periodPnl === null ? '' : periodPnl >= 0 ? 'positive' : 'negative'}>
                        {periodPnl === null ? 'Dönem verisi henüz yok' : `${periodPnl > 0 ? '+' : ''}${money(periodPnl)}`}
                    </strong>
                    <small>{periodPnlPercent === null ? 'Toplam net kâr/zarar geçmiş kayıt gerektirmeden gösterilir.' : `${periodPnlPercent > 0 ? '+' : ''}${periodPnlPercent.toFixed(2)}% · Açık ve gerçekleşen sonuçlar, nakit ekleme/çekme hariç`}</small>
                </article>
            </section>

            <section className="ds-panel portfolio-performance">
                <div className="portfolio-panel-heading"><div><span className="ds-eyebrow">PERFORMANS TAKİBİ</span><h2>Portföy değer değişimi</h2></div><div className="portfolio-heading-actions"><div className="portfolio-range-switch" role="group" aria-label="Performans zaman aralığı">{ranges.map((item) => <button key={item.id} className={range === item.id ? 'active' : ''} onClick={() => setRange(item.id)}>{item.label}</button>)}</div><button className="portfolio-refresh" onClick={() => void load(true)} disabled={refreshing} aria-label="Portföyü yenile"><RefreshCw size={15} className={refreshing ? 'spin' : ''} /></button></div></div>
                <PortfolioChart points={visiblePoints} />
                <p className="portfolio-footnote">Günlük değer kaydı, portföy ekranı ziyaret edildiğinde alınır. Gösterilen sanal performans yatırım tavsiyesi değildir.</p>
            </section>

            <section className="ds-panel portfolio-risk-summary">
                <div className="portfolio-panel-heading"><div><span className="ds-eyebrow">RİSK VE DAĞILIM</span><h2>Portföy risk özeti</h2></div></div>
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                    <article className="rounded-xl border border-slate-800 bg-slate-950/60 p-3"><span className="text-xs text-slate-400">En iyi pozisyon</span>{bestPosition ? <><strong className="mt-1 block text-sm text-emerald-300">{bestPosition.symbol} · +%{bestPosition.returnPercent.toFixed(2)}</strong><button type="button" onClick={() => setSelectedSymbol(bestPosition.symbol)} className="mt-1 text-[10px] text-slate-500 hover:text-emerald-300">Detayı aç</button></> : <strong className="mt-1 block text-sm text-slate-500">Hesaplanamıyor</strong>}</article>
                    <article className="rounded-xl border border-slate-800 bg-slate-950/60 p-3"><span className="text-xs text-slate-400">En kötü pozisyon</span>{worstPosition ? <><strong className={`mt-1 block text-sm ${worstPosition.returnPercent < 0 ? 'text-rose-300' : 'text-slate-200'}`}>{worstPosition.symbol} · {worstPosition.returnPercent > 0 ? '+' : ''}%{worstPosition.returnPercent.toFixed(2)}</strong><button type="button" onClick={() => setSelectedSymbol(worstPosition.symbol)} className="mt-1 text-[10px] text-slate-500 hover:text-emerald-300">Detayı aç</button></> : <strong className="mt-1 block text-sm text-slate-500">Hesaplanamıyor</strong>}</article>
                    <article className="rounded-xl border border-slate-800 bg-slate-950/60 p-3"><span className="text-xs text-slate-400">Nakit oranı</span><strong className="mt-1 block text-sm text-white">{cashRatio === null ? '—' : `%${cashRatio.toFixed(2)}`}</strong><span className="mt-1 block text-[10px] text-slate-500">Toplam portföy değerine göre</span></article>
                    <article className="rounded-xl border border-slate-800 bg-slate-950/60 p-3"><span className="text-xs text-slate-400">En büyük pozisyon payı</span><strong className="mt-1 block text-sm text-white">{largestPositionShare === null ? '—' : `%${largestPositionShare.toFixed(2)}`}</strong><span className="mt-1 block text-[10px] text-slate-500">Tek hisse yoğunlaşma göstergesi</span></article>
                    <article className="rounded-xl border border-slate-800 bg-slate-950/60 p-3"><span className="text-xs text-slate-400">Maksimum düşüş</span><strong className="mt-1 block text-sm text-rose-300">{orderedSnapshots.length < 2 ? 'Yetersiz geçmiş' : `-%${maximumDrawdown.toFixed(2)}`}</strong><span className="mt-1 block text-[10px] text-slate-500">{orderedSnapshots.length} günlük kayıt üzerinden</span></article>
                    <article className="rounded-xl border border-slate-800 bg-slate-950/60 p-3"><span className="text-xs text-slate-400">Yıllıklandırılmış oynaklık</span><strong className="mt-1 block text-sm text-white">{annualizedVolatility === null ? 'Yetersiz geçmiş' : `%${annualizedVolatility.toFixed(2)}`}</strong><span className="mt-1 block text-[10px] text-slate-500">{dailyReturns.length < 20 ? 'En az 20 günlük getiri kaydı gerekir' : 'Günlük portföy getirilerinden hesaplandı'}</span></article>
                    <article className="rounded-xl border border-slate-800 bg-slate-950/60 p-3"><span className="text-xs text-slate-400">Sektör dağılımı</span><strong className="mt-1 block text-sm text-slate-500">Veri yok</strong><span className="mt-1 block text-[10px] text-slate-500">Pozisyonların doğrulanmış sektör sınıflandırması henüz mevcut değil.</span></article>
                    <article className="rounded-xl border border-slate-800 bg-slate-950/60 p-3"><span className="text-xs text-slate-400">BIST 100 karşılaştırması</span><strong className="mt-1 block text-sm text-slate-500">Veri yok</strong><span className="mt-1 block text-[10px] text-slate-500">Aynı tarih aralığına ait güvenilir benchmark serisi alınamıyor.</span></article>
                </div>
                <p className="mt-3 text-[10px] leading-5 text-slate-500">Maksimum düşüş ve oynaklık yalnızca kaydedilmiş günlük portföy değerlerinden hesaplanır. Günlük kayıtlar portföy ekranı ziyaret edildiğinde yazılır; boşluklar veya kısa geçmiş yatırım riski ölçümü için yeterli değildir.</p>
            </section>

            <div className="portfolio-content-grid">
                <section className="ds-panel portfolio-positions">
                    <div className="portfolio-panel-heading"><div><span className="ds-eyebrow">SANAL VARLIKLAR</span><h2>Hisse pozisyonlarım</h2></div><Link href="/lists">Listelerden hisse incele <ArrowUpRight size={14} /></Link></div>
                    {portfolio.positions.length ? <div className="portfolio-position-list">{portfolio.positions.map((position) => {
                        const value = position.quantity * position.currentPrice;
                        return <article className="portfolio-position" key={position.symbol}>
                            <div className="portfolio-position-title"><div><button className="portfolio-symbol-button" onClick={() => setSelectedSymbol(position.symbol)} aria-label={`${position.symbol} detaylarını aç ve alım satım yap`}><strong>{position.symbol}</strong><span>{position.quantity.toLocaleString('tr-TR')} adet</span></button></div><strong>{money(value)}</strong></div>
                            <div className="portfolio-position-details"><span>Ort. maliyet <b>{money(position.averagePrice)}</b></span><span>Güncel fiyat <b>{money(position.currentPrice)}</b></span><span>Portföy payı <b>{currentValue ? `%${(value / currentValue * 100).toFixed(2)}` : '—'}</b></span></div>
                            <div className={`portfolio-pnl ${position.pnl >= 0 ? 'positive' : 'negative'}`}>Açık kâr / zarar: {position.pnl >= 0 ? '+' : ''}{money(position.pnl)}</div>
                            <button className="portfolio-trade-link" onClick={() => setSelectedSymbol(position.symbol)}>Grafik, detay ve al / sat <ArrowUpRight size={13} /></button>
                        </article>;
                    })}</div> : <div className="portfolio-empty"><BriefcaseBusiness size={25} /><strong>Henüz sanal pozisyon yok</strong><span>Listelerinden bir hisse açıp adet ve fiyat girerek simüle alım yapabilirsin.</span><Link href="/lists">Çalışma listelerine git <ArrowUpRight size={14} /></Link></div>}
                </section>
                <section className="ds-panel portfolio-orders">
                    <div className="portfolio-panel-heading"><div><span className="ds-eyebrow">EMİR TAKİBİ</span><h2>Bekleyen emirler</h2></div></div>
                    {portfolio.orders?.some((order) => order.status === 'pending') ? <div className="portfolio-pending-orders">{portfolio.orders.filter((order) => order.status === 'pending').map((order) => <article key={order.id}>
                        <div><strong><button type="button" onClick={() => setSelectedSymbol(order.symbol)} className="hover:text-emerald-300">{order.symbol}</button> · {orderLabel(order)}</strong><small>{order.side === 'buy' ? 'Alış' : 'Satış'} · {order.quantity.toLocaleString('tr-TR')} adet</small>{order.error && <small className="portfolio-order-reason">Bekleme nedeni: {order.error}</small>}</div>
                        <span>{order.orderType === 'chain'
                            ? `Kâr al ${money(order.takeProfitPrice ?? 0)} / Zarar durdur ${money(order.stopLossPrice ?? 0)}`
                            : `Tetik ${money(order.triggerPrice ?? 0)}`}{order.expiresAt
                            ? ` · Bitiş ${new Date(order.expiresAt).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' })}`
                            : ' · Süresiz'}</span>
                        <button className="portfolio-order-edit-button" onClick={() => beginEditOrder(order)}>Güncelle</button>
                        <button onClick={() => void cancelOrder(order.id)}>İptal</button>
                        {editingOrderId === order.id && <div className="portfolio-order-editor">
                            <label>Adet (tam sayı)<input type="number" min="1" step="1" value={editQuantity} onChange={(event) => setEditQuantity(event.target.value)} /></label>
                            {order.orderType === 'chain' ? <>
                                <label>Kâr al (TL)<input type="number" min="0" step={getBistPriceStep(Number(editTakeProfit))} value={editTakeProfit} onChange={(event) => setEditTakeProfit(event.target.value)} /></label>
                                <label>Zarar durdur (TL)<input type="number" min="0" step={getBistPriceStep(Number(editStopLoss))} value={editStopLoss} onChange={(event) => setEditStopLoss(event.target.value)} /></label>
                            </> : <label>Tetik fiyatı (TL)<input type="number" min="0" step={getBistPriceStep(Number(editTriggerPrice))} value={editTriggerPrice} onChange={(event) => setEditTriggerPrice(event.target.value)} /></label>}
                            <label>Güncelleyince yeni süre<select value={editExpiryMinutes} onChange={(event) => setEditExpiryMinutes(Number(event.target.value))}>
                                {ORDER_EXPIRY_OPTIONS.map((option) => <option key={option.minutes} value={option.minutes}>{option.label}</option>)}
                            </select></label>
                            <div><button onClick={() => void saveOrder(order)} disabled={savingOrder}>{savingOrder ? 'Kaydediliyor…' : 'Kaydet'}</button><button className="portfolio-order-edit-button" onClick={() => setEditingOrderId(null)} disabled={savingOrder}>Vazgeç</button></div>
                        </div>}
                    </article>)}</div> : <p className="portfolio-footnote">Aktif emirleriniz burada görünür. Limit veya koşullu emir verdiğinizde durumunu buradan izleyebilir, tetiklenmeden önce iptal edebilirsiniz.</p>}
                    <details className="portfolio-history-disclosure">
                        <summary><span><i className="ds-eyebrow">EMİR GÜNLÜĞÜ</i><strong>Emir geçmişi</strong></span><small>{portfolio.orderEvents?.length ?? 0} kayıt</small></summary>
                        {portfolio.orderEvents?.length ? <div className="portfolio-transaction-list">{portfolio.orderEvents.map((event) => <article key={event.id}>
                            <span className={`portfolio-transaction-badge ${event.eventType === 'filled' ? event.side : 'adjustment'}`}>{orderEventLabel(event.eventType)}</span>
                            <div>
                                <strong><button type="button" onClick={() => setSelectedSymbol(event.symbol)} className="hover:text-emerald-300">{event.symbol}</button> · {event.side === 'buy' ? 'Alış' : 'Satış'} · {event.quantity.toLocaleString('tr-TR')} adet</strong>
                                <small>{orderTypeLabel(event.orderType)} · {new Date(event.createdAt).toLocaleString('tr-TR', { dateStyle: 'medium', timeStyle: 'short' })}</small>
                                {event.error && <small className="negative">{event.error}</small>}
                            </div>
                            <b>{event.price === null ? 'Fiyat yok' : `${money(event.price)} / adet`}</b>
                        </article>)}</div> : <p className="portfolio-footnote">Henüz emir olayı bulunmuyor.</p>}
                    </details>
                </section>
                <section className="ds-panel portfolio-transactions">
                    <details className="portfolio-history-disclosure">
                        <summary><span><i className="ds-eyebrow">HESAP DEFTERİ</i><strong>Gerçekleşen işlemler ve alarm günlüğü</strong></span><small>{ledgerEntries.length} kayıt</small></summary>
                        {ledgerEntries.length ? <div className="portfolio-transaction-list">{ledgerEntries.map((entry) => {
                        if (entry.kind === 'alert') {
                            const alert = entry.data;
                            return <article key={`alert-${alert.id}`}>
                                <span className="portfolio-transaction-badge alert">{alertEventLabel(alert.eventType)}</span>
                                <div>
                                    <strong><button type="button" onClick={() => setSelectedSymbol(alert.symbol)} className="hover:text-emerald-300">{alert.symbol}</button> · {alert.direction === 'above' ? 'Yükselirse' : 'Düşerse'} · {money(alert.targetPrice)}</strong>
                                    <small>{new Date(alert.createdAt).toLocaleString('tr-TR', { dateStyle: 'medium', timeStyle: 'short' })}</small>
                                </div>
                                <b>{alert.marketPrice === null ? '—' : `${money(alert.marketPrice)} piyasa`}</b>
                            </article>;
                        }
                        const trade = entry.data;
                        return <article key={`trade-${trade.id}`}>
                            <span className={`portfolio-transaction-badge ${trade.side}`}>{tradeKind(trade)}</span>
                            <div><strong>{trade.side === 'cash_adjustment' ? 'Sanal cüzdan bakiyesi' : <><button type="button" onClick={() => trade.symbol && setSelectedSymbol(trade.symbol)} className="hover:text-emerald-300">{trade.symbol}</button> · {trade.quantity.toLocaleString('tr-TR')} adet</>}</strong><small>{new Date(trade.createdAt).toLocaleString('tr-TR', { dateStyle: 'medium', timeStyle: 'short' })}</small>{trade.side !== 'cash_adjustment' && <small>Komisyon {money(trade.commissionAmount)} · Kayma {money(trade.slippageAmount)}</small>}{trade.side === 'sell' && <small className={trade.realizedPnl >= 0 ? 'positive' : 'negative'}>Gerçekleşen: {trade.realizedPnl > 0 ? '+' : ''}{money(trade.realizedPnl)}</small>}</div>
                            <b>{trade.side === 'cash_adjustment' ? `${trade.cashDelta >= 0 ? '+' : ''}${money(trade.cashDelta)}` : `${money(trade.price)} / adet`}</b>
                        </article>;
                        })}</div> : <p className="portfolio-footnote">Henüz portföy hareketi bulunmuyor.</p>}
                    </details>
                </section>
            </div>
        </>}
    </div><StockDetailModal symbol={selectedSymbol} onClose={() => setSelectedSymbol(null)} onAnalyze={(symbol) => router.push(`/trade-agent?symbol=${encodeURIComponent(symbol)}`)} /></main>;
}
