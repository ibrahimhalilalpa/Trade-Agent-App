'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Activity, ArrowDownRight, ArrowUpRight, Clock3, RefreshCw, Volume2 } from 'lucide-react';
import type { MarketQuote } from '@/lib/types';
import { getSupabaseBrowserClient } from '@/lib/supabase-browser';
import { showError } from '@/lib/ui-alerts';

type Interval = '1m' | '5m' | '15m' | '1h' | '4h' | '1d' | '1w' | '1M';
interface MarketMoversProps { onSelect: (symbol: string) => void; }
const INTERVALS: Array<{ value: Interval; label: string }> = [
    { value: '1m', label: '1 dk' },
    { value: '5m', label: '5 dk' },
    { value: '15m', label: '15 dk' },
    { value: '1h', label: '1 saat' },
    { value: '4h', label: '4 saat' },
    { value: '1d', label: '1 gün' },
    { value: '1w', label: '1 hafta' },
    { value: '1M', label: '1 ay' },
];
const CHANGE_FIELD: Record<Interval, keyof MarketQuote> = {
    '1m': 'change1m',
    '5m': 'change5m',
    '15m': 'change15m',
    '1h': 'change1h',
    '4h': 'change4h',
    '1d': 'change1D',
    '1w': 'change1W',
    '1M': 'change1M',
};
const formatTurnover = (value: number) => new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', notation: 'compact', maximumFractionDigits: 3 }).format(value);

export default function MarketMovers({ onSelect }: MarketMoversProps) {
    const [quotes, setQuotes] = useState<MarketQuote[]>([]);
    const [interval, setInterval] = useState<Interval>('5m');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [provider, setProvider] = useState<'tradingview' | 'fallback' | ''>('');
    const [updatedAt, setUpdatedAt] = useState('');
    const [authenticated, setAuthenticated] = useState(false);
    const refreshInFlight = useRef(false);
    useEffect(() => {
        if (error) showError(error);
    }, [error]);

    const refresh = useCallback(async () => {
        if (refreshInFlight.current) return;
        refreshInFlight.current = true;
        setLoading(true);
        setError('');
        try {
            const response = await fetch('/api/market?limit=all&period=1D', { cache: 'no-store' });
            const payload = await response.json() as { data?: MarketQuote[]; provider?: 'tradingview' | 'fallback'; fetchedAt?: string; error?: string };
            if (!response.ok || !payload.data) throw new Error(payload.error ?? 'Piyasa hareketleri alınamadı.');
            setQuotes(payload.data);
            setProvider(payload.provider ?? 'fallback');
            setUpdatedAt(payload.fetchedAt ?? new Date().toISOString());
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'Piyasa hareketleri alınamadı.');
        } finally {
            setLoading(false);
            refreshInFlight.current = false;
        }
    }, []);

    useEffect(() => {
        const client = getSupabaseBrowserClient();
        if (!client) return;
        void client.auth.getSession().then(({ data, error: sessionError }) => {
            if (sessionError) console.error('Market movers auth status lookup failed.', sessionError);
            setAuthenticated(Boolean(data.session));
        });
        const { data: { subscription } } = client.auth.onAuthStateChange((_event, session) => {
            setAuthenticated(Boolean(session));
        });
        return () => subscription.unsubscribe();
    }, []);

    useEffect(() => {
        const timer = window.setTimeout(() => void refresh(), 0);
        const intervalId = window.setInterval(() => {
            if (document.visibilityState === 'visible') void refresh();
        }, 30_000);
        return () => {
            window.clearTimeout(timer);
            window.clearInterval(intervalId);
        };
    }, [refresh]);

    const lists = useMemo(() => {
        const field = CHANGE_FIELD[interval];
        const eligible = quotes.filter((quote) => quote.source === 'tradingview' && typeof quote[field] === 'number' && Number.isFinite(quote[field]));
        const change = (quote: MarketQuote) => quote[field] as number;
        const positive = eligible.filter((quote) => change(quote) > 0);
        const negative = eligible.filter((quote) => change(quote) < 0);
        return {
            gainers: [...positive].sort((first, second) => change(second) - change(first)).slice(0, 10),
            losers: [...negative].sort((first, second) => change(first) - change(second)).slice(0, 10),
            volume: [...quotes].filter((quote) => quote.source === 'tradingview' && typeof quote.tradedValue === 'number' && quote.tradedValue > 0)
                .sort((first, second) => (second.tradedValue ?? 0) - (first.tradedValue ?? 0)).slice(0, 10),
        };
    }, [interval, quotes]);

    const moverCard = (title: string, icon: typeof ArrowUpRight, items: MarketQuote[], getValue: (quote: MarketQuote) => string, tone: 'emerald' | 'rose' | 'slate') => {
        const Icon = icon;
        return <section className="min-w-0 rounded-2xl border border-slate-800 bg-slate-900 p-4 shadow-xl sm:p-5">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-white"><Icon className={`h-4 w-4 ${tone === 'emerald' ? 'text-emerald-400' : tone === 'rose' ? 'text-rose-400' : 'text-sky-400'}`} />{title}</h3>
            <ol className="space-y-2">
                {items.map((quote, index) => {
                    const locked = !authenticated && index >= 5;
                    return <li key={quote.symbol} aria-hidden={locked} className={`flex min-w-0 items-center gap-3 rounded-xl border border-slate-800/80 bg-slate-950/60 px-3 py-2.5 ${locked ? 'pointer-events-none select-none blur-[4px]' : ''}`}>
                        <span className="w-5 shrink-0 text-[10px] font-semibold text-slate-600">{index + 1}</span>
                        <button type="button" onClick={() => onSelect(quote.symbol)} tabIndex={locked ? -1 : 0} className="min-w-0 flex-1 truncate text-left text-xs font-bold text-slate-200 hover:text-emerald-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60" aria-label={`${quote.symbol} hisse detayını aç`}>{quote.symbol}</button>
                        <span className={`shrink-0 text-xs font-semibold ${tone === 'emerald' ? 'text-emerald-400' : tone === 'rose' ? 'text-rose-400' : 'text-slate-300'}`}>{getValue(quote)}</span>
                    </li>;
                })}
                {!items.length && <li className="rounded-xl border border-slate-800/80 bg-slate-950/40 p-3 text-xs text-slate-500">{loading ? 'Veriler yükleniyor…' : 'Bu aralık için veri bulunamadı.'}</li>}
            </ol>
        </section>;
    };

    return <section className="mt-6 space-y-4">
        <header className="flex flex-wrap items-end justify-between gap-3">
            <div><span className="text-[10px] font-bold tracking-[.2em] text-emerald-400">BİST / PİYASA TAKİBİ</span><h2 className="mt-1 flex items-center gap-2 text-xl font-extrabold text-white"><Activity className="h-5 w-5 text-emerald-400" />Piyasa hareketleri</h2><p className="mt-1 text-xs text-slate-500">Seçilen zaman aralığındaki pozitif/negatif değişimler ve günlük işlem tutarı.</p></div>
            <div className="flex flex-wrap items-center gap-2">
                <div role="group" aria-label="Piyasa değişim aralığı" className="flex max-w-full gap-1 overflow-x-auto rounded-xl border border-slate-800 bg-slate-900 p-1">
                    {INTERVALS.map((item) => <button key={item.value} type="button" onClick={() => setInterval(item.value)} aria-pressed={interval === item.value} className={`shrink-0 rounded-lg px-3 py-2 text-xs font-semibold transition ${interval === item.value ? 'bg-emerald-500/10 text-emerald-300' : 'text-slate-400 hover:text-white'}`}>{item.label}</button>)}
                </div>
                <button type="button" onClick={() => void refresh()} disabled={loading} aria-label="Piyasa hareketlerini yenile" className="rounded-lg border border-slate-700 bg-slate-900 p-2.5 text-slate-300 hover:bg-slate-800 disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /></button>
            </div>
        </header>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            {moverCard(`En çok yükselen · ${INTERVALS.find((item) => item.value === interval)?.label}`, ArrowUpRight, lists.gainers, (quote) => `${(quote[CHANGE_FIELD[interval] as keyof MarketQuote] as number) > 0 ? '+' : ''}${(quote[CHANGE_FIELD[interval] as keyof MarketQuote] as number).toFixed(2)}%`, 'emerald')}
            {moverCard(`En çok düşen · ${INTERVALS.find((item) => item.value === interval)?.label}`, ArrowDownRight, lists.losers, (quote) => `${(quote[CHANGE_FIELD[interval] as keyof MarketQuote] as number).toFixed(2)}%`, 'rose')}
            {moverCard('İşlem hacmi en yüksek · TL', Volume2, lists.volume, (quote) => formatTurnover(quote.tradedValue ?? 0), 'slate')}
        </div>
        {!authenticated && <div className="flex flex-wrap items-center justify-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-center text-xs text-slate-300">
            <span>İlk 5 sıra açık. Giriş yaparak tüm 10 sırayı görüntüleyin.</span>
            <Link href="/auth?next=%2Fmarket" className="font-bold text-emerald-400 underline-offset-2 hover:underline">Giriş yap</Link>
        </div>}
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-500/15 bg-amber-500/5 px-3 py-2.5 text-[11px] text-amber-200/80">
            <span>Hacim, gün içinde gerçekleşen toplam işlem tutarıdır; seans kapalıyken değişmemesi normaldir. Veriler sağlayıcı gecikmesine tabi olabilir.</span>
            <span className="inline-flex items-center gap-1.5 text-slate-500"><Clock3 className="h-3 w-3" />{updatedAt ? `Güncellendi ${new Date(updatedAt).toLocaleTimeString('tr-TR')}` : loading ? 'Veri bekleniyor' : provider === 'fallback' ? 'Yedek veri' : 'Güncelleme bekleniyor'}</span>
        </div>
        <p className="text-[11px] text-slate-600">3 ve 6 saatlik değişimler sağlayıcı tarafından sunulmadığı için 4 saatlik görünüm kullanılır. Devre kesici bilgisi de mevcut piyasa veri kaynağında bulunmuyor.</p>
    </section>;
}
