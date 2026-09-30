'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { Wallet } from 'lucide-react';
import Link from 'next/link';
import type { PortfolioState } from '@/lib/types';
import { showError, showSuccess } from '@/lib/ui-alerts';

type BalanceRequest = {
    id: string;
    requested_amount: number;
    reason: string;
    status: 'pending' | 'approved' | 'rejected';
    approved_amount: number | null;
    admin_note: string | null;
    created_at: string;
};
type BalanceMovement = {
    id: string;
    description: string;
    metadata: { delta?: number | string };
    created_at: string;
};
type HistoryEntry = { kind: 'request'; item: BalanceRequest } | { kind: 'adjustment'; item: BalanceMovement };
type ApiPayload<T> = {
    data?: T;
    error?: string;
    hasMore?: boolean;
    balanceMovements?: BalanceMovement[];
    hasMoreMovements?: boolean;
};

function formatMoney(value: number): string {
    return `${value.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} TL`;
}

function formatDate(value: string): string {
    return new Date(value).toLocaleString('tr-TR', { dateStyle: 'medium', timeStyle: 'short' });
}

export default function WalletBalanceCard({ className = '' }: { className?: string }) {
    const [portfolio, setPortfolio] = useState<PortfolioState | null>(null);
    const [requests, setRequests] = useState<BalanceRequest[]>([]);
    const [balanceMovements, setBalanceMovements] = useState<BalanceMovement[]>([]);
    const [hasMoreRequests, setHasMoreRequests] = useState(false);
    const [hasMoreMovements, setHasMoreMovements] = useState(false);
    const [loadingMoreRequests, setLoadingMoreRequests] = useState(false);
    const [amount, setAmount] = useState('');
    const [reason, setReason] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');

    useEffect(() => {
        if (error) showError(error);
    }, [error]);
    useEffect(() => {
        if (message) showSuccess(message);
    }, [message]);

    useEffect(() => {
        let active = true;
        const load = async () => {
            try {
                const [portfolioResponse, requestsResponse] = await Promise.all([
                    fetch('/api/portfolio', { cache: 'no-store' }),
                    fetch('/api/balance-requests?limit=10&movementOffset=0', { cache: 'no-store' }),
                ]);
                const [portfolioPayload, requestPayload] = await Promise.all([
                    portfolioResponse.json() as Promise<ApiPayload<PortfolioState>>,
                    requestsResponse.json() as Promise<ApiPayload<BalanceRequest[]>>,
                ]);
                if (portfolioResponse.status === 401 || requestsResponse.status === 401) {
                    throw new Error('Sanal cüzdanı açmak için giriş yapın.');
                }
                if (!portfolioResponse.ok || !portfolioPayload.data) {
                    throw new Error(portfolioPayload.error ?? 'Sanal cüzdan yüklenemedi.');
                }
                if (!requestsResponse.ok || !requestPayload.data) {
                    throw new Error(requestPayload.error ?? 'Bakiye talep geçmişi yüklenemedi.');
                }
                if (active) {
                    setPortfolio(portfolioPayload.data);
                    setRequests(requestPayload.data);
                    setHasMoreRequests(requestPayload.hasMore ?? false);
                    setBalanceMovements(requestPayload.balanceMovements ?? []);
                    setHasMoreMovements(requestPayload.hasMoreMovements ?? false);
                }
            } catch (cause) {
                if (active) setError(cause instanceof Error ? cause.message : 'Sanal cüzdan yüklenemedi.');
            }
        };
        void load();
        return () => { active = false; };
    }, []);

    const submitRequest = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const requestedAmount = Number(amount);
        if (!Number.isFinite(requestedAmount) || requestedAmount <= 0
            || Number(requestedAmount.toFixed(2)) !== requestedAmount) {
            setError('Talep tutarını en fazla iki ondalık basamakla girin.');
            return;
        }
        if (reason.trim().length < 5) {
            setError('Lütfen talep nedeninizi en az 5 karakterle açıklayın.');
            return;
        }

        setBusy(true);
        setError('');
        setMessage('');
        try {
            const response = await fetch('/api/balance-requests', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ amount: requestedAmount, reason: reason.trim() }),
            });
            const payload = await response.json() as ApiPayload<{ id: string }>;
            if (!response.ok || !payload.data) throw new Error(payload.error ?? 'Bakiye talebi gönderilemedi.');
            const historyResponse = await fetch('/api/balance-requests?limit=10&offset=0&movementOffset=0', { cache: 'no-store' });
            const historyPayload = await historyResponse.json() as ApiPayload<BalanceRequest[]>;
            if (!historyResponse.ok || !historyPayload.data) {
                throw new Error(historyPayload.error ?? 'Talep gönderildi ancak geçmiş yenilenemedi.');
            }
            setRequests((current) => {
                const currentIds = new Set(current.map((item) => item.id));
                return [...historyPayload.data ?? [], ...current.filter((item) => !currentIds.has(item.id))];
            });
            setHasMoreRequests(historyPayload.hasMore ?? false);
            setBalanceMovements((current) => {
                const currentIds = new Set(current.map((item) => item.id));
                return [...historyPayload.balanceMovements ?? [], ...current.filter((item) => !currentIds.has(item.id))];
            });
            setHasMoreMovements(historyPayload.hasMoreMovements ?? false);
            setAmount('');
            setReason('');
            setMessage('Bakiye talebiniz super admin incelemesine gönderildi.');
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'Bakiye talebi gönderilemedi.');
        } finally {
            setBusy(false);
        }
    };

    const totalValue = portfolio
        ? portfolio.balance + portfolio.positions.reduce((sum, position) => sum + position.currentPrice * position.quantity, 0)
        : 0;
    const hasPendingRequest = requests.some((item) => item.status === 'pending');
    const hasMoreHistory = hasMoreRequests || hasMoreMovements;
    const loadOlderRequests = async () => {
        if (loadingMoreRequests || !hasMoreHistory) return;
        setLoadingMoreRequests(true);
        try {
            const response = await fetch(`/api/balance-requests?limit=10&offset=${requests.length}&movementOffset=${balanceMovements.length}`, { cache: 'no-store' });
            const payload = await response.json() as ApiPayload<BalanceRequest[]>;
            if (!response.ok || !payload.data) throw new Error(payload.error ?? 'Eski bakiye talepleri yüklenemedi.');
            setRequests((current) => [...current, ...payload.data ?? []]);
            setBalanceMovements((current) => [...current, ...payload.balanceMovements ?? []]);
            setHasMoreRequests(payload.hasMore ?? false);
            setHasMoreMovements(payload.hasMoreMovements ?? false);
        } catch (cause) {
            showError(cause instanceof Error ? cause.message : 'Eski bakiye talepleri yüklenemedi.');
        } finally {
            setLoadingMoreRequests(false);
        }
    };
    const renderRequestRow = (item: BalanceRequest) => <li key={item.id} className="wallet-request-row flex min-w-0 flex-wrap items-start justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/50 p-3">
        <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
                <strong className="text-xs text-slate-100">{formatMoney(item.requested_amount)}</strong>
                <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${item.status === 'approved' ? 'border border-emerald-500/20 bg-emerald-500/10 text-emerald-400' : item.status === 'rejected' ? 'border border-rose-500/20 bg-rose-500/10 text-rose-400' : 'border border-amber-500/20 bg-amber-500/10 text-amber-400'}`}>
                    {item.status === 'approved' ? 'Onaylandı' : item.status === 'rejected' ? 'Reddedildi' : 'İncelemede'}
                </span>
            </div>
            <p className="mt-1 break-words text-xs text-slate-400"><span className="font-semibold text-slate-300">Talep notun:</span> {item.reason}</p>
            {item.status === 'approved' && item.approved_amount !== null && item.approved_amount !== item.requested_amount && <p className="mt-1 text-xs text-emerald-400">Aktarılan: {formatMoney(item.approved_amount)}</p>}
            {item.admin_note && <p className="mt-1 break-words text-xs text-slate-500">Yönetici notu: {item.admin_note}</p>}
            <time className="mt-2 block text-[10px] text-slate-500">{formatDate(item.created_at)}</time>
        </div>
    </li>;
    const renderAdjustmentRow = (item: BalanceMovement) => {
        const delta = Number(item.metadata?.delta);
        return <li key={`adjustment-${item.id}`} className="wallet-request-row flex min-w-0 flex-wrap items-start justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/50 p-3">
            <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                    <strong className={`text-xs ${!Number.isFinite(delta) ? 'text-slate-400' : delta >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {Number.isFinite(delta) ? `${delta > 0 ? '+' : ''}${formatMoney(delta)}` : 'Tutar kaydı bulunamadı'}
                    </strong>
                    <span className="rounded-full border border-slate-700 bg-slate-800 px-2.5 py-1 text-[10px] font-semibold text-slate-300">Yönetici bakiye işlemi</span>
                </div>
                <p className="mt-1 break-words text-xs text-slate-400">Neden: {item.description}</p>
                <time className="mt-2 block text-[10px] text-slate-500">{formatDate(item.created_at)}</time>
            </div>
        </li>;
    };
    const historyItems: HistoryEntry[] = [
        ...requests.map((item): HistoryEntry => ({ kind: 'request', item })),
        ...balanceMovements.map((item): HistoryEntry => ({ kind: 'adjustment', item })),
    ].sort((a, b) => new Date(b.item.created_at).getTime() - new Date(a.item.created_at).getTime());
    const renderHistoryItem = (entry: HistoryEntry) => entry.kind === 'request'
        ? renderRequestRow(entry.item)
        : renderAdjustmentRow(entry.item);

    return <section className={`wallet-balance-card ${className} space-y-5 rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-xl`}>
        <div className="wallet-card-heading border-b border-slate-800 pb-4">
            <div className="wallet-card-icon"><Wallet className="h-5 w-5" /></div>
            <div className="wallet-card-copy"><h2>Sanal cüzdan</h2><p>Hesabınıza 100.000 TL başlangıç sermayesi tanımlanır; ek bakiye için talep gönderebilirsiniz.</p></div>
        </div>
        {portfolio ? <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="wallet-stat rounded-xl border border-slate-700/60 bg-slate-800/80 p-3 text-xs"><span className="text-slate-400">Kullanılabilir nakit</span><strong className="mt-1 block text-white">{formatMoney(portfolio.balance)}</strong></div>
                <div className="wallet-stat rounded-xl border border-slate-700/60 bg-slate-800/80 p-3 text-xs"><span className="text-slate-400">Portföy toplamı</span><strong className="mt-1 block text-emerald-400">{formatMoney(totalValue)}</strong></div>
            </div>
            <form onSubmit={(event) => void submitRequest(event)} className="wallet-request-form space-y-3 rounded-xl border border-slate-800 bg-slate-950/50 p-4">
                <div><h3 className="text-sm font-bold text-white">Ek bakiye talep et</h3><p className="mt-1 text-xs leading-relaxed text-slate-400">Talebiniz incelendikten sonra istenen tutarın tamamı veya bir bölümü onaylanabilir.</p></div>
                <label className="block text-xs font-medium text-slate-300">Talep tutarı (TL)
                    <input type="number" required min="0.01" max="1000000000" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50" />
                </label>
                <label className="block text-xs font-medium text-slate-300">Talep nedeni
                    <textarea required minLength={5} maxLength={500} rows={3} value={reason} onChange={(event) => setReason(event.target.value)} className="mt-1.5 w-full resize-y rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50" placeholder="Talebinizi kısaca açıklayın" />
                </label>
                <button type="submit" disabled={busy || hasPendingRequest} className="w-full rounded-lg bg-emerald-600 px-5 py-2.5 text-xs font-bold text-white shadow-lg shadow-emerald-900/20 transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50">
                    {busy ? 'Gönderiliyor…' : hasPendingRequest ? 'İncelemede olan talebiniz var' : 'Bakiye talebi gönder'}
                </button>
            </form>
            <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-bold text-white">Talep ve bakiye geçmişi</h3>
                    <div className="flex flex-wrap items-center justify-end gap-2">
                        <span className="rounded-full border border-slate-700/80 bg-slate-800/70 px-2.5 py-1 text-[10px] font-medium text-slate-300">Güncel bakiye: {formatMoney(portfolio.balance)}</span>
                        <span className="text-[10px] text-slate-500">{historyItems.length}{hasMoreHistory ? '+' : ''} kayıt</span>
                    </div>
                </div>
                {historyItems.length ? <>
                    <ul className="space-y-2">{historyItems.slice(0, 3).map(renderHistoryItem)}</ul>
                    {historyItems.length > 3 && <div className="wallet-request-history-scroll max-h-64 space-y-2 overflow-y-auto overscroll-contain rounded-xl border border-slate-800/80 bg-slate-950/30 p-2" aria-label="Önceki talep ve bakiye hareketleri">
                        <p className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Önceki hareketler</p>
                        <ul className="space-y-2">{historyItems.slice(3).map(renderHistoryItem)}</ul>
                    </div>}
                </> : <p className="rounded-xl border border-slate-800 bg-slate-950/40 p-3 text-xs text-slate-500">Henüz bakiye talebi veya yönetici müdahalesi yok.</p>}
                {hasMoreHistory && <button type="button" onClick={() => void loadOlderRequests()} disabled={loadingMoreRequests} className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-bold text-slate-300 transition hover:bg-slate-700 disabled:opacity-50">{loadingMoreRequests ? 'Yükleniyor…' : 'Daha eski hareketleri yükle'}</button>}
            </div>
        </> : <div className="wallet-load-state"><p className="text-xs text-slate-400">{error || 'Cüzdan yükleniyor…'}</p>{error.includes('giriş yapın') && <Link href="/auth?next=%2Fprofile">Giriş yap</Link>}</div>}
        <p className="text-[11px] leading-relaxed text-slate-500">Cüzdan bakiyesi işlem ve onaylanan talepler doğrultusunda değişir; kullanıcılar doğrudan bakiye düzenleyemez.</p>
    </section>;
}
