'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Award, LockKeyhole, RefreshCw, TrendingDown, TrendingUp } from 'lucide-react';
import { toast } from 'react-toastify';

type Period = 'day' | 'week' | 'month' | 'all';
type ProfileData = { user_id: string; display_name: string; trader_rank: string; xp: number; pnl_percent: number; pnl_amount?: number | string | null };
type ResponsePayload = { data?: ProfileData; error?: string };

const PERIOD_LABELS: Record<Period, string> = { day: 'Günlük', week: 'Haftalık', month: 'Aylık', all: 'Tüm zamanlar' };

function formatGain(value: ProfileData['pnl_amount']): string | null | undefined {
    if (value === null) return null;
    if (value === undefined || value === '') return undefined;
    const amount = Number(value);
    if (!Number.isFinite(amount)) return undefined;
    return `${amount > 0 ? '+' : ''}${amount.toLocaleString('tr-TR', { style: 'currency', currency: 'TRY', minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function PublicTraderProfile({ userId, period }: { userId: string; period: Period }) {
    const [profile, setProfile] = useState<ProfileData | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let active = true;
        void fetch(`/api/leaderboard/${userId}?period=${period}`, { cache: 'no-store' })
            .then(async (response) => {
                const payload = await response.json() as ResponsePayload;
                if (!active) return;
                if (!response.ok || !payload.data) {
                    const message = payload.error ?? 'Trader profili açılamadı.';
                    toast.error(`Trader profili açılamadı. ${message}`);
                    return;
                }
                setProfile(payload.data);
            })
            .catch(() => {
                if (!active) return;
                const message = 'Trader profiline ulaşılamadı.';
                toast.error(`${message} Bağlantınızı kontrol edip tekrar deneyin.`);
            })
            .finally(() => { if (active) setLoading(false); });
        return () => { active = false; };
    }, [period, userId]);

    return <main className="min-h-screen bg-slate-950 p-4 text-slate-100 md:p-8">
        <div className="mx-auto max-w-3xl space-y-6">
            <Link href="/leaderboard" className="inline-flex items-center gap-2 text-sm font-semibold text-slate-400 hover:text-white"><ArrowLeft className="h-4 w-4" />Liderlik tablosuna dön</Link>
            <header><span className="text-xs font-bold tracking-widest text-emerald-400">TRADE ENGINE / PUBLIC PROFILE</span><h1 className="mt-2 text-3xl font-extrabold text-white">Trader performans kartı</h1><p className="mt-2 text-sm text-slate-400">Kullanıcı adı, rank ve getiri yüzdesi paylaşım tercihine göre gösterilir. Hesap sahibi kendi kazanç ve getiri bilgilerini her zaman görebilir; diğer kullanıcılar kazanç tutarını yalnızca paylaşım izni varsa görür. Bakiye ve e-posta gizlidir.</p></header>
            {loading && <div className="flex items-center justify-center gap-2 rounded-2xl border border-slate-800 bg-slate-900 p-10 text-slate-400"><RefreshCw className="h-4 w-4 animate-spin" />Performans yükleniyor...</div>}
            {profile && <section className="space-y-6 rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-xl">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div><span className="text-xs text-slate-500">Kullanıcı adı</span><h2 className="mt-1 text-2xl font-bold text-white">{profile.display_name}</h2></div>
                    <span className="inline-flex items-center gap-2 rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-300"><Award className="h-4 w-4" />{profile.trader_rank} · {profile.xp.toLocaleString('tr-TR')} XP</span>
                </div>
                <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-5">
                    <p className="text-xs font-bold uppercase tracking-wider text-slate-500">{PERIOD_LABELS[period]} performansı</p>
                    <p className={`mt-2 flex items-center gap-2 text-4xl font-extrabold ${profile.pnl_percent >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {profile.pnl_percent >= 0 ? <TrendingUp className="h-8 w-8" /> : <TrendingDown className="h-8 w-8" />}
                        {profile.pnl_percent >= 0 ? '+' : ''}{Number(profile.pnl_percent).toFixed(2)}%
                    </p>
                </div>
                <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-5">
                    <p className="text-xs font-bold uppercase tracking-wider text-slate-500">{PERIOD_LABELS[period]} kazancı</p>
                    {formatGain(profile.pnl_amount)
                        ? <p className={`mt-2 text-2xl font-extrabold ${Number(profile.pnl_amount) >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>{formatGain(profile.pnl_amount)}</p>
                        : profile.pnl_amount === null
                            ? <span title="Bu kullanıcı kazanç tutarını paylaşmamayı tercih etti." className="mt-2 inline-flex items-center gap-2 rounded-full border border-slate-700/80 bg-slate-800/70 px-3 py-1.5 text-xs font-semibold text-slate-400"><LockKeyhole className="h-3.5 w-3.5" />Kazanç tutarı gizli</span>
                            : <p className="mt-2 text-sm text-slate-500">Kazanç bilgisi yok</p>}
                </div>
            </section>}
        </div>
    </main>;
}
