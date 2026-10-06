'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { ArrowUpRight, BookOpenCheck, CalendarDays, Check, CheckCircle2, CircleHelp, ClipboardCheck, Clock3, NotebookPen, Pencil, Plus, Save, Search, Sparkles, Trash2, X } from 'lucide-react';
import { useAppPreferences } from '@/components/AppProviders';

type ReviewStatus = 'pending' | 'matched' | 'partially_matched' | 'not_matched';
type JournalEntry = {
    id: string;
    symbol: string;
    reason: string;
    scenario: string;
    reviewStatus: ReviewStatus;
    reviewNote: string;
    reviewedAt: string | null;
    createdAt: string;
    updatedAt: string;
};
type JournalPayload = { data?: JournalEntry[] | JournalEntry; error?: string };
type EntryForm = { symbol: string; reason: string; scenario: string };
type ReviewForm = { status: ReviewStatus; note: string };
type EntryFilter = 'all' | 'pending' | 'reviewed';

const STATUS_LABELS: Record<ReviewStatus, string> = {
    pending: 'Değerlendirme bekliyor',
    matched: 'Senaryoyla uyumlu',
    partially_matched: 'Kısmen uyumlu',
    not_matched: 'Senaryodan farklı',
};
const REVIEW_STATUSES: ReviewStatus[] = ['matched', 'partially_matched', 'not_matched'];
const EMPTY_FORM: EntryForm = { symbol: '', reason: '', scenario: '' };

function dateLabel(value: string | null) {
    if (!value) return '—';
    return new Date(value).toLocaleString('tr-TR', { dateStyle: 'medium', timeStyle: 'short' });
}

async function requestJournal(url: string, method = 'GET', body?: Record<string, string>) {
    const response = await fetch(url, {
        method,
        cache: 'no-store',
        ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
    });
    const payload = await response.json() as JournalPayload;
    if (!response.ok) throw new Error(payload.error ?? 'Araştırma günlüğü işlemi tamamlanamadı.');
    return payload;
}

export default function ResearchJournal() {
    const { confirmDialog } = useAppPreferences();
    const [entries, setEntries] = useState<JournalEntry[]>([]);
    const [form, setForm] = useState<EntryForm>(EMPTY_FORM);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [reviewingId, setReviewingId] = useState<string | null>(null);
    const [reviewForm, setReviewForm] = useState<ReviewForm>({ status: 'matched', note: '' });
    const [filter, setFilter] = useState('');
    const [entryFilter, setEntryFilter] = useState<EntryFilter>('all');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [authRequired, setAuthRequired] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const payload = await requestJournal('/api/journal');
            if (!Array.isArray(payload.data)) throw new Error('Günlük kayıtları beklenen biçimde alınamadı.');
            setEntries(payload.data);
            setAuthRequired(false);
        } catch (cause) {
            if (cause instanceof Error && cause.message.includes('giriş yapmalısınız')) setAuthRequired(true);
            setError(cause instanceof Error ? cause.message : 'Araştırma günlüğü yüklenemedi.');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        const timer = window.setTimeout(() => {
            const symbol = new URLSearchParams(window.location.search).get('symbol')?.trim().toUpperCase();
            if (symbol && /^[A-Z0-9]{3,6}$/.test(symbol)) setForm((current) => ({ ...current, symbol }));
        }, 0);
        return () => window.clearTimeout(timer);
    }, []);

    useEffect(() => { queueMicrotask(() => void load()); }, [load]);

    const filteredEntries = useMemo(() => {
        const query = filter.trim().toLocaleLowerCase('tr-TR');
        return entries.filter((entry) => {
            const matchesQuery = !query || `${entry.symbol} ${entry.reason} ${entry.scenario} ${entry.reviewNote}`.toLocaleLowerCase('tr-TR').includes(query);
            const matchesStatus = entryFilter === 'all' || (entryFilter === 'pending' ? entry.reviewStatus === 'pending' : entry.reviewStatus !== 'pending');
            return matchesQuery && matchesStatus;
        });
    }, [entries, entryFilter, filter]);
    const pendingCount = entries.filter((entry) => entry.reviewStatus === 'pending').length;
    const reviewedCount = entries.length - pendingCount;

    const submitEntry = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setSaving(true);
        setError('');
        const body = { symbol: form.symbol.trim().toUpperCase(), reason: form.reason.trim(), scenario: form.scenario.trim() };
        try {
            const payload = await requestJournal('/api/journal', editingId ? 'PATCH' : 'POST', editingId ? { id: editingId, ...body } : body);
            if (!payload.data || Array.isArray(payload.data)) throw new Error('Kayıt yanıtı beklenen biçimde alınamadı.');
            const saved = payload.data;
            setEntries((current) => editingId ? current.map((entry) => entry.id === saved.id ? saved : entry) : [saved, ...current]);
            setForm(EMPTY_FORM);
            setEditingId(null);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'Kayıt kaydedilemedi.');
        } finally {
            setSaving(false);
        }
    };

    const startEdit = (entry: JournalEntry) => {
        setEditingId(entry.id);
        setReviewingId(null);
        setForm({ symbol: entry.symbol, reason: entry.reason, scenario: entry.scenario });
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const saveReview = async (event: FormEvent<HTMLFormElement>, entry: JournalEntry) => {
        event.preventDefault();
        setSaving(true);
        setError('');
        try {
            const payload = await requestJournal('/api/journal', 'PATCH', {
                id: entry.id, reviewStatus: reviewForm.status, reviewNote: reviewForm.note.trim(),
            });
            if (!payload.data || Array.isArray(payload.data)) throw new Error('Değerlendirme yanıtı beklenen biçimde alınamadı.');
            const saved = payload.data;
            setEntries((current) => current.map((item) => item.id === entry.id ? saved : item));
            setReviewingId(null);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'Değerlendirme kaydedilemedi.');
        } finally {
            setSaving(false);
        }
    };

    const deleteEntry = async (entry: JournalEntry) => {
        const confirmed = await confirmDialog({
            title: `${entry.symbol} günlüğü silinsin mi?`,
            message: 'Bu araştırma notu ve değerlendirmesi kalıcı olarak silinecek.',
            confirmLabel: 'Kaydı sil',
            danger: true,
        });
        if (!confirmed) return;
        setSaving(true);
        setError('');
        try {
            await requestJournal('/api/journal', 'DELETE', { id: entry.id });
            setEntries((current) => current.filter((item) => item.id !== entry.id));
            if (editingId === entry.id) { setEditingId(null); setForm(EMPTY_FORM); }
            if (reviewingId === entry.id) setReviewingId(null);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'Kayıt silinemedi.');
        } finally {
            setSaving(false);
        }
    };

    return <main className="app-shell ds-shell">
        <div className="app-container ds-container">
            <header className="journal-hero">
                <div className="journal-hero-copy">
                    <span className="ds-eyebrow"><BookOpenCheck size={13} /> TRADE ENGINE / RESEARCH JOURNAL</span>
                    <h1>Araştırma günlüğü</h1>
                    <p>Yatırım tezini kaydet, gelişmeleri izle ve zamanla ne kadar isabetli olduğunu değerlendir.</p>
                </div>
                <div className="journal-hero-stats">
                    <div><span><NotebookPen size={14} /> Toplam kayıt</span><strong>{entries.length}</strong></div>
                    <div><span><Clock3 size={14} /> Değerlenecek</span><strong>{pendingCount}</strong></div>
                    <div><span><CheckCircle2 size={14} /> Değerlendirildi</span><strong>{reviewedCount}</strong></div>
                </div>
            </header>
            {error && !authRequired && <div className="portfolio-alert" role="alert"><span>{error}</span></div>}
            {authRequired && <section className="ds-panel mt-4 p-5">
                <h2 className="text-lg font-bold text-white">Günlüğün hesabına özel</h2>
                <p className="mt-2 text-sm text-slate-400">Kayıtlarını oluşturmak ve daha sonra değerlendirmek için giriş yap.</p>
                <Link className="ds-primary-button mt-4 inline-flex" href="/auth?next=%2Fjournal">Giriş yap</Link>
            </section>}
            {!authRequired && <>
                <section className="journal-compose-layout">
                    <form onSubmit={(event) => void submitEntry(event)} className="ds-panel journal-form">
                        <div className="journal-form-heading">
                            <span className="journal-form-icon"><NotebookPen size={18} /></span>
                            <div><span className="ds-eyebrow">{editingId ? 'KAYDI DÜZENLE' : 'YENİ KAYIT'}</span><h2>{editingId ? 'Araştırma notunu güncelle' : 'Yeni bir yatırım tezi yaz'}</h2></div>
                            <span className="journal-auto-date"><CalendarDays size={14} /> Tarih otomatik eklenir</span>
                        </div>
                        <label className="journal-field journal-symbol-field">Hisse kodu
                            <input required minLength={3} maxLength={6} pattern="[A-Za-z0-9]{3,6}" value={form.symbol} onChange={(event) => setForm((current) => ({ ...current, symbol: event.target.value.toUpperCase() }))} placeholder="Örn. THYAO" />
                        </label>
                        <label className="journal-field">Neden takip ediyorum?
                            <textarea required maxLength={2000} rows={3} value={form.reason} onChange={(event) => setForm((current) => ({ ...current, reason: event.target.value }))} placeholder="Şirketi veya hisseyi izleme nedenini yaz..." />
                        </label>
                        <label className="journal-field">Beklentim / senaryom
                            <textarea required maxLength={2000} rows={3} value={form.scenario} onChange={(event) => setForm((current) => ({ ...current, scenario: event.target.value }))} placeholder="Hangi gelişmeyi bekliyorsun? Senaryonun hangi koşullarda geçerli olduğunu belirt..." />
                        </label>
                        <div className="journal-form-footer">
                            <span>Net ve ölçülebilir bir senaryo, sonradan değerlendirmeyi kolaylaştırır.</span>
                            <div className="flex flex-wrap gap-2">
                                <button type="submit" disabled={saving} className="ds-primary-button inline-flex items-center gap-2 disabled:opacity-60">{editingId ? <Save size={15} /> : <Plus size={15} />}{saving ? 'Kaydediliyor…' : editingId ? 'Değişiklikleri kaydet' : 'Günlüğe ekle'}</button>
                                {editingId && <button type="button" onClick={() => { setEditingId(null); setForm(EMPTY_FORM); }} className="ds-secondary-button inline-flex items-center gap-2"><X size={15} />Vazgeç</button>}
                            </div>
                        </div>
                    </form>
                    <aside className="journal-guide">
                        <span className="journal-guide-icon"><Sparkles size={17} /></span>
                        <span className="ds-eyebrow">DAHA İYİ BİR GÜNLÜK İÇİN</span>
                        <h2>Önce tezi yaz.<br />Sonra veriye dön.</h2>
                        <p>Sonucu bilmeden önce gerekçeni ve beklentini kaydet. Böylece kararlarını sonradan daha tarafsız değerlendirebilirsin.</p>
                        <div className="journal-guide-step"><span>01</span><div><strong>Gerekçeni belirt</strong><small>Takip etme nedenini yaz.</small></div></div>
                        <div className="journal-guide-step"><span>02</span><div><strong>Senaryonu tanımla</strong><small>Beklentini açıkça kaydet.</small></div></div>
                        <div className="journal-guide-step"><span>03</span><div><strong>Gerçekleşeni değerlendir</strong><small>Sonuçla tezi karşılaştır.</small></div></div>
                    </aside>
                </section>
                <section className="mt-7">
                    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
                        <div><span className="ds-eyebrow">KAYITLARIN</span><h2 className="mt-1 text-xl font-bold text-white">Yatırım tezlerin</h2><p className="mt-1 text-xs text-slate-400">Sonuçları takip et, düşüncelerini zaman içinde gözden geçir.</p></div>
                        <label className="journal-search"><Search size={15} /><input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Hisse veya metin ara" /><span>{filteredEntries.length}</span></label>
                    </div>
                    <div className="journal-filter-tabs" role="group" aria-label="Günlük kayıtlarını filtrele">
                        {([
                            ['all', 'Tümü', entries.length],
                            ['pending', 'Bekleyen', pendingCount],
                            ['reviewed', 'Değerlendirilen', reviewedCount],
                        ] as const).map(([value, label, count]) => <button key={value} type="button" aria-pressed={entryFilter === value} onClick={() => setEntryFilter(value)}>{label}<span>{count}</span></button>)}
                    </div>
                    {loading ? <div className="ds-panel p-6 text-sm text-slate-400">Günlük yükleniyor…</div>
                        : !filteredEntries.length ? <div className="ds-panel p-6 text-sm text-slate-400">{entries.length ? 'Aramana uygun kayıt bulunamadı.' : 'Henüz kayıt yok. İlk takip gerekçeni ve senaryonu yukarıdan ekleyebilirsin.'}</div>
                            : <div className="journal-entry-list">{filteredEntries.map((entry) => <article key={entry.id} className={`ds-panel journal-entry-card${entry.reviewStatus === 'pending' ? ' is-pending' : ' is-reviewed'}`}>
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <div className="flex flex-wrap items-center gap-2"><Link href={`/market?symbol=${encodeURIComponent(entry.symbol)}`} className="journal-entry-symbol">{entry.symbol}<ArrowUpRight size={14} /></Link><span className={`journal-status-badge ${entry.reviewStatus}`}>{entry.reviewStatus === 'pending' ? <Clock3 size={12} /> : <CheckCircle2 size={12} />}{STATUS_LABELS[entry.reviewStatus]}</span></div>
                                        <div className="journal-entry-dates"><span><CalendarDays size={12} /> Oluşturuldu: {dateLabel(entry.createdAt)}</span><span><Pencil size={11} /> Güncellendi: {dateLabel(entry.updatedAt)}</span>{entry.reviewedAt && <span><Check size={12} /> Değerlendirildi: {dateLabel(entry.reviewedAt)}</span>}</div>
                                    </div>
                                    <div className="flex shrink-0 gap-1">
                                        <button type="button" aria-label={`${entry.symbol} kaydını düzenle`} onClick={() => startEdit(entry)} className="grid h-9 w-9 place-items-center rounded-lg text-slate-400 hover:bg-slate-800 hover:text-white"><Pencil size={15} /></button>
                                        <button type="button" aria-label={`${entry.symbol} kaydını sil`} onClick={() => void deleteEntry(entry)} className="grid h-9 w-9 place-items-center rounded-lg text-slate-400 hover:bg-rose-500/10 hover:text-rose-300"><Trash2 size={15} /></button>
                                    </div>
                                </div>
                                <div className="journal-entry-body">
                                    <div className="journal-entry-copy reason"><h3><span>01</span> Takip gerekçem</h3><p>{entry.reason}</p></div>
                                    <div className="journal-entry-copy scenario"><h3><span>02</span> Beklentim / senaryom</h3><p>{entry.scenario}</p></div>
                                </div>
                                {entry.reviewStatus !== 'pending' && <div className="journal-review-result"><h3><CheckCircle2 size={13} /> Gerçekleşen ve değerlendirmem</h3><p>{entry.reviewNote}</p></div>}
                                {reviewingId === entry.id ? <form onSubmit={(event) => void saveReview(event, entry)} className="mt-4 grid gap-3 rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                                    <label className="grid gap-1.5 text-xs font-semibold text-slate-300">Senaryonun sonucu
                                        <select value={reviewForm.status} onChange={(event) => setReviewForm((current) => ({ ...current, status: event.target.value as ReviewStatus }))} className="min-h-10 rounded-lg border border-slate-700 bg-slate-900 px-3 text-sm text-white">
                                            {REVIEW_STATUSES.map((status) => <option key={status} value={status}>{STATUS_LABELS[status]}</option>)}
                                        </select>
                                    </label>
                                    <label className="grid gap-1.5 text-xs font-semibold text-slate-300">Gerçekte ne oldu?
                                        <textarea required maxLength={2000} rows={3} value={reviewForm.note} onChange={(event) => setReviewForm((current) => ({ ...current, note: event.target.value }))} placeholder="Gelişmeleri ve beklentinle farklarını kaydet..." className="resize-y rounded-xl border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-white outline-none focus:border-emerald-500" />
                                    </label>
                                    <div className="flex flex-wrap gap-2"><button type="submit" disabled={saving} className="ds-primary-button inline-flex items-center gap-2 disabled:opacity-60"><Check size={15} />Değerlendirmeyi kaydet</button><button type="button" onClick={() => setReviewingId(null)} className="ds-secondary-button inline-flex items-center gap-2"><X size={15} />Vazgeç</button></div>
                                </form> : <button type="button" onClick={() => { setReviewingId(entry.id); if (editingId) { setEditingId(null); setForm(EMPTY_FORM); } setReviewForm({ status: entry.reviewStatus === 'pending' ? 'matched' : entry.reviewStatus, note: entry.reviewNote }); }} className="mt-4 inline-flex min-h-9 items-center gap-2 rounded-lg border border-slate-700 px-3 text-xs font-semibold text-slate-300 hover:border-emerald-500/40 hover:text-emerald-300">{entry.reviewStatus === 'pending' ? <ClipboardCheck size={14} /> : <Pencil size={14} />}{entry.reviewStatus === 'pending' ? 'Gerçekleşeni değerlendir' : 'Değerlendirmeyi güncelle'}</button>}
                            </article>)}</div>}
                </section>
                <p className="journal-disclaimer"><CircleHelp size={14} />Bu günlük kişisel araştırma notlarını saklar; piyasa tahmini veya yatırım tavsiyesi üretmez. Sonuç değerlendirmesi kullanıcı tarafından kaydedilir.</p>
            </>}
        </div>
    </main>;
}
