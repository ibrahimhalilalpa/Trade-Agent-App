'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { LockKeyhole, MessageSquare, Pin, RefreshCw, ShieldAlert, Trash2, UnlockKeyhole, Users } from 'lucide-react';

type User = { user_id: string; username: string; display_name: string; email?: string; is_banned: boolean; forum_ban_until: string | null; forum_ban_active: boolean };
type Author = { user_id: string; username: string; display_name: string };
type Topic = { id: string; user_id: string; title: string; content: string; category: string; related_symbol: string | null; cover_image_url: string | null; images: string[]; tags: string[]; visibility: 'public' | 'followers'; is_pinned: boolean; is_closed: boolean; created_at: string; author?: Author | null };
type Comment = { id: string; topic_id: string; user_id: string; content: string; created_at: string; author?: Author | null; topic_title?: string };
type Report = {
    id: string; reporter_id: string; reported_user_id: string | null; target_type: 'topic' | 'comment'; target_topic_id: string | null;
    target_id: string; target_title: string | null; content_snapshot: string; reason: string; details: string;
    status: 'pending' | 'resolved' | 'dismissed' | 'withdrawn'; resolution_note: string | null; created_at: string;
    reporter: { username: string | null; display_name: string | null } | null;
    reported_user: { username: string | null; display_name: string | null } | null;
    previous_reports: Array<{ id: string; reason: string; status: string; created_at: string; target_title: string | null }>;
    moderation_history: Array<{ id: string; action: string; note: string; created_at: string }>;
};
type AdminData = { topics: Topic[]; comments: Comment[]; users: User[]; reports: Report[] };
type Payload = { data?: AdminData; error?: string };
const dateLabel = (value: string | null) => value ? new Date(value).toLocaleString('tr-TR', { dateStyle: 'medium', timeStyle: 'short' }) : 'Süresiz';
const REPORT_REASON_LABELS: Record<string, string> = { spam: 'Spam veya reklam', harassment: 'Taciz veya hakaret', misleading: 'Yanıltıcı içerik', personal_info: 'Kişisel bilgi', other: 'Diğer' };

export default function AdminCommunityWorkspace() {
    const [data, setData] = useState<AdminData>({ topics: [], comments: [], users: [], reports: [] });
    const [section, setSection] = useState<'reports' | 'topics' | 'comments' | 'users'>('reports');
    const [reportFilter, setReportFilter] = useState<'pending' | 'closed'>('pending');
    const [banDurations, setBanDurations] = useState<Record<string, string>>({});
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');

    const load = useCallback(async () => {
        setBusy(true);
        setError('');
        try {
            const response = await fetch('/api/admin/community?limit=100', { cache: 'no-store' });
            const payload = await response.json() as Payload;
            if (!response.ok || !payload.data) throw new Error(payload.error ?? 'Topluluk moderasyon verileri yüklenemedi.');
            setData(payload.data);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'Topluluk moderasyon verileri yüklenemedi.');
        } finally {
            setBusy(false);
        }
    }, []);
    useEffect(() => {
        const timer = window.setTimeout(() => { void load(); }, 0);
        return () => window.clearTimeout(timer);
    }, [load]);

    const moderate = async (action: string, fields: Record<string, string | boolean>) => {
        setBusy(true);
        setError('');
        setNotice('');
        try {
            const response = await fetch('/api/admin/community', {
                method: action === 'ban' || action === 'unban' ? 'POST' : 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action, ...fields }),
            });
            const payload = await response.json() as { error?: string };
            if (!response.ok) throw new Error(payload.error ?? 'Moderasyon işlemi tamamlanamadı.');
            setNotice('Moderasyon işlemi uygulandı.');
            await load();
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'Moderasyon işlemi tamamlanamadı.');
        } finally {
            setBusy(false);
        }
    };

    const banUser = (user: User) => {
        const duration = banDurations[user.user_id] ?? '7d';
        void moderate('ban', { user_id: user.user_id, duration });
    };

    return <main className="min-h-screen bg-slate-950 p-4 text-slate-100 md:p-8">
        <div className="mx-auto max-w-7xl space-y-6">
            <header className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-800 pb-5">
                <div><span className="text-[10px] font-bold tracking-[.18em] text-emerald-400">TRADE ENGINE / MODERATION</span><h1 className="mt-1 flex items-center gap-3 text-2xl font-extrabold text-white"><ShieldAlert className="h-7 w-7 text-emerald-400" />Topluluk & Forum</h1><p className="mt-2 text-xs text-slate-400">Topluluk içeriklerini denetleyin, konuları yönetin ve forum erişimini kontrol edin.</p></div>
                <button onClick={() => void load()} disabled={busy} className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-4 py-2.5 text-xs font-bold hover:bg-slate-700 disabled:opacity-50"><RefreshCw size={14} className={busy ? 'animate-spin' : ''} />Yenile</button>
            </header>
            {error && <p role="alert" className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-xs text-rose-300">{error}</p>}
            {notice && <p className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-xs text-emerald-300">{notice}</p>}
            <div className="grid grid-cols-2 gap-2 rounded-2xl border border-slate-800 bg-slate-900 p-2 shadow-xl sm:grid-cols-4">
                {([['reports', `Şikâyetler (${data.reports.filter((report) => report.status === 'pending').length})`], ['topics', `Konular (${data.topics.length})`], ['comments', `Yorumlar (${data.comments.length})`], ['users', `Kullanıcılar (${data.users.length})`]] as const).map(([key, label]) => <button key={key} onClick={() => setSection(key)} className={`rounded-xl px-3 py-3 text-xs font-bold ${section === key ? 'bg-emerald-500/10 text-emerald-300' : 'text-slate-400 hover:bg-slate-800'}`}>{label}</button>)}
            </div>
            {section === 'reports' && <>
                <div className="flex gap-2">
                    <button onClick={() => setReportFilter('pending')} className={`rounded-lg px-3 py-2 text-xs font-bold ${reportFilter === 'pending' ? 'bg-amber-500/10 text-amber-300' : 'text-slate-500 hover:bg-slate-800'}`}>Bekleyen</button>
                    <button onClick={() => setReportFilter('closed')} className={`rounded-lg px-3 py-2 text-xs font-bold ${reportFilter === 'closed' ? 'bg-emerald-500/10 text-emerald-300' : 'text-slate-500 hover:bg-slate-800'}`}>Sonuçlanan</button>
                </div>
                <section className="space-y-3">{data.reports.filter((report) => reportFilter === 'pending' ? report.status === 'pending' : report.status !== 'pending').map((report) => {
                    const statusLabel = report.status === 'pending' ? 'Bekliyor' : report.status === 'resolved' ? 'Sonuçlandı' : report.status === 'withdrawn' ? 'Bildiren geri çekti' : 'Reddedildi';
                    const warn = () => {
                        const note = window.prompt('Kullanıcıya gönderilecek uyarı metni:');
                        if (note?.trim()) void moderate('warn_user', { user_id: report.reported_user_id ?? '', report_id: report.id, note: note.trim() });
                    };
                    return <article key={report.id} className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900 p-4 shadow-xl">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2"><span className={`rounded-full border px-2.5 py-1 text-[10px] font-bold ${report.status === 'pending' ? 'border-amber-500/20 bg-amber-500/10 text-amber-300' : 'border-slate-700 bg-slate-800 text-slate-300'}`}>{statusLabel}</span><span className="text-xs font-bold text-white">{REPORT_REASON_LABELS[report.reason] ?? report.reason}</span><span className="text-[10px] text-slate-500">{dateLabel(report.created_at)}</span></div>
                                <p className="mt-2 text-xs text-slate-400">İçerik: {report.target_title ?? report.target_type} · Bildiren: {report.reporter?.username ?? report.reporter_id} · Hedef kullanıcı: {report.reported_user?.username ?? report.reported_user_id ?? 'bilinmiyor'}</p>
                                <div className="mt-3 rounded-xl border border-slate-800 bg-slate-950/70 p-3"><p className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-300">{report.content_snapshot}</p>{report.details && <p className="mt-2 border-t border-slate-800 pt-2 text-xs text-amber-200">Açıklama: {report.details}</p>}</div>
                                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                                    <div className="rounded-lg border border-slate-800 p-2.5"><p className="text-[10px] font-bold text-slate-400">Önceki şikâyetler: {report.previous_reports.length}</p>{report.previous_reports.slice(0, 4).map((previous) => <p key={previous.id} className="mt-1 text-[10px] text-slate-500">{dateLabel(previous.created_at)} · {REPORT_REASON_LABELS[previous.reason] ?? previous.reason} · {previous.status === 'resolved' ? 'Sonuçlandı' : previous.status === 'dismissed' ? 'Reddedildi' : previous.status === 'withdrawn' ? 'Bildiren geri çekti' : 'Bekliyor'}</p>)}</div>
                                    <div className="rounded-lg border border-slate-800 p-2.5"><p className="text-[10px] font-bold text-slate-400">Moderasyon geçmişi: {report.moderation_history.length}</p>{report.moderation_history.slice(0, 4).map((action) => <p key={action.id} className="mt-1 text-[10px] text-slate-500">{dateLabel(action.created_at)} · {action.action}: {action.note}</p>)}</div>
                                </div>
                            </div>
                            <div className="flex shrink-0 flex-wrap gap-2">
                                {report.target_topic_id && <Link href={`/forum/${report.target_topic_id}`} className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-[10px] font-bold text-slate-300">İçeriği aç</Link>}
                                {report.status === 'pending' && <>
                                    <button disabled={busy || !report.reported_user_id} onClick={warn} className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-[10px] font-bold text-amber-300 disabled:opacity-50">Uyarı gönder</button>
                                    <button disabled={busy || !report.reported_user_id} onClick={() => void moderate('ban', { user_id: report.reported_user_id ?? '', duration: 'permanent', report_id: report.id })} className="rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-[10px] font-bold text-rose-300 disabled:opacity-50">Süresiz yasakla</button>
                                    {report.target_type === 'topic'
                                        ? <button disabled={busy} onClick={() => void moderate('delete_topic', { topic_id: report.target_id, report_id: report.id })} className="rounded-lg border border-rose-500/20 px-3 py-2 text-[10px] font-bold text-rose-300 disabled:opacity-50">Konuyu sil</button>
                                        : <button disabled={busy} onClick={() => void moderate('delete_comment', { comment_id: report.target_id, report_id: report.id })} className="rounded-lg border border-rose-500/20 px-3 py-2 text-[10px] font-bold text-rose-300 disabled:opacity-50">Yorumu sil</button>}
                                    <button disabled={busy} onClick={() => void moderate('resolve_report', { report_id: report.id })} className="rounded-lg bg-emerald-600 px-3 py-2 text-[10px] font-bold text-white disabled:opacity-50">Çözüldü</button>
                                    <button disabled={busy} onClick={() => void moderate('dismiss_report', { report_id: report.id })} className="rounded-lg border border-slate-700 px-3 py-2 text-[10px] font-bold text-slate-300 disabled:opacity-50">Reddet</button>
                                </>}
                            </div>
                        </div>
                        {report.resolution_note && <p className="text-xs text-slate-500">Sonuç notu: {report.resolution_note}</p>}
                    </article>;
                })}</section>
            </>}
            {section === 'topics' && <section className="space-y-3">{data.topics.map((topic) => <article key={topic.id} className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900 p-4 shadow-xl">
                <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0 flex-1"><Link href={`/forum/${topic.id}`} className="font-bold text-white hover:text-emerald-300">{topic.title}</Link><p className="mt-1 line-clamp-3 text-xs leading-5 text-slate-400">{topic.content}</p><div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px] text-slate-500"><span>Yazar: {topic.author?.username ?? topic.user_id}</span><span>· {dateLabel(topic.created_at)}</span><span>· {topic.category.replaceAll('_', ' ')}</span><span className="inline-flex items-center gap-1 rounded-full border border-slate-700 bg-slate-800 px-2 py-1 text-slate-300">{topic.visibility === 'followers' ? <Users size={10} /> : <LockKeyhole size={10} />}{topic.visibility === 'followers' ? 'Takipçiler' : 'Herkese açık'}</span>{topic.related_symbol && <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-1 font-bold text-emerald-300">{topic.related_symbol}</span>}{topic.tags?.map((tag) => <span key={tag} className="rounded-full border border-slate-700 bg-slate-800 px-2 py-1 text-slate-400">#{tag}</span>)}</div></div><div className="flex shrink-0 flex-wrap gap-2">
                    <button disabled={busy} onClick={() => void moderate('pin', { topic_id: topic.id, is_pinned: !topic.is_pinned })} className={`inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-[10px] font-bold ${topic.is_pinned ? 'border-amber-500/20 bg-amber-500/10 text-amber-300' : 'border-slate-700 bg-slate-800 text-slate-300'}`}><Pin size={12} />{topic.is_pinned ? 'Sabiti kaldır' : 'Sabitle'}</button>
                    <button disabled={busy} onClick={() => void moderate('close', { topic_id: topic.id, is_closed: !topic.is_closed })} className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-[10px] font-bold text-slate-300">{topic.is_closed ? <UnlockKeyhole size={12} /> : <LockKeyhole size={12} />}{topic.is_closed ? 'Kilidi aç' : 'Kilitle'}</button>
                    <button disabled={busy} onClick={() => void moderate('delete_topic', { topic_id: topic.id })} className="inline-flex items-center gap-1 rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-[10px] font-bold text-rose-300"><Trash2 size={12} />Sil</button>
                </div></div>
                {(topic.cover_image_url || topic.images?.length > 0) && <div className="flex flex-wrap gap-2">{topic.cover_image_url && <Image src={topic.cover_image_url} alt="Konu kapak görseli" width={112} height={72} unoptimized className="h-[72px] w-28 rounded-lg border border-slate-700 object-cover" />}{topic.images?.map((image, index) => <Image key={image} src={image} alt={`Konu görseli ${index + 1}`} width={112} height={72} unoptimized className="h-[72px] w-28 rounded-lg border border-slate-700 object-cover" />)}</div>}
            </article>)}</section>}
            {section === 'comments' && <section className="space-y-3">{data.comments.map((comment) => <article key={comment.id} className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-900 p-4 shadow-xl">
                <div className="min-w-0 flex-1"><p className="whitespace-pre-wrap text-sm leading-6 text-slate-300">{comment.content}</p><p className="mt-2 text-[10px] text-slate-500">{comment.author?.username ?? comment.user_id} · {dateLabel(comment.created_at)} · <Link href={`/forum/${comment.topic_id}`} className="text-emerald-300 hover:underline">{comment.topic_title ?? 'Konuyu aç'}</Link></p></div>
                <button disabled={busy} onClick={() => void moderate('delete_comment', { comment_id: comment.id })} className="inline-flex items-center gap-1 rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-[10px] font-bold text-rose-300"><Trash2 size={12} />Sil</button>
            </article>)}</section>}
            {section === 'users' && <section className="space-y-3">{data.users.map((user) => {
                const banned = user.forum_ban_active;
                return <article key={user.user_id} className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-800 bg-slate-900 p-4 shadow-xl">
                    <div className="min-w-0"><strong className="block truncate text-sm text-white">{user.username || user.display_name || user.user_id}</strong><span className="text-xs text-slate-500">{user.email ?? ''}</span><p className="mt-1 text-[10px] text-slate-500">{banned ? `Yasaklı · ${dateLabel(user.forum_ban_until)}` : 'Forum erişimi açık'}</p></div>
                    <div className="flex flex-wrap items-center gap-2">
                        {!banned && <select aria-label={`${user.username} yasağı süresi`} value={banDurations[user.user_id] ?? '7d'} onChange={(event) => setBanDurations({ ...banDurations, [user.user_id]: event.target.value })} className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-white"><option value="1d">1 gün</option><option value="7d">7 gün</option><option value="30d">30 gün</option><option value="permanent">Süresiz</option></select>}
                        {banned ? <button disabled={busy} onClick={() => void moderate('unban', { user_id: user.user_id })} className="rounded-lg bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white disabled:opacity-50">Yasağı kaldır</button> : <button disabled={busy} onClick={() => banUser(user)} className="rounded-lg border border-rose-500/20 bg-rose-500/10 px-4 py-2.5 text-xs font-bold text-rose-300 disabled:opacity-50">Forum yasağı ver</button>}
                    </div>
                </article>;
            })}</section>}
            {(section === 'reports' && !data.reports.some((report) => reportFilter === 'pending' ? report.status === 'pending' : report.status !== 'pending') || section === 'topics' && data.topics.length === 0 || section === 'comments' && data.comments.length === 0 || section === 'users' && data.users.length === 0) && !busy && <div className="rounded-2xl border border-slate-800 bg-slate-900 p-8 text-center text-sm text-slate-500"><MessageSquare className="mx-auto mb-2 h-6 w-6" />Görüntülenecek kayıt bulunamadı.</div>}
        </div>
    </main>;
}
