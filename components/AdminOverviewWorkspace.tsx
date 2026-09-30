'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Activity, AlertTriangle, ArrowUpRight, BriefcaseBusiness, CircleDollarSign, Clock3, RefreshCw, Users } from 'lucide-react';
import { showError } from '@/lib/ui-alerts';

type Overview = {
    totalUsers: number; activeUsers24h: number; totalPortfolioValue: number;
    totalRealizedPnl: number; totalUnrealizedPnl: number; turnover24h: number;
    openPositions: number;
    monitor: { cronEnabled: boolean; orderMonitorJob: { active?: boolean } | null; lastOrderMonitorRun: { status?: string; end_time?: string; return_message?: string } | null; vaultTokenConfigured: boolean; vaultUrlConfigured: boolean };
    activity: Array<{ id: string; user_id: string; email: string; display_name: string; event_type: string; description: string; created_at: string }>;
    recentUsers: Array<{ id: string; email: string; displayName: string; role: string; createdAt: string; lastSignInAt: string | null }>;
};
const money = (value: number) => new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 0 }).format(value);

export default function AdminOverviewWorkspace() {
    const [overview, setOverview] = useState<Overview | null>(null);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(true);
    useEffect(() => {
        if (error) showError(error);
    }, [error]);
    const refresh = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const overviewResponse = await fetch('/api/admin/overview', { cache: 'no-store' });
            const overviewPayload = await overviewResponse.json() as { data?: Overview; error?: string };
            if (!overviewResponse.ok || !overviewPayload.data) throw new Error(overviewPayload.error ?? 'Yönetim verileri alınamadı.');
            setOverview(overviewPayload.data);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'Yönetim verileri alınamadı.');
        } finally {
            setLoading(false);
        }
    }, []);
    useEffect(() => {
        const timer = window.setTimeout(() => { void refresh(); }, 0);
        const interval = window.setInterval(() => { void refresh(); }, 60000);
        return () => { window.clearTimeout(timer); window.clearInterval(interval); };
    }, [refresh]);

    const monitorOk = Boolean(overview?.monitor.cronEnabled && overview.monitor.orderMonitorJob?.active);
    const cards = overview ? [
        { title: 'Toplam kullanıcı', value: overview.totalUsers.toLocaleString('tr-TR'), detail: `${overview.activeUsers24h} son 24 saatte aktif`, icon: Users },
        { title: 'Portföy toplam değeri', value: money(overview.totalPortfolioValue), detail: `${overview.openPositions} açık pozisyon`, icon: BriefcaseBusiness },
        { title: 'Son 24 saat işlem hacmi', value: money(overview.turnover24h), detail: 'Sanal işlemler üzerinden', icon: CircleDollarSign },
        { title: 'Toplam açık P/L', value: money(overview.totalUnrealizedPnl), detail: `Gerçekleşen ${money(overview.totalRealizedPnl)}`, icon: Activity },
    ] : [];

    return <main className="min-h-screen bg-slate-950 p-4 text-slate-100 md:p-7">
        <div className="mx-auto max-w-[1600px] space-y-6">
            <header className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-800 pb-5">
                <div><span className="text-[10px] font-bold tracking-[.2em] text-emerald-400">TRADE ENGINE / OPERATIONS</span><h1 className="mt-1 text-3xl font-extrabold text-white">Sistem Genel Bakışı</h1><p className="mt-2 text-sm text-slate-400">Yönetim, portföy ve BİST aktivitesinin canlı özeti.</p></div>
                <button onClick={() => void refresh()} disabled={loading} className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-4 py-2.5 text-xs font-bold hover:bg-slate-800 disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Yenile</button>
            </header>
            {overview && <div className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4 ${monitorOk ? 'border-emerald-500/20 bg-emerald-500/5' : 'border-amber-500/20 bg-amber-500/5'}`}>
                <div className="flex items-center gap-3"><span className={`rounded-lg p-2 ${monitorOk ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-400'}`}><Activity className="h-4 w-4" /></span>
                    <div><strong className="block text-sm text-white">Emir izleyici {monitorOk ? 'çalışıyor' : 'kontrol gerekli'}</strong><span className="text-xs text-slate-400">Son çalışma: {overview.monitor.lastOrderMonitorRun?.end_time ? new Date(overview.monitor.lastOrderMonitorRun.end_time).toLocaleString('tr-TR') : 'kayıt yok'}</span></div></div>
                <Link href="/admin/system" className="inline-flex items-center gap-1 text-xs font-bold text-emerald-300">Sistem sağlığı <ArrowUpRight className="h-3.5 w-3.5" /></Link>
            </div>}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 2xl:grid-cols-4">
                {cards.map(({ title, value, detail, icon: Icon }) => <article key={title} className="rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-xl"><div className="flex items-center justify-between"><span className="text-xs font-semibold text-slate-400">{title}</span><Icon className="h-4 w-4 text-emerald-400" /></div><strong className="mt-4 block truncate text-2xl font-bold text-white">{value}</strong><span className="mt-1 block text-xs text-slate-500">{detail}</span></article>)}
            </div>
            <div className="grid grid-cols-1 gap-6 2xl:grid-cols-5">
                <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-xl 2xl:col-span-3">
                    <div className="mb-4 flex items-center gap-2"><Activity className="h-4 w-4 text-emerald-400" /><h2 className="text-lg font-bold text-white">Son kullanıcı hareketleri</h2></div>
                    <div className="max-h-[430px] space-y-2 overflow-y-auto">{overview?.activity.map((event) => <article key={event.id} className="rounded-xl border border-slate-800 bg-slate-950/50 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2"><div className="min-w-0"><strong className="block truncate text-xs text-slate-200">{event.display_name || 'Kullanıcı'}</strong><span className="block truncate text-[10px] text-slate-500">{event.email || event.user_id}</span></div><div className="flex shrink-0 items-center gap-2"><span className="rounded-full border border-slate-700 bg-slate-800 px-2.5 py-1 text-[10px] text-slate-300">{event.event_type.replaceAll('_', ' ')}</span><time className="text-[10px] text-slate-600">{new Date(event.created_at).toLocaleString('tr-TR')}</time></div></div>
                        <p className="mt-2 text-xs text-slate-300">{event.description}</p>
                    </article>)}
                    {!overview?.activity.length && !loading && <p className="py-6 text-center text-xs text-slate-500">Henüz kullanıcı hareketi yok.</p>}</div>
                </section>
                <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-xl 2xl:col-span-2">
                    <div className="mb-4 flex items-center gap-2"><Clock3 className="h-4 w-4 text-emerald-400" /><h2 className="text-lg font-bold text-white">Son aktif kullanıcılar</h2></div>
                    <div className="max-h-[430px] space-y-2 overflow-y-auto">{overview?.recentUsers.map((user) => <article key={user.id} className="flex min-w-0 items-center gap-3 rounded-xl border border-slate-800 bg-slate-950/50 p-3">
                        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-emerald-500/20 bg-emerald-500/10 text-[11px] font-bold text-emerald-300">{(user.displayName || user.email || '?').slice(0, 1).toLocaleUpperCase('tr-TR')}</span>
                        <div className="min-w-0 flex-1"><strong className="block truncate text-xs text-slate-200">{user.displayName || 'İsimsiz kullanıcı'}</strong><span className="block truncate text-[10px] text-slate-500">{user.email || user.id}</span></div>
                        <div className="shrink-0 text-right"><span className="block text-[10px] font-semibold text-slate-400">{user.role.replaceAll('_', ' ')}</span><time className="mt-1 block text-[9px] text-slate-600">{user.lastSignInAt ? new Date(user.lastSignInAt).toLocaleDateString('tr-TR') : 'Giriş yok'}</time></div>
                    </article>)}
                    {!overview?.recentUsers.length && !loading && <p className="py-6 text-center text-xs text-slate-500">Kullanıcı kaydı yok.</p>}</div>
                </section>
            </div>
            {overview && !overview.monitor.vaultTokenConfigured && <div className="flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-xs text-amber-200"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />Vault portfolio monitor token is not reported. Monitor Vault status in Systems before relying on scheduled order checks.</div>}
        </div>
    </main>;
}
