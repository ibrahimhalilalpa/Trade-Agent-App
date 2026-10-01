'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownRight, ArrowUpRight, ChevronLeft, ChevronRight, Minus, RefreshCw } from 'lucide-react';
import type { MarketQuote } from '@/lib/types';

interface MarketOverviewProps { symbols?: string[]; selectedSymbol: string; onSelect: (symbol: string) => void; onSymbolCountChange?: (count: number) => void; }
type SortMode = 'ALL' | 'UP' | 'DOWN' | 'FLAT';
type PageSize = '20' | '50' | '100' | 'all';
type Period = '1D' | '1W' | '1M' | '6M' | '1Y' | '5Y';
type SortKey = 'symbol' | 'change' | 'price' | 'volume' | 'marketCap';
const FALLBACK_SYMBOLS = ['THYAO', 'GARAN', 'EREGL', 'ASELS', 'KCHOL', 'SASA', 'SISE', 'TUPRS', 'AKBNK', 'BIMAS', 'YKBNK', 'MANAS'];
const PERIODS: Array<[Period, string]> = [['1D', 'Günlük'], ['1W', 'Haftalık'], ['1M', 'Aylık'], ['6M', '6 ay'], ['1Y', '1 yıl'], ['5Y', '5 yıl']];

function formatLarge(value: number): string {
    if (!value) return '--';
    if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)} Mr`;
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)} Mn`;
    return value.toLocaleString('tr-TR');
}

function fallbackRows(symbols: string[]): MarketQuote[] {
    return symbols.map((symbol) => ({ symbol, name: `${symbol} BİST`, price: 0, changePercent: 0, volume: 0, marketCap: 0, exchange: 'BIST', updatedAt: new Date().toISOString(), source: 'fallback' }));
}

function formatQuoteTime(value: string): string { return value ? new Date(value).toLocaleString('tr-TR') : '--'; }

export default function MarketOverview({ symbols = FALLBACK_SYMBOLS, selectedSymbol, onSelect, onSymbolCountChange }: MarketOverviewProps) {
    const [rows, setRows] = useState<MarketQuote[]>([]);
    const [sortMode, setSortMode] = useState<SortMode>('ALL');
    const [period, setPeriod] = useState<Period>('1D');
    const [sortKey, setSortKey] = useState<SortKey>('symbol');
    const [direction, setDirection] = useState<'asc' | 'desc'>('asc');
    const [query, setQuery] = useState('');
    const [pageSize, setPageSize] = useState<PageSize>('20');
    const [page, setPage] = useState(1);
    const [loading, setLoading] = useState(true);
    const [lastUpdated, setLastUpdated] = useState('');
    const [provider, setProvider] = useState<'tradingview' | 'fallback' | ''>('');
    const previousPrices = useRef<Record<string, number>>({});
    const [priceMoves, setPriceMoves] = useState<Record<string, 'up' | 'down' | 'flat'>>({});

    useEffect(() => {
        let active = true;
        const load = async () => {
            setLoading(true);
            try {
                const response = await fetch(`/api/market?limit=all&period=${period}`, { cache: 'no-store' });
                const payload = await response.json() as { data?: MarketQuote[]; provider?: 'tradingview' | 'fallback' };
                if (!active) return;
                const nextRows = payload.data?.length ? payload.data : fallbackRows(symbols);
                const nextPrices: Record<string, number> = {};
                const nextMoves: Record<string, 'up' | 'down' | 'flat'> = {};
                nextRows.forEach((row) => {
                    nextPrices[row.symbol] = row.price;
                    const previous = previousPrices.current[row.symbol];
                    nextMoves[row.symbol] = previous === undefined || row.price === previous
                        ? 'flat' : row.price > previous ? 'up' : 'down';
                });
                previousPrices.current = nextPrices;
                setPriceMoves(nextMoves);
                setRows(nextRows);
                setProvider(payload.provider ?? 'fallback');
                setLastUpdated(new Date().toISOString());
            } catch {
                if (active) { setRows(fallbackRows(symbols)); setProvider('fallback'); setLastUpdated(''); }
            } finally { if (active) setLoading(false); }
        };
        void load();
        const interval = window.setInterval(() => void load(), 30_000);
        return () => { active = false; window.clearInterval(interval); };
    }, [period, symbols]);

    useEffect(() => {
        onSymbolCountChange?.(rows.length);
    }, [onSymbolCountChange, rows.length]);

    const visibleRows = useMemo(() => rows.filter((row) => (
        (row.symbol.includes(query.trim().toUpperCase()) || row.name.toLocaleUpperCase('tr-TR').includes(query.trim().toLocaleUpperCase('tr-TR')))
        && (sortMode === 'ALL' || (sortMode === 'UP' ? row.changePercent > 0 : sortMode === 'DOWN' ? row.changePercent < 0 : row.changePercent === 0))
    )).sort((first, second) => {
        if (sortMode === 'UP') return second.changePercent - first.changePercent || first.symbol.localeCompare(second.symbol, 'tr');
        if (sortMode === 'DOWN') return first.changePercent - second.changePercent || first.symbol.localeCompare(second.symbol, 'tr');
        const comparison = sortKey === 'symbol'
            ? first.symbol.localeCompare(second.symbol, 'tr', { numeric: true })
            : (sortKey === 'change' ? first.changePercent : first[sortKey])
                - (sortKey === 'change' ? second.changePercent : second[sortKey]);
        return comparison * (direction === 'asc' ? 1 : -1);
    }), [direction, query, rows, sortKey, sortMode]);
    const pageCount = pageSize === 'all' ? 1 : Math.max(1, Math.ceil(visibleRows.length / Number(pageSize)));
    const currentPage = Math.min(page, pageCount);
    const startIndex = pageSize === 'all' ? 0 : (currentPage - 1) * Number(pageSize);
    const pageRows = pageSize === 'all' ? visibleRows : visibleRows.slice(startIndex, startIndex + Number(pageSize));
    const rangeStart = visibleRows.length ? startIndex + 1 : 0;
    const rangeEnd = Math.min(startIndex + pageRows.length, visibleRows.length);

    const toggleSort = (key: SortKey) => {
        if (sortMode !== 'ALL') return;
        setPage(1);
        if (sortKey === key) setDirection((value) => value === 'asc' ? 'desc' : 'asc');
        else { setSortKey(key); setDirection('desc'); }
    };
    const sortArrow = (key: SortKey) => sortMode === 'UP' && key === 'change' ? ' ↓'
        : sortMode === 'DOWN' && key === 'change' ? ' ↑'
            : sortMode === 'ALL' && sortKey === key ? direction === 'asc' ? ' ↑' : ' ↓' : '';
    const header = (label: string, key: SortKey) => <th key={key}><button className="table-sort" title={sortMode === 'ALL' ? `${label} sıralamasını değiştir` : 'Bu görünüm değişim yüzdesine göre sıralanır'} disabled={sortMode !== 'ALL'} onClick={() => toggleSort(key)}>{label}{sortArrow(key)}</button></th>;

    return <section id="market" className="market-overview panel">
        <div className="section-heading market-heading">
            <div><span className="eyebrow">PİYASA ÖZETİ</span><h2>BİST hisse evreni</h2><p className="section-subtitle">Fiyatlar sağlayıcı gecikmesine tabi olabilir; gerçek zamanlı veri değildir.</p></div>
            <div className="market-tools"><span className="muted">Güncellendi · {lastUpdated ? formatQuoteTime(lastUpdated) : 'yükleniyor'} · {provider === 'tradingview' ? 'TradingView verisi' : provider === 'fallback' ? 'yedek liste' : 'durum bekleniyor'}</span><RefreshCw size={15} className={loading ? 'spin' : ''} /></div>
        </div>
        <div className="market-search"><input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="Hisse kodu veya şirket adı ara..." aria-label="Piyasa hissesi ara" /></div>
        <div className="period-tabs">{PERIODS.map(([value, label]) => <button key={value} className={period === value ? 'active' : ''} onClick={() => { setPeriod(value); setPage(1); }}>{label}</button>)}</div>
        <div className="market-controls flex-wrap">
            <div className="market-tabs">{([['ALL', 'Tümü'], ['UP', 'En çok artan'], ['DOWN', 'En çok azalan'], ['FLAT', 'Yatay']] as Array<[SortMode, string]>).map(([mode, label]) => <button key={mode} className={sortMode === mode ? 'active' : ''} onClick={() => { setSortMode(mode); setPage(1); }}>{label}</button>)}</div>
            <div className="flex flex-wrap items-center gap-2">
                <label className="limit-select">Sayfa başı
                    <select aria-label="Sayfa başına hisse sayısı" value={pageSize} onChange={(event) => { setPageSize(event.target.value as PageSize); setPage(1); }}>
                        <option value="20">20</option>
                        <option value="50">50</option>
                        <option value="100">100</option>
                        <option value="all">Tümü</option>
                    </select>
                </label>
                <span className="limit-select">{rangeStart}–{rangeEnd} / {visibleRows.length} hisse</span>
                {pageSize !== 'all' && <nav aria-label="Hisse tablosu sayfaları" className="flex items-center gap-1">
                    <button type="button" aria-label="Önceki sayfa" disabled={currentPage <= 1} onClick={() => setPage(Math.max(1, currentPage - 1))} className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-700 bg-slate-900 px-2 text-xs font-semibold text-slate-300 transition hover:border-emerald-500/40 hover:text-emerald-300 disabled:cursor-not-allowed disabled:opacity-40"><ChevronLeft size={14} />Önceki</button>
                    <span className="min-w-14 text-center text-[10px] font-semibold text-slate-400">{currentPage} / {pageCount}</span>
                    <button type="button" aria-label="Sonraki sayfa" disabled={currentPage >= pageCount} onClick={() => setPage(Math.min(pageCount, currentPage + 1))} className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-700 bg-slate-900 px-2 text-xs font-semibold text-slate-300 transition hover:border-emerald-500/40 hover:text-emerald-300 disabled:cursor-not-allowed disabled:opacity-40">Sonraki<ChevronRight size={14} /></button>
                </nav>}
            </div>
        </div>
        <div className="market-table-wrap"><table className="market-table"><thead><tr>{header('HİSSE', 'symbol')}{header('FİYAT', 'price')}{header('DEĞİŞİM', 'change')}{header('HACİM', 'volume')}{header('PİYASA DEĞERİ', 'marketCap')}<th>YÖN</th><th>GÜNCELLEME</th></tr></thead><tbody>{pageRows.map((row) => {
            return <tr key={row.symbol} className={row.symbol === selectedSymbol ? 'active-row' : ''} onClick={() => onSelect(row.symbol)}>
                <td><strong>{row.symbol}</strong><span>{row.name}</span></td><td><span className="market-price">{row.price ? `${row.price.toFixed(2)} TL` : '--'}{priceMoves[row.symbol] !== 'flat' && priceMoves[row.symbol] && <i aria-label={priceMoves[row.symbol] === 'up' ? 'Önceki güncellemeye göre yükseldi' : 'Önceki güncellemeye göre düştü'} className={`market-price-move ${priceMoves[row.symbol]}`} />}</span></td><td className={row.changePercent > 0 ? 'positive' : row.changePercent < 0 ? 'negative' : 'neutral'}>{row.changePercent > 0 ? '+' : ''}{row.changePercent.toFixed(2)}%</td><td>{formatLarge(row.volume)}</td><td>{formatLarge(row.marketCap)}</td><td><span className={`trend-pill ${row.changePercent > 0 ? 'yukari' : row.changePercent < 0 ? 'asagi' : 'yatay'}`}>{row.changePercent > 0 ? <ArrowUpRight size={12} /> : row.changePercent < 0 ? <ArrowDownRight size={12} /> : <Minus size={12} />}{row.changePercent > 0 ? 'Yukarı' : row.changePercent < 0 ? 'Aşağı' : 'Yatay'}</span></td><td>{formatQuoteTime(row.updatedAt)}</td>
            </tr>;
        })}</tbody></table>{!visibleRows.length && <div className="empty-cell">Eşleşen hisse bulunamadı.</div>}</div>
    </section>;
}
