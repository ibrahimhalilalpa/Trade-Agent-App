'use client';

import { ArrowLeft, Bell, Check, CheckCheck, CheckSquare, Circle, Info, MessageCircle, OctagonAlert, Settings2, Sparkles, Square, Trash2, TrendingUp, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { getSupabaseBrowserClient } from '@/lib/supabase-browser';
import { useAppPreferences } from '@/components/AppProviders';
import { showError, showSuccess } from '@/lib/ui-alerts';

type Category = 'announcement' | 'market' | 'portfolio' | 'academy' | 'system' | 'community';
type Notification = {
    id: string;
    announcement_id: string | null;
    category: Category;
    severity: 'info' | 'success' | 'warning' | 'critical';
    title: string;
    message: string;
    created_at: string;
    read_at: string | null;
    action_url?: string | null;
};
type NotificationPreference = {
    eventKey: string;
    title: string;
    message: string;
    category: string;
    active: boolean;
    enabled: boolean;
};
type CategoryFilter = 'all' | Category;
const FILTERS: Array<{ id: CategoryFilter; label: string; icon: typeof Bell }> = [
    { id: 'all', label: 'Tümü', icon: Bell },
    { id: 'announcement', label: 'Duyuru', icon: Bell },
    { id: 'market', label: 'Piyasa', icon: TrendingUp },
    { id: 'portfolio', label: 'Portföy', icon: Sparkles },
    { id: 'academy', label: 'Akademi', icon: Info },
    { id: 'system', label: 'Sistem', icon: Info },
    { id: 'community', label: 'Topluluk', icon: MessageCircle },
];
const CATEGORY_LABELS: Record<Category, string> = {
    announcement: 'Duyuru', market: 'Piyasa', portfolio: 'Portföy', academy: 'Akademi', system: 'Sistem', community: 'Topluluk',
};
const CATEGORY_ICONS: Record<Category, typeof Bell> = {
    announcement: Bell, market: TrendingUp, portfolio: Sparkles, academy: Info, system: Info, community: MessageCircle,
};
function displayNotificationMessage(notification: Notification) {
    if (!['Hesap itirazı kabul edildi', 'Hesap itirazı sonuçlandı'].includes(notification.title)) return notification.message;

    const statusMessages = [
        'Hesap erişiminiz yeniden açıldı.',
        'Hesap itirazınız yeniden değerlendirildi ve reddedildi; hesap kısıtlaması devam ediyor.',
        'Hesap itirazınız reddedildi.',
    ];
    const statusMessage = statusMessages.find((candidate) => notification.message.startsWith(candidate));
    if (!statusMessage) return notification.message;

    const adminMessage = notification.message.slice(statusMessage.length).trim();
    if (!adminMessage || adminMessage.startsWith('Yönetici mesajı:')) return notification.message;
    return `${statusMessage}\n\nYönetici mesajı: ${adminMessage}`;
}

export default function NotificationCenter() {
    const { confirmDialog } = useAppPreferences();
    const [items, setItems] = useState<Notification[]>([]);
    const [unreadCount, setUnreadCount] = useState(0);
    const [filter, setFilter] = useState<CategoryFilter>('all');
    const [open, setOpen] = useState(false);
    const [selectedId, setSelectedId] = useState('');
    const [preferencesOpen, setPreferencesOpen] = useState(false);
    const [preferences, setPreferences] = useState<NotificationPreference[]>([]);
    const [preferencesLoading, setPreferencesLoading] = useState(false);
    const [preferenceBusyKey, setPreferenceBusyKey] = useState('');
    const [selectionMode, setSelectionMode] = useState(false);
    const [selectedNotificationIds, setSelectedNotificationIds] = useState<string[]>([]);
    const [signedIn, setSignedIn] = useState(false);
    const [error, setError] = useState('');
    const selected = useMemo(() => items.find((item) => item.id === selectedId) ?? null, [items, selectedId]);

    useEffect(() => {
        if (error && open) showError(error);
    }, [error, open]);

    const load = useCallback(async () => {
        try {
            const response = await fetch(`/api/notifications?category=${filter}`, { cache: 'no-store' });
            if (response.status === 401) {
                setSignedIn(false);
                setItems([]);
                setUnreadCount(0);
                return;
            }
            setSignedIn(true);
            const payload = await response.json() as {
                data?: { notifications: Notification[]; unreadCount: number };
                error?: string;
            };
            if (!response.ok || !payload.data) throw new Error(payload.error ?? 'Bildirimler alınamadı.');
            setItems(payload.data.notifications);
            setUnreadCount(payload.data.unreadCount);
            setError('');
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'Bildirimler yüklenemedi.');
        }
    }, [filter]);

    useEffect(() => {
        const timer = window.setTimeout(() => { void load(); }, 0);
        const interval = window.setInterval(() => { void load(); }, 60000);
        const client = getSupabaseBrowserClient();
        const { data: { subscription } } = client?.auth.onAuthStateChange(() => { void load(); })
            ?? { data: { subscription: null } };
        return () => {
            window.clearTimeout(timer);
            window.clearInterval(interval);
            subscription?.unsubscribe();
        };
    }, [load]);

    useEffect(() => {
        if (!open) return;
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setOpen(false);
                setSelectedId('');
            }
        };
        window.addEventListener('keydown', closeOnEscape);
        return () => window.removeEventListener('keydown', closeOnEscape);
    }, [open]);

    const setRead = async (notification: Notification, read: boolean) => {
        const response = await fetch('/api/notifications', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: notification.id, read }),
        });
        const payload = await response.json() as { error?: string };
        if (!response.ok) {
            setError(payload.error ?? 'Bildirim durumu güncellenemedi.');
            return;
        }
        setItems((current) => current.map((item) => item.id === notification.id
            ? { ...item, read_at: read ? new Date().toISOString() : null }
            : item));
        setUnreadCount((count) => Math.max(0, count + (read && !notification.read_at ? -1 : !read && notification.read_at ? 1 : 0)));
        setError('');
    };

    const markAllRead = async () => {
        const response = await fetch('/api/notifications', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ all: true, read: true }),
        });
        const payload = await response.json() as { error?: string };
        if (!response.ok) {
            setError(payload.error ?? 'Bildirimler okundu olarak işaretlenemedi.');
            return;
        }
        const now = new Date().toISOString();
        setItems((current) => current.map((item) => ({ ...item, read_at: item.read_at ?? now })));
        setUnreadCount(0);
        setError('');
        showSuccess('Tüm bildirimler okundu olarak işaretlendi.');
    };

    const deleteNotifications = async (all: boolean, notification?: Notification) => {
        const ids = notification ? [notification.id] : selectedNotificationIds;
        if (!all && ids.length === 0) return;
        const confirmed = await confirmDialog({
            title: all ? 'Tüm bildirimleri sil?' : 'Seçili bildirimleri sil?',
            message: all
                ? 'Tüm bildirimlerin kalıcı olarak silinecek.'
                : ids.length === 1 ? 'Bu bildirim kalıcı olarak silinecek.' : `${ids.length} bildirim kalıcı olarak silinecek.`,
            confirmLabel: 'Kalıcı olarak sil',
            danger: true,
        });
        if (!confirmed) return;
        try {
            const response = await fetch('/api/notifications', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(all ? { all: true } : { ids }),
            });
            const payload = await response.json() as { error?: string; deletedIds?: string[] };
            if (!response.ok || !payload.deletedIds) throw new Error(payload.error ?? 'Bildirimler silinemedi.');
            const deletedIds = new Set(payload.deletedIds);
            const removedUnread = items.filter((item) => deletedIds.has(item.id) && !item.read_at).length;
            setItems((current) => all ? [] : current.filter((item) => !deletedIds.has(item.id)));
            setUnreadCount((count) => all ? 0 : Math.max(0, count - removedUnread));
            setSelectedId((current) => all || deletedIds.has(current) ? '' : current);
            setSelectedNotificationIds([]);
            setSelectionMode(false);
            setError('');
            showSuccess(all ? 'Tüm bildirimler silindi.' : 'Seçili bildirimler silindi.');
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'Bildirimler silinemedi.');
        }
    };

    const toggleSelectedNotification = (id: string) => {
        setSelectedNotificationIds((current) => current.includes(id)
            ? current.filter((selected) => selected !== id)
            : [...current, id]);
    };

    const selectVisibleNotifications = () => {
        setSelectedNotificationIds((current) => current.length === items.length
            ? []
            : items.map((item) => item.id));
    };

    const loadPreferences = async () => {
        setPreferencesLoading(true);
        try {
            const response = await fetch('/api/notifications/preferences', { cache: 'no-store' });
            const payload = await response.json() as { data?: NotificationPreference[]; error?: string };
            if (!response.ok || !payload.data) throw new Error(payload.error ?? 'Bildirim izinleri alınamadı.');
            setPreferences(payload.data);
            setError('');
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'Bildirim izinleri alınamadı.');
        } finally {
            setPreferencesLoading(false);
        }
    };

    const setPreference = async (preference: NotificationPreference) => {
        setPreferenceBusyKey(preference.eventKey);
        try {
            const response = await fetch('/api/notifications/preferences', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ eventKey: preference.eventKey, enabled: !preference.enabled }),
            });
            const payload = await response.json() as { error?: string };
            if (!response.ok) throw new Error(payload.error ?? 'Bildirim izni güncellenemedi.');
            setPreferences((current) => current.map((item) => item.eventKey === preference.eventKey
                ? { ...item, enabled: !item.enabled }
                : item));
            setError('');
            showSuccess('Bildirim tercihi güncellendi.');
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'Bildirim izni güncellenemedi.');
        } finally {
            setPreferenceBusyKey('');
        }
    };

    const openNotification = async (item: Notification) => {
        if (selectionMode) {
            toggleSelectedNotification(item.id);
            return;
        }
        setSelectedId(item.id);
        if (!item.read_at) await setRead(item, true);
    };

    if (!signedIn) return null;
    return <div className="relative z-[90]">
        <button type="button" onClick={() => { setOpen((current) => !current); if (!open) void load(); }}
            className="relative inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-700 bg-slate-900 text-slate-200 transition hover:border-emerald-500/40 hover:text-emerald-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
            aria-label={unreadCount ? `${unreadCount} okunmamış bildirim` : 'Bildirimleri aç'} aria-expanded={open}>
            <Bell className="h-5 w-5" />
            {unreadCount > 0 && <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-slate-950 bg-rose-500 px-1 text-[10px] font-bold text-white">{unreadCount > 99 ? '99+' : unreadCount}</span>}
        </button>
        {open && <>
            <button className="fixed inset-0 z-[99] cursor-default bg-slate-950/60 backdrop-blur-[2px]" aria-label="Bildirimleri kapat" onClick={() => { setOpen(false); setSelectedId(''); }} />
            <section className="fixed inset-x-0 bottom-0 z-[100] flex max-h-[min(86dvh,760px)] flex-col overflow-hidden rounded-t-3xl border border-slate-700 bg-slate-900 pb-[env(safe-area-inset-bottom)] shadow-2xl sm:absolute sm:inset-x-auto sm:bottom-auto sm:right-0 sm:top-12 sm:max-h-[min(80vh,720px)] sm:w-[min(94vw,440px)] sm:rounded-2xl">
                <header className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-800 px-4 py-3 sm:p-4">
                    <div className="flex min-w-0 items-center gap-3">
                        {(selected || preferencesOpen) && <button type="button" onClick={() => { setSelectedId(''); setPreferencesOpen(false); }} aria-label="Bildirim listesine dön" className="rounded-lg border border-slate-700 bg-slate-800 p-2 text-slate-300 hover:text-white"><ArrowLeft className="h-4 w-4" /></button>}
                        <div className="min-w-0"><h2 className="truncate font-bold text-white">{selected ? 'Bildirim detayı' : preferencesOpen ? 'Bildirim izinleri' : 'Bildirimler'}</h2><p className="text-xs text-slate-400">{selected ? CATEGORY_LABELS[selected.category] : preferencesOpen ? 'Hangi bildirimleri alacağını seç' : `${unreadCount} okunmamış`}</p></div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                        {!selected && !preferencesOpen && unreadCount > 0 && <button type="button" onClick={() => void markAllRead()} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 text-[11px] font-semibold text-emerald-300 hover:bg-emerald-500/10"><CheckCheck className="h-3.5 w-3.5" /><span>Tümünü oku</span></button>}
                        {!selected && <button type="button" onClick={() => { const next = !preferencesOpen; setPreferencesOpen(next); setSelectionMode(false); setSelectedNotificationIds([]); if (next) void loadPreferences(); }} aria-label="Bildirim izinlerini yönet" title="Bildirim izinlerini yönet" className={`grid h-9 w-9 place-items-center rounded-lg ${preferencesOpen ? 'bg-emerald-500/10 text-emerald-300' : 'text-slate-300 hover:bg-slate-800'}`}><Settings2 className="h-4 w-4" /></button>}
                        {!selected && !preferencesOpen && items.length > 0 && <button type="button" onClick={() => { setSelectionMode((current) => !current); setSelectedNotificationIds([]); }} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 text-[11px] font-semibold text-slate-300 hover:bg-slate-800 hover:text-white"><CheckSquare className="h-3.5 w-3.5" /><span>{selectionMode ? 'Vazgeç' : 'Seç'}</span></button>}
                        {!selected && !preferencesOpen && items.length > 0 && <button type="button" onClick={() => void deleteNotifications(true)} aria-label="Tüm bildirimleri sil" title="Tüm bildirimleri sil" className="grid h-9 w-9 place-items-center rounded-lg text-rose-300 hover:bg-rose-500/10"><Trash2 className="h-4 w-4" /></button>}
                        <button type="button" onClick={() => { setOpen(false); setSelectedId(''); }} aria-label="Kapat" className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white"><X className="h-4 w-4" /></button>
                    </div>
                </header>
                {selected ? <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 sm:p-5">
                    <article className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4 sm:p-5">
                        <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded-full border border-slate-700 bg-slate-800 px-3 py-1 text-[11px] font-semibold text-slate-300">{CATEGORY_LABELS[selected.category]}</span>
                            <span className={`rounded-full border px-3 py-1 text-[11px] font-semibold ${selected.severity === 'critical' ? 'border-rose-500/20 bg-rose-500/10 text-rose-300' : selected.severity === 'warning' ? 'border-amber-500/20 bg-amber-500/10 text-amber-300' : selected.severity === 'success' ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300' : 'border-sky-500/20 bg-sky-500/10 text-sky-300'}`}>{selected.severity === 'critical' ? 'Kritik' : selected.severity === 'warning' ? 'Uyarı' : selected.severity === 'success' ? 'Başarılı' : 'Bilgi'}</span>
                        </div>
                        <h3 className="mt-4 break-words text-lg font-bold leading-snug text-white">{selected.title}</h3>
                        <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-slate-300">{displayNotificationMessage(selected)}</p>
                        {selected.action_url && <a href={selected.action_url} onClick={() => setOpen(false)} className="mt-4 inline-flex min-h-10 items-center rounded-lg bg-emerald-600 px-4 text-xs font-bold text-white transition hover:bg-emerald-500">İlgili içeriği aç</a>}
                        <time className="mt-5 block border-t border-slate-800 pt-3 text-xs text-slate-500">{new Date(selected.created_at).toLocaleString('tr-TR')}</time>
                    </article>
                    {selected.read_at && <p className="mt-3 flex items-center gap-2 text-xs text-emerald-300"><Check className="h-4 w-4" />Okundu · {new Date(selected.read_at).toLocaleString('tr-TR')}</p>}
                    <button type="button" onClick={() => void setRead(selected, !selected.read_at)} className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-800 px-4 text-sm font-semibold text-slate-200 hover:border-emerald-500/40 hover:text-emerald-300">{selected.read_at ? <><Circle className="h-4 w-4" />Okunmadı olarak işaretle</> : <><Check className="h-4 w-4" />Okundu olarak işaretle</>}</button>
                    <button type="button" onClick={() => void deleteNotifications(false, selected)} className="mt-2 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 text-sm font-semibold text-rose-300 hover:bg-rose-500/15"><Trash2 className="h-4 w-4" />Bildirimi sil</button>
                </div> : preferencesOpen ? <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-3 sm:p-4">
                    <p className="text-xs leading-5 text-slate-400">Yeni bildirim türleri yönetim sistemine eklendikçe burada otomatik görünür. Henüz özel tercih belirlemediğin türler açık kalır.</p>
                    {preferencesLoading && <p className="py-8 text-center text-xs text-slate-500">Bildirim izinleri yükleniyor…</p>}
                    {!preferencesLoading && preferences.map((preference) => <article key={preference.eventKey} className="flex min-w-0 items-start gap-3 rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                        <span className="min-w-0 flex-1"><strong className="block break-words text-sm text-white">{preference.title}</strong><span className="mt-1 block break-words text-xs leading-5 text-slate-400">{preference.message}</span><span className="mt-1.5 block text-[10px] uppercase tracking-wider text-slate-600">{CATEGORY_LABELS[preference.category as Category] ?? preference.category}{!preference.active ? ' · şu anda sistemde kapalı' : ''}</span></span>
                        <button type="button" role="switch" aria-checked={preference.enabled} aria-label={`${preference.title} bildirim izni`} disabled={preferenceBusyKey === preference.eventKey || !preference.active} onClick={() => void setPreference(preference)} className={`relative mt-1 h-6 w-11 shrink-0 rounded-full transition disabled:cursor-not-allowed disabled:opacity-50 ${preference.enabled ? 'bg-emerald-600' : 'bg-slate-700'}`}><span className={`absolute top-1 h-4 w-4 rounded-full bg-white transition ${preference.enabled ? 'left-6' : 'left-1'}`} /></button>
                    </article>)}
                    {!preferencesLoading && preferences.length === 0 && <p className="py-8 text-center text-xs text-slate-500">Henüz bildirim türü tanımlanmamış.</p>}
                </div> : <>
                    <div className="shrink-0 border-b border-slate-800 px-3 py-3">
                        <div className="flex gap-2 overflow-x-auto overscroll-x-contain pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" aria-label="Bildirim kategorileri">
                            {FILTERS.map((item) => {
                                const Icon = item.icon;
                                return <button type="button" key={item.id} onClick={() => { setFilter(item.id); setSelectedNotificationIds([]); }} aria-pressed={filter === item.id}
                                    className={`inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition ${filter === item.id ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-slate-700 bg-slate-800/70 text-slate-400 hover:text-slate-200'}`}><Icon className="h-3.5 w-3.5" />{item.label}</button>;
                            })}
                        </div>
                    </div>
                    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2 sm:p-3">
                        {selectionMode && <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-950/70 p-2">
                            <span className="text-xs text-slate-400">{selectedNotificationIds.length} bildirim seçildi</span>
                            <div className="flex items-center gap-2">
                                <button type="button" onClick={selectVisibleNotifications} className="min-h-9 rounded-lg px-2.5 text-[11px] font-semibold text-slate-300 hover:bg-slate-800">{selectedNotificationIds.length === items.length ? 'Seçimi temizle' : 'Görünenleri seç'}</button>
                                <button type="button" onClick={() => void deleteNotifications(false)} disabled={!selectedNotificationIds.length} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-rose-500/10 px-3 text-[11px] font-semibold text-rose-300 disabled:opacity-40"><Trash2 className="h-3.5 w-3.5" />Seçilenleri sil</button>
                            </div>
                        </div>}
                        {!items.length && <div className="grid justify-items-center px-5 py-12 text-center"><span className="grid h-12 w-12 place-items-center rounded-2xl border border-slate-800 bg-slate-800/60 text-slate-500"><Bell className="h-5 w-5" /></span><strong className="mt-4 text-sm text-slate-300">Bildirim yok</strong><p className="mt-1 text-xs text-slate-500">Bu kategoride yeni bir bildirim olduğunda burada görünecek.</p></div>}
                        {items.map((item) => {
                            const Icon = item.severity === 'critical' ? OctagonAlert : CATEGORY_ICONS[item.category];
                            const tone = item.severity === 'critical' ? 'bg-rose-500/10 text-rose-300' : item.severity === 'warning' ? 'bg-amber-500/10 text-amber-300' : item.severity === 'success' ? 'bg-emerald-500/10 text-emerald-300' : 'bg-sky-500/10 text-sky-300';
                            const isSelected = selectedNotificationIds.includes(item.id);
                            return <article key={item.id} className={`mb-1 flex items-stretch gap-2 rounded-xl border p-2 transition ${item.read_at ? 'border-transparent hover:border-slate-800 hover:bg-slate-800/50' : 'border-slate-800 bg-slate-800/60 hover:border-slate-700'}`}>
                                {selectionMode && <button type="button" onClick={() => toggleSelectedNotification(item.id)} aria-label={isSelected ? 'Seçimi kaldır' : 'Bildirimi seç'} aria-pressed={isSelected} className="grid w-8 shrink-0 place-items-center self-center rounded-lg text-slate-400 hover:text-emerald-300">{isSelected ? <CheckSquare className="h-4 w-4 text-emerald-300" /> : <Square className="h-4 w-4" />}</button>}
                                <button type="button" onClick={() => void openNotification(item)} className={`flex min-h-[72px] min-w-0 flex-1 items-start gap-3 rounded-lg p-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50 ${isSelected ? 'bg-emerald-500/5' : ''}`}>
                                    <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${tone}`}><Icon className="h-4 w-4" /></span>
                                    <span className="min-w-0 flex-1"><span className="flex items-center gap-2"><strong className={`line-clamp-2 text-sm leading-snug ${item.read_at ? 'font-medium text-slate-300' : 'font-bold text-white'}`}>{item.title}</strong>{!item.read_at && <Circle className="h-2 w-2 shrink-0 fill-emerald-400 text-emerald-400" />}</span><span className="mt-1.5 line-clamp-2 block whitespace-pre-line break-words text-xs leading-5 text-slate-400">{displayNotificationMessage(item)}</span><span className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-slate-500"><span className="rounded-full bg-slate-800 px-2 py-0.5">{CATEGORY_LABELS[item.category]}</span><time>{new Date(item.created_at).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' })}</time></span></span>
                                </button>
                                <button type="button" onClick={() => void setRead(item, !item.read_at)} title={item.read_at ? 'Okunmadı olarak işaretle' : 'Okundu olarak işaretle'} aria-label={item.read_at ? 'Okunmadı olarak işaretle' : 'Okundu olarak işaretle'} className="my-2 grid min-h-10 w-10 shrink-0 place-items-center self-center rounded-lg text-slate-500 hover:bg-slate-700 hover:text-emerald-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50">{item.read_at ? <Circle className="h-4 w-4" /> : <Check className="h-4 w-4" />}</button>
                                <button type="button" onClick={() => void deleteNotifications(false, item)} title="Bildirimi sil" aria-label={`${item.title} bildirimini sil`} className="my-2 grid min-h-10 w-10 shrink-0 place-items-center self-center rounded-lg text-slate-500 hover:bg-rose-500/10 hover:text-rose-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/50"><Trash2 className="h-4 w-4" /></button>
                            </article>;
                        })}
                    </div>
                </>}
            </section>
        </>}
    </div>;
}
