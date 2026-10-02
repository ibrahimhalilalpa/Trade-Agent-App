'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Check, LockKeyhole, MessageSquare, Pin, RefreshCw, Search, ShieldAlert, Tags, Trash2, UnlockKeyhole, Users, X } from 'lucide-react';

type User = {
    user_id: string; username: string; display_name: string; email?: string; is_banned: boolean;
    forum_ban_until: string | null; forum_ban_active: boolean; topics_count: number; comments_count: number;
    reports_count: number; pending_reports_count: number;
};
type Category = { slug: string; label: string; sort_order: number; is_active: boolean };
type Author = { user_id: string; username: string; display_name: string };
type Topic = { id: string; user_id: string; title: string; content: string; category: string; related_symbol: string | null; cover_image_url: string | null; images: string[]; tags: string[]; visibility: 'public' | 'followers'; is_pinned: boolean; is_closed: boolean; created_at: string; author?: Author | null };
type Comment = { id: string; topic_id: string; user_id: string; content: string; created_at: string; author?: Author | null; topic_title?: string; topic_category?: string };
type Report = {
    id: string; reporter_id: string; reported_user_id: string | null; target_type: 'topic' | 'comment' | 'profile'; target_topic_id: string | null;
    target_id: string; target_title: string | null; content_snapshot: string; reason: string; details: string;
    status: 'pending' | 'reviewing' | 'resolved' | 'dismissed' | 'withdrawn'; resolution_note: string | null; created_at: string;
    reporter: { username: string | null; display_name: string | null } | null;
    reported_user: { username: string | null; display_name: string | null; forum_ban_active: boolean } | null;
    previous_reports: Array<{ id: string; reason: string; status: string; created_at: string; target_title: string | null }>;
    moderation_history: Array<{ id: string; action: string; note: string; created_at: string }>;
};
type AdminData = { topics: Topic[]; comments: Comment[]; users: User[]; reports: Report[]; categories: Category[] };
type Payload = { data?: AdminData; error?: string };
const dateLabel = (value: string | null) => value ? new Date(value).toLocaleString('tr-TR', { dateStyle: 'medium', timeStyle: 'short' }) : 'Süresiz';
const REPORT_REASON_LABELS: Record<string, string> = {
    spam: 'Spam veya reklam', harassment: 'Taciz veya hakaret', misleading: 'Yanıltıcı içerik', personal_info: 'Kişisel bilgi', other: 'Diğer',
    inappropriate_profile_photo: 'Uygunsuz profil fotoğrafı', inappropriate_username: 'Uygunsuz kullanıcı adı/görünen ad',
    impersonation: 'Taklit / sahte hesap', profile_other: 'Diğer profil ihlali',
};
type ReportDialog = { report: Report; mode: 'warning' | 'resolve' | 'dismiss' | 'ban' | 'result' };
const MODERATION_REASON_LABELS: Record<string, string> = {
    rules: 'Topluluk kurallarına aykırılık',
    spam: 'Spam veya yanıltıcı tanıtım',
    harassment: 'Taciz, hakaret veya hedef gösterme',
    misinformation: 'Yanlış/yanıltıcı bilgi',
    privacy: 'Kişisel veya hassas bilgi paylaşımı',
    other: 'Diğer',
};

export default function AdminCommunityWorkspace() {
    const [data, setData] = useState<AdminData>({ topics: [], comments: [], users: [], reports: [], categories: [] });
    const [section, setSection] = useState<'reports' | 'topics' | 'comments' | 'users' | 'categories'>('reports');
    const [reportFilter, setReportFilter] = useState<'pending' | 'closed'>('pending');
    const [banDurations, setBanDurations] = useState<Record<string, string>>({});
    const [search, setSearch] = useState('');
    const [commentUserFilter, setCommentUserFilter] = useState('');
    const [commentTopicFilter, setCommentTopicFilter] = useState('');
    const [commentCategoryFilter, setCommentCategoryFilter] = useState('');
    const [reportDialog, setReportDialog] = useState<ReportDialog | null>(null);
    const [dialogNote, setDialogNote] = useState('');
    const [dialogReason, setDialogReason] = useState('rules');
    const [dialogDuration, setDialogDuration] = useState('7d');
    const [dialogStatus, setDialogStatus] = useState<'pending' | 'reviewing' | 'resolved' | 'dismissed'>('resolved');
    const [removeReportedContent, setRemoveReportedContent] = useState(false);
    const [expandedReports, setExpandedReports] = useState<Record<string, boolean>>({});
    const [categoryDraft, setCategoryDraft] = useState<Category>({ slug: '', label: '', sort_order: 90, is_active: true });
    const [editingCategory, setEditingCategory] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');

    const load = useCallback(async () => {
        setBusy(true);
        setError('');
        try {
            const params = new URLSearchParams({ limit: '100', q: search, reportStatus: reportFilter });
            const response = await fetch(`/api/admin/community?${params}`, { cache: 'no-store' });
            const payload = await response.json() as Payload;
            if (!response.ok || !payload.data) throw new Error(payload.error ?? 'Topluluk moderasyon verileri yüklenemedi.');
            setData(payload.data);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'Topluluk moderasyon verileri yüklenemedi.');
        } finally {
            setBusy(false);
        }
    }, [search, reportFilter]);
    useEffect(() => {
        const timer = window.setTimeout(() => { void load(); }, 250);
        return () => window.clearTimeout(timer);
    }, [load]);

    const moderate = async (action: string, fields: Record<string, string | number | boolean>) => {
        setBusy(true);
        setError('');
        setNotice('');
        try {
            const response = await fetch('/api/admin/community', {
                method: action === 'ban' || action === 'unban' || action === 'create_category' ? 'POST' : 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action, ...fields }),
            });
            const payload = await response.json() as { error?: string };
            if (!response.ok) throw new Error(payload.error ?? 'Moderasyon işlemi tamamlanamadı.');
            setNotice('Moderasyon işlemi uygulandı.');
            await load();
            return true;
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'Moderasyon işlemi tamamlanamadı.');
            return false;
        } finally {
            setBusy(false);
        }
    };

    const banUser = (user: User) => {
        const duration = banDurations[user.user_id] ?? '7d';
        void moderate('ban', { user_id: user.user_id, duration });
    };
    const saveCategory = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const saved = await moderate(editingCategory ? 'save_category' : 'create_category', categoryDraft);
        if (saved) {
            setCategoryDraft({ slug: '', label: '', sort_order: data.categories.length * 10 + 10, is_active: true });
            setEditingCategory(false);
        }
    };
    const submitReportDialog = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!reportDialog) return;
        const { report, mode } = reportDialog;
        const reasonLabel = MODERATION_REASON_LABELS[dialogReason] ?? MODERATION_REASON_LABELS.other;
        const note = mode === 'warning' || mode === 'ban'
            ? `${reasonLabel}${dialogNote.trim() ? `: ${dialogNote.trim()}` : ''}`
            : dialogNote.trim();
        const action = mode === 'warning' ? 'warn_user'
            : mode === 'ban' ? 'ban'
                : mode === 'result' ? 'update_report_result'
                    : mode === 'resolve' ? 'resolve_report' : 'dismiss_report';
        const submitted = await moderate(action, {
            user_id: report.reported_user_id ?? '',
            report_id: report.id,
            note,
            ...(mode === 'ban' ? { duration: dialogDuration } : {}),
            ...(mode === 'result' ? { status: dialogStatus } : {}),
        });
        if (submitted) {
            if (mode === 'result' && removeReportedContent && ['topic', 'comment'].includes(report.target_type)) {
                const removed = await moderate(report.target_type === 'topic' ? 'delete_topic' : 'delete_comment', {
                    [report.target_type === 'topic' ? 'topic_id' : 'comment_id']: report.target_id,
                    report_id: report.id,
                });
                if (!removed) return;
            }
            setReportDialog(null);
            setDialogNote('');
            setRemoveReportedContent(false);
        }
    };

    const filteredComments = data.comments.filter((comment) =>
        (!commentUserFilter || comment.user_id === commentUserFilter)
        && (!commentTopicFilter || comment.topic_id === commentTopicFilter)
        && (!commentCategoryFilter || comment.topic_category === commentCategoryFilter),
    );
    const previewComment = (content: string) => content.length > 180 ? `${content.slice(0, 180).trimEnd()}…` : content;

    return <main className="min-h-screen bg-slate-950 p-4 text-slate-100 md:p-8">
        <div className="mx-auto max-w-7xl space-y-6">
            <header className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-800 pb-5">
                <div><span className="text-[10px] font-bold tracking-[.18em] text-emerald-400">TRADE ENGINE / MODERATION</span><h1 className="mt-1 flex items-center gap-3 text-2xl font-extrabold text-white"><ShieldAlert className="h-7 w-7 text-emerald-400" />Topluluk & Forum</h1><p className="mt-2 text-xs text-slate-400">Topluluk içeriklerini denetleyin, konuları yönetin ve forum erişimini kontrol edin.</p></div>
                <button onClick={() => void load()} disabled={busy} className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-4 py-2.5 text-xs font-bold hover:bg-slate-700 disabled:opacity-50"><RefreshCw size={14} className={busy ? 'animate-spin' : ''} />Yenile</button>
            </header>
            {error && <p role="alert" className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-xs text-rose-300">{error}</p>}
            {notice && <p className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-xs text-emerald-300">{notice}</p>}
            <div className="grid grid-cols-2 gap-2 rounded-2xl border border-slate-800 bg-slate-900 p-2 shadow-xl sm:grid-cols-3 lg:grid-cols-5">
                {([
                    ['reports', `Şikâyetler (${data.reports.filter((report) => report.status === 'pending').length})`],
                    ['topics', `Konular (${data.topics.length})`],
                    ['comments', `Yorumlar (${data.comments.length})`],
                    ['users', `Kullanıcılar (${data.users.length})`],
                    ['categories', `Kategoriler (${data.categories.length})`],
                ] as const).map(([key, label]) => <button key={key} onClick={() => setSection(key)} className={`rounded-xl px-3 py-3 text-xs font-bold ${section === key ? 'bg-emerald-500/10 text-emerald-300' : 'text-slate-400 hover:bg-slate-800'}`}>{label}</button>)}
            </div>
            <label className="flex items-center gap-3 rounded-xl border border-slate-700 bg-slate-900 px-3.5 py-3">
                <Search className="h-4 w-4 shrink-0 text-slate-500" />
                <input value={search} onChange={(event) => setSearch(event.target.value)} className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-slate-500" placeholder={section === 'reports' ? 'İçerik, kullanıcı veya şikâyet nedeni ara…' : section === 'users' ? 'Kullanıcı adı veya görünen ad ara…' : section === 'topics' ? 'Konu, kategori veya hisse kodu ara…' : section === 'categories' ? 'Kategori ara…' : 'Yorum içeriğinde ara…'} />
                {search && <button type="button" onClick={() => setSearch('')} aria-label="Aramayı temizle" className="text-slate-500 hover:text-white"><X size={15} /></button>}
            </label>
            {section === 'reports' && <>
                <div className="flex gap-2">
                    <button onClick={() => setReportFilter('pending')} className={`rounded-lg px-3 py-2 text-xs font-bold ${reportFilter === 'pending' ? 'bg-amber-500/10 text-amber-300' : 'text-slate-500 hover:bg-slate-800'}`}>Bekleyen</button>
                    <button onClick={() => setReportFilter('closed')} className={`rounded-lg px-3 py-2 text-xs font-bold ${reportFilter === 'closed' ? 'bg-emerald-500/10 text-emerald-300' : 'text-slate-500 hover:bg-slate-800'}`}>Sonuçlanan</button>
                </div>
                <section className="grid gap-3 xl:grid-cols-2">{data.reports.filter((report) => reportFilter === 'pending' ? report.status === 'pending' || report.status === 'reviewing' : report.status !== 'pending' && report.status !== 'reviewing').map((report) => {
                    const statusLabel = report.status === 'pending' ? 'Bekliyor' : report.status === 'reviewing' ? 'İnceleniyor' : report.status === 'resolved' ? 'Sonuçlandı' : report.status === 'withdrawn' ? 'Bildiren geri çekti' : 'Reddedildi';
                    const expanded = Boolean(expandedReports[report.id]);
                    return <article key={report.id} className="flex min-h-[300px] flex-col gap-3 rounded-2xl border border-slate-800 bg-slate-900 p-4 shadow-xl">
                        <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2"><span className={`rounded-full border px-2.5 py-1 text-[10px] font-bold ${report.status === 'pending' ? 'border-amber-500/20 bg-amber-500/10 text-amber-300' : report.status === 'reviewing' ? 'border-sky-500/20 bg-sky-500/10 text-sky-300' : 'border-slate-700 bg-slate-800 text-slate-300'}`}>{statusLabel}</span><span className="text-xs font-bold text-white">{REPORT_REASON_LABELS[report.reason] ?? report.reason}</span><span className="text-[10px] text-slate-500">{dateLabel(report.created_at)}</span></div>
                                <p className="mt-2 line-clamp-2 text-xs text-slate-400">{report.target_title ?? report.target_type} · Bildiren: {report.reporter?.username ?? report.reporter_id} · Hedef: {report.reported_user?.username ?? report.reported_user_id ?? 'bilinmiyor'}</p>
                            </div>
                        </div>
                        <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
                            <p className={`whitespace-pre-wrap break-words text-xs leading-5 text-slate-300 ${expanded ? 'max-h-64 overflow-y-auto' : 'line-clamp-3'}`}>{report.content_snapshot}</p>
                            {report.content_snapshot.length > 220 && <button onClick={() => setExpandedReports({ ...expandedReports, [report.id]: !expanded })} className="mt-2 text-[10px] font-bold text-emerald-300">{expanded ? 'Kısalt' : 'İçeriğin tamamını göster'}</button>}
                            {report.details && <p className="mt-2 line-clamp-2 border-t border-slate-800 pt-2 text-xs text-amber-200">Bildirim notu: {report.details}</p>}
                        </div>
                        <details className="group rounded-lg border border-slate-800 px-3 py-2">
                            <summary className="cursor-pointer list-none text-[10px] font-bold text-slate-400">Geçmiş · Önceki şikâyet {report.previous_reports.length} · Moderasyon {report.moderation_history.length}</summary>
                            <div className="mt-2 grid gap-2 sm:grid-cols-2">
                                <div className="max-h-24 overflow-y-auto">{report.previous_reports.slice(0, 5).map((previous) => <p key={previous.id} className="mt-1 text-[10px] text-slate-500">{dateLabel(previous.created_at)} · {REPORT_REASON_LABELS[previous.reason] ?? previous.reason} · {previous.status}</p>)}</div>
                                <div className="max-h-24 overflow-y-auto">{report.moderation_history.slice(0, 5).map((action) => <p key={action.id} className="mt-1 text-[10px] text-slate-500">{dateLabel(action.created_at)} · {action.action}: {action.note}</p>)}</div>
                            </div>
                        </details>
                        {report.resolution_note && <p className="line-clamp-2 text-xs text-slate-500">Sonuç notu: {report.resolution_note}</p>}
                        <div className="mt-auto flex flex-wrap gap-2 border-t border-slate-800 pt-3">
                            {report.target_topic_id && <Link href={`/forum/${report.target_topic_id}`} className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-[10px] font-bold text-slate-300">İçeriği aç</Link>}
                            {report.target_type === 'profile' && report.reported_user?.username && <Link href={`/profile/${encodeURIComponent(report.reported_user.username)}`} className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-[10px] font-bold text-slate-300">Profili aç</Link>}
                            {(report.status === 'pending' || report.status === 'reviewing') && <>
                                {report.status === 'pending' && <button disabled={busy} onClick={() => void moderate('start_review', { report_id: report.id })} className="rounded-lg border border-sky-500/20 bg-sky-500/10 px-3 py-2 text-[10px] font-bold text-sky-300 disabled:opacity-50">İncelemeye al</button>}
                                <button disabled={busy || !report.reported_user_id} onClick={() => { setReportDialog({ report, mode: 'warning' }); setDialogNote(''); setDialogReason('rules'); }} className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-[10px] font-bold text-amber-300 disabled:opacity-50">Uyarı gönder</button>
                                <button disabled={busy || !report.reported_user_id} onClick={() => { setReportDialog({ report, mode: 'ban' }); setDialogNote(''); setDialogReason('rules'); setDialogDuration('7d'); }} className="rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-[10px] font-bold text-rose-300 disabled:opacity-50">Erişimi kısıtla</button>
                                {report.target_type === 'topic'
                                    ? <button disabled={busy} onClick={() => void moderate('delete_topic', { topic_id: report.target_id, report_id: report.id })} className="rounded-lg border border-rose-500/20 px-3 py-2 text-[10px] font-bold text-rose-300 disabled:opacity-50">Konuyu sil</button>
                                    : report.target_type === 'comment' && <button disabled={busy} onClick={() => void moderate('delete_comment', { comment_id: report.target_id, report_id: report.id })} className="rounded-lg border border-rose-500/20 px-3 py-2 text-[10px] font-bold text-rose-300 disabled:opacity-50">Yorumu sil</button>}
                                <button disabled={busy} onClick={() => { setReportDialog({ report, mode: 'resolve' }); setDialogNote(''); }} className="rounded-lg bg-emerald-600 px-3 py-2 text-[10px] font-bold text-white disabled:opacity-50">Sonuçlandır</button>
                                <button disabled={busy} onClick={() => { setReportDialog({ report, mode: 'dismiss' }); setDialogNote(''); }} className="rounded-lg border border-slate-700 px-3 py-2 text-[10px] font-bold text-slate-300 disabled:opacity-50">Reddet</button>
                            </>}
                            {report.status !== 'pending' && report.status !== 'reviewing' && report.status !== 'withdrawn' && <>
                                <button disabled={busy} onClick={() => { setReportDialog({ report, mode: 'result' }); setDialogNote(report.resolution_note ?? ''); setDialogStatus(report.status === 'resolved' ? 'resolved' : 'dismissed'); setRemoveReportedContent(false); }} className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-[10px] font-bold text-slate-200">Sonucu düzenle / yeniden aç</button>
                                {report.reported_user?.forum_ban_active && <button disabled={busy} onClick={() => void moderate('unban', { user_id: report.reported_user_id ?? '', report_id: report.id, note: 'Moderasyon panelinden yasak kaldırıldı.' })} className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-[10px] font-bold text-emerald-300 disabled:opacity-50">Yasağı kaldır</button>}
                            </>}
                        </div>
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
            {section === 'comments' && <section className="space-y-3">
                <div className="grid gap-2 rounded-2xl border border-slate-800 bg-slate-900 p-3 shadow-xl sm:grid-cols-3">
                    <select aria-label="Yoruma göre kullanıcı filtresi" value={commentUserFilter} onChange={(event) => setCommentUserFilter(event.target.value)} className="min-w-0 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-white"><option value="">Tüm kullanıcılar</option>{Array.from(new Map(data.comments.map((comment) => [comment.user_id, comment.author?.username ?? comment.user_id])).entries()).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>
                    <select aria-label="Yoruma göre konu filtresi" value={commentTopicFilter} onChange={(event) => setCommentTopicFilter(event.target.value)} className="min-w-0 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-white"><option value="">Tüm konular</option>{Array.from(new Map(data.comments.map((comment) => [comment.topic_id, comment.topic_title ?? 'Konusuz'])).entries()).map(([id, title]) => <option key={id} value={id}>{title}</option>)}</select>
                    <select aria-label="Yoruma göre kategori filtresi" value={commentCategoryFilter} onChange={(event) => setCommentCategoryFilter(event.target.value)} className="min-w-0 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-white"><option value="">Tüm kategoriler</option>{data.categories.map((category) => <option key={category.slug} value={category.slug}>{category.label}</option>)}</select>
                </div>
                {filteredComments.map((comment) => <article key={comment.id} className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-900 p-4 shadow-xl">
                <div className="min-w-0 flex-1"><p className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-300">{previewComment(comment.content)}</p><p className="mt-2 text-[10px] text-slate-500">{comment.author?.username ?? comment.user_id} · {dateLabel(comment.created_at)} · <Link href={`/forum/${comment.topic_id}`} className="text-emerald-300 hover:underline">{comment.topic_title ?? 'Konuyu aç'}</Link>{comment.topic_category && ` · ${comment.topic_category.replaceAll('_', ' ')}`}</p></div>
                <button disabled={busy} onClick={() => void moderate('delete_comment', { comment_id: comment.id })} className="inline-flex items-center gap-1 rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-[10px] font-bold text-rose-300"><Trash2 size={12} />Sil</button>
            </article>)}</section>}
            {section === 'users' && <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900 shadow-xl"><table className="w-full min-w-[780px] border-collapse text-left text-xs">
                <thead className="border-b border-slate-800 bg-slate-950/60 text-[10px] uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3">Kullanıcı</th><th className="px-3 py-3 text-center">Paylaşım</th><th className="px-3 py-3 text-center">Yorum</th><th className="px-3 py-3 text-center">Bildirilen</th><th className="px-3 py-3 text-center">Bekleyen</th><th className="px-4 py-3">Erişim / İşlem</th></tr></thead><tbody className="divide-y divide-slate-800">{data.users.map((user) => {
                const banned = user.forum_ban_active;
                return <tr key={user.user_id} className="hover:bg-slate-800/30">
                    <td className="max-w-[250px] px-4 py-3"><strong className="block truncate text-sm text-white">{user.username || user.display_name || user.user_id}</strong><span className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${banned ? 'bg-rose-500/10 text-rose-300' : 'bg-emerald-500/10 text-emerald-300'}`}>{banned ? `Yasaklı · ${dateLabel(user.forum_ban_until)}` : 'Erişim açık'}</span></td>
                    <td className="px-3 py-3 text-center text-white">{user.topics_count}</td><td className="px-3 py-3 text-center text-white">{user.comments_count}</td><td className="px-3 py-3 text-center text-white">{user.reports_count}</td><td className="px-3 py-3 text-center text-amber-300">{user.pending_reports_count}</td>
                    <td className="px-4 py-3"><div className="flex items-center gap-2">{!banned && <select aria-label={`${user.username} yasağı süresi`} value={banDurations[user.user_id] ?? '7d'} onChange={(event) => setBanDurations({ ...banDurations, [user.user_id]: event.target.value })} className="rounded-lg border border-slate-700 bg-slate-800 px-2 py-2 text-[10px] text-white"><option value="1d">1 gün</option><option value="7d">7 gün</option><option value="30d">30 gün</option><option value="permanent">Süresiz</option></select>}{banned ? <button disabled={busy} onClick={() => void moderate('unban', { user_id: user.user_id })} className="whitespace-nowrap rounded-lg bg-emerald-600 px-3 py-2 text-[10px] font-bold text-white disabled:opacity-50">Yasağı kaldır</button> : <button disabled={busy} onClick={() => banUser(user)} className="whitespace-nowrap rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-[10px] font-bold text-rose-300 disabled:opacity-50">Yasakla</button>}</div></td>
                </tr>;
            })}</tbody></table></div>}
            {section === 'categories' && <section className="space-y-4">
                <form onSubmit={(event) => void saveCategory(event)} className="grid gap-3 rounded-2xl border border-slate-800 bg-slate-900 p-4 shadow-xl md:grid-cols-[1fr_1.4fr_130px_auto]">
                    <label className="space-y-1 text-[10px] font-semibold text-slate-400">Kategori kodu
                        <input required minLength={2} maxLength={40} pattern="[a-z][a-z0-9_]{1,39}" disabled={editingCategory} value={categoryDraft.slug} onChange={(event) => setCategoryDraft({ ...categoryDraft, slug: event.target.value })} className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 text-xs text-white outline-none focus:ring-2 focus:ring-emerald-500/40" placeholder="ornek_kategori" />
                    </label>
                    <label className="space-y-1 text-[10px] font-semibold text-slate-400">Görünen kategori adı
                        <input required minLength={2} maxLength={48} value={categoryDraft.label} onChange={(event) => setCategoryDraft({ ...categoryDraft, label: event.target.value })} className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 text-xs text-white outline-none focus:ring-2 focus:ring-emerald-500/40" placeholder="Örn. Temettü Yatırımı" />
                    </label>
                    <label className="space-y-1 text-[10px] font-semibold text-slate-400">Sıra
                        <input required type="number" min={0} max={9999} value={categoryDraft.sort_order} onChange={(event) => setCategoryDraft({ ...categoryDraft, sort_order: Number(event.target.value) })} className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 text-xs text-white outline-none focus:ring-2 focus:ring-emerald-500/40" />
                    </label>
                    <div className="flex items-end gap-2">
                        <button disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-50"><Check size={14} />{editingCategory ? 'Kaydet' : 'Kategori ekle'}</button>
                        {editingCategory && <button type="button" onClick={() => { setCategoryDraft({ slug: '', label: '', sort_order: data.categories.length * 10 + 10, is_active: true }); setEditingCategory(false); }} className="rounded-lg border border-slate-700 px-3 py-2.5 text-xs text-slate-300">İptal</button>}
                    </div>
                    {editingCategory && <label className="flex items-center gap-2 text-xs text-slate-300 md:col-span-4"><input type="checkbox" checked={categoryDraft.is_active} onChange={(event) => setCategoryDraft({ ...categoryDraft, is_active: event.target.checked })} className="accent-emerald-500" />Kategori paylaşım formunda kullanılabilir</label>}
                </form>
                <div className="grid gap-3 md:grid-cols-2">
                    {data.categories.filter((category) => !search || `${category.slug} ${category.label}`.toLocaleLowerCase('tr-TR').includes(search.toLocaleLowerCase('tr-TR'))).map((category) => <article key={category.slug} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900 p-4">
                        <div className="flex min-w-0 items-center gap-3">
                            <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold ${category.is_active ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300' : 'border-slate-700 bg-slate-800 text-slate-500'}`}>{category.is_active ? 'Aktif' : 'Arşivde'}</span>
                            <div className="min-w-0"><p className="truncate text-sm font-bold text-white">{category.label}</p><p className="text-[10px] text-slate-500">{category.slug} · Sıra {category.sort_order}</p></div>
                        </div>
                        <div className="flex gap-2">
                            <button onClick={() => { setCategoryDraft(category); setEditingCategory(true); }} className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-[10px] font-bold text-slate-200">Düzenle</button>
                            <button disabled={busy} onClick={() => void moderate('save_category', { ...category, is_active: !category.is_active })} className={`rounded-lg border px-3 py-2 text-[10px] font-bold ${category.is_active ? 'border-amber-500/20 bg-amber-500/10 text-amber-300' : 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300'}`}>{category.is_active ? 'Arşivle' : 'Yeniden etkinleştir'}</button>
                        </div>
                    </article>)}
                </div>
                <p className="rounded-xl border border-slate-800 bg-slate-900 p-3 text-xs leading-5 text-slate-500"><Tags className="mr-2 inline h-4 w-4 text-emerald-400" />Kategoriler silinmez; arşivlenen kategoriler yeni paylaşımlarda seçilemez, eski içerikleri ve bağlantıları korunur. Kategori kodu URL ve mevcut içeriklerle bağlantılı olduğundan sonradan değiştirilemez.</p>
            </section>}
            {(section === 'reports' && data.reports.length === 0 || section === 'topics' && data.topics.length === 0 || section === 'comments' && filteredComments.length === 0 || section === 'users' && data.users.length === 0 || section === 'categories' && data.categories.length === 0) && !busy && <div className="rounded-2xl border border-slate-800 bg-slate-900 p-8 text-center text-sm text-slate-500"><MessageSquare className="mx-auto mb-2 h-6 w-6" />Aramanızla eşleşen kayıt bulunamadı.</div>}
        </div>
        {reportDialog && <div className="fixed inset-0 z-[120] flex items-end justify-center bg-slate-950/80 p-0 backdrop-blur-sm sm:items-center sm:p-4" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setReportDialog(null); }}>
            <form onSubmit={(event) => void submitReportDialog(event)} className="w-full max-w-lg space-y-4 rounded-t-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl sm:rounded-2xl">
                <div className="flex items-start justify-between gap-4">
                    <div><p className="text-[10px] font-bold tracking-widest text-emerald-400">TRADE ENGINE / MODERASYON</p><h2 className="mt-1 text-lg font-bold text-white">{reportDialog.mode === 'warning' ? 'Kullanıcıya uyarı gönder' : reportDialog.mode === 'ban' ? 'Forum erişimini kısıtla' : reportDialog.mode === 'result' ? 'Şikâyet sonucunu düzenle' : reportDialog.mode === 'resolve' ? 'Şikâyeti sonuçlandır' : 'Şikâyeti reddet'}</h2><p className="mt-1 line-clamp-2 text-xs text-slate-400">{reportDialog.report.target_title ?? 'Bildirilen içerik'}</p></div>
                    <button type="button" disabled={busy} onClick={() => setReportDialog(null)} aria-label="Pencereyi kapat" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"><X size={18} /></button>
                </div>
                {(reportDialog.mode === 'warning' || reportDialog.mode === 'ban') && <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block space-y-1.5 text-xs font-medium text-slate-300">Uyarı / kısıtlama nedeni
                        <select value={dialogReason} onChange={(event) => setDialogReason(event.target.value)} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white">
                            {Object.entries(MODERATION_REASON_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                        </select>
                    </label>
                    {reportDialog.mode === 'ban' && <label className="block space-y-1.5 text-xs font-medium text-slate-300">Erişim kısıtlaması süresi
                        <select value={dialogDuration} onChange={(event) => setDialogDuration(event.target.value)} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white">
                            <option value="1d">1 gün</option><option value="7d">7 gün</option><option value="30d">30 gün</option><option value="permanent">Süresiz</option>
                        </select>
                    </label>}
                </div>}
                {reportDialog.mode === 'result' && ['topic', 'comment'].includes(reportDialog.report.target_type) && <label className="flex items-start gap-2 rounded-xl border border-rose-500/20 bg-rose-500/5 p-3 text-xs text-slate-300"><input type="checkbox" checked={removeReportedContent} onChange={(event) => setRemoveReportedContent(event.target.checked)} className="mt-0.5 accent-rose-500" /><span><strong className="text-rose-300">Bildirilen içeriği kaldır</strong><span className="mt-1 block text-[10px] leading-4 text-slate-400">Sonucu kaydettikten sonra konu/yorum silinir ve moderasyon geçmişine eklenir. Bu işlem geri alınamaz.</span></span></label>}
                {reportDialog.mode === 'result' && <label className="block space-y-1.5 text-xs font-medium text-slate-300">Şikâyetin durumu
                    <select value={dialogStatus} onChange={(event) => setDialogStatus(event.target.value as typeof dialogStatus)} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white">
                        <option value="pending">Beklemeye al</option><option value="reviewing">İnceleniyor</option><option value="resolved">Sonuçlandı</option><option value="dismissed">İşlem yapılmadı</option>
                    </select>
                </label>}
                <label className="block space-y-1.5 text-xs font-medium text-slate-300">
                    {reportDialog.mode === 'warning' ? 'Kullanıcıya gönderilecek açıklama' : reportDialog.mode === 'ban' ? 'Kısıtlama gerekçesi / kullanıcıya iletilecek mesaj' : 'İnceleme sonucu ve kullanıcıya gösterilecek not'}
                    <textarea autoFocus maxLength={reportDialog.mode === 'warning' || reportDialog.mode === 'ban' ? 450 : 1000} rows={4} value={dialogNote} onChange={(event) => setDialogNote(event.target.value)} className="w-full resize-y rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-3 text-sm text-white outline-none focus:ring-2 focus:ring-emerald-500/40" placeholder={reportDialog.mode === 'warning' ? 'Uyarı mesajını yazın…' : reportDialog.mode === 'ban' ? 'İsteğe bağlı ek açıklama…' : 'İnceleme kararını ve gerekçesini yazın…'} />
                    <span className="block text-right text-[10px] text-slate-500">{dialogNote.length}/{reportDialog.mode === 'warning' || reportDialog.mode === 'ban' ? 450 : 1000}</span>
                </label>
                <div className="flex justify-end gap-2">
                    <button type="button" disabled={busy} onClick={() => setReportDialog(null)} className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-2.5 text-xs font-bold text-slate-200">Vazgeç</button>
                    <button disabled={busy || (reportDialog.mode === 'warning' && !dialogNote.trim()) || (reportDialog.mode === 'resolve' && !dialogNote.trim())} className={`rounded-lg px-4 py-2.5 text-xs font-bold text-white disabled:opacity-50 ${reportDialog.mode === 'dismiss' ? 'bg-slate-700 hover:bg-slate-600' : reportDialog.mode === 'warning' ? 'bg-amber-600 hover:bg-amber-500' : reportDialog.mode === 'ban' ? 'bg-rose-600 hover:bg-rose-500' : 'bg-emerald-600 hover:bg-emerald-500'}`}>{busy ? 'Kaydediliyor…' : reportDialog.mode === 'warning' ? 'Uyarıyı gönder' : reportDialog.mode === 'ban' ? 'Kısıtlamayı uygula' : reportDialog.mode === 'result' ? 'Sonucu kaydet' : reportDialog.mode === 'resolve' ? 'Sonuçlandır' : 'Reddet'}</button>
                </div>
            </form>
        </div>}
    </main>;
}
