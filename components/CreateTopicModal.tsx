'use client';

import { FormEvent, KeyboardEvent, useEffect, useState } from 'react';
import { ImagePlus, LoaderCircle, LockKeyhole, X } from 'lucide-react';
import { cleanText, hasProfanity } from '@/lib/profanityFilter';
import MentionTextarea from '@/components/MentionTextarea';

export const FORUM_CATEGORIES = [
    ['serbest_konu', 'Serbest Konu'],
    ['hisse_analiz', 'Hisse Analiz'],
    ['bist30', 'BİST 30'],
    ['bist100', 'BİST 100'],
    ['bist500', 'BİST 500'],
    ['soru_cevap', 'Soru-Cevap'],
    ['strateji_egitim', 'Strateji & Eğitim'],
    ['makro_ekonomi', 'Makro Ekonomi'],
] as const;
export type ForumCategoryOption = { slug: string; label: string; sort_order: number };

type TopicInput = {
    title: string;
    content: string;
    category: string;
    related_symbol: string | null;
    cover_image_url: string | null;
    images: string[];
    tags: string[];
    visibility: 'public' | 'followers';
};

const inputClass = 'w-full rounded-xl border border-slate-700 bg-slate-800/80 px-3.5 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50';
const LEGAL_DISCLAIMER = 'Yasal Uyarı: Burada yer alan yatırım bilgi, yorum ve tavsiyeleri yatırım danışmanlığı kapsamında değildir. Yer alan görüşler kişisel analizlere dayanmaktadır.';

export default function CreateTopicModal({
    categories = FORUM_CATEGORIES.map(([slug, label], index) => ({ slug, label, sort_order: (index + 1) * 10 })),
    initialSymbol = '',
    onClose,
    onCreated,
}: {
    categories?: ForumCategoryOption[];
    initialSymbol?: string;
    onClose: () => void;
    onCreated: (topicId: string) => void;
}) {
    const [title, setTitle] = useState('');
    const [content, setContent] = useState('');
    const [category, setCategory] = useState(initialSymbol ? 'hisse_analiz' : 'serbest_konu');
    const [symbol, setSymbol] = useState(initialSymbol);
    const [coverImage, setCoverImage] = useState<File | null>(null);
    const [images, setImages] = useState<File[]>([]);
    const [tags, setTags] = useState<string[]>([]);
    const [tagInput, setTagInput] = useState('');
    const [visibility, setVisibility] = useState<'public' | 'followers'>('public');
    const [symbolSuggestions, setSymbolSuggestions] = useState<Array<{ symbol: string; name: string }>>([]);
    const [symbolSearchError, setSymbolSearchError] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [banStatus, setBanStatus] = useState<{ banned: boolean; ban_until: string | null; appeal: { id: string; subject: string; details: string; status: string; admin_note: string | null; attachment_url: string | null } | null } | null>(null);
    const [appealDetails, setAppealDetails] = useState('');
    const [appealSubject, setAppealSubject] = useState('Topluluk kısıtlamasına itiraz');
    const [appealFile, setAppealFile] = useState<File | null>(null);
    const [appealBusy, setAppealBusy] = useState(false);
    const selectedCategory = categories.some((item) => item.slug === category)
        ? category
        : (initialSymbol ? categories.find((item) => item.slug === 'hisse_analiz')?.slug : null)
            ?? categories[0]?.slug
            ?? '';

    useEffect(() => {
        const query = symbol.trim();
        if (query.length < 2 || query === initialSymbol) return;
        const controller = new AbortController();
        const timer = window.setTimeout(() => {
            void fetch(`/api/market/symbols?q=${encodeURIComponent(query)}`, { signal: controller.signal, cache: 'no-store' })
                .then(async (response) => {
                    const payload = await response.json() as { data?: Array<{ symbol: string; name: string }>; error?: string };
                    if (!response.ok) throw new Error(payload.error ?? 'Hisse önerileri yüklenemedi.');
                    setSymbolSuggestions(payload.data ?? []);
                    setSymbolSearchError('');
                })
                .catch((cause) => {
                    if (cause instanceof DOMException && cause.name === 'AbortError') return;
                    setSymbolSuggestions([]);
                    setSymbolSearchError(cause instanceof Error ? cause.message : 'Hisse önerileri yüklenemedi.');
                });
        }, 250);
        return () => {
            window.clearTimeout(timer);
            controller.abort();
        };
    }, [initialSymbol, symbol]);

    useEffect(() => {
        const controller = new AbortController();
        void fetch('/api/forum/appeals', { signal: controller.signal, cache: 'no-store' })
            .then(async (response) => {
                const payload = await response.json() as { data?: typeof banStatus; error?: string };
                if (!response.ok || !payload.data) throw new Error(payload.error ?? 'Forum erişim durumu yüklenemedi.');
                setBanStatus(payload.data);
            })
            .catch((cause) => {
                if (cause instanceof DOMException && cause.name === 'AbortError') return;
                setError(cause instanceof Error ? cause.message : 'Forum erişim durumu yüklenemedi.');
            });
        return () => controller.abort();
    }, []);

    const submitAppeal = async () => {
        if (appealDetails.trim().length < 20 || appealDetails.trim().length > 1000) {
            setError('İtiraz açıklaması 20-1000 karakter arasında olmalıdır.');
            return;
        }
        setAppealBusy(true);
        setError('');
        try {
            const form = new FormData();
            form.set('subject', appealSubject);
            form.set('details', appealDetails);
            if (appealFile) form.set('file', appealFile);
            const response = await fetch('/api/forum/appeals', {
                method: 'POST',
                body: form,
            });
            const payload = await response.json() as { data?: { id: string; subject: string; details: string; status: string; attachment_url: string | null }; error?: string };
            if (!response.ok || !payload.data) throw new Error(payload.error ?? 'İtiraz gönderilemedi.');
            setBanStatus((current) => current ? { ...current, appeal: { ...payload.data!, admin_note: null } } : current);
            setAppealDetails('');
            setAppealFile(null);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'İtiraz gönderilemedi.');
        } finally {
            setAppealBusy(false);
        }
    };

    const uploadImage = async (file: File) => {
        const form = new FormData();
        form.append('file', file);
        const response = await fetch('/api/forum/media', { method: 'POST', body: form });
        const payload = await response.json() as { data?: { url: string }; error?: string };
        if (!response.ok || !payload.data?.url) throw new Error(payload.error ?? 'Görsel yüklenemedi.');
        return payload.data.url;
    };

    const commitTag = () => {
        const tag = cleanText(tagInput.trim().replace(/^#/, '')).toLocaleLowerCase('tr-TR');
        if (!tag) return;
        if (hasProfanity(tag)) {
            setError('Etiket topluluk kurallarına uygun olmayan ifadeler içeremez.');
            return;
        }
        if (tag.length > 30) {
            setError('Etiket en fazla 30 karakter olabilir.');
            return;
        }
        if (!/^[\p{L}\p{N}_-]+$/u.test(tag)) {
            setError('Etiket yalnızca harf, rakam, alt çizgi ve tire içerebilir.');
            return;
        }
        if (tags.includes(tag)) {
            setTagInput('');
            return;
        }
        if (tags.length >= 5) {
            setError('En fazla 5 etiket ekleyebilirsiniz.');
            return;
        }
        setError('');
        setTags([...tags, tag]);
        setTagInput('');
    };

    const addTag = (event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key !== 'Enter' && event.key !== ',') return;
        event.preventDefault();
        commitTag();
    };

    const create = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setError('');
        if (hasProfanity(title) || hasProfanity(content)) {
            setError('Başlık veya içerik topluluk kurallarına uygun olmayan ifadeler içeriyor. Düzenleyip tekrar deneyin.');
            return;
        }
        const pendingTag = cleanText(tagInput.trim().replace(/^#/, '')).toLocaleLowerCase('tr-TR');
        if (pendingTag && (hasProfanity(pendingTag) || !/^[\p{L}\p{N}_-]{1,30}$/u.test(pendingTag))) {
            setError('Etiket yalnızca uygun ifadelerle harf, rakam, alt çizgi ve tire içerebilir (en fazla 30 karakter).');
            return;
        }
        const submittedTags = pendingTag && !tags.includes(pendingTag) ? [...tags, pendingTag] : tags;
        if (submittedTags.length > 5) {
            setError('En fazla 5 etiket ekleyebilirsiniz.');
            return;
        }
        setBusy(true);
        try {
            const coverImageUrl = coverImage ? await uploadImage(coverImage) : null;
            const imageUrls: string[] = [];
            for (const file of images) imageUrls.push(await uploadImage(file));
            const input: TopicInput = {
                title: cleanText(title.trim()),
                content: cleanText(content.trim()),
                category: selectedCategory,
                related_symbol: symbol.trim() ? symbol.trim().toUpperCase() : null,
                cover_image_url: coverImageUrl,
                images: imageUrls,
                tags: submittedTags,
                visibility,
            };
            const response = await fetch('/api/forum/topics', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(input),
            });
            const payload = await response.json() as { data?: { id?: string }; error?: string };
            if (!response.ok || !payload.data?.id) throw new Error(payload.error ?? 'Konu oluşturulamadı.');
            onCreated(payload.data.id);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'Konu oluşturulamadı.');
        } finally {
            setBusy(false);
        }
    };

    return <div className="fixed inset-0 z-[100] flex items-end justify-center bg-slate-950/80 p-0 backdrop-blur-md sm:items-center sm:p-5" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
        <section role="dialog" aria-modal="true" aria-labelledby="create-topic-title" className="flex max-h-[94vh] w-full max-w-5xl flex-col overflow-hidden rounded-t-2xl border border-slate-700/80 bg-slate-950 shadow-2xl sm:rounded-2xl">
            <header className="flex items-start justify-between gap-4 border-b border-slate-800 bg-slate-900/80 px-5 py-4 sm:px-7">
                <div className="min-w-0"><p className="text-[10px] font-bold tracking-[.2em] text-emerald-400">TRADE ENGINE / TOPLULUK</p><h2 id="create-topic-title" className="mt-1 text-xl font-bold text-white sm:text-2xl">Yeni tartışma</h2><p className="mt-1 text-xs text-slate-400">Araştırmanı, sorunu veya piyasa görüşünü toplulukla paylaş.</p></div>
                <button type="button" onClick={onClose} disabled={busy} aria-label="Pencereyi kapat" className="rounded-lg border border-slate-700 bg-slate-800 p-2 text-slate-400 transition hover:text-white"><X size={18} /></button>
            </header>
            <form onSubmit={(event) => void create(event)} className="flex min-h-0 flex-1 flex-col">
                {banStatus?.banned && <section className="mx-5 mt-4 rounded-xl border border-rose-500/20 bg-rose-500/10 p-4 sm:mx-7">
                    <h3 className="text-sm font-bold text-rose-300">Forum paylaşım erişiminiz kısıtlı</h3>
                    <p className="mt-1 text-xs leading-5 text-slate-300">{banStatus.ban_until ? `Kısıtlama ${new Date(banStatus.ban_until).toLocaleString('tr-TR')} tarihinde sona erecek.` : 'Kısıtlama süresizdir.'}</p>
                    {banStatus.appeal && ['pending', 'reviewing'].includes(banStatus.appeal.status)
                        ? <div className="mt-3 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3"><p className="text-xs font-semibold text-amber-300">İtirazınız incelemede: {banStatus.appeal.subject}</p><p className="mt-1 line-clamp-2 text-xs text-slate-400">{banStatus.appeal.details}</p><p className="mt-2 text-[10px] text-slate-400">İnceleme tamamlanana kadar yeni itiraz hakkı kullanılamaz. Sonuca göre yeniden başvuru hakkı değerlendirilecektir.</p></div>
                        : <div className="mt-3 space-y-2">
                            <label htmlFor="ban-appeal-subject" className="block text-xs font-semibold text-slate-200">Konu (3-120 karakter)</label><input id="ban-appeal-subject" value={appealSubject} onChange={(event) => setAppealSubject(event.target.value)} minLength={3} maxLength={120} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white" />
                            <label htmlFor="ban-appeal-details" className="block text-xs font-semibold text-slate-200">İtiraz açıklaması (20-1000 karakter)</label><textarea id="ban-appeal-details" value={appealDetails} onChange={(event) => setAppealDetails(event.target.value)} minLength={20} maxLength={1000} rows={3} className="w-full resize-y rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white outline-none focus:ring-2 focus:ring-emerald-500/40" placeholder="Yasak kararının yeniden değerlendirilmesini istediğiniz nedeni açıklayın." /><p className="text-right text-[10px] text-slate-500">{appealDetails.length}/1000</p>
                            <label className="block text-[10px] font-semibold text-slate-300">İsteğe bağlı görsel · en fazla 5 MB<input type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={(event) => setAppealFile(event.target.files?.[0] ?? null)} className="mt-1 block w-full text-[10px] text-slate-400" /></label>
                            {appealFile && <p className="truncate text-[10px] text-slate-400">{appealFile.name}</p>}
                            <button type="button" disabled={appealBusy || appealDetails.trim().length < 20 || appealSubject.trim().length < 3} onClick={() => void submitAppeal()} className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-50">{appealBusy ? 'Gönderiliyor…' : 'İtiraz gönder'}</button>
                        </div>}
                </section>}
                <div className="grid min-h-0 flex-1 gap-5 overflow-y-auto p-5 sm:p-7 lg:grid-cols-[minmax(0,1.45fr)_minmax(270px,.85fr)]">
                    <div className="min-w-0 space-y-5">
                        <section className="space-y-4">
                            <div><label htmlFor="topic-title" className="mb-1.5 block text-xs font-semibold text-slate-300">Başlık</label><input id="topic-title" className={`${inputClass} bg-slate-900`} required minLength={3} maxLength={180} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Örn. THYAO bilançosunda öne çıkanlar" /><p className="mt-1.5 text-right text-[10px] text-slate-500">{title.length}/180</p></div>
                            <div><div className="mb-1.5 flex items-center justify-between"><label htmlFor="topic-content" className="text-xs font-semibold text-slate-300">İçerik</label><span className="text-[10px] text-slate-500">Yatırım tavsiyesi niteliğinde değildir</span></div><MentionTextarea id="topic-content" className={`${inputClass} min-h-64 resize-y bg-slate-900 leading-6`} required maxLength={13800} value={content} onChange={setContent} placeholder="Görüşünü destekleyen verileri, kaynakları ve riskleri paylaş..." /><p className="mt-1.5 text-right text-[10px] text-slate-500">{content.length.toLocaleString('tr-TR')}/13.800 karakter · @ ile kullanıcı etiketle</p></div>
                        </section>
                        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
                            <label htmlFor="topic-tags" className="mb-2 block text-xs font-semibold text-slate-300">Etiketler <span className="font-normal text-slate-500">· en fazla 5</span></label>
                            <div className="flex min-h-10 flex-wrap items-center gap-2 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5">
                                {tags.map((tag) => <span key={tag} className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/20 bg-emerald-500/10 px-2 py-1 text-[11px] font-medium text-emerald-200">#{tag}<button type="button" aria-label={`${tag} etiketini kaldır`} onClick={() => setTags(tags.filter((item) => item !== tag))} className="text-emerald-300 hover:text-white">×</button></span>)}
                                <input id="topic-tags" value={tagInput} onChange={(event) => setTagInput(event.target.value)} onKeyDown={addTag} onBlur={() => { if (tagInput.trim()) commitTag(); }} maxLength={30} className="min-w-[150px] flex-1 bg-transparent px-1 py-1 text-xs text-white outline-none placeholder:text-slate-600" placeholder="Etiket yaz, Enter'a bas" />
                            </div>
                        </section>
                    </div>
                    <aside className="min-w-0 space-y-4">
                        <section className="space-y-3 rounded-xl border border-slate-800 bg-slate-900 p-4">
                            <h3 className="text-xs font-bold text-white">Gönderi bilgileri</h3>
                            <label className="block space-y-1.5 text-[11px] font-medium text-slate-400">Kategori<select className={`${inputClass} bg-slate-950`} value={selectedCategory} onChange={(event) => setCategory(event.target.value)}>{categories.map(({ slug, label }) => <option key={slug} value={slug}>{label}</option>)}</select></label>
                            <div className="relative space-y-1.5"><label htmlFor="topic-symbol" className="block text-[11px] font-medium text-slate-400">Hisse sembolü <span className="text-slate-600">(isteğe bağlı)</span></label><input id="topic-symbol" role="combobox" aria-autocomplete="list" aria-expanded={symbolSuggestions.length > 0} aria-controls="topic-symbol-options" className={`${inputClass} bg-slate-950`} maxLength={20} value={symbol} onChange={(event) => { setSymbol(event.target.value.toUpperCase().replace(/[^A-Z0-9 .&-]/g, '')); setSymbolSuggestions([]); setSymbolSearchError(''); }} placeholder="Şirket adı veya kod" />
                                {symbolSuggestions.length > 0 && <ul id="topic-symbol-options" role="listbox" className="absolute inset-x-0 top-full z-20 mt-1 max-h-56 overflow-y-auto rounded-lg border border-slate-700 bg-slate-900 p-1 shadow-xl">{symbolSuggestions.map((option) => <li key={option.symbol} role="option" aria-selected={symbol === option.symbol}><button type="button" onClick={() => { setSymbol(option.symbol); setSymbolSuggestions([]); }} className="flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left hover:bg-slate-800"><strong className="text-xs text-emerald-300">{option.symbol}</strong><span className="min-w-0 truncate text-right text-xs text-slate-300">{option.name}</span></button></li>)}</ul>}
                                {symbolSearchError && <p role="status" className="text-[10px] text-amber-300">{symbolSearchError}</p>}
                            </div>
                            <label className="block space-y-1.5 text-[11px] font-medium text-slate-400">Görünürlük<select className={`${inputClass} bg-slate-950`} value={visibility} onChange={(event) => setVisibility(event.target.value as typeof visibility)}><option value="public">Herkese açık</option><option value="followers">Yalnızca takipçilerim</option></select></label>
                        </section>
                        <section className="space-y-3 rounded-xl border border-slate-800 bg-slate-900 p-4">
                            <h3 className="text-xs font-bold text-white">Görseller</h3>
                            <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-slate-700 bg-slate-950 p-3 transition hover:border-emerald-500/40"><ImagePlus className="h-4 w-4 shrink-0 text-emerald-400" /><span className="min-w-0 flex-1"><span className="block text-xs font-medium text-slate-200">{coverImage?.name ?? 'Kapak görseli ekle'}</span><span className="mt-0.5 block text-[10px] text-slate-500">JPG, PNG, WebP veya GIF · en fazla 5 MB</span></span><input type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="sr-only" onChange={(event) => {
                                const file = event.target.files?.[0] ?? null;
                                if (file && (file.size > 5 * 1024 * 1024 || !['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type))) {
                                    setError('Yalnızca JPG, PNG, WebP veya GIF biçiminde, en fazla 5 MB görsel yükleyebilirsiniz.');
                                    setCoverImage(null);
                                    return;
                                }
                                setError('');
                                setCoverImage(file);
                            }} /></label>
                            <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-slate-700 bg-slate-950 p-3 transition hover:border-emerald-500/40"><ImagePlus className="h-4 w-4 shrink-0 text-slate-400" /><span className="min-w-0 flex-1"><span className="block text-xs font-medium text-slate-200">{images.length ? `${images.length} içerik görseli seçildi` : 'İçerik görselleri ekle'}</span><span className="mt-0.5 block text-[10px] text-slate-500">En fazla 5 görsel · her biri 5 MB</span></span><input type="file" multiple accept="image/jpeg,image/png,image/webp,image/gif" className="sr-only" onChange={(event) => {
                                const files = Array.from(event.target.files ?? []);
                                if (files.length > 5 || files.some((file) => file.size > 5 * 1024 * 1024 || !['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type))) {
                                    setError('En fazla 5 adet, JPG/PNG/WebP/GIF biçiminde ve her biri 5 MB altında içerik görseli seçin.');
                                    setImages([]);
                                } else {
                                    setError('');
                                    setImages(files);
                                }
                            }} /></label>
                        </section>
                        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3.5"><div className="flex items-center gap-2 text-[11px] font-semibold text-amber-300"><LockKeyhole size={13} />Yasal bilgilendirme</div><p className="mt-2 text-[10px] leading-4 text-slate-400">{LEGAL_DISCLAIMER}</p><p className="mt-2 text-[10px] text-slate-500">Bu uyarı gönderinizin sonunda otomatik olarak yer alır.</p></div>
                    </aside>
                </div>
                {error && <p role="alert" className="mx-5 mb-3 rounded-lg border border-rose-500/20 bg-rose-500/10 p-3 text-xs text-rose-300 sm:mx-7">{error}</p>}
                <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 bg-slate-900/80 px-5 py-4 sm:px-7">
                    <p className="hidden text-[10px] text-slate-500 sm:block">Paylaşım öncesi başlık, etiket ve görünürlük ayarlarını kontrol edin.</p>
                    <div className="ml-auto flex gap-2"><button type="button" onClick={onClose} disabled={busy} className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-2.5 text-xs font-semibold text-slate-300 transition hover:bg-slate-700">İptal</button><button disabled={busy || banStatus?.banned} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2.5 text-xs font-bold text-white shadow-lg shadow-emerald-900/20 transition hover:bg-emerald-500 disabled:opacity-50">{busy && <LoaderCircle className="h-4 w-4 animate-spin" />}{busy ? 'Paylaşılıyor…' : banStatus?.banned ? 'Paylaşım kısıtlı' : 'Konuyu paylaş'}</button></div>
                </footer>
            </form>
        </section>
    </div>;
}
