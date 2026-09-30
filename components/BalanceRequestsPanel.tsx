'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, CircleDollarSign, Clock3, RefreshCw, ScrollText, Wallet, X } from 'lucide-react';
import { showError, showSuccess } from '@/lib/ui-alerts';

type BalanceRequest = {
    id: string;
    userId: string;
    email: string;
    displayName: string;
    requestedAmount: number;
    reason: string;
    status: 'pending' | 'approved' | 'rejected';
    approvedAmount: number | null;
    adminNote: string | null;
    reviewedBy: string | null;
    reviewerEmail: string;
    reviewedAt: string | null;
    createdAt: string;
};
type BalanceAdjustment = {
    id: string;
    userId: string;
    email: string;
    displayName: string;
    amount: number;
    balanceAfter: number;
    createdAt: string;
};
type BalanceWorkspaceData = { requests: BalanceRequest[]; adjustments: BalanceAdjustment[] };
type Payload<T> = { data?: T; error?: string };
type LedgerItem = {
    id: string;
    userId: string;
    displayName: string;
    email: string;
    kind: string;
    amount: number;
    balanceAfter: number | null;
    detail: string;
    actor: string;
    createdAt: string;
    status: 'approved' | 'rejected' | 'pending' | 'adjustment';
};

const money = (amount: number) => new Intl.NumberFormat('tr-TR', {
    style: 'currency', currency: 'TRY', minimumFractionDigits: 2, maximumFractionDigits: 2,
}).format(amount);
const dateLabel = (value: string) => new Date(value).toLocaleString('tr-TR', { dateStyle: 'medium', timeStyle: 'short' });

export default function BalanceRequestsPanel() {
    const [data, setData] = useState<BalanceWorkspaceData>({ requests: [], adjustments: [] });
    const [approvedAmounts, setApprovedAmounts] = useState<Record<string, string>>({});
    const [notes, setNotes] = useState<Record<string, string>>({});
    const [loading, setLoading] = useState(true);
    const [busyId, setBusyId] = useState('');
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [activeTab, setActiveTab] = useState<'pending' | 'ledger'>('pending');
    const refreshInFlight = useRef(false);
    const backgroundErrorNotified = useRef(false);

    useEffect(() => {
        if (error) showError(error);
    }, [error]);
    useEffect(() => {
        if (notice) showSuccess(notice);
    }, [notice]);

    const loadRequests = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
        if (refreshInFlight.current) return;
        refreshInFlight.current = true;
        if (!silent) {
            setLoading(true);
            setError('');
        }
        try {
            const response = await fetch('/api/admin/balance-requests', { cache: 'no-store' });
            const payload = await response.json() as Payload<BalanceWorkspaceData>;
            if (!response.ok || !payload.data) throw new Error(payload.error ?? 'Bakiye işlem kayıtları yüklenemedi.');
            setData(payload.data);
            if (silent) backgroundErrorNotified.current = false;
            setApprovedAmounts((current) => {
                const next = { ...current };
                for (const item of payload.data?.requests ?? []) next[item.id] ??= String(item.requestedAmount);
                return next;
            });
        } catch (cause) {
            const message = cause instanceof Error ? cause.message : 'Bakiye işlem kayıtları yüklenemedi.';
            if (silent) {
                if (!backgroundErrorNotified.current) {
                    showError(`Bakiye kayıtları otomatik güncellenemedi. ${message}`);
                    backgroundErrorNotified.current = true;
                }
            } else {
                setError(message);
            }
        } finally {
            refreshInFlight.current = false;
            if (!silent) setLoading(false);
        }
    }, []);

    useEffect(() => {
        const timer = window.setTimeout(() => void loadRequests(), 0);
        const refreshWhenVisible = () => {
            if (document.visibilityState === 'visible') void loadRequests({ silent: true });
        };
        const interval = window.setInterval(refreshWhenVisible, 15_000);
        document.addEventListener('visibilitychange', refreshWhenVisible);
        window.addEventListener('focus', refreshWhenVisible);
        return () => {
            window.clearTimeout(timer);
            window.clearInterval(interval);
            document.removeEventListener('visibilitychange', refreshWhenVisible);
            window.removeEventListener('focus', refreshWhenVisible);
        };
    }, [loadRequests]);

    const pendingRequests = useMemo(() => data.requests.filter((item) => item.status === 'pending'), [data.requests]);
    const ledger = useMemo(() => {
        const requests = data.requests.map((item): LedgerItem => ({
            id: `request-${item.id}`,
            userId: item.userId,
            displayName: item.displayName,
            email: item.email,
            kind: 'Bakiye talebi',
            amount: item.status === 'approved' ? item.approvedAmount ?? item.requestedAmount : item.requestedAmount,
            balanceAfter: null,
            detail: item.status === 'approved'
                ? `İstenen ${money(item.requestedAmount)} · onaylanan ${money(item.approvedAmount ?? item.requestedAmount)}${item.adminNote ? ` · ${item.adminNote}` : ''}`
                : item.status === 'rejected'
                    ? `İstenen ${money(item.requestedAmount)} · reddedildi${item.adminNote ? ` · ${item.adminNote}` : ''}`
                    : `İstenen ${money(item.requestedAmount)} · ${item.reason}`,
            actor: item.reviewerEmail || (item.reviewedBy ? 'Yetkili' : 'Kullanıcı'),
            createdAt: item.reviewedAt ?? item.createdAt,
            status: item.status,
        }));
        const standaloneAdjustments = data.adjustments.filter((adjustment) => !data.requests.some((request) =>
            request.status === 'approved'
            && request.userId === adjustment.userId
            && request.approvedAmount !== null
            && Math.abs(request.approvedAmount - adjustment.amount) < 0.005
            && request.reviewedAt !== null
            && Math.abs(Date.parse(request.reviewedAt) - Date.parse(adjustment.createdAt)) < 60_000));
        const adjustments = standaloneAdjustments.map((item): LedgerItem => ({
            id: `adjustment-${item.id}`,
            userId: item.userId,
            displayName: item.displayName,
            email: item.email,
            kind: item.amount >= 0 ? 'Bakiye yüklemesi' : 'Bakiye düşümü',
            amount: item.amount,
            balanceAfter: item.balanceAfter,
            detail: `İşlem sonrası bakiye: ${money(item.balanceAfter)}`,
            actor: 'Yönetici işlemi',
            createdAt: item.createdAt,
            status: 'adjustment',
        }));
        return [...requests, ...adjustments].sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
    }, [data]);

    const review = async (item: BalanceRequest, decision: 'approve' | 'reject') => {
        const amount = Number(approvedAmounts[item.id]);
        if (decision === 'approve' && (!Number.isFinite(amount) || amount <= 0 || Number(amount.toFixed(2)) !== amount)) {
            setError('Onay tutarı geçerli ve en fazla iki ondalık basamaklı olmalıdır.');
            return;
        }
        setBusyId(item.id);
        setError('');
        setNotice('');
        try {
            const response = await fetch('/api/admin/balance-requests', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    requestId: item.id,
                    decision,
                    approvedAmount: decision === 'approve' ? amount : undefined,
                    note: notes[item.id] ?? '',
                }),
            });
            const payload = await response.json() as Payload<unknown>;
            if (!response.ok || !payload.data) throw new Error(payload.error ?? 'Talep sonuçlandırılamadı.');
            setNotice(decision === 'approve'
                ? `${item.displayName} için ${money(amount)} sanal bakiyeye aktarıldı.`
                : `${item.displayName} kullanıcısının talebi reddedildi.`);
            await loadRequests();
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'Talep sonuçlandırılamadı.');
        } finally {
            setBusyId('');
        }
    };

    const tabClass = (selected: boolean) => `inline-flex min-h-10 items-center gap-2 rounded-lg px-3 py-2 text-xs font-bold transition ${selected ? 'border border-emerald-500/20 bg-emerald-500/10 text-emerald-300' : 'border border-slate-700 bg-slate-800 text-slate-400 hover:text-white'}`;

    return <main className="min-h-[calc(100vh-64px)] min-w-0 bg-slate-950 p-4 text-slate-100 md:p-7">
        <div className="mx-auto max-w-[1500px] space-y-6">
            <header className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-800 pb-5">
                <div>
                    <span className="text-[10px] font-bold tracking-[.2em] text-emerald-400">TRADE ENGINE / SUPER ADMIN</span>
                    <h1 className="mt-1 flex items-center gap-3 text-3xl font-extrabold text-white"><Wallet className="h-7 w-7 text-emerald-400" />Bakiye İşlemleri</h1>
                    <p className="mt-2 text-sm text-slate-400">Kullanıcı taleplerini yönetin ve tüm sanal bakiye hareketlerini denetleyin.</p>
                </div>
                <button type="button" onClick={() => void loadRequests()} disabled={loading} className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-4 py-2.5 text-xs font-bold text-slate-200 hover:bg-slate-700 disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Yenile</button>
            </header>
            <section className="space-y-5 rounded-2xl border border-slate-800 bg-slate-900 p-4 shadow-xl md:p-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap gap-2">
                        <button type="button" className={tabClass(activeTab === 'pending')} onClick={() => setActiveTab('pending')}><Clock3 className="h-4 w-4" />Bekleyen talepler <span className="rounded-full bg-slate-950/70 px-2 py-0.5">{pendingRequests.length}</span></button>
                        <button type="button" className={tabClass(activeTab === 'ledger')} onClick={() => setActiveTab('ledger')}><ScrollText className="h-4 w-4" />Bakiye işlem günlüğü <span className="rounded-full bg-slate-950/70 px-2 py-0.5">{ledger.length}</span></button>
                    </div>
                    <span className="inline-flex items-center gap-1.5 text-[10px] font-bold tracking-wider text-emerald-400"><CircleDollarSign className="h-3.5 w-3.5" />SUPER ADMIN</span>
                </div>
                {loading && !data.requests.length && !data.adjustments.length ? <p className="py-8 text-center text-xs text-slate-500">Bakiye kayıtları yükleniyor…</p>
                    : activeTab === 'pending' ? pendingRequests.length ? <ul className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                        {pendingRequests.map((item) => <li key={item.id} className="min-w-0 space-y-3 rounded-xl border border-slate-800 bg-slate-950/50 p-4">
                            <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
                                <div className="min-w-0"><p className="break-words text-sm font-bold text-white">{item.displayName}</p><p className="break-all text-xs text-slate-500">{item.email || item.userId}</p></div>
                                <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-400">Beklemede</span>
                            </div>
                            <div className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
                                <p className="rounded-lg border border-slate-800 bg-slate-900 p-3"><span className="block text-slate-500">İstenen tutar</span><strong className="mt-1 block text-slate-100">{money(item.requestedAmount)}</strong></p>
                                <p className="rounded-lg border border-slate-800 bg-slate-900 p-3"><span className="block text-slate-500">Gönderilme zamanı</span><strong className="mt-1 block text-slate-100">{dateLabel(item.createdAt)}</strong></p>
                            </div>
                            <p className="break-words text-xs leading-relaxed text-slate-300">{item.reason}</p>
                            <label className="block text-xs font-medium text-slate-400">Onaylanacak tutar (TL)
                                <input type="number" min="0.01" max="1000000000" step="0.01" value={approvedAmounts[item.id] ?? String(item.requestedAmount)} onChange={(event) => setApprovedAmounts((current) => ({ ...current, [item.id]: event.target.value }))} className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50" />
                            </label>
                            <label className="block text-xs font-medium text-slate-400">Kullanıcıya iletilecek not (isteğe bağlı)
                                <input type="text" maxLength={180} value={notes[item.id] ?? ''} onChange={(event) => setNotes((current) => ({ ...current, [item.id]: event.target.value }))} className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50" />
                            </label>
                            <div className="flex flex-wrap gap-2">
                                <button type="button" onClick={() => void review(item, 'approve')} disabled={Boolean(busyId)} className="inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white transition hover:bg-emerald-500 disabled:opacity-50"><Check className="h-4 w-4" />{busyId === item.id ? 'İşleniyor…' : 'Onayla ve aktar'}</button>
                                <button type="button" onClick={() => void review(item, 'reject')} disabled={Boolean(busyId)} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-rose-500/20 bg-rose-500/10 px-4 py-2.5 text-xs font-bold text-rose-300 transition hover:bg-rose-500/20 disabled:opacity-50"><X className="h-4 w-4" />Reddet</button>
                            </div>
                        </li>)}
                    </ul> : <p className="rounded-xl border border-slate-800 bg-slate-950/50 p-6 text-center text-xs text-slate-500">Bekleyen bakiye talebi yok.</p>
                    : ledger.length ? <div className="overflow-x-auto rounded-xl border border-slate-800">
                        <table className="w-full min-w-[900px] text-left text-xs">
                            <thead className="bg-slate-950 text-slate-500"><tr><th className="px-4 py-3 font-semibold">Tarih</th><th className="px-4 py-3 font-semibold">Kullanıcı</th><th className="px-4 py-3 font-semibold">İşlem</th><th className="px-4 py-3 font-semibold">Tutar</th><th className="px-4 py-3 font-semibold">Durum / Not</th><th className="px-4 py-3 font-semibold">İşlemi yapan</th></tr></thead>
                            <tbody>{ledger.map((item) => <tr key={item.id} className="border-t border-slate-800/80 align-top">
                                <td className="whitespace-nowrap px-4 py-3 text-slate-400">{dateLabel(item.createdAt)}</td>
                                <td className="max-w-56 px-4 py-3"><strong className="block truncate text-slate-200">{item.displayName}</strong><span className="block truncate text-[10px] text-slate-500">{item.email || item.userId}</span></td>
                                <td className="whitespace-nowrap px-4 py-3 text-slate-200">{item.kind}</td>
                                <td className={`whitespace-nowrap px-4 py-3 font-bold ${item.amount >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>{item.status === 'rejected' || item.status === 'pending' ? '—' : `${item.amount >= 0 ? '+' : ''}${money(item.amount)}`}</td>
                                <td className="max-w-[380px] break-words px-4 py-3 text-slate-400"><span className={`mb-1 inline-flex rounded-full border px-2.5 py-1 text-[10px] font-semibold ${item.status === 'approved' ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300' : item.status === 'rejected' ? 'border-rose-500/20 bg-rose-500/10 text-rose-300' : item.status === 'pending' ? 'border-amber-500/20 bg-amber-500/10 text-amber-300' : 'border-slate-700 bg-slate-800 text-slate-300'}`}>{item.status === 'approved' ? 'Onaylandı' : item.status === 'rejected' ? 'Reddedildi' : item.status === 'pending' ? 'Beklemede' : 'Kaydedildi'}</span><span className="block leading-relaxed">{item.detail}{item.balanceAfter !== null ? ` · Bakiye: ${money(item.balanceAfter)}` : ''}</span></td>
                                <td className="whitespace-nowrap px-4 py-3 text-slate-400">{item.actor}</td>
                            </tr>)}</tbody>
                        </table>
                    </div> : <p className="rounded-xl border border-slate-800 bg-slate-950/50 p-6 text-center text-xs text-slate-500">Bakiye işlemi kaydı bulunmuyor.</p>}
            </section>
        </div>
    </main>;
}
