'use client';

import { useCallback, useEffect, useState } from 'react';
import { Check, HelpCircle, MessageSquareText, RefreshCw, Send, ShieldCheck } from 'lucide-react';

type Profile = { username: string | null; display_name: string | null; xp_points?: number | null; rank_title?: string | null; is_banned?: boolean | null; forum_ban_until?: string | null } | null;
type SupportRequest = {
    id: string; user_id: string; request_type: 'question' | 'suggestion' | 'feedback'; subject: string; details: string; attachment_url: string | null;
    status: 'pending' | 'reviewing' | 'answered' | 'closed'; admin_reply: string | null; created_at: string; user: Profile;
    resolved_by: string | null; resolved_at: string | null; evaluator: Profile;
    events: Array<{ id: string; actor_role: string; event_type: string; previous_status: string | null; status: string; created_at: string; actor: Profile }>;
};
type AccountAppeal = {
    id: string; user_id: string; email: string; restriction_type: 'suspension' | 'closure'; reason_title: string;
    restriction_explanation: string; restriction_ends_at: string | null; subject: string; details: string; attachment_url: string | null; status: string;
    admin_note: string | null; created_at: string; user: Profile;
};
type ForumAppeal = { id: string; user_id: string; subject: string; details: string; attachment_url: string | null; status: string; admin_note: string | null; created_at: string; user: Profile };
type AdminData = {
    requests: SupportRequest[]; accountAppeals: AccountAppeal[]; forumAppeals: ForumAppeal[];
    totalCount: number; resolvedCount: number; offset: number; limit: number; hasMore: boolean; lane: 'waiting' | 'resolved';
    waitingCounts: { all: number; question: number; suggestion: number; feedback: number; appeals: number };
};
type Payload = { data?: AdminData; error?: string };
type Filter = 'all' | 'question' | 'suggestion' | 'feedback' | 'appeals';
type StatusFilter = 'all' | 'pending' | 'reviewing' | 'answered' | 'closed' | 'approved' | 'rejected' | 'superseded';
const dateLabel = (value: string | null) => value ? new Date(value).toLocaleString('tr-TR', { dateStyle: 'medium', timeStyle: 'short' }) : 'Süresiz';

function statusLabel(status: string) {
    return ({ pending: 'Bekliyor', reviewing: 'İnceleniyor', answered: 'Yanıtlandı', closed: 'Kapandı', approved: 'Kabul edildi', rejected: 'Reddedildi', superseded: 'Güncellendi' } as Record<string, string>)[status] ?? status;
}

function statusStyle(status: string) {
    if (status === 'answered' || status === 'approved') return 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300';
    if (status === 'closed' || status === 'rejected') return 'border-rose-500/20 bg-rose-500/10 text-rose-300';
    if (status === 'pending' || status === 'reviewing') return 'border-amber-500/20 bg-amber-500/10 text-amber-300';
    return 'border-slate-700 bg-slate-800 text-slate-400';
}

export default function AdminSupportWorkspace() {
    const [data, setData] = useState<AdminData>({
        requests: [], accountAppeals: [], forumAppeals: [], totalCount: 0, offset: 0, limit: 25,
        hasMore: false, resolvedCount: 0, lane: 'waiting', waitingCounts: { all: 0, question: 0, suggestion: 0, feedback: 0, appeals: 0 },
    });
    const [filter, setFilter] = useState<Filter>('all');
    const [lane, setLane] = useState<'waiting' | 'resolved'>('waiting');
    const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
    const [search, setSearch] = useState('');
    const [replies, setReplies] = useState<Record<string, string>>({});
    const [busyId, setBusyId] = useState('');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');

    const load = useCallback(async (offset = 0, selectedLane = lane) => {
        setLoading(true);
        setError('');
        try {
            const response = await fetch(`/api/admin/support?limit=25&offset=${offset}&lane=${selectedLane}`, { cache: 'no-store' });
            const payload = await response.json() as Payload;
            if (!response.ok || !payload.data) throw new Error(payload.error ?? 'Yardım ve itiraz kuyruğu yüklenemedi.');
            setData(payload.data);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'Yardım ve itiraz kuyruğu yüklenemedi.');
        } finally {
            setLoading(false);
        }
    }, [lane]);
    useEffect(() => {
        const timer = window.setTimeout(() => { void load(0, lane); }, 0);
        return () => window.clearTimeout(timer);
    }, [load, lane]);

    const updateSupport = async (item: SupportRequest, status: SupportRequest['status']) => {
        const adminReply = replies[item.id] ?? item.admin_reply ?? '';
        if (status === 'answered' && adminReply.trim().length < 2) {
            setError('Yanıtlanan talepler için önce kullanıcıya iletilecek bir yanıt yazın.');
            return;
        }
        setBusyId(item.id);
        setError('');
        setNotice('');
        try {
            const response = await fetch('/api/admin/support', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ request_id: item.id, status, admin_reply: adminReply }),
            });
            const payload = await response.json() as { data?: SupportRequest; error?: string };
            if (!response.ok || !payload.data) throw new Error(payload.error ?? 'Talep güncellenemedi.');
            await load(data.offset, lane);
            setNotice('Talep durumu güncellendi.');
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'Talep güncellenemedi.');
        } finally {
            setBusyId('');
        }
    };

    const reviewAppeal = async (appealId: string, action: 'review_account_appeal' | 'review_appeal', status: 'approved' | 'rejected') => {
        const note = replies[appealId]?.trim() ?? '';
        if (note.length < 2) {
            setError('İtiraz kararı için en az 2 karakterlik bir yönetici notu yazın.');
            return;
        }
        setBusyId(appealId);
        setError('');
        setNotice('');
        try {
            const response = await fetch('/api/admin/community', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action, appeal_id: appealId, status, admin_note: note }),
            });
            const payload = await response.json() as { error?: string };
            if (!response.ok) throw new Error(payload.error ?? 'İtiraz sonuçlandırılamadı.');
            setNotice(status === 'approved' ? 'İtiraz kabul edildi.' : 'İtiraz reddedildi.');
            await load(data.offset, lane);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'İtiraz sonuçlandırılamadı.');
        } finally {
            setBusyId('');
        }
    };

    const resolvedCount = data.resolvedCount;
    const showRequests = filter !== 'appeals';
    const showAppeals = filter === 'all' || filter === 'appeals';
    const visibleRequests = filter === 'all'
        ? data.requests
        : data.requests.filter((item) => item.request_type === filter);
    const matches = (subject: string, details: string, owner: string, status: string) => (
        (statusFilter === 'all' || status === statusFilter)
        && `${subject} ${details} ${owner}`.toLocaleLowerCase('tr-TR').includes(search.trim().toLocaleLowerCase('tr-TR'))
    );
    const requestsToShow = visibleRequests.filter((item) => matches(item.subject, item.details, item.user?.display_name ?? item.user?.username ?? item.user_id, item.status));
    const accountAppealsToShow = data.accountAppeals.filter((item) => matches(item.subject, item.details, item.email, item.status));
    const forumAppealsToShow = data.forumAppeals.filter((item) => matches(item.subject, item.details, item.user?.display_name ?? item.user?.username ?? item.user_id, item.status));

    return <main className="min-h-screen bg-slate-950 p-4 text-slate-100 md:p-8">
        <div className="mx-auto max-w-7xl space-y-6">
            <header className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-800 pb-5">
                <div><span className="text-xs font-bold tracking-widest text-emerald-400">TRADE ENGINE / DESTEK MASASI</span><h1 className="mt-1 flex items-center gap-3 text-3xl font-extrabold text-white"><HelpCircle className="h-8 w-8 text-emerald-400" />Yardım ve itirazlar</h1><p className="mt-2 text-sm text-slate-400">Soruları, görüş ve önerileri, hesap ve topluluk itirazlarını tek kuyruktan yönetin.</p></div>
                <button type="button" onClick={() => void load(data.offset, lane)} disabled={loading} className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-4 py-2.5 text-xs font-bold hover:bg-slate-700 disabled:opacity-50"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} />Yenile</button>
            </header>
            {error && <p role="alert" className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-sm text-rose-300">{error}</p>}
            {notice && <p role="status" className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-300">{notice}</p>}
            <nav aria-label="Kuyruk durumu" className="grid grid-cols-2 gap-2 rounded-2xl border border-slate-800 bg-slate-900 p-2 shadow-xl">
                <button type="button" onClick={() => { setLane('waiting'); setStatusFilter('all'); }} className={`rounded-xl px-3 py-3 text-sm font-bold transition ${lane === 'waiting' ? 'bg-amber-500/10 text-amber-300' : 'text-slate-400 hover:bg-slate-800'}`}>Değerlendirme bekleyenler ({data.waitingCounts.all})</button>
                <button type="button" onClick={() => { setLane('resolved'); setStatusFilter('all'); }} className={`rounded-xl px-3 py-3 text-sm font-bold transition ${lane === 'resolved' ? 'bg-emerald-500/10 text-emerald-300' : 'text-slate-400 hover:bg-slate-800'}`}>Sonuçlananlar ({resolvedCount})</button>
            </nav>
            <nav aria-label="Talep kategorileri" className="grid grid-cols-2 gap-2 rounded-2xl border border-slate-800 bg-slate-900 p-2 shadow-xl sm:grid-cols-3 lg:grid-cols-5">
                {([
                    ['all', `Tümü (${data.waitingCounts.all})`],
                    ['question', `Sorular (${data.waitingCounts.question})`],
                    ['suggestion', `Görüş / öneriler (${data.waitingCounts.suggestion})`],
                    ['feedback', `Geri bildirim (${data.waitingCounts.feedback})`],
                    ['appeals', `İtirazlar (${data.waitingCounts.appeals})`],
                ] as const).map(([key, label]) => <button key={key} type="button" onClick={() => setFilter(key)} className={`rounded-xl px-3 py-3 text-xs font-bold transition ${filter === key ? 'bg-emerald-500/10 text-emerald-300' : 'text-slate-400 hover:bg-slate-800'}`}>{label}</button>)}
            </nav>

            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_220px]">
                <input aria-label="Talep ara" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Konu, mesaj veya kullanıcı ara..." className="min-w-0 rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/40" />
                <select aria-label="Duruma göre filtrele" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)} className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/40">
                    <option value="all">Tüm durumlar</option>{lane === 'waiting'
                        ? <><option value="pending">Bekliyor</option><option value="reviewing">İnceleniyor</option></>
                        : <><option value="answered">Yanıtlandı</option><option value="closed">Kapandı</option><option value="approved">Kabul edildi</option><option value="rejected">Reddedildi</option><option value="superseded">Güncellendi</option></>}
                </select>
            </div>
            {showRequests && <section className="space-y-3">
                <h2 className="flex items-center gap-2 text-sm font-bold text-white"><MessageSquareText className="h-4 w-4 text-emerald-400" />{lane === 'waiting' ? 'Değerlendirme bekleyen' : 'Sonuçlanan'} · {filter === 'question' ? 'Sorular' : filter === 'suggestion' ? 'Görüş ve öneriler' : filter === 'feedback' ? 'Geri bildirimler' : 'Sorular, görüş ve öneriler'}</h2>
                {requestsToShow.map((item) => <article key={item.id} className="min-w-0 rounded-2xl border border-slate-800 bg-slate-900 p-4 shadow-xl md:p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-300">{item.request_type === 'question' ? 'Soru' : item.request_type === 'suggestion' ? 'Görüş / öneri' : 'Geri bildirim'}</span><strong className="break-all text-sm text-white">{item.user?.display_name || item.user?.username || item.user_id}</strong><span className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusStyle(item.status)}`}>{statusLabel(item.status)}</span></div><h3 className="mt-2 break-words text-sm font-bold text-white">{item.subject}</h3><p className="mt-1 text-[10px] text-slate-500">Gönderildi: {dateLabel(item.created_at)}{item.resolved_at ? ` · Sonuçlandı: ${dateLabel(item.resolved_at)}` : ''}{item.evaluator ? ` · Değerlendiren: ${item.evaluator.display_name || item.evaluator.username || 'Yönetici'}` : ''}</p></div></div>
                    <details className="mt-3 min-w-0 rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                        <summary className="cursor-pointer text-xs leading-5 text-slate-400"><span className="line-clamp-2 break-words">{item.details}</span></summary>
                        <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-slate-300">{item.details}</p>
                        {item.attachment_url && <a href={item.attachment_url} target="_blank" rel="noreferrer" className="mt-3 inline-flex text-xs font-semibold text-emerald-300 underline">Ekli görseli aç</a>}
                        {item.admin_reply && <div className="mt-3 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3"><p className="text-[10px] font-bold uppercase tracking-wider text-emerald-300">Yönetici yanıtı</p><p className="mt-1 whitespace-pre-wrap break-words text-xs text-slate-300">{item.admin_reply}</p></div>}
                        <div className="mt-3 border-t border-slate-800 pt-3"><p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">İşlem geçmişi</p><ul className="mt-2 space-y-2">{item.events.map((event) => <li key={event.id} className="flex flex-wrap justify-between gap-x-3 gap-y-1 text-[10px] text-slate-400"><span>{event.event_type === 'created' ? 'Talep oluşturuldu' : event.event_type === 'reply_updated' ? 'Yanıt güncellendi' : `Durum: ${statusLabel(event.previous_status ?? '')} → ${statusLabel(event.status)}`} · {event.actor_role === 'admin' ? event.actor?.display_name || event.actor?.username || 'Yönetici' : 'Kullanıcı'}</span><time>{dateLabel(event.created_at)}</time></li>)}</ul></div>
                    </details>
                    <label className="mt-4 block text-xs font-semibold text-slate-300">Kullanıcıya yanıt
                        <textarea rows={3} maxLength={3000} value={replies[item.id] ?? item.admin_reply ?? ''} onChange={(event) => setReplies((current) => ({ ...current, [item.id]: event.target.value }))} className="mt-1 w-full resize-y rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 text-sm text-white outline-none focus:ring-2 focus:ring-emerald-500/40" placeholder="Yanıtınızı yazın..." />
                    </label>
                    <div className="mt-3 flex flex-wrap justify-end gap-2">
                        <button type="button" disabled={busyId === item.id} onClick={() => void updateSupport(item, 'reviewing')} className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs font-bold text-amber-300 disabled:opacity-50">İnceleniyor</button>
                        <button type="button" disabled={busyId === item.id} onClick={() => void updateSupport(item, 'closed')} className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-bold text-slate-300 disabled:opacity-50">Kapat</button>
                        <button type="button" disabled={busyId === item.id} onClick={() => void updateSupport(item, 'answered')} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-50"><Send size={13} />Yanıtla</button>
                    </div>
                </article>)}
                {!loading && !requestsToShow.length && <p className="rounded-xl border border-slate-800 bg-slate-900 p-4 text-xs text-slate-400">Bu filtrede talep bulunamadı.</p>}
            </section>}

            {showAppeals && <section className="space-y-3">
                <h2 className="flex items-center gap-2 text-sm font-bold text-white"><ShieldCheck className="h-4 w-4 text-amber-400" />Hesap ve topluluk itirazları</h2>
                {accountAppealsToShow.map((item) => <article key={`account-${item.id}`} className="rounded-2xl border border-amber-500/20 bg-slate-900 p-4 shadow-xl md:p-5">
                    <div className="flex flex-wrap items-center justify-between gap-2"><div><div className="flex flex-wrap items-center gap-2"><span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-300">Hesap itirazı</span><strong className="text-sm text-white">{item.email}</strong></div><p className="mt-1 text-[10px] text-slate-500">Gönderildi: {dateLabel(item.created_at)} · {item.restriction_type === 'closure' ? 'Süresiz kapatma' : `Dondurma bitişi: ${dateLabel(item.restriction_ends_at)}`}</p></div><span className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusStyle(item.status)}`}>{statusLabel(item.status)}</span></div>
                    <p className="mt-2 text-xs text-slate-500">{item.user?.rank_title ?? 'Üye'}{item.user?.xp_points != null ? ` · ${item.user.xp_points} XP` : ''} · Hesap ID: {item.user_id}</p>
                    <details className="mt-3 min-w-0 rounded-xl border border-slate-800 bg-slate-950/70 p-3">
                        <summary className="cursor-pointer text-xs leading-5 text-slate-400"><strong className="text-slate-200">{item.subject}</strong><span className="mt-1 block line-clamp-2 break-words">{item.details}</span></summary>
                        <div className="mt-3 space-y-3"><div><strong className="text-xs text-slate-200">Kısıtlama nedeni · {item.reason_title}</strong><p className="mt-1 whitespace-pre-wrap break-words text-xs text-slate-400">{item.restriction_explanation}</p></div><div><strong className="text-xs text-slate-200">İtiraz açıklaması</strong><p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-slate-300">{item.details}</p></div>{item.attachment_url && <a href={item.attachment_url} target="_blank" rel="noreferrer" className="inline-flex text-xs font-semibold text-emerald-300 underline">Ekli görseli aç</a>}{item.admin_note && <p className="rounded-lg bg-slate-900 p-3 text-xs text-slate-400">Son yönetici kararı: {item.admin_note}</p>}</div>
                    </details>
                    {!['superseded'].includes(item.status) && <div className="mt-3 flex flex-wrap gap-2"><input value={replies[item.id] ?? ''} onChange={(event) => setReplies((current) => ({ ...current, [item.id]: event.target.value }))} maxLength={1000} placeholder="Karar notu (zorunlu)" className="min-w-[220px] flex-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-white" /><button type="button" disabled={busyId === item.id} onClick={() => void reviewAppeal(item.id, 'review_account_appeal', 'approved')} className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"><Check size={13} />{['approved', 'rejected'].includes(item.status) ? 'Yeniden değerlendir · kabul et' : 'Kabul et ve hesabı aç'}</button><button type="button" disabled={busyId === item.id} onClick={() => void reviewAppeal(item.id, 'review_account_appeal', 'rejected')} className="rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-xs font-bold text-rose-300 disabled:opacity-50">{['approved', 'rejected'].includes(item.status) ? 'Yeniden değerlendir · reddet' : 'Reddet'}</button></div>}
                </article>)}
                {forumAppealsToShow.map((item) => <article key={`forum-${item.id}`} className="rounded-2xl border border-slate-800 bg-slate-900 p-4 shadow-xl md:p-5">
                    <div className="flex flex-wrap items-center justify-between gap-2"><div><div className="flex flex-wrap items-center gap-2"><span className="rounded-full border border-slate-700 bg-slate-800 px-3 py-1 text-xs font-semibold text-slate-300">Topluluk itirazı</span><strong className="text-sm text-white">{item.user?.display_name || item.user?.username || item.user_id}</strong></div><p className="mt-1 text-[10px] text-slate-500">{dateLabel(item.created_at)}</p></div><span className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusStyle(item.status)}`}>{statusLabel(item.status)}</span></div>
                    <p className="mt-2 text-xs text-slate-500">{item.user?.rank_title ?? 'Üye'}{item.user?.xp_points != null ? ` · ${item.user.xp_points} XP` : ''} · Hesap ID: {item.user_id}</p>
                    <details className="mt-3 min-w-0 rounded-xl border border-slate-800 bg-slate-950/70 p-3">
                        <summary className="cursor-pointer text-xs leading-5 text-slate-400"><strong className="text-slate-200">{item.subject}</strong><span className="mt-1 block line-clamp-2 break-words">{item.details}</span></summary>
                        <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-slate-300">{item.details}</p>{item.attachment_url && <a href={item.attachment_url} target="_blank" rel="noreferrer" className="mt-3 inline-flex text-xs font-semibold text-emerald-300 underline">Ekli görseli aç</a>}{item.admin_note && <p className="mt-2 rounded-lg bg-slate-900 p-3 text-xs text-slate-400">Son yönetici kararı: {item.admin_note}</p>}
                    </details>
                    {!['superseded'].includes(item.status) && <div className="mt-3 flex flex-wrap gap-2"><input value={replies[item.id] ?? ''} onChange={(event) => setReplies((current) => ({ ...current, [item.id]: event.target.value }))} maxLength={1000} placeholder="Karar notu (zorunlu)" className="min-w-[220px] flex-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-white" /><button type="button" disabled={busyId === item.id} onClick={() => void reviewAppeal(item.id, 'review_appeal', 'approved')} className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"><Check size={13} />{['approved', 'rejected'].includes(item.status) ? 'Yeniden değerlendir · kabul et' : 'Kabul et ve yasağı kaldır'}</button><button type="button" disabled={busyId === item.id} onClick={() => void reviewAppeal(item.id, 'review_appeal', 'rejected')} className="rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-xs font-bold text-rose-300 disabled:opacity-50">{['approved', 'rejected'].includes(item.status) ? 'Yeniden değerlendir · reddet' : 'Reddet'}</button></div>}
                </article>)}
                {!loading && !accountAppealsToShow.length && !forumAppealsToShow.length && <p className="rounded-xl border border-slate-800 bg-slate-900 p-4 text-xs text-slate-400">Bu filtrede itiraz bulunamadı.</p>}
            </section>}
            {loading && <p className="text-xs text-slate-500">Yardım merkezi kuyruğu yükleniyor…</p>}
            <footer className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-900 p-4 shadow-xl">
                <p className="text-xs text-slate-400">Toplam {data.totalCount} kayıt · bu dilimde {data.requests.length + data.accountAppeals.length + data.forumAppeals.length} kayıt</p>
                <div className="flex gap-2"><button type="button" disabled={loading || data.offset === 0} onClick={() => void load(Math.max(0, data.offset - data.limit))} className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-bold text-slate-200 disabled:opacity-40">Önceki</button><button type="button" disabled={loading || !data.hasMore} onClick={() => void load(data.offset + data.limit)} className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-40">Sonraki</button></div>
            </footer>
        </div>
    </main>;
}
