'use client';

import { useCallback, useEffect, useState } from 'react';
import { HelpCircle, ImagePlus, Lightbulb, MessageSquareText, RefreshCw, Send, ShieldCheck } from 'lucide-react';
import Link from 'next/link';

type SupportRequest = {
    id: string;
    request_type: 'question' | 'suggestion' | 'feedback';
    subject: string;
    details: string;
    status: 'pending' | 'reviewing' | 'answered' | 'closed';
    admin_reply: string | null;
    attachment_url: string | null;
    created_at: string;
    events?: Array<{ id: string; actor_role: string; event_type: string; status: string; created_at: string }>;
};
type Appeal = { id: string; subject: string | null; details: string; status: string; admin_note: string | null; attachment_url: string | null; created_at: string; decided_at: string | null; reason_title?: string; restriction_explanation?: string; restriction_ends_at?: string | null };
type History = { requests: SupportRequest[]; accountAppeals: Appeal[]; forumAppeals: Appeal[]; remainingQuota: number };
type Payload = Partial<History> & { error?: string };
const TYPE_LABELS = { question: 'Soru', suggestion: 'Görüş / öneri', feedback: 'Geri bildirim' } as const;

function statusStyle(status: string) {
    if (status === 'answered' || status === 'approved') return 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300';
    if (status === 'rejected' || status === 'closed') return 'border-rose-500/20 bg-rose-500/10 text-rose-300';
    if (status === 'reviewing' || status === 'pending') return 'border-amber-500/20 bg-amber-500/10 text-amber-300';
    return 'border-slate-700 bg-slate-800 text-slate-400';
}

function statusLabel(status: string) {
    return ({ pending: 'Bekliyor', reviewing: 'İnceleniyor', answered: 'Yanıtlandı', closed: 'Kapandı', approved: 'Kabul edildi', rejected: 'Reddedildi', superseded: 'Yeni başvuru ile güncellendi' } as Record<string, string>)[status] ?? status;
}

export default function SupportPage() {
    const [history, setHistory] = useState<History>({ requests: [], accountAppeals: [], forumAppeals: [], remainingQuota: 3 });
    const [requestType, setRequestType] = useState<SupportRequest['request_type']>('question');
    const [subject, setSubject] = useState('');
    const [details, setDetails] = useState('');
    const [file, setFile] = useState<File | null>(null);
    const [busy, setBusy] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');

    const load = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const response = await fetch('/api/support/requests', { cache: 'no-store' });
            const payload = await response.json() as Payload;
            if (!response.ok) throw new Error(payload.error ?? 'Yardım geçmişi yüklenemedi.');
            setHistory({
                requests: payload.requests ?? [],
                accountAppeals: payload.accountAppeals ?? [],
                forumAppeals: payload.forumAppeals ?? [],
                remainingQuota: payload.remainingQuota ?? 3,
            });
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'Yardım geçmişi yüklenemedi.');
        } finally {
            setLoading(false);
        }
    }, []);
    useEffect(() => {
        const timer = window.setTimeout(() => { void load(); }, 0);
        return () => window.clearTimeout(timer);
    }, [load]);

    const submit = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setBusy(true);
        setError('');
        setNotice('');
        try {
            const form = new FormData();
            form.set('requestType', requestType);
            form.set('subject', subject);
            form.set('details', details);
            if (file) form.set('file', file);
            const response = await fetch('/api/support/requests', {
                method: 'POST',
                body: form,
            });
            const payload = await response.json() as { request?: SupportRequest; error?: string; remainingQuota?: number };
            if (!response.ok || !payload.request) throw new Error(payload.error ?? 'Talep gönderilemedi.');
            setHistory((current) => ({ ...current, requests: [payload.request!, ...current.requests], remainingQuota: payload.remainingQuota ?? Math.max(0, current.remainingQuota - 1) }));
            setSubject('');
            setDetails('');
            setFile(null);
            setNotice('Talebiniz alındı. Yanıt ve durum güncellemelerini bu sayfadan takip edebilirsiniz.');
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'Talep gönderilemedi.');
        } finally {
            setBusy(false);
        }
    };

    const appealItems = [
        ...history.accountAppeals.map((item) => ({ ...item, kind: 'Hesap itirazı' })),
        ...history.forumAppeals.map((item) => ({ ...item, kind: 'Topluluk itirazı' })),
    ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    return <main className="min-h-screen bg-slate-950 px-4 py-8 text-slate-100 md:px-8">
        <div className="mx-auto max-w-6xl space-y-7">
            <header className="border-b border-slate-800 pb-6">
                <span className="text-xs font-bold tracking-widest text-emerald-400">TRADE ENGINE / DESTEK</span>
                <h1 className="mt-2 flex items-center gap-3 text-3xl font-extrabold text-white"><HelpCircle className="h-8 w-8 text-emerald-400" />Yardım ve talepler</h1>
                <p className="mt-2 max-w-2xl text-sm text-slate-400">Sorularınızı, görüşlerinizi ve önerilerinizi iletin; hesap ve topluluk itirazlarınızın durumunu da buradan takip edin.</p>
            </header>
            {error && <div role="alert" className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-4 text-sm text-rose-300">{error}{error.includes('giriş yapın') && <Link href="/auth?next=%2Fsupport" className="ml-2 font-bold underline">Giriş yap</Link>}</div>}
            {notice && <p role="status" className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm text-emerald-300">{notice}</p>}

            <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
                <form onSubmit={(event) => void submit(event)} className="min-w-0 space-y-4 rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-xl md:p-6">
                    <div><span className="text-xs font-bold tracking-widest text-emerald-400">YENİ TALEP</span><h2 className="mt-1 flex items-center gap-2 text-lg font-bold text-white"><MessageSquareText size={18} />Bize yazın</h2><p className="mt-1 text-xs text-slate-400">Bugün kalan genel gönderim hakkı (değerlendirme bonusları dahil): <strong className="text-emerald-300">{history.remainingQuota}</strong></p></div>
                    <label className="block space-y-1.5 text-xs font-semibold text-slate-300">Talep türü
                        <select value={requestType} onChange={(event) => setRequestType(event.target.value as SupportRequest['request_type'])} className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50">
                            {Object.entries(TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                        </select>
                    </label>
                    <label className="block space-y-1.5 text-xs font-semibold text-slate-300">Konu
                        <input required minLength={3} maxLength={120} value={subject} onChange={(event) => setSubject(event.target.value)} className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50" placeholder="Kısaca konu başlığı" /><span className="block text-right text-[10px] text-slate-500">{subject.length}/120</span>
                    </label>
                    <label className="block space-y-1.5 text-xs font-semibold text-slate-300">Açıklama
                        <textarea required minLength={20} maxLength={2000} rows={5} value={details} onChange={(event) => setDetails(event.target.value)} className="w-full resize-y rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50" placeholder="Talebinizi veya önerinizi açıklayın (20-2000 karakter)." /><span className="block text-right text-[10px] text-slate-500">{details.length}/2000</span>
                    </label>
                    <label className="flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-300"><ImagePlus size={15} className="text-slate-400" />İsteğe bağlı görsel (JPEG, PNG, WebP veya GIF · en fazla 5 MB)
                        <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={(event) => setFile(event.target.files?.[0] ?? null)} className="block w-full text-xs text-slate-400 file:mr-3 file:rounded-lg file:border file:border-slate-700 file:bg-slate-800 file:px-3 file:py-2 file:text-xs file:font-bold file:text-slate-200" />
                    </label>
                    {file && <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-300"><span className="min-w-0 truncate">{file.name}</span><button type="button" onClick={() => setFile(null)} className="shrink-0 text-rose-300">Kaldır</button></div>}
                    <div className="flex justify-end"><button disabled={busy || history.remainingQuota <= 0} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2.5 text-xs font-bold text-white shadow-lg shadow-emerald-900/20 transition hover:bg-emerald-500 disabled:opacity-50"><Send size={14} />{busy ? 'Gönderiliyor…' : 'Talep gönder'}</button></div>
                </form>

                <section className="min-w-0 space-y-4 rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-xl md:p-6">
                    <div className="flex items-center justify-between gap-3"><div><span className="text-xs font-bold tracking-widest text-emerald-400">TAKİP</span><h2 className="mt-1 flex items-center gap-2 text-lg font-bold text-white"><ShieldCheck size={18} />Son hareketler</h2></div><button type="button" onClick={() => void load()} disabled={loading} aria-label="Geçmişi yenile" className="rounded-lg border border-slate-700 bg-slate-800 p-2 text-slate-300 hover:bg-slate-700 disabled:opacity-50"><RefreshCw size={15} className={loading ? 'animate-spin' : ''} /></button></div>
                    <div className="space-y-3">
                        {history.requests.map((item) => <article key={item.id} className="min-w-0 rounded-xl border border-slate-800 bg-slate-950/70 p-4">
                            <div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-300"><Lightbulb size={12} />{TYPE_LABELS[item.request_type]}</span><h3 className="mt-2 break-words text-sm font-bold text-white">{item.subject}</h3><p className="mt-1 line-clamp-2 whitespace-pre-wrap break-words text-xs leading-5 text-slate-400">{item.details}</p></div><span className={`shrink-0 rounded-full border px-3 py-1 text-xs font-semibold ${statusStyle(item.status)}`}>{statusLabel(item.status)}</span></div>
                            <p className="mt-2 text-[10px] text-slate-500">{new Date(item.created_at).toLocaleString('tr-TR')}</p>
                            <details className="mt-2"><summary className="cursor-pointer text-xs font-semibold text-emerald-300">Ayrıntılar ve hareket geçmişi</summary><div className="mt-2 space-y-3 rounded-lg border border-slate-800 bg-slate-900/70 p-3"><p className="whitespace-pre-wrap break-words text-xs leading-5 text-slate-300">{item.details}</p>{item.attachment_url && <a href={item.attachment_url} target="_blank" rel="noreferrer" className="text-xs font-semibold text-sky-300 underline">Ekli görseli görüntüle</a>}{item.admin_reply && <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3"><p className="text-[10px] font-bold uppercase tracking-wider text-emerald-300">Yönetici yanıtı</p><p className="mt-1 whitespace-pre-wrap break-words text-xs leading-5 text-slate-300">{item.admin_reply}</p></div>}{item.events?.length ? <ul className="space-y-2 border-t border-slate-800 pt-3">{item.events.map((event) => <li key={event.id} className="flex flex-wrap justify-between gap-2 text-[10px] text-slate-400"><span>{event.event_type === 'created' ? 'Talep gönderildi' : event.event_type === 'reply_updated' ? 'Yönetici yanıtı güncellendi' : `Talep durumu: ${statusLabel(event.status)}`} · {event.actor_role === 'admin' ? 'Yönetici' : 'Kullanıcı'}</span><time>{new Date(event.created_at).toLocaleString('tr-TR')}</time></li>)}</ul> : null}</div></details>
                        </article>)}
                        {appealItems.map((item) => <article key={`${item.kind}-${item.id}`} className="min-w-0 rounded-xl border border-amber-500/20 bg-slate-950/70 p-4">
                            <div className="flex flex-wrap items-center justify-between gap-2"><span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-300">{item.kind}</span><span className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusStyle(item.status)}`}>{statusLabel(item.status)}</span></div>
                            <p className="mt-2 line-clamp-2 whitespace-pre-wrap break-words text-xs leading-5 text-slate-400">{item.subject || item.details}</p><p className="mt-2 text-[10px] text-slate-500">{new Date(item.created_at).toLocaleString('tr-TR')}</p>
                            <details className="mt-2"><summary className="cursor-pointer text-xs font-semibold text-emerald-300">İtiraz ayrıntıları</summary><div className="mt-2 space-y-2 rounded-lg border border-slate-800 bg-slate-900/70 p-3">{item.reason_title && <p className="text-xs font-semibold text-amber-200">{item.reason_title}</p>}{item.restriction_explanation && <p className="whitespace-pre-wrap break-words text-xs text-slate-400">{item.restriction_explanation}</p>}<p className="whitespace-pre-wrap break-words text-xs leading-5 text-slate-300">{item.details}</p>{item.attachment_url && <a href={item.attachment_url} target="_blank" rel="noreferrer" className="text-xs font-semibold text-sky-300 underline">Ekli görseli görüntüle</a>}{item.admin_note && <p className="rounded-lg border border-slate-800 bg-slate-950 p-3 text-xs text-slate-300">Yönetici kararı: {item.admin_note}</p>}</div></details>
                        </article>)}
                        {!loading && !history.requests.length && !appealItems.length && <p className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 text-xs leading-5 text-slate-400">Henüz bir destek talebiniz veya itirazınız yok.</p>}
                        {loading && <p className="text-xs text-slate-500">Yardım geçmişi yükleniyor…</p>}
                    </div>
                </section>
            </div>
        </div>
    </main>;
}
