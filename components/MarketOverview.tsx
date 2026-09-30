'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownRight, ArrowUpRight, Minus, RefreshCw } from 'lucide-react';
import type { MarketQuote } from '@/lib/types';

interface MarketOverviewProps { symbols?: string[]; selectedSymbol: string; onSelect: (symbol: string) => void; }
type SortMode = 'ALL' | 'UP' | 'DOWN' | 'FLAT';
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

export default function MarketOverview({ symbols = FALLBACK_SYMBOLS, selectedSymbol, onSelect }: MarketOverviewProps) {
    const [rows, setRows] = useState<MarketQuote[]>([]);
    const [sortMode, setSortMode] = useState<SortMode>('ALL');
    const [period, setPeriod] = useState<Period>('1D');
    const [sortKey, setSortKey] = useState<SortKey>('symbol');
    const [direction, setDirection] = useState<'asc' | 'desc'>('asc');
    const [query, setQuery] = useState('');
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
    }).slice(0, 10), [direction, query, rows, sortKey, sortMode]);

    const toggleSort = (key: SortKey) => {
        if (sortMode !== 'ALL') return;
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
        <div className="market-search"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Hisse kodu veya şirket adı ara..." aria-label="Piyasa hissesi ara" /></div>
        <div className="period-tabs">{PERIODS.map(([value, label]) => <button key={value} className={period === value ? 'active' : ''} onClick={() => setPeriod(value)}>{label}</button>)}</div>
        <div className="market-controls">
            <div className="market-tabs">{([['ALL', 'Tümü'], ['UP', 'En çok artan'], ['DOWN', 'En çok azalan'], ['FLAT', 'Yatay']] as Array<[SortMode, string]>).map(([mode, label]) => <button key={mode} className={sortMode === mode ? 'active' : ''} onClick={() => setSortMode(mode)}>{label}</button>)}</div>
            <span className="limit-select">{visibleRows.length} hisse gösteriliyor</span>
        </div>
        <div className="market-table-wrap"><table className="market-table"><thead><tr>{header('HİSSE', 'symbol')}{header('FİYAT', 'price')}{header('DEĞİŞİM', 'change')}{header('HACİM', 'volume')}{header('PİYASA DEĞERİ', 'marketCap')}<th>YÖN</th><th>GÜNCELLEME</th></tr></thead><tbody>{visibleRows.map((row) => {
            return <tr key={row.symbol} className={row.symbol === selectedSymbol ? 'active-row' : ''} onClick={() => onSelect(row.symbol)}>
                <td><strong>{row.symbol}</strong><span>{row.name}</span></td><td><span className="market-price">{row.price ? `${row.price.toFixed(2)} TL` : '--'}{priceMoves[row.symbol] !== 'flat' && priceMoves[row.symbol] && <i aria-label={priceMoves[row.symbol] === 'up' ? 'Önceki güncellemeye göre yükseldi' : 'Önceki güncellemeye göre düştü'} className={`market-price-move ${priceMoves[row.symbol]}`} />}</span></td><td className={row.changePercent > 0 ? 'positive' : row.changePercent < 0 ? 'negative' : 'neutral'}>{row.changePercent > 0 ? '+' : ''}{row.changePercent.toFixed(2)}%</td><td>{formatLarge(row.volume)}</td><td>{formatLarge(row.marketCap)}</td><td><span className={`trend-pill ${row.changePercent > 0 ? 'yukari' : row.changePercent < 0 ? 'asagi' : 'yatay'}`}>{row.changePercent > 0 ? <ArrowUpRight size={12} /> : row.changePercent < 0 ? <ArrowDownRight size={12} /> : <Minus size={12} />}{row.changePercent > 0 ? 'Yukarı' : row.changePercent < 0 ? 'Aşağı' : 'Yatay'}</span></td><td>{formatQuoteTime(row.updatedAt)}</td>
            </tr>;
        })}</tbody></table>{!visibleRows.length && <div className="empty-cell">Eşleşen hisse bulunamadı.</div>}</div>
    </section>;
}
