'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, Ban, ChevronLeft, ChevronRight, CircleDollarSign, Download, KeyRound, MailPlus, RefreshCw, Search, Shield, Trash2, Users } from 'lucide-react';
import StockSymbolLink from '@/components/StockSymbolLink';
import { useAppPreferences } from '@/components/AppProviders';
import { showError, showSuccess } from '@/lib/ui-alerts';

type Role = 'user' | 'pro_trader' | 'analyst' | 'admin' | 'super_admin';
type AdminUser = {
    id: string; email: string; createdAt: string; lastSignInAt: string | null;
    emailVerifiedAt: string | null; banned: boolean; displayName: string; role: Role;
    balance: number; portfolioValue: number; realizedPnl: number; unrealizedPnl: number; positionsCount: number;
};
type UserDetails = {
    id: string; email: string; createdAt: string; lastSignInAt: string | null; emailVerifiedAt: string | null;
    banned: boolean; profile: { username: string; display_name: string; full_name: string; bio: string; rank_xp_adjustment: number } | null;
    role: Role; rank: { xp: number; rank: string; pnlPercent: number; completedLessons: number; activeDays: number };
    portfolio: { id: string; balance: number } | null;
    positions: Array<{ symbol: string; quantity: number; average_price: number; current_price: number; pnl: number }>;
    pendingOrders: Array<{ id: string; symbol: string; side: string; order_type: string; quantity: number; trigger_price: number | null; status: string }>;
    recentTransactions: Array<{ id: string; symbol: string | null; transaction_type: string; quantity: number; cash_delta: number; realized_pnl: number; created_at: string }>;
};
type Event = { id: string; userId: string; email: string; displayName: string; kind: string; description: string; createdAt: string };
type Payload<T> = { data?: T; error?: string; actionLink?: string | null; emailSent?: boolean };

const ROLES: Array<{ value: Role; label: string }> = [
    { value: 'user', label: 'Standart yatırımcı' }, { value: 'pro_trader', label: 'Pro Trader' },
    { value: 'analyst', label: 'Analist' }, { value: 'admin', label: 'Admin' }, { value: 'super_admin', label: 'Super Admin' },
];
const money = (value: number) => new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 2 }).format(value);
const date = (value: string | null) => value ? new Date(value).toLocaleString('tr-TR', { dateStyle: 'medium', timeStyle: 'short' }) : '—';

export default function AdminWorkspace({ actorRole }: { actorRole: Role }) {
    const { confirmDialog } = useAppPreferences();
    const [users, setUsers] = useState<AdminUser[]>([]);
    const [selectedId, setSelectedId] = useState('');
    const [details, setDetails] = useState<UserDetails | null>(null);
    const [events, setEvents] = useState<Event[]>([]);
    const [eventUserFilter, setEventUserFilter] = useState('all');
    const [search, setSearch] = useState('');
    const [roleFilter, setRoleFilter] = useState('all');
    const [statusFilter, setStatusFilter] = useState('all');
    const [verificationFilter, setVerificationFilter] = useState('all');
    const [createdFrom, setCreatedFrom] = useState('');
    const [createdTo, setCreatedTo] = useState('');
    const [sortBy, setSortBy] = useState('created');
    const [page, setPage] = useState(1);
    const [profileDraft, setProfileDraft] = useState({ displayName: '', fullName: '', bio: '' });
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [cashAmount, setCashAmount] = useState('');
    const [cashNote, setCashNote] = useState('');
    const [rankNote, setRankNote] = useState('');
    const [recoveryLink, setRecoveryLink] = useState('');
    const [inviteEmail, setInviteEmail] = useState('');
    const [inviteName, setInviteName] = useState('');

    useEffect(() => {
        if (error) showError(error);
    }, [error]);
    useEffect(() => {
        if (notice) showSuccess(notice);
    }, [notice]);

    const loadUsers = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const [usersResponse, activityResponse] = await Promise.all([
                fetch('/api/admin/users', { cache: 'no-store' }),
                fetch('/api/admin/activity', { cache: 'no-store' }),
            ]);
            const [userPayload, activityPayload] = await Promise.all([
                usersResponse.json() as Promise<Payload<AdminUser[]>>,
                activityResponse.json() as Promise<Payload<Event[]>>,
            ]);
            if (!usersResponse.ok || !userPayload.data) throw new Error(userPayload.error ?? 'Kullanıcılar yüklenemedi.');
            if (!activityResponse.ok || !activityPayload.data) throw new Error(activityPayload.error ?? 'Etkinlik akışı yüklenemedi.');
            setUsers(userPayload.data);
            setEvents(activityPayload.data);
            setSelectedId((previous) => previous || userPayload.data?.[0]?.id || '');
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'Yönetim verileri yüklenemedi.');
        } finally {
            setLoading(false);
        }
    }, []);

    const loadDetails = useCallback(async (userId: string) => {
        if (!userId) { setDetails(null); return; }
        try {
            const response = await fetch(`/api/admin/users/${userId}`, { cache: 'no-store' });
            const payload = await response.json() as Payload<UserDetails>;
            if (!response.ok || !payload.data) throw new Error(payload.error ?? 'Kullanıcı detayları yüklenemedi.');
            setDetails(payload.data);
            setProfileDraft({
                displayName: payload.data.profile?.username ?? payload.data.profile?.display_name ?? '',
                fullName: payload.data.profile?.full_name ?? '',
                bio: payload.data.profile?.bio ?? '',
            });
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'Kullanıcı detayları yüklenemedi.');
        }
    }, []);

    useEffect(() => {
        const timer = window.setTimeout(() => { void loadUsers(); }, 0);
        return () => window.clearTimeout(timer);
    }, [loadUsers]);
    useEffect(() => {
        const timer = window.setTimeout(() => { void loadDetails(selectedId); }, 0);
        return () => window.clearTimeout(timer);
    }, [loadDetails, selectedId]);
    useEffect(() => {
        const timer = window.setInterval(() => {
            void loadUsers();
            if (selectedId) void loadDetails(selectedId);
        }, 30000);
        return () => window.clearInterval(timer);
    }, [loadDetails, loadUsers, selectedId]);

    const visibleUsers = useMemo(() => users.filter((item) => {
        const query = search.trim().toLocaleLowerCase('tr-TR');
        const matchesQuery = !query || `${item.email} ${item.displayName} ${item.id}`.toLocaleLowerCase('tr-TR').includes(query);
        const matchesStatus = statusFilter === 'all' || (statusFilter === 'banned' ? item.banned : !item.banned);
        const matchesVerification = verificationFilter === 'all' || (verificationFilter === 'verified' ? Boolean(item.emailVerifiedAt) : !item.emailVerifiedAt);
        const createdAt = new Date(item.createdAt).getTime();
        const matchesFromDate = !createdFrom || createdAt >= new Date(`${createdFrom}T00:00:00`).getTime();
        const matchesToDate = !createdTo || createdAt < new Date(`${createdTo}T00:00:00`).getTime() + 86400000;
        return matchesQuery && matchesStatus && matchesVerification && matchesFromDate && matchesToDate && (roleFilter === 'all' || item.role === roleFilter);
    }).sort((a, b) => sortBy === 'portfolio' ? b.portfolioValue - a.portfolioValue
        : sortBy === 'pnl' ? (b.realizedPnl + b.unrealizedPnl) - (a.realizedPnl + a.unrealizedPnl)
            : sortBy === 'lastSignIn' ? new Date(b.lastSignInAt ?? 0).getTime() - new Date(a.lastSignInAt ?? 0).getTime()
                : new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()), [createdFrom, createdTo, roleFilter, search, sortBy, statusFilter, users, verificationFilter]);

    const pageSize = 25;
    const pageCount = Math.max(1, Math.ceil(visibleUsers.length / pageSize));
    const effectivePage = Math.min(page, pageCount);
    const pageUsers = visibleUsers.slice((effectivePage - 1) * pageSize, effectivePage * pageSize);
    const performAction = async (action: string, extra: Record<string, string | number> = {}) => {
        if (!selectedId || busy) return;
        setBusy(true);
        setError('');
        setNotice('');
        setRecoveryLink('');
        try {
            const response = await fetch(`/api/admin/users/${selectedId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action, ...extra }),
            });
            const payload = await response.json() as Payload<unknown>;
            if (!response.ok) throw new Error(payload.error ?? 'İşlem tamamlanamadı.');
            if (payload.actionLink) setRecoveryLink(payload.actionLink);
            else if (action === 'recovery_link' && payload.emailSent) setNotice('Parola yenileme e-postası kullanıcıya gönderildi.');
            else setNotice('İşlem başarıyla tamamlandı.');
            if (action === 'delete') {
                setSelectedId('');
                setDetails(null);
                await loadUsers();
                return;
            }
            await loadUsers();
            await loadDetails(selectedId);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'İşlem tamamlanamadı.');
        } finally {
            setBusy(false);
        }
    };

    const updateRole = async (role: Role) => {
        if (!selectedId || busy) return;
        setBusy(true);
        setError('');
        setNotice('');
        try {
            const response = await fetch(`/api/admin/users/${selectedId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ role }),
            });
            const payload = await response.json() as Payload<unknown>;
            if (!response.ok) throw new Error(payload.error ?? 'Rol değiştirilemedi.');
            setNotice('Kullanıcı rolü güncellendi.');
            await loadUsers();
            await loadDetails(selectedId);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'Rol değiştirilemedi.');
        } finally {
            setBusy(false);
        }
    };

    const saveProfile = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!selectedId || busy) return;
        setBusy(true);
        setError('');
        setNotice('');
        try {
            const response = await fetch(`/api/admin/users/${selectedId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(profileDraft),
            });
            const payload = await response.json() as Payload<unknown>;
            if (!response.ok) throw new Error(payload.error ?? 'Profil güncellenemedi.');
            setNotice('Profil bilgileri güncellendi.');
            await loadUsers();
            await loadDetails(selectedId);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'Profil güncellenemedi.');
        } finally {
            setBusy(false);
        }
    };

    const inviteUser = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (busy) return;
        setBusy(true);
        setError('');
        setNotice('');
        try {
            const response = await fetch('/api/admin/users', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: inviteEmail, displayName: inviteName }),
            });
            const payload = await response.json() as Payload<{ id: string; email: string; invited: boolean }>;
            if (!response.ok || !payload.data) throw new Error(payload.error ?? 'Kullanıcı davet edilemedi.');
            setNotice(`${payload.data.email} adresine hesap daveti gönderildi.`);
            setInviteEmail('');
            setInviteName('');
            await loadUsers();
            setSelectedId(payload.data.id);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'Kullanıcı davet edilemedi.');
        } finally {
            setBusy(false);
        }
    };

    const exportUsers = () => {
        const headers = ['User ID', 'Email', 'Display name', 'Role', 'Account status', 'Email verified', 'Created at', 'Last sign in', 'Cash balance TRY', 'Portfolio value TRY', 'Realized PnL TRY', 'Unrealized PnL TRY', 'Position count'];
        const escapeCell = (value: string | number) => {
            let text = String(value);
            if (/^[\s]*[=+\-@]/.test(text) && typeof value === 'string') text = `'${text}`;
            return `"${text.replaceAll('"', '""')}"`;
        };
        const rows = visibleUsers.map((item) => [
            item.id, item.email, item.displayName, item.role, item.banned ? 'banned' : 'active',
            item.emailVerifiedAt ? 'verified' : 'unverified', item.createdAt, item.lastSignInAt ?? '',
            item.balance, item.portfolioValue, item.realizedPnl, item.unrealizedPnl, item.positionsCount,
        ].map(escapeCell).join(','));
        const content = `\uFEFF${[headers.map(escapeCell).join(','), ...rows].join('\r\n')}`;
        const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = `trade-agent-users-${new Date().toISOString().slice(0, 10)}.csv`;
        link.click();
        URL.revokeObjectURL(url);
    };

    const updateRank = async (rank: string) => {
        if (!selectedId || !details || busy) return;
        const targetXp = Number(rank);
        const currentAdjustment = Number(details.profile?.rank_xp_adjustment ?? 0);
        const organicXp = Number(details.rank.xp) - currentAdjustment;
        const adjustment = targetXp - organicXp;
        setBusy(true);
        setError('');
        setNotice('');
        try {
            const response = await fetch(`/api/admin/users/${selectedId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ rankXpAdjustment: adjustment, rankNote }),
            });
            const payload = await response.json() as Payload<unknown>;
            if (!response.ok) throw new Error(payload.error ?? 'Trader Rank güncellenemedi.');
            setRankNote('');
            setNotice('Trader Rank güncellendi; bildirim tercihi açıksa kullanıcıya iletildi.');
            await loadUsers();
            await loadDetails(selectedId);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'Trader Rank güncellenemedi.');
        } finally {
            setBusy(false);
        }
    };

    const adjustCash = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const amount = Number(cashAmount.replace(',', '.'));
        if (!Number.isFinite(amount) || amount === 0 || !cashNote.trim()) {
            setError('Sıfırdan farklı tutar ve işlem açıklaması girin.');
            return;
        }
        await performAction('cash_adjustment', { amount, note: cashNote.trim() });
        setCashAmount('');
        setCashNote('');
    };

    const selected = users.find((item) => item.id === selectedId);
    const visibleEvents = useMemo(
        () => events.filter((item) => eventUserFilter === 'all' || item.userId === eventUserFilter),
        [eventUserFilter, events],
    );
    const choices = actorRole === 'super_admin' ? ROLES : ROLES.filter((item) => !['admin', 'super_admin'].includes(item.value));

    return <main className="admin-workspace-shell min-h-screen bg-slate-950 p-4 text-slate-100 md:p-8">
        <div className="max-w-[1500px] mx-auto space-y-7">
            <header className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-800 pb-6">
                <div><span className="text-xs font-bold tracking-widest text-emerald-400 uppercase">TRADE ENGINE / ADMINISTRATION</span>
                    <h1 className="mt-1 flex items-center gap-3 text-3xl font-extrabold text-white"><Shield className="h-8 w-8 text-emerald-400" />Yönetim Merkezi</h1>
                    <p className="mt-2 text-sm text-slate-400">Kullanıcı erişimleri, sanal portföy işlemleri ve sistem etkinlikleri.</p></div>
                <button onClick={() => void loadUsers()} disabled={loading} className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-4 py-2.5 text-xs font-bold text-slate-100 hover:bg-slate-700 disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Yenile</button>
            </header>
            {recoveryLink && <section className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-4">
                <p className="mb-2 text-sm font-bold text-amber-300">Tek kullanımlık parola yenileme bağlantısı</p>
                <div className="flex gap-2"><input readOnly value={recoveryLink} className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-300" />
                    <button type="button" onClick={() => void navigator.clipboard.writeText(recoveryLink)} className="rounded-lg bg-slate-800 px-4 py-2 text-xs font-bold">Kopyala</button></div>
            </section>}

            <form onSubmit={inviteUser} className="grid grid-cols-1 items-end gap-3 rounded-2xl border border-slate-800 bg-slate-900 p-4 shadow-xl md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:p-5">
                <div className="md:col-span-3"><span className="text-[10px] font-bold tracking-widest text-emerald-400">KULLANICI OLUŞTURMA</span><h2 className="mt-1 text-base font-bold text-white">E-posta daveti gönder</h2><p className="mt-1 text-xs text-slate-500">Kullanıcı kendi güvenli parola bağlantısını e-posta üzerinden oluşturur. Supabase Service Role gerektirir.</p></div>
                <input required type="email" maxLength={254} value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder="E-posta adresi" className="rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50" />
                <input minLength={3} maxLength={24} pattern="[a-z][a-z0-9_]{2,23}" value={inviteName} onChange={(event) => setInviteName(event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))} placeholder="Kullanıcı adı (isteğe bağlı)" className="rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50" />
                <button disabled={busy} className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-5 py-2.5 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-50"><MailPlus className="h-4 w-4" />{busy ? 'Gönderiliyor…' : 'Davet gönder'}</button>
            </form>

            <section className="min-w-0 space-y-4 rounded-2xl border border-slate-800 bg-slate-900 p-4 shadow-xl md:p-5">
                <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="flex items-center gap-2 font-bold text-white"><Users className="h-4 w-4 text-emerald-400" />Kullanıcı kayıtları</h2><p className="mt-1 text-xs text-slate-500">Tüm kullanıcılar ve hesap/portföy özetleri · {users.length.toLocaleString('tr-TR')} toplam</p></div><div className="flex items-center gap-2"><button type="button" onClick={exportUsers} disabled={!visibleUsers.length} className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-bold text-slate-200 hover:bg-slate-700 disabled:opacity-40"><Download className="h-3.5 w-3.5" />CSV dışa aktar</button><span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-300">{visibleUsers.length.toLocaleString('tr-TR')} sonuç</span></div></div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-8">
                    <label className="flex min-w-0 items-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-3 xl:col-span-2"><Search className="h-4 w-4 shrink-0 text-slate-500" /><input value={search} onChange={(event) => { setPage(1); setSearch(event.target.value); }} placeholder="E-posta, ad veya kullanıcı ID" className="w-full min-w-0 bg-transparent py-2.5 text-xs text-white outline-none" /></label>
                    <select value={roleFilter} onChange={(event) => { setPage(1); setRoleFilter(event.target.value); }} aria-label="Rol filtresi" className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 text-xs text-white"><option value="all">Tüm roller</option>{ROLES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
                    <select value={statusFilter} onChange={(event) => { setPage(1); setStatusFilter(event.target.value); }} aria-label="Hesap durumu filtresi" className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 text-xs text-white"><option value="all">Tüm durumlar</option><option value="active">Aktif</option><option value="banned">Dondurulmuş</option></select>
                    <select value={verificationFilter} onChange={(event) => { setPage(1); setVerificationFilter(event.target.value); }} aria-label="E-posta doğrulama filtresi" className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 text-xs text-white"><option value="all">Tüm e-postalar</option><option value="verified">Doğrulanmış</option><option value="unverified">Doğrulanmamış</option></select>
                    <select value={sortBy} onChange={(event) => { setPage(1); setSortBy(event.target.value); }} aria-label="Kullanıcı sıralaması" className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 text-xs text-white"><option value="created">En yeni kayıt</option><option value="lastSignIn">Son giriş</option><option value="portfolio">Portföy değeri</option><option value="pnl">Toplam P/L</option></select>
                    <input type="date" value={createdFrom} onChange={(event) => { setPage(1); setCreatedFrom(event.target.value); }} aria-label="Kayıt başlangıç tarihi" className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 text-xs text-white" />
                    <input type="date" value={createdTo} onChange={(event) => { setPage(1); setCreatedTo(event.target.value); }} aria-label="Kayıt bitiş tarihi" className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 text-xs text-white" />
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-5">
                    {[
                        ['Kayıtlı hesap', users.length],
                        ['Aktif', users.filter((item) => !item.banned).length],
                        ['Dondurulmuş', users.filter((item) => item.banned).length],
                        ['E-posta doğrulanmış', users.filter((item) => Boolean(item.emailVerifiedAt)).length],
                        ['Toplam portföy', money(users.reduce((total, item) => total + item.portfolioValue, 0))],
                    ].map(([label, value]) => <div key={String(label)} className="rounded-xl border border-slate-800 bg-slate-950/70 p-3"><span className="block text-[10px] text-slate-500">{label}</span><strong className="mt-1 block truncate text-sm text-white">{typeof value === 'number' ? value.toLocaleString('tr-TR') : value}</strong></div>)}
                </div>
                {loading && !users.length ? <p className="py-8 text-center text-sm text-slate-400">Kullanıcılar yükleniyor...</p> : <div className="overflow-x-auto rounded-xl border border-slate-800">
                    <table className="w-full min-w-[1320px] text-left text-xs">
                        <thead className="bg-slate-950/80 text-[10px] uppercase tracking-wide text-slate-500"><tr>{['Hesap / E-posta', 'Rol', 'Durum', 'Doğrulama', 'Kayıt tarihi', 'Son giriş', 'Nakit', 'Portföy değeri', 'Gerçekleşen P/L', 'Açık P/L', 'Pozisyon', ''].map((item, index) => <th key={`${item}-${index}`} className="whitespace-nowrap border-b border-slate-800 px-3 py-3 font-semibold">{item}</th>)}</tr></thead>
                        <tbody>{pageUsers.map((item) => <tr key={item.id} onClick={() => setSelectedId(item.id)} className={`cursor-pointer border-b border-slate-800/70 transition last:border-0 hover:bg-slate-800/50 ${selectedId === item.id ? 'bg-emerald-500/5' : ''}`}>
                            <td className="max-w-[260px] px-3 py-3"><strong className="block truncate text-slate-100">{item.displayName || item.email || item.id}</strong><span className="block truncate text-[10px] text-slate-500">{item.email || 'E-posta görünmüyor'}</span><span className="block truncate font-mono text-[9px] text-slate-600">{item.id}</span></td>
                            <td className="px-3 py-3"><span className="whitespace-nowrap rounded-full border border-slate-700 bg-slate-800 px-2.5 py-1 text-[10px] font-semibold text-slate-300">{item.role.replaceAll('_', ' ')}</span></td>
                            <td className="px-3 py-3"><span className={`whitespace-nowrap rounded-full border px-2.5 py-1 text-[10px] font-semibold ${item.banned ? 'border-rose-500/20 bg-rose-500/10 text-rose-300' : 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300'}`}>{item.banned ? 'Dondurulmuş' : 'Aktif'}</span></td>
                            <td className="px-3 py-3"><span className={`whitespace-nowrap rounded-full border px-2.5 py-1 text-[10px] font-semibold ${item.emailVerifiedAt ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300' : 'border-amber-500/20 bg-amber-500/10 text-amber-300'}`}>{item.emailVerifiedAt ? 'Doğrulandı' : 'Bekliyor'}</span></td>
                            <td className="whitespace-nowrap px-3 py-3 text-slate-400">{date(item.createdAt)}</td><td className="whitespace-nowrap px-3 py-3 text-slate-400">{date(item.lastSignInAt)}</td>
                            <td className="whitespace-nowrap px-3 py-3 text-slate-300">{money(item.balance)}</td><td className="whitespace-nowrap px-3 py-3 font-semibold text-white">{money(item.portfolioValue)}</td>
                            <td className={`whitespace-nowrap px-3 py-3 ${item.realizedPnl >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>{money(item.realizedPnl)}</td><td className={`whitespace-nowrap px-3 py-3 ${item.unrealizedPnl >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>{money(item.unrealizedPnl)}</td>
                            <td className="px-3 py-3 text-center text-slate-300">{item.positionsCount}</td><td className="px-3 py-3 text-right"><button type="button" onClick={(event) => { event.stopPropagation(); setSelectedId(item.id); }} className="whitespace-nowrap rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-[10px] font-bold text-emerald-300 hover:bg-emerald-500/20">Detay / CRUD</button></td>
                        </tr>)}</tbody>
                    </table>
                    {!pageUsers.length && <p className="p-8 text-center text-sm text-slate-500">Filtrelerle eşleşen kullanıcı bulunamadı.</p>}
                </div>}
                <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-400"><span>{visibleUsers.length ? `${((effectivePage - 1) * pageSize + 1).toLocaleString('tr-TR')}–${Math.min(effectivePage * pageSize, visibleUsers.length).toLocaleString('tr-TR')} / ${visibleUsers.length.toLocaleString('tr-TR')} kullanıcı` : 'Gösterilecek kullanıcı yok'}</span><div className="flex items-center gap-2"><button type="button" disabled={effectivePage <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} className="rounded-lg border border-slate-700 bg-slate-800 p-2 disabled:opacity-40" aria-label="Önceki sayfa"><ChevronLeft className="h-4 w-4" /></button><span>Sayfa {effectivePage} / {pageCount}</span><button type="button" disabled={effectivePage >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))} className="rounded-lg border border-slate-700 bg-slate-800 p-2 disabled:opacity-40" aria-label="Sonraki sayfa"><ChevronRight className="h-4 w-4" /></button></div></div>
            </section>

            <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">

                <div className="space-y-6 xl:col-span-5">
                    {details && <section className="space-y-5 rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-xl">
                        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-800 pb-4">
                            <div><span className="text-xs font-bold tracking-widest text-emerald-400 uppercase">KULLANICI DETAYI</span><h2 className="mt-1 break-all text-lg font-bold text-white">{details.profile?.username || details.profile?.display_name || details.profile?.full_name || details.email}</h2><p className="text-xs text-slate-400">{details.email}</p></div>
                            <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${details.emailVerifiedAt ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300' : 'border-amber-500/20 bg-amber-500/10 text-amber-300'}`}>{details.emailVerifiedAt ? 'E-posta doğrulanmış' : 'E-posta bekliyor'}</span>
                        </div>
                        <div className="grid grid-cols-2 gap-3 text-xs md:grid-cols-4">
                            {[['Bakiye', money(Number(details.portfolio?.balance ?? 0))], ['Portföy', money(Number(selected?.portfolioValue ?? 0))], ['Gerçekleşen P/L', money(Number(selected?.realizedPnl ?? 0))], ['Açık P/L', money(Number(selected?.unrealizedPnl ?? 0))]].map(([label, value]) => <div key={label} className="rounded-xl border border-slate-800 bg-slate-950/70 p-3"><span className="block text-slate-500">{label}</span><strong className="mt-1 block text-slate-100">{value}</strong></div>)}
                        </div>
                        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-xs">
                            <span className="font-bold text-amber-300">{details.rank.rank}</span><span className="text-slate-300">{details.rank.xp.toLocaleString('tr-TR')} XP</span>
                            <span className="text-slate-400">· {details.rank.completedLessons} ders · {details.rank.activeDays} aktif gün · {Number(details.rank.pnlPercent).toFixed(2)}% getiri</span>
                        </div>
                        <div className="grid grid-cols-1 gap-2 text-xs md:grid-cols-2"><p className="text-slate-400">Kayıt: <span className="text-slate-200">{date(details.createdAt)}</span></p><p className="text-slate-400">Son giriş: <span className="text-slate-200">{date(details.lastSignInAt)}</span></p></div>

                        <form onSubmit={saveProfile} className="space-y-3 rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                            <div><h3 className="text-sm font-bold text-white">Hesap profili</h3><p className="mt-1 text-[10px] text-slate-500">Kullanıcı adı, ad soyad ve biyografi güncellenebilir. Giriş e-postası Auth güvenliği nedeniyle bu ekrandan değiştirilemez.</p></div>
                            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                <input minLength={3} maxLength={24} pattern="[a-z][a-z0-9_]{2,23}" value={profileDraft.displayName} onChange={(event) => setProfileDraft({ ...profileDraft, displayName: event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') })} placeholder="Kullanıcı adı" className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 text-xs text-white" />
                                <input maxLength={120} value={profileDraft.fullName} onChange={(event) => setProfileDraft({ ...profileDraft, fullName: event.target.value })} placeholder="Ad soyad" className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 text-xs text-white" />
                                <textarea maxLength={280} rows={2} value={profileDraft.bio} onChange={(event) => setProfileDraft({ ...profileDraft, bio: event.target.value })} placeholder="Biyografi" className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 text-xs text-white sm:col-span-2" />
                            </div>
                            <button type="submit" disabled={busy} className="rounded-lg bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-50">Profil bilgilerini kaydet</button>
                        </form>

                        <div className="space-y-2"><label className="text-xs font-semibold text-slate-300">Kullanıcı rolü</label><select disabled={busy} value={details.role} onChange={(event) => void updateRole(event.target.value as Role)} className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 text-sm text-white">
                            {choices.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                        </select></div>
                        <div className="space-y-2"><label htmlFor="admin-rank-note" className="text-xs font-semibold text-slate-300">Rank değişikliği mesajı <span className="font-normal text-slate-500">(isteğe bağlı)</span></label><input id="admin-rank-note" maxLength={180} value={rankNote} onChange={(event) => setRankNote(event.target.value)} placeholder="Kullanıcıya iletilecek kısa not" className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 text-xs text-white" /></div>
                        <div className="space-y-2"><label className="text-xs font-semibold text-slate-300">Trader Rank ataması</label><select disabled={busy} value="" onChange={(event) => { if (event.target.value) void updateRank(event.target.value); }} className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 text-sm text-white">
                            <option value="">Mevcut: {details.rank.rank} · {details.rank.xp} XP</option>
                            <option value="0">Çaylak (0 XP)</option><option value="500">Analist (500 XP)</option><option value="2000">Üstat (2.000 XP)</option><option value="5000">Piyasa Yapıcı (5.000 XP)</option>
                        </select><p className="text-[10px] text-slate-500">Atama, otomatik hesaplanan ders/aktiflik/getiri XP’sine yönetici düzeltmesi olarak eklenir. Rank ve XP bilgisi bildirim olarak gönderilir.</p></div>

                        {actorRole === 'super_admin' && <form onSubmit={adjustCash} className="space-y-2 border-t border-slate-800 pt-4">
                            <h3 className="flex items-center gap-2 text-sm font-bold text-white"><CircleDollarSign className="h-4 w-4 text-emerald-400" />Sanal bakiye müdahalesi</h3>
                            <p className="text-[11px] text-slate-500">Pozitif tutar yükler, negatif tutar düşer. Eksi tutar rezerve emir bakiyesini aşamaz.</p>
                            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[140px_1fr]"><input value={cashAmount} onChange={(event) => setCashAmount(event.target.value)} inputMode="decimal" placeholder="± Tutar (TL)" className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 text-sm text-white" /><input value={cashNote} onChange={(event) => setCashNote(event.target.value)} maxLength={180} placeholder="İşlem açıklaması" className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 text-sm text-white" /></div>
                            <div className="flex flex-wrap gap-2">
                                <button disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-50">{busy ? 'İşleniyor...' : 'Bakiyeyi ayarla'}</button>
                                <button type="button" disabled={busy || Number(details.portfolio?.balance ?? 0) <= 0}
                                    onClick={() => {
                                        const balance = Number(details.portfolio?.balance ?? 0);
                                        void confirmDialog({
                                            title: 'Kullanıcı bakiyesi sıfırlansın mı?',
                                            message: `${money(balance)} bakiye sıfırlanacak. Bekleyen emir rezervasyonları bu işleme engel olabilir.`,
                                            confirmLabel: 'Bakiyeyi sıfırla',
                                            danger: true,
                                        }).then((confirmed) => {
                                            if (!confirmed) return;
                                            void performAction('cash_adjustment', { amount: -balance, note: 'Yönetici bakiye sıfırlama' });
                                        });
                                    }}
                                    className="rounded-lg border border-rose-500/20 bg-rose-500/10 px-4 py-2.5 text-xs font-bold text-rose-300 disabled:opacity-50">Bakiyeyi sıfırla</button>
                            </div>
                        </form>}

                        <div className="flex flex-wrap gap-2 border-t border-slate-800 pt-4">
                            <button disabled={busy} onClick={() => void performAction(details.banned ? 'unban' : 'ban')} className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-bold disabled:opacity-50 ${details.banned ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300' : 'border-rose-500/20 bg-rose-500/10 text-rose-300'}`}><Ban className="h-4 w-4" />{details.banned ? 'Hesabı etkinleştir' : 'Hesabı dondur'}</button>
                            <button disabled={busy} onClick={() => void performAction('recovery_link')} className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-bold text-slate-200 disabled:opacity-50"><KeyRound className="h-4 w-4" />Sıfırlama bağlantısı üret</button>
                            <button disabled={busy || details.id === '' || details.id === undefined} onClick={() => {
                                void confirmDialog({
                                    title: 'Hesap kalıcı olarak silinsin mi?',
                                    message: `${details.email} hesabı ve bağlı verileri kalıcı olarak silinecek. Bu işlem geri alınamaz.`,
                                    confirmLabel: 'Hesabı sil',
                                    danger: true,
                                }).then((confirmed) => { if (confirmed) void performAction('delete'); });
                            }} className="inline-flex items-center gap-2 rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-xs font-bold text-rose-300 disabled:opacity-50"><Trash2 className="h-4 w-4" />Hesabı kalıcı sil</button>
                        </div>

                        <div className="grid grid-cols-1 gap-4 border-t border-slate-800 pt-4 md:grid-cols-2">
                            <div><h3 className="mb-2 text-xs font-bold text-slate-200">Aktif pozisyonlar</h3><div className="max-h-36 space-y-2 overflow-y-auto">{details.positions.map((item) => <div key={item.symbol} className="flex justify-between rounded-lg bg-slate-950/70 px-3 py-2 text-xs"><span><StockSymbolLink symbol={item.symbol} /> · {item.quantity}</span><span className={Number(item.pnl) >= 0 ? 'text-emerald-300' : 'text-rose-300'}>{money(Number(item.pnl))}</span></div>)}{!details.positions.length && <p className="text-xs text-slate-500">Açık pozisyon yok.</p>}</div></div>
                            <div><h3 className="mb-2 text-xs font-bold text-slate-200">Bekleyen emirler</h3><div className="max-h-36 space-y-2 overflow-y-auto">{details.pendingOrders.map((item) => <div key={item.id} className="rounded-lg bg-slate-950/70 px-3 py-2 text-xs text-slate-300"><StockSymbolLink symbol={item.symbol} /> · {item.side === 'buy' ? 'Alış' : 'Satış'} · {item.quantity} adet{item.trigger_price ? ` · ${money(Number(item.trigger_price))}` : ''}</div>)}{!details.pendingOrders.length && <p className="text-xs text-slate-500">Bekleyen emir yok.</p>}</div></div>
                        </div>
                        <div className="border-t border-slate-800 pt-4">
                            <div className="mb-2 flex items-center justify-between"><h3 className="text-xs font-bold text-slate-200">Son 50 portföy hareketi</h3><span className="text-[10px] text-slate-500">Gerçekleşen P/L dahil</span></div>
                            <div className="max-h-64 overflow-auto rounded-xl border border-slate-800">
                                <table className="w-full min-w-[620px] text-left text-[10px]"><thead className="sticky top-0 bg-slate-950 text-slate-500"><tr>{['Tarih', 'Hisse', 'Tür', 'Lot', 'Nakit hareketi', 'Gerçekleşen P/L'].map((label) => <th key={label} className="whitespace-nowrap border-b border-slate-800 px-2.5 py-2">{label}</th>)}</tr></thead>
                                    <tbody>{details.recentTransactions.map((item) => <tr key={item.id} className="border-b border-slate-800/70 last:border-0"><td className="whitespace-nowrap px-2.5 py-2 text-slate-400">{date(item.created_at)}</td><td className="font-semibold text-slate-200">{item.symbol ?? '—'}</td><td className="text-slate-400">{item.transaction_type.replaceAll('_', ' ')}</td><td className="text-slate-300">{item.quantity}</td><td className={Number(item.cash_delta) >= 0 ? 'text-emerald-300' : 'text-rose-300'}>{money(Number(item.cash_delta))}</td><td className={Number(item.realized_pnl) >= 0 ? 'text-emerald-300' : 'text-rose-300'}>{money(Number(item.realized_pnl))}</td></tr>)}</tbody>
                                </table>
                                {!details.recentTransactions.length && <p className="p-4 text-center text-xs text-slate-500">Portföy hareketi yok.</p>}
                            </div>
                        </div>
                    </section>}
                </div>

                <section className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-xl xl:col-span-3">
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
                        <div><h2 className="flex items-center gap-2 font-bold text-white"><Activity className="h-4 w-4 text-emerald-400" />Global Etkinlik</h2><p className="mt-1 text-[10px] text-slate-500">Tüm akışı veya tek bir kullanıcının hareketlerini incele.</p></div>
                        <div className="flex items-center gap-2"><label htmlFor="activity-user-filter" className="text-[10px] text-slate-500">Kullanıcı</label><select id="activity-user-filter" value={eventUserFilter} onChange={(event) => setEventUserFilter(event.target.value)} className="max-w-[240px] rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-slate-200"><option value="all">Tüm kullanıcılar</option>{users.map((user) => <option key={user.id} value={user.id}>{user.displayName || user.email || user.id}</option>)}</select><span className="text-[10px] text-slate-500">30 sn&apos;de yenilenir</span></div>
                    </div>
                    <div className="max-h-[700px] space-y-2 overflow-y-auto pr-1">
                        {visibleEvents.map((item) => <article key={`${item.kind}-${item.id}`} className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                            <div className="flex flex-wrap items-center justify-between gap-2"><button type="button" onClick={() => setEventUserFilter(item.userId || 'all')} className="min-w-0 text-left hover:text-emerald-300"><strong className="block truncate text-xs font-semibold text-slate-200">{item.displayName || 'Kullanıcı'}</strong><span className="block truncate text-[10px] text-slate-500">{item.email || item.userId}</span></button><span className="shrink-0 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[9px] text-emerald-300">{item.kind.replaceAll('_', ' ')}</span></div>
                            <p className="mt-2 text-xs leading-relaxed text-slate-400">{item.description}</p><time className="mt-2 block text-[10px] text-slate-600">{date(item.createdAt)}</time>
                        </article>)}
                        {!visibleEvents.length && <p className="py-8 text-center text-xs text-slate-500">{eventUserFilter === 'all' ? 'Henüz sistem hareketi yok.' : 'Bu kullanıcı için etkinlik bulunmuyor.'}</p>}
                    </div>
                </section>
            </div>
        </div>
    </main>;
}
