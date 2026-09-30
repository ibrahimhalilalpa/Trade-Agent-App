'use client';

import { useEffect, useMemo, useState } from 'react';
import { Award, ChartNoAxesCombined, CircleHelp, LockKeyhole, RefreshCw, Trophy } from 'lucide-react';
import Link from 'next/link';
import { toast } from 'react-toastify';

type Period = 'day' | 'week' | 'month' | 'all';
type SortBy = 'standard' | 'pnl_percent' | 'pnl_amount' | 'xp';
type Entry = {
    user_id: string;
    display_name: string;
    trader_rank: string;
    xp: number;
    pnl_percent: number;
    pnl_amount?: number | string | null;
    rank_position?: number | null;
    is_self?: boolean;
};

const PERIODS: Array<{ value: Period; label: string }> = [
    { value: 'day', label: 'Günlük' },
    { value: 'week', label: 'Haftalık' },
    { value: 'month', label: 'Aylık' },
    { value: 'all', label: 'Tüm zamanlar' },
];

function formatGain(value: Entry['pnl_amount']): string | null | undefined {
    if (value === null) return null;
    if (value === undefined || value === '') return undefined;
    const amount = Number(value);
    if (!Number.isFinite(amount)) return undefined;
    return `${amount > 0 ? '+' : ''}${amount.toLocaleString('tr-TR', { style: 'currency', currency: 'TRY', minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function LeaderboardWorkspace() {
    const [period, setPeriod] = useState<Period>('all');
    const [sortBy, setSortBy] = useState<SortBy>('standard');
    const [entries, setEntries] = useState<Entry[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let active = true;
        void fetch(`/api/leaderboard?period=${period}`, { cache: 'no-store' })
            .then(async (response) => {
                const payload = await response.json() as { data?: Entry[]; error?: string };
                if (!active) return;
                if (!response.ok) {
                    toast.error(`Liderlik tablosu yüklenemedi. ${payload.error ?? 'Lütfen biraz sonra tekrar deneyin.'}`);
                    return;
                }
                setEntries(payload.data ?? []);
            })
            .catch(() => { if (active) toast.error('Liderlik tablosuna ulaşılamadı. Bağlantınızı kontrol edip tekrar deneyin.'); })
            .finally(() => { if (active) setLoading(false); });
        return () => { active = false; };
    }, [period]);

    const sortedEntries = useMemo(() => {
        if (sortBy === 'standard') return entries;
        const valueFor = (entry: Entry) => {
            if (sortBy === 'xp') return Number(entry.xp);
            if (sortBy === 'pnl_percent') return Number(entry.pnl_percent);
            if (entry.pnl_amount === null || entry.pnl_amount === undefined || entry.pnl_amount === '') return null;
            const amount = Number(entry.pnl_amount);
            return Number.isFinite(amount) ? amount : null;
        };
        return [...entries].sort((a, b) => {
            const aValue = valueFor(a);
            const bValue = valueFor(b);
            if (aValue === null) return bValue === null ? 0 : 1;
            if (bValue === null) return -1;
            const difference = bValue - aValue;
            if (difference !== 0) return difference;
            return (a.rank_position ?? Number.MAX_SAFE_INTEGER) - (b.rank_position ?? Number.MAX_SAFE_INTEGER);
        });
    }, [entries, sortBy]);

    return <main className="min-h-screen bg-slate-950 text-slate-100 p-4 md:p-8">
        <div className="max-w-6xl mx-auto space-y-8">
            <header className="border-b border-slate-800 pb-6">
                <span className="text-xs font-bold tracking-widest text-emerald-400 uppercase">TRADE ENGINE / COMMUNITY</span>
                <h1 className="text-3xl font-extrabold text-white flex items-center gap-3 mt-1"><Trophy className="w-8 h-8 text-emerald-400" />Trader Liderlik Tablosu</h1>
                <p className="text-sm text-slate-400 mt-2">Diğer kullanıcılar yalnızca paylaşım izni verilen bilgileri görür. Kendi getiri ve kazanç bilgilerin, gizlilik tercihinden bağımsız olarak sana gösterilir; bakiye ve e-posta paylaşılmaz.</p>
            </header>

            <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5 md:p-6 shadow-xl">
                <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
                    <div className="flex flex-wrap gap-2" aria-label="Getiri dönemi">
                        {PERIODS.map((item) => <button key={item.value} type="button" onClick={() => setPeriod(item.value)}
                            className={`px-4 py-2 rounded-lg text-xs font-bold border transition ${period === item.value ? 'bg-emerald-600 border-emerald-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'}`}>
                            {item.label}
                        </button>)}
                    </div>
                    <label className="flex items-center gap-2 text-xs font-semibold text-slate-400">
                        Sırala
                        <select value={sortBy} onChange={(event) => setSortBy(event.target.value as SortBy)} className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-slate-100 outline-none focus:ring-2 focus:ring-emerald-500/50">
                            <option value="standard">Standart sıralama</option>
                            <option value="pnl_percent">Dönem Getirisi</option>
                            <option value="pnl_amount">Dönem Kazancı</option>
                            <option value="xp">Rank XP</option>
                        </select>
                    </label>
                </div>
                {loading ? <div className="flex items-center gap-2 py-12 justify-center text-slate-400"><RefreshCw className="w-4 h-4 animate-spin" />Liderlik tablosu yükleniyor...</div>
                    : !entries.length ? <p className="py-12 text-center text-sm text-slate-400">Bu dönemde henüz görünür performans profili yok.</p>
                        : <div className="overflow-x-auto">
                            <table className="w-full min-w-[760px] text-left text-sm">
                                <thead className="text-xs uppercase tracking-wide text-slate-500 border-b border-slate-800">
                                    <tr><th className="py-3 px-3">Sıra</th><th className="py-3 px-3">Trader</th><th className="py-3 px-3">Rank</th><th className="py-3 px-3 text-right">Dönem Getirisi</th><th className="py-3 px-3 text-right">Dönem Kazancı</th><th className="py-3 px-3 text-right">Profil</th></tr>
                                </thead>
                                <tbody className="divide-y divide-slate-800/70">
                                    {sortedEntries.map((entry, index) => <tr key={entry.user_id} className={entry.is_self ? 'bg-emerald-500/10 shadow-[inset_3px_0_0_0_rgba(52,211,153,0.9)]' : 'hover:bg-slate-800/40'}>
                                        <td className={`py-4 px-3 font-mono ${entry.is_self ? 'font-bold text-emerald-300' : 'text-slate-400'}`}>{entry.rank_position === null ? 'Özel' : `#${entry.rank_position ?? index + 1}`}</td>
                                        <td className={`py-4 px-3 font-semibold ${entry.is_self ? 'text-emerald-100' : 'text-white'}`}><span className="inline-flex flex-wrap items-center gap-2">{entry.display_name}{entry.is_self && <span className="rounded-full border border-emerald-400/30 bg-emerald-400/15 px-2.5 py-1 text-[10px] font-extrabold text-emerald-200">SEN · SIRAN</span>}</span></td>
                                        <td className="py-4 px-3"><span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-300"><Award className="w-3.5 h-3.5" />{entry.trader_rank} · {entry.xp} XP</span></td>
                                        <td className={`py-4 px-3 text-right font-bold ${entry.pnl_percent >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{entry.pnl_percent >= 0 ? '+' : ''}{Number(entry.pnl_percent).toFixed(2)}%</td>
                                        <td className="py-4 px-3 text-right font-semibold">{(() => {
                                            const gain = formatGain(entry.pnl_amount);
                                            const amount = Number(entry.pnl_amount);
                                            return gain
                                                ? <span className={amount >= 0 ? 'text-emerald-300' : 'text-rose-300'}>{gain}</span>
                                                : gain === null
                                                    ? <span title="Bu kullanıcı kazanç tutarını paylaşmamayı tercih etti." className="inline-flex items-center gap-1.5 rounded-full border border-slate-700/80 bg-slate-800/70 px-2.5 py-1 text-[11px] font-medium text-slate-400"><LockKeyhole className="h-3 w-3" />Gizli</span>
                                                    : <span className="text-slate-500" aria-label="Kazanç bilgisi yok">—</span>;
                                        })()}</td>
                                        <td className="py-4 px-3 text-right"><Link href={`/leaderboard/${entry.user_id}?period=${period}`} className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:border-emerald-500/40 hover:text-emerald-300">Performans</Link></td>
                                    </tr>)}
                                </tbody>
                            </table>
                        </div>}
            </section>

            <section className="rounded-2xl border border-emerald-500/20 bg-gradient-to-br from-slate-900 via-slate-900 to-emerald-950/30 p-5 shadow-xl md:p-6" aria-labelledby="leaderboard-method-title">
                <div className="flex items-start gap-3">
                    <span className="mt-0.5 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-2 text-emerald-300"><ChartNoAxesCombined className="h-5 w-5" /></span>
                    <div className="min-w-0 flex-1">
                        <h2 id="leaderboard-method-title" className="flex items-center gap-2 text-lg font-bold text-white"><CircleHelp className="h-4 w-4 text-emerald-300" />Sıralama nasıl hesaplanıyor?</h2>
                        <p className="mt-1 max-w-4xl text-sm leading-6 text-slate-400">Seçilen dönemdeki portföy getiri yüzdesi yüksekten düşüğe sıralanır. Yüzde getiri farklı büyüklükteki sanal portföyleri daha adil karşılaştırır. Kazanç tutarı, XP ve rütbe sıralamaya etki etmez; TL tutarı yalnızca ayrıca paylaşmayı seçen kullanıcılar için gösterilir.</p>
                    </div>
                </div>
                <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-4">
                        <p className="text-xs font-bold uppercase tracking-wider text-emerald-300">Sıralama ölçütü</p>
                        <p className="mt-2 text-xs leading-5 text-slate-300">Dönem kârı ÷ başlangıç sermayesi × 100. Nakit ekleme/çekme kâr sayılmaz; en yüksek getiri yüzdesi ilk sıraya çıkar. İlk 50 profil gösterilir.</p>
                    </div>
                    <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-4">
                        <p className="text-xs font-bold uppercase tracking-wider text-amber-300">Dönem ve karşılaştırma</p>
                        <p className="mt-2 text-xs leading-5 text-slate-300">Günlük, haftalık ve aylık sonuçlar ilgili başlangıç snapshot’ıyla; tüm zamanlar sonucu 100.000 TL sanal başlangıç sermayesi ve ek nakit hareketleriyle hesaplanır.</p>
                    </div>
                    <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-4">
                        <p className="text-xs font-bold uppercase tracking-wider text-sky-300">Katılım ve veri</p>
                        <p className="mt-2 text-xs leading-5 text-slate-300">Yalnızca liderlik görünürlüğünü açan profiller listelenir. Dönem için gerekli başlangıç snapshot’ı yoksa o profil ilgili dönemde sıralanmaz.</p>
                    </div>
                    <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-4">
                        <p className="text-xs font-bold uppercase tracking-wider text-violet-300">XP ve rütbenin önemi</p>
                        <p className="mt-2 text-xs leading-5 text-slate-300">XP: ders başına 100, aktif gün başına 10, pozitif toplam getiri yüzdesi başına 100 XP. 500/2.000/5.000 XP seviyeleri Analist/Üstat/Piyasa Yapıcı rütbelerini açar; dönem sırasını değiştirmez.</p>
                    </div>
                </div>
                <p className="mt-4 text-[11px] leading-5 text-slate-500">Liderlik tablosu sanal portföy performansını karşılaştırır; geçmiş performans gelecek getiriyi garanti etmez. Dönem başlangıç verisi her gün alınan snapshot’lara bağlıdır.</p>
            </section>
        </div>
    </main>;
}
