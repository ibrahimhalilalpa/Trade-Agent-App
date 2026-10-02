'use client';

import { useId, useState, type FormEvent } from 'react';
import { Flag } from 'lucide-react';
import { useRouter } from 'next/navigation';

export default function ForumReportControl({
    targetType,
    targetId,
    compact = false,
}: {
    targetType: 'topic' | 'comment';
    targetId: string;
    compact?: boolean;
}) {
    const router = useRouter();
    const dialogTitleId = useId();
    const [open, setOpen] = useState(false);
    const [reason, setReason] = useState('spam');
    const [details, setDetails] = useState('');
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    const [activeReport, setActiveReport] = useState<{ id: string; status: string } | null>(null);
    const [checked, setChecked] = useState(false);

    const inspectReport = async () => {
        if (checked) return;
        const query = new URLSearchParams({ target_type: targetType, target_id: targetId });
        const response = await fetch(`/api/forum/reports?${query}`);
        const payload = await response.json() as { data?: { report: { id: string; status: string } | null }; error?: string };
        if (response.status === 401) {
            router.push(`/auth?next=${encodeURIComponent(window.location.pathname)}`);
            return;
        }
        if (!response.ok) throw new Error(payload.error ?? 'Şikâyet durumu yüklenemedi.');
        setActiveReport(payload.data?.report ?? null);
        setChecked(true);
    };

    const openControl = async () => {
        try {
            await inspectReport();
            setOpen(true);
            setMessage('');
        } catch (cause) {
            setMessage(cause instanceof Error ? cause.message : 'Şikâyet durumu yüklenemedi.');
        }
    };

    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setBusy(true);
        setMessage('');
        try {
            const response = await fetch('/api/forum/reports', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ target_type: targetType, target_id: targetId, reason, details }),
            });
            const payload = await response.json() as { error?: string };
            if (response.status === 401) {
                router.push(`/auth?next=${encodeURIComponent(window.location.pathname)}`);
                return;
            }
            if (!response.ok) throw new Error(payload.error ?? 'Şikâyet gönderilemedi.');
            const report = (payload as { data?: { id?: string; status?: string } }).data;
            setActiveReport(report?.id && report.status ? { id: report.id, status: report.status } : { id: '', status: 'pending' });
            setChecked(true);
            setOpen(false);
            setDetails('');
            setMessage('');
        } catch (cause) {
            setMessage(cause instanceof Error ? cause.message : 'Şikâyet gönderilemedi.');
        } finally {
            setBusy(false);
        }
    };

    const withdraw = async () => {
        if (!activeReport?.id) return;
        setBusy(true);
        setMessage('');
        try {
            const response = await fetch('/api/forum/reports', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ report_id: activeReport.id }),
            });
            const payload = await response.json() as { error?: string };
            if (!response.ok) throw new Error(payload.error ?? 'Şikâyet geri çekilemedi.');
            setActiveReport(null);
            setMessage('');
        } catch (cause) {
            setMessage(cause instanceof Error ? cause.message : 'Şikâyet geri çekilemedi.');
        } finally {
            setBusy(false);
        }
    };

    return <span className="inline-flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => void openControl()} aria-label={activeReport ? 'Şikâyet durumunu yönet' : 'İçeriği bildir'} title={activeReport ? 'Şikâyeti yönet' : 'İçeriği bildir'} className={`inline-flex items-center justify-center text-slate-500 transition hover:text-amber-300 ${compact ? 'h-7 w-7' : 'gap-1 text-[10px] font-semibold'} ${compact ? '' : ''}`}><Flag size={12} />{!compact && (activeReport ? 'Şikâyeti yönet' : 'İçeriği şikâyet et')}</button>
        {message && <span role="status" className="text-[10px] text-slate-400">{message}</span>}
        {open && activeReport && <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
            <section role="dialog" aria-modal="true" className="w-full max-w-md space-y-4 rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl">
                <div><h2 className="text-lg font-bold text-white">Şikâyet kaydı</h2><p className="mt-1 text-xs leading-5 text-slate-400">Şikâyet durumunu İçeriklerim → Bildirdiklerim bölümünden takip edebilir, açık durumdayken düzenleyebilir veya geri çekebilirsin.</p></div>
                <div className="flex justify-end gap-2"><button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-slate-700 px-4 py-2 text-xs font-semibold text-slate-300">Kapat</button><button type="button" disabled={busy} onClick={() => void withdraw()} className="rounded-lg bg-rose-500/10 px-4 py-2 text-xs font-bold text-rose-300 disabled:opacity-50">{busy ? 'İşleniyor…' : 'Şikâyeti geri çek'}</button></div>
            </section>
        </div>}
        {open && !activeReport && <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
            <form onSubmit={(event) => void submit(event)} role="dialog" aria-modal="true" aria-labelledby={dialogTitleId} className="w-full max-w-lg space-y-4 rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl">
                <div><h2 id={dialogTitleId} className="text-lg font-bold text-white">İçeriği şikâyet et</h2><p className="mt-1 text-xs leading-5 text-slate-400">Şikâyetiniz yönetici incelemesine iletilir.</p></div>
                <label className="block space-y-1.5 text-xs font-semibold text-slate-300">Neden
                    <select value={reason} onChange={(event) => setReason(event.target.value)} className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 text-sm text-white">
                        <option value="spam">Spam veya reklam</option><option value="harassment">Taciz veya hakaret</option><option value="misleading">Yanıltıcı içerik</option><option value="personal_info">Kişisel bilgi paylaşımı</option><option value="other">Diğer</option>
                    </select>
                </label>
                <label className="block space-y-1.5 text-xs font-semibold text-slate-300">Açıklama (isteğe bağlı)
                    <textarea maxLength={1000} rows={3} value={details} onChange={(event) => setDetails(event.target.value)} className="w-full resize-y rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 text-sm text-white outline-none focus:ring-2 focus:ring-emerald-500/50" />
                </label>
                <div className="flex justify-end gap-2"><button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-slate-700 px-4 py-2 text-xs font-semibold text-slate-300">Vazgeç</button><button disabled={busy} className="rounded-lg bg-amber-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-50">{busy ? 'Gönderiliyor…' : 'Şikâyeti gönder'}</button></div>
            </form>
        </div>}
    </span>;
}
