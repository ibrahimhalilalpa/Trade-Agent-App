'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Activity, Bell, BookOpen, Boxes, CircleAlert, Clock3, Pencil, Plus, RefreshCw, Save, Trash2, Users as UsersIcon, X } from 'lucide-react';
import type { AcademyLevel, AcademyQuizQuestion } from '@/data/academyLessons';
import StockSymbolLink from '@/components/StockSymbolLink';
import { useAppPreferences } from '@/components/AppProviders';
import { showError, showSuccess } from '@/lib/ui-alerts';

type Section = 'portfolios' | 'orders' | 'academy' | 'system';
type ApiPayload<T> = { data?: T; error?: string; success?: boolean };
type Position = { id: string; symbol: string; quantity: number; average_price: number; current_price: number; pnl: number; displayName: string; email: string; role: string; cashBalance: number };
type PortfolioData = { portfolios: Array<{ id: string; userId: string; cashBalance: number; displayName: string; email: string; role: string }>; positions: Position[]; totals: { portfolios: number; openPositions: number; marketValue: number; unrealizedPnl: number } };
type OrderData = {
    orders: Array<{ id: string; symbol: string; side: string; order_type: string; quantity: number; trigger_price: number | null; status: string; error: string | null; created_at: string; display_name: string }>;
    alerts: Array<{ id: string; symbol: string; direction: string; target_price: number; status: string; triggered_at: string | null; created_at: string; display_name: string }>;
    transactions: Array<{ id: string; symbol: string | null; transaction_type: string; quantity: number; price: number; realized_pnl: number; created_at: string; display_name: string }>;
    alertEvents: Array<{ id: string; symbol: string; event_type: string; market_price: number; created_at: string }>;
};
type AcademyRow = { id: string; chapter_id: string; chapter_title: string; title: string; level: AcademyLevel; duration: string; summary: string; concept: string; bist_example: string; application: string; formula: string; pitfalls: string[]; checklist: string[]; quiz_questions: AcademyQuizQuestion[]; sort_order: number; published: boolean };
type Announcement = { id: string; title: string; message: string; category: string; severity: string; active: boolean; starts_at: string; ends_at: string | null; audience_role: string; created_at: string };
type AnnouncementReaders = { total: number; readCount: number; unreadCount: number; recipients: Array<{ userId: string; username: string; readAt: string | null }> };
type NotificationTemplate = { event_key: string; title: string; message: string; category: string; severity: string; active: boolean; updated_at: string };
type MarketCalendarDay = { trading_date: string; is_open: boolean; open_time: string | null; close_time: string | null; title: string; message: string | null; notification_sent: boolean; updated_at: string };
type SystemData = { status: { database: string; cronEnabled: boolean; orderMonitorJob: { active?: boolean; schedule?: string; error?: string } | null; lastOrderMonitorRun: { status?: string; end_time?: string; return_message?: string; error?: string } | null; vaultTokenConfigured: boolean; vaultUrlConfigured: boolean; serviceRoleConfigured: boolean }; announcements: Announcement[]; notificationTemplates: NotificationTemplate[]; audit: Array<{ id: string; event_type: string; description: string; created_at: string; user_id: string; user_email: string; display_name: string; actor_name: string }> };

const formatMoney = (value: number) => new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 2 }).format(Number(value) || 0);
const formatDate = (value: string) => new Date(value).toLocaleString('tr-TR');
const inputClass = 'w-full rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50';
const secondaryButton = 'inline-flex items-center justify-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-4 py-2.5 text-xs font-bold text-slate-100 transition hover:bg-slate-700 disabled:opacity-50';
const panelClass = 'rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-xl';
type SortState = { key: string; ascending: boolean };
const NUMERIC_SORT_KEYS = new Set(['quantity', 'average_price', 'current_price', 'marketValue', 'pnl', 'cashBalance']);
const NOTIFICATION_EVENT_OPTIONS = [
    { key: 'user_registered', label: 'Yeni kullanıcı kaydı', title: 'Aramıza hoş geldin', message: 'Hesabın hazır. Piyasaları takip etmeye ve ilk izleme listeni oluşturmaya başlayabilirsin.', category: 'system', severity: 'success' },
    { key: 'transaction_buy', label: 'Sanal alış gerçekleşti', title: 'Alış işlemi gerçekleşti', message: '{{symbol}} için {{quantity}} adetlik sanal alış işlemin {{price}} TL birim fiyatla tamamlandı.', category: 'portfolio', severity: 'info' },
    { key: 'transaction_sell', label: 'Sanal satış gerçekleşti', title: 'Satış işlemi gerçekleşti', message: '{{symbol}} için {{quantity}} adetlik sanal satış işlemin {{price}} TL birim fiyatla tamamlandı.', category: 'portfolio', severity: 'info' },
    { key: 'lesson_completed', label: 'Akademi dersi tamamlandı', title: 'Ders tamamlandı', message: '{{lesson_id}} akademi dersini tamamladın. Öğrenmeye devam et!', category: 'academy', severity: 'success' },
    { key: 'price_alert_triggered', label: 'Fiyat alarmı tetiklendi', title: 'Fiyat alarmın tetiklendi', message: '{{symbol}} alarmın {{target_price}} TL hedefi, piyasa fiyatı {{market_price}} TL olduğunda tetiklendi.', category: 'market', severity: 'warning' },
    { key: 'price_alert_created', label: 'Yeni fiyat alarmı kuruldu', title: 'Fiyat alarmı oluşturuldu', message: '{{symbol}} için {{direction}} alarmı {{target_price}} TL seviyesinde kuruldu.', category: 'market', severity: 'info' },
    { key: 'order_created', label: 'Emir oluşturuldu', title: 'Emrin oluşturuldu', message: '{{symbol}} için {{side}} emrin oluşturuldu. Emir türü: {{order_type}}.', category: 'portfolio', severity: 'info' },
    { key: 'order_filled', label: 'Emir gerçekleşti', title: 'Emrin gerçekleşti', message: '{{symbol}} için {{quantity}} adetlik {{side}} emrin {{price}} TL seviyesinde gerçekleşti.', category: 'portfolio', severity: 'success' },
    { key: 'order_cancelled', label: 'Emir iptal edildi', title: 'Emrin iptal edildi', message: '{{symbol}} için {{side}} emrin iptal edildi.', category: 'portfolio', severity: 'warning' },
    { key: 'order_failed', label: 'Emir başarısız oldu', title: 'Emir gerçekleştirilemedi', message: '{{symbol}} için {{side}} emrin tamamlanamadı. {{error}}', category: 'portfolio', severity: 'critical' },
    { key: 'order_expired', label: 'Emir süresi doldu', title: 'Emrinin süresi doldu', message: '{{symbol}} için bekleyen {{side}} emrinin süresi doldu.', category: 'portfolio', severity: 'warning' },
    { key: 'balance_request_approved', label: 'Bakiye talebi onaylandı', title: 'Bakiye talebin onaylandı', message: 'Sanal cüzdanına {{amount}} TL aktarıldı. {{admin_note}}', category: 'portfolio', severity: 'success' },
    { key: 'balance_request_rejected', label: 'Bakiye talebi reddedildi', title: 'Bakiye talebin sonuçlandı', message: 'Sanal bakiye talebin onaylanmadı. {{admin_note}}', category: 'portfolio', severity: 'warning' },
    { key: 'admin_balance_adjustment', label: 'Yönetici bakiye müdahalesi', title: 'Sanal bakiye güncellendi', message: 'Sanal bakiyene yönetici tarafından {{amount}} TL {{action}}. Açıklama: {{description}} Yeni bakiyen: {{balance}} TL.', category: 'portfolio', severity: 'info' },
] as const;
const notificationTemplateFor = (eventKey: string): NotificationTemplate => {
    const preset = NOTIFICATION_EVENT_OPTIONS.find((item) => item.key === eventKey) ?? NOTIFICATION_EVENT_OPTIONS[0];
    return { event_key: preset.key, title: preset.title, message: preset.message, category: preset.category, severity: preset.severity, active: true, updated_at: '' };
};

function sortRows<T extends Record<string, unknown>>(rows: T[], sort: SortState): T[] {
    return [...rows].sort((left, right) => {
        const a = left[sort.key];
        const b = right[sort.key];
        const comparison = NUMERIC_SORT_KEYS.has(sort.key)
            ? Number(a ?? 0) - Number(b ?? 0)
            : String(a ?? '').localeCompare(String(b ?? ''), 'tr', { numeric: true, sensitivity: 'base' });
        return sort.ascending ? comparison : -comparison;
    });
}

function SortableHeading({ label, sort, sortKey, onSort }: {
    label: string; sort: SortState; sortKey: string; onSort: (key: string) => void;
}) {
    const active = sort.key === sortKey;
    return <th className="sticky top-0 z-10 whitespace-nowrap border-b border-slate-800 bg-slate-900 px-3 py-3 font-semibold">
        <button type="button" onClick={() => onSort(sortKey)} className="inline-flex items-center gap-1.5 text-left hover:text-emerald-300">
            {label}<span aria-hidden="true" className="text-[10px] text-emerald-400">{active ? sort.ascending ? '↑' : '↓' : '↕'}</span>
        </button>
    </th>;
}

export default function AdminModuleWorkspace({ section }: { section: Section }) {
    const { confirmDialog, promptDialog } = useAppPreferences();
    const [portfolioData, setPortfolioData] = useState<PortfolioData | null>(null);
    const [orderData, setOrderData] = useState<OrderData | null>(null);
    const [lessons, setLessons] = useState<AcademyRow[]>([]);
    const [systemData, setSystemData] = useState<SystemData | null>(null);
    const [marketCalendar, setMarketCalendar] = useState<MarketCalendarDay[]>([]);
    const [query, setQuery] = useState('');
    const [activeTab, setActiveTab] = useState('orders');
    const [selectedLesson, setSelectedLesson] = useState('');
    const [busy, setBusy] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');

    useEffect(() => {
        if (error) showError(error);
    }, [error]);
    useEffect(() => {
        if (notice) showSuccess(notice);
    }, [notice]);
    const [editor, setEditor] = useState<AcademyRow>(() => blankLesson());
    const [quizText, setQuizText] = useState('[]');
    const [announcement, setAnnouncement] = useState({
        title: '', message: '', category: 'announcement', severity: 'info', audienceRole: 'all', active: true,
        startsAtDate: '', startsAtTime: '', endsAtDate: '', endsAtTime: '',
    });
    const [editingAnnouncementId, setEditingAnnouncementId] = useState('');
    const [announcementLimit, setAnnouncementLimit] = useState(5);
    const [calendarDate, setCalendarDate] = useState('');
    const [calendarIsOpen, setCalendarIsOpen] = useState(false);
    const [calendarOpenTime, setCalendarOpenTime] = useState('10:00');
    const [calendarCloseTime, setCalendarCloseTime] = useState('12:30');
    const [calendarTitle, setCalendarTitle] = useState('BİST seans duyurusu');
    const [calendarMessage, setCalendarMessage] = useState('');
    const [calendarNotify, setCalendarNotify] = useState(true);
    const [notificationTemplate, setNotificationTemplate] = useState<NotificationTemplate>(() => notificationTemplateFor('user_registered'));
    const [editingNotificationTemplate, setEditingNotificationTemplate] = useState(false);
    const [readerAnnouncement, setReaderAnnouncement] = useState<Announcement | null>(null);
    const [announcementReaders, setAnnouncementReaders] = useState<AnnouncementReaders | null>(null);
    const [readersLoading, setReadersLoading] = useState(false);
    const [readerFilter, setReaderFilter] = useState<'all' | 'read' | 'unread'>('all');
    const [positionSort, setPositionSort] = useState<SortState>({ key: 'symbol', ascending: true });
    const [portfolioSort, setPortfolioSort] = useState<SortState>({ key: 'displayName', ascending: true });

    function blankLesson(): AcademyRow {
        return { id: '', chapter_id: 'chapter-1', chapter_title: '', title: '', level: 'Başlangıç', duration: '15 dk', summary: '', concept: '', bist_example: '', application: '', formula: '', pitfalls: [], checklist: [], quiz_questions: [], sort_order: 0, published: true };
    }
    const load = useCallback(async () => {
        setLoading(true); setError('');
        try {
            const endpoint = section === 'portfolios' ? '/api/admin/portfolios'
                : section === 'orders' ? '/api/admin/orders'
                    : section === 'academy' ? '/api/admin/academy' : '/api/admin/system';
            const response = await fetch(endpoint, { cache: 'no-store' });
            const payload = await response.json() as ApiPayload<PortfolioData | OrderData | AcademyRow[] | SystemData>;
            if (!response.ok || !payload.data) throw new Error(payload.error ?? 'Yönetim verileri alınamadı.');
            if (section === 'portfolios') setPortfolioData(payload.data as PortfolioData);
            if (section === 'orders') setOrderData(payload.data as OrderData);
            if (section === 'academy') {
                const rows = payload.data as AcademyRow[];
                setLessons(rows);
                const selected = rows.find((row) => row.id === selectedLesson) ?? (!selectedLesson ? rows[0] : undefined);
                if (selected) {
                    setSelectedLesson(selected.id);
                    setEditor({ ...selected });
                    setQuizText(JSON.stringify(selected.quiz_questions ?? [], null, 2));
                }
            }
            if (section === 'system') {
                setSystemData(payload.data as SystemData);
                const calendarResponse = await fetch('/api/admin/market-calendar', { cache: 'no-store' });
                const calendarPayload = await calendarResponse.json() as ApiPayload<MarketCalendarDay[]>;
                if (!calendarResponse.ok || !calendarPayload.data) throw new Error(calendarPayload.error ?? 'BİST seans takvimi yüklenemedi.');
                setMarketCalendar(calendarPayload.data);
            }
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'Yönetim verileri alınamadı.');
        } finally { setLoading(false); }
    }, [section, selectedLesson]);
    useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load]);
    useEffect(() => { if (section !== 'portfolios' && section !== 'orders' && section !== 'system') return; const timer = window.setInterval(() => { void load(); }, 30000); return () => window.clearInterval(timer); }, [load, section]);
    const request = async (endpoint: string, method: string, body?: object) => {
        setBusy(true); setError(''); setNotice('');
        try {
            const response = await fetch(endpoint, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
            const payload = await response.json() as ApiPayload<unknown>;
            if (!response.ok) throw new Error(payload.error ?? 'İşlem tamamlanamadı.');
            setNotice('Değişiklik kaydedildi.');
            await load();
            return true;
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'İşlem tamamlanamadı.');
            return false;
        } finally { setBusy(false); }
    };
    const saveNotificationTemplate = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!editingNotificationTemplate && systemData?.notificationTemplates.some((item) => item.event_key === selectedNotificationTemplate.event_key)) {
            setError('Bu olay için bir bildirim kuralı zaten var. Mevcut kuralı düzenleyin.');
            return;
        }
        const saved = await request('/api/admin/system/notification-rules', 'POST', {
            eventKey: selectedNotificationTemplate.event_key,
            title: selectedNotificationTemplate.title,
            message: selectedNotificationTemplate.message,
            category: selectedNotificationTemplate.category,
            severity: selectedNotificationTemplate.severity,
            active: selectedNotificationTemplate.active,
        });
        if (saved) {
            const configured = new Set((systemData?.notificationTemplates ?? []).map((item) => item.event_key));
            configured.add(selectedNotificationTemplate.event_key);
            const nextEvent = NOTIFICATION_EVENT_OPTIONS.find((item) => !configured.has(item.key));
            if (nextEvent) setNotificationTemplate(notificationTemplateFor(nextEvent.key));
            setEditingNotificationTemplate(false);
        }
    };
    const startNewNotificationTemplate = () => {
        const configured = new Set((systemData?.notificationTemplates ?? []).map((item) => item.event_key));
        const nextEvent = NOTIFICATION_EVENT_OPTIONS.find((item) => !configured.has(item.key));
        if (!nextEvent) {
            setNotice('Uygulamadaki tüm otomatik olayların bildirim şablonu zaten tanımlı. Yeni otomatik olay eklemek için önce olayın uygulama tarafında oluşturulması gerekir.');
            return;
        }
        setNotificationTemplate(notificationTemplateFor(nextEvent.key));
        setEditingNotificationTemplate(false);
        setNotice('');
    };
    const saveAnnouncement = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const toIso = (date: string, time: string) => {
            if (!date && !time) return null;
            if (!date || !time) throw new Error('Tarih ve saat alanlarını birlikte doldurun.');
            const parsed = new Date(`${date}T${time}`);
            if (!Number.isFinite(parsed.getTime())) throw new Error('Geçerli bir tarih ve saat girin.');
            return parsed.toISOString();
        };
        let startsAt: string | null;
        let endsAt: string | null;
        try {
            startsAt = toIso(announcement.startsAtDate, announcement.startsAtTime);
            endsAt = toIso(announcement.endsAtDate, announcement.endsAtTime);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'Duyuru tarih ve saatini kontrol edin.');
            return;
        }
        const body = {
            title: announcement.title, message: announcement.message,
            category: announcement.category, severity: announcement.severity,
            audienceRole: announcement.audienceRole, startsAt, endsAt, active: announcement.active,
        };
        const saved = editingAnnouncementId
            ? await request('/api/admin/system', 'PATCH', { id: editingAnnouncementId, ...body })
            : await request('/api/admin/system', 'POST', body);
        if (saved) {
            setAnnouncement({
                title: '', message: '', category: 'announcement', severity: 'info', audienceRole: 'all', active: true,
                startsAtDate: '', startsAtTime: '', endsAtDate: '', endsAtTime: '',
            });
            setEditingAnnouncementId('');
        }
    };
    const editAnnouncement = (item: Announcement) => {
        const localParts = (value: string | null) => {
            if (!value) return { date: '', time: '' };
            const date = new Date(value);
            const pad = (part: number) => String(part).padStart(2, '0');
            return {
                date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
                time: `${pad(date.getHours())}:${pad(date.getMinutes())}`,
            };
        };
        const starts = localParts(item.starts_at);
        const ends = localParts(item.ends_at);
        setAnnouncement({
            title: item.title, message: item.message, category: item.category,
            severity: item.severity, audienceRole: item.audience_role, active: item.active,
            startsAtDate: starts.date, startsAtTime: starts.time,
            endsAtDate: ends.date, endsAtTime: ends.time,
        });
        setEditingAnnouncementId(item.id);
    };
    const loadAnnouncementReaders = async (item: Announcement) => {
        setReaderAnnouncement(item);
        setAnnouncementReaders(null);
        setReaderFilter('all');
        setReadersLoading(true);
        try {
            const response = await fetch(`/api/admin/system/announcements/${item.id}`, { cache: 'no-store' });
            const payload = await response.json() as ApiPayload<AnnouncementReaders>;
            if (!response.ok || !payload.data) throw new Error(payload.error ?? 'Okunma bilgileri alınamadı.');
            setAnnouncementReaders(payload.data);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'Okunma bilgileri alınamadı.');
        } finally {
            setReadersLoading(false);
        }
    };
    const pageTitle = { portfolios: 'Portföyler & Pozisyonlar', orders: 'Emirler & Alarmlar', academy: 'Akademi İçerik Yönetimi', system: 'Sistem & Ayarlar' }[section];
    const PageIcon = { portfolios: Boxes, orders: Activity, academy: BookOpen, system: Bell }[section];
    const availableNotificationEvents = NOTIFICATION_EVENT_OPTIONS.filter((item) =>
        !systemData?.notificationTemplates.some((template) => template.event_key === item.key));
    const selectedNotificationTemplate = editingNotificationTemplate || availableNotificationEvents.some((item) => item.key === notificationTemplate.event_key)
        ? notificationTemplate
        : notificationTemplateFor(availableNotificationEvents[0]?.key ?? notificationTemplate.event_key);
    const visiblePositions = sortRows(
        (portfolioData?.positions ?? [])
            .filter((row) => `${row.symbol} ${row.displayName} ${row.email}`.toLocaleLowerCase('tr-TR').includes(query.toLocaleLowerCase('tr-TR')))
            .map((row) => ({ ...row, marketValue: Number(row.quantity) * Number(row.current_price) })),
        positionSort,
    );
    const sortedPortfolios = sortRows(portfolioData?.portfolios ?? [], portfolioSort);
    const titleHeader = <header className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-800 pb-5">
        <div><span className="text-[10px] font-bold tracking-[.2em] text-emerald-400">TRADE ENGINE / ADMINISTRATION</span><h1 className="mt-1 flex items-center gap-3 text-3xl font-extrabold text-white"><PageIcon className="h-7 w-7 text-emerald-400" />{pageTitle}</h1><p className="mt-2 text-sm text-slate-400">Kontrol merkezi verileri ve yönetim işlemleri.</p></div>
        <button onClick={() => void load()} disabled={loading} className={secondaryButton}><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Yenile</button>
    </header>;

    const saveLesson = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        let questions: AcademyQuizQuestion[];
        try {
            const value: unknown = JSON.parse(quizText);
            if (!Array.isArray(value)) throw new Error();
            questions = value as AcademyQuizQuestion[];
        } catch { setError('Sınav soruları geçerli bir JSON dizisi olmalıdır.'); return; }
        const body = {
            id: editor.id, chapterId: editor.chapter_id, chapterTitle: editor.chapter_title, title: editor.title,
            level: editor.level, duration: editor.duration, summary: editor.summary, concept: editor.concept,
            bistExample: editor.bist_example, application: editor.application, formula: editor.formula,
            pitfalls: editor.pitfalls, checklist: editor.checklist, quizQuestions: questions,
            sortOrder: Number(editor.sort_order), published: editor.published,
        };
        if (!body.id) { setError('Ders ID alanı zorunludur.'); return; }
        const saved = await request('/api/admin/academy', 'POST', body);
        if (saved) setSelectedLesson(body.id);
    };
    const saveMarketCalendarDay = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const saved = await request('/api/admin/market-calendar', 'POST', {
            date: calendarDate,
            isOpen: calendarIsOpen,
            openTime: calendarIsOpen ? calendarOpenTime : null,
            closeTime: calendarIsOpen ? calendarCloseTime : null,
            title: calendarTitle,
            message: calendarMessage,
            notify: calendarNotify,
        });
        if (saved) {
            setCalendarDate('');
            setCalendarMessage('');
        }
    };

    return <main className="min-h-screen min-w-0 bg-slate-950 p-4 text-slate-100 md:p-7">
        <div className="mx-auto max-w-[1600px] space-y-6">
            {titleHeader}

            {section === 'portfolios' && <div className="space-y-5">
                {portfolioData && <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">{[
                    ['Portföy', portfolioData.totals.portfolios.toLocaleString('tr-TR')], ['Açık pozisyon', portfolioData.totals.openPositions.toLocaleString('tr-TR')],
                    ['Pozisyon piyasa değeri', formatMoney(portfolioData.totals.marketValue)], ['Açık kâr/zarar', formatMoney(portfolioData.totals.unrealizedPnl)],
                ].map(([label, value]) => <article key={label} className={panelClass}><span className="text-xs text-slate-400">{label}</span><strong className="mt-2 block truncate text-xl text-white">{value}</strong></article>)}</div>}
                <section className={`${panelClass} min-w-0`}>
                    <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h2 className="font-bold text-white">Tüm açık pozisyonlar</h2><input className={`${inputClass} max-w-sm`} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Hisse veya yatırımcı ara" /></div>
                    <div className="max-h-[560px] overflow-auto rounded-xl border border-slate-800"><table className="w-full min-w-[900px] text-left text-xs"><thead className="text-slate-500"><tr>
                        <SortableHeading label="Yatırımcı" sort={positionSort} sortKey="displayName" onSort={(key) => setPositionSort((current) => ({ key, ascending: current.key === key ? !current.ascending : true }))} />
                        <SortableHeading label="Hisse" sort={positionSort} sortKey="symbol" onSort={(key) => setPositionSort((current) => ({ key, ascending: current.key === key ? !current.ascending : true }))} />
                        <SortableHeading label="Lot" sort={positionSort} sortKey="quantity" onSort={(key) => setPositionSort((current) => ({ key, ascending: current.key === key ? !current.ascending : true }))} />
                        <SortableHeading label="Ort. maliyet" sort={positionSort} sortKey="average_price" onSort={(key) => setPositionSort((current) => ({ key, ascending: current.key === key ? !current.ascending : true }))} />
                        <SortableHeading label="Son fiyat" sort={positionSort} sortKey="current_price" onSort={(key) => setPositionSort((current) => ({ key, ascending: current.key === key ? !current.ascending : true }))} />
                        <SortableHeading label="Piyasa değeri" sort={positionSort} sortKey="marketValue" onSort={(key) => setPositionSort((current) => ({ key, ascending: current.key === key ? !current.ascending : true }))} />
                        <SortableHeading label="Açık P/L" sort={positionSort} sortKey="pnl" onSort={(key) => setPositionSort((current) => ({ key, ascending: current.key === key ? !current.ascending : true }))} />
                        <th className="sticky top-0 z-10 whitespace-nowrap border-b border-slate-800 bg-slate-900 px-3 py-3 font-semibold">Müdahale</th>
                    </tr></thead>
                        <tbody>{visiblePositions.map((row) => <tr key={row.id} className="border-b border-slate-800/70"><td className="max-w-48 truncate px-3 py-3"><strong className="block text-slate-200">{row.displayName}</strong><span className="block truncate text-[10px] text-slate-500">{row.email || row.role.replace('_', ' ')}</span></td><td className="px-3 py-3 font-bold text-white"><StockSymbolLink symbol={row.symbol} /></td><td className="px-3 py-3">{row.quantity}</td><td className="px-3 py-3">{formatMoney(row.average_price)}</td><td className="px-3 py-3">{formatMoney(row.current_price)}</td><td className="px-3 py-3">{formatMoney(row.quantity * row.current_price)}</td><td className={`px-3 py-3 font-semibold ${Number(row.pnl) >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>{formatMoney(row.pnl)}</td><td className="px-3 py-2"><div className="flex items-center gap-2"><button title="Miktar ve maliyeti düzenle" className="rounded-lg border border-slate-700 p-2 text-slate-300 hover:text-emerald-300" onClick={async () => {
                            const quantity = await promptDialog({ title: 'Pozisyon miktarını düzenle', message: `${row.symbol} için yeni lot miktarını girin.`, label: 'Yeni lot miktarı', defaultValue: String(row.quantity), confirmLabel: 'Devam et' });
                            if (quantity === null) return;
                            const averagePrice = await promptDialog({ title: 'Ortalama maliyeti düzenle', message: `${row.symbol} pozisyonunun ortalama maliyetini girin.`, label: 'Yeni ortalama maliyet', defaultValue: String(row.average_price), confirmLabel: 'Kaydet' });
                            if (averagePrice !== null) void request('/api/admin/portfolios', 'PATCH', { positionId: row.id, action: 'update', quantity, averagePrice });
                        }}><Pencil className="h-3.5 w-3.5" /></button><button title="Pozisyonu sil" className="rounded-lg border border-rose-500/20 p-2 text-rose-300 hover:bg-rose-500/10" onClick={async () => {
                            if (await confirmDialog({ title: `${row.symbol} pozisyonu silinsin mi?`, message: 'Bu işlem pozisyonu kaldırır ancak geçmiş işlem kayıtlarını değiştirmez.', confirmLabel: 'Pozisyonu sil', danger: true })) {
                                void request('/api/admin/portfolios', 'PATCH', { positionId: row.id, action: 'delete' });
                            }
                        }}><Trash2 className="h-3.5 w-3.5" /></button></div></td></tr>)}</tbody>
                    </table>{loading && !portfolioData && <p className="p-6 text-center text-sm text-slate-500">Veriler yükleniyor...</p>}{portfolioData && !portfolioData.positions.length && <p className="p-6 text-center text-sm text-slate-500">Açık pozisyon bulunmuyor.</p>}</div>
                </section>
                <section className={`${panelClass} min-w-0`}><h2 className="mb-4 font-bold text-white">Portföy nakit bakiyeleri</h2><div className="max-h-[440px] overflow-auto rounded-xl border border-slate-800"><table className="w-full min-w-[500px] text-left text-xs"><thead className="text-slate-500"><tr>
                    <SortableHeading label="Yatırımcı" sort={portfolioSort} sortKey="displayName" onSort={(key) => setPortfolioSort((current) => ({ key, ascending: current.key === key ? !current.ascending : true }))} />
                    <SortableHeading label="Rol" sort={portfolioSort} sortKey="role" onSort={(key) => setPortfolioSort((current) => ({ key, ascending: current.key === key ? !current.ascending : true }))} />
                    <SortableHeading label="Nakit bakiye" sort={portfolioSort} sortKey="cashBalance" onSort={(key) => setPortfolioSort((current) => ({ key, ascending: current.key === key ? !current.ascending : true }))} />
                </tr></thead><tbody>{sortedPortfolios.map((item) => <tr key={item.id} className="border-b border-slate-800/70"><td className="px-3 py-3 text-slate-200"><span className="block">{item.displayName}</span><span className="text-[10px] text-slate-500">{item.email}</span></td><td className="px-3 py-3 text-slate-400">{item.role.replace('_', ' ')}</td><td className="px-3 py-3 font-semibold text-white">{formatMoney(item.cashBalance)}</td></tr>)}</tbody></table></div></section>
            </div>}

            {section === 'orders' && <section className={`${panelClass} min-w-0`}>
                <div className="mb-5 flex flex-wrap gap-2">{[['orders', 'Emirler'], ['alerts', 'Fiyat alarmları'], ['transactions', 'İşlem geçmişi'], ['events', 'Alarm olayları']].map(([key, label]) => <button key={key} onClick={() => setActiveTab(key)} className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${activeTab === key ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300' : 'border-slate-700 bg-slate-800 text-slate-400'}`}>{label}</button>)}</div>
                <div className="overflow-x-auto">
                    {activeTab === 'orders' && <table className="w-full min-w-[850px] text-left text-xs"><thead><tr className="text-slate-500">{['Kullanıcı', 'Hisse', 'Yön / tür', 'Lot', 'Tetik fiyatı', 'Durum / neden', 'Tarih', 'İşlem'].map((x) => <th key={x} className="border-b border-slate-800 px-3 py-3">{x}</th>)}</tr></thead><tbody>{(orderData?.orders ?? []).map((item) => <tr key={item.id} className="border-b border-slate-800/70"><td className="px-3 py-3">{item.display_name}</td><td className="font-bold text-white">{item.symbol}</td><td>{item.side} · {item.order_type}</td><td>{item.quantity}</td><td>{item.trigger_price ? formatMoney(item.trigger_price) : '—'}</td><td><StatusBadge status={item.status} />{item.error && <small className="mt-1 block max-w-56 text-amber-300">{item.error}</small>}</td><td>{formatDate(item.created_at)}</td><td>{item.status === 'pending' && <div className="flex gap-1"><button className="rounded-lg border border-rose-500/20 px-2 py-1 text-rose-300" onClick={() => void request('/api/admin/orders', 'PATCH', { kind: 'order', id: item.id, status: 'cancelled', reason: 'Yönetici iptali' })}>İptal</button><button className="rounded-lg border border-amber-500/20 px-2 py-1 text-amber-300" onClick={() => void request('/api/admin/orders', 'PATCH', { kind: 'order', id: item.id, status: 'failed', reason: 'Yönetici hatalı emir işaretlemesi' })}>Hatalı</button></div>}</td></tr>)}</tbody></table>}
                    {activeTab === 'alerts' && <table className="w-full min-w-[750px] text-left text-xs"><thead><tr className="text-slate-500">{['Kullanıcı', 'Hisse', 'Koşul', 'Hedef fiyat', 'Durum', 'Tetiklenme', 'İşlem'].map((x) => <th key={x} className="border-b border-slate-800 px-3 py-3">{x}</th>)}</tr></thead><tbody>{(orderData?.alerts ?? []).map((item) => <tr key={item.id} className="border-b border-slate-800/70"><td className="px-3 py-3">{item.display_name}</td><td className="font-bold text-white">{item.symbol}</td><td>{item.direction}</td><td>{formatMoney(item.target_price)}</td><td><StatusBadge status={item.status} /></td><td>{item.triggered_at ? formatDate(item.triggered_at) : '—'}</td><td>{item.status === 'active' && <button className="rounded-lg border border-rose-500/20 px-2 py-1 text-rose-300" onClick={() => void request('/api/admin/orders', 'PATCH', { kind: 'alert', id: item.id, status: 'cancelled' })}>Durdur</button>}</td></tr>)}</tbody></table>}
                    {activeTab === 'transactions' && <table className="w-full min-w-[750px] text-left text-xs"><thead><tr className="text-slate-500">{['Kullanıcı', 'Hisse', 'İşlem', 'Lot', 'Fiyat', 'Gerçekleşen P/L', 'Tarih'].map((x) => <th key={x} className="border-b border-slate-800 px-3 py-3">{x}</th>)}</tr></thead><tbody>{(orderData?.transactions ?? []).map((item) => <tr key={item.id} className="border-b border-slate-800/70"><td className="px-3 py-3">{item.display_name}</td><td className="font-bold text-white">{item.symbol ?? '—'}</td><td>{item.transaction_type}</td><td>{item.quantity}</td><td>{formatMoney(item.price)}</td><td className={Number(item.realized_pnl) >= 0 ? 'text-emerald-300' : 'text-rose-300'}>{formatMoney(item.realized_pnl)}</td><td>{formatDate(item.created_at)}</td></tr>)}</tbody></table>}
                    {activeTab === 'events' && <table className="w-full min-w-[550px] text-left text-xs"><thead><tr className="text-slate-500">{['Hisse', 'Olay', 'Piyasa fiyatı', 'Tarih'].map((x) => <th key={x} className="border-b border-slate-800 px-3 py-3">{x}</th>)}</tr></thead><tbody>{(orderData?.alertEvents ?? []).map((item) => <tr key={item.id} className="border-b border-slate-800/70"><td className="px-3 py-3 font-bold text-white">{item.symbol}</td><td>{item.event_type}</td><td>{formatMoney(item.market_price)}</td><td>{formatDate(item.created_at)}</td></tr>)}</tbody></table>}
                    {loading && !orderData && <p className="p-6 text-center text-sm text-slate-500">Kayıtlar yükleniyor...</p>}
                </div>
                <p className="mt-4 flex items-start gap-2 text-[11px] text-slate-500"><CircleAlert className="h-4 w-4 shrink-0 text-amber-400" />Admin paneli emirleri gerçekleşmiş olarak işaretlemez; gerçekleşme yalnızca portföy işlem akışından yürütülür.</p>
            </section>}

            {section === 'academy' && <div className="grid grid-cols-1 gap-5 2xl:grid-cols-[320px_minmax(0,1fr)]">
                <section className={`${panelClass} min-w-0`}><div className="mb-4 flex items-center justify-between"><h2 className="font-bold text-white">Ders kataloğu</h2><button className={secondaryButton} onClick={() => { setSelectedLesson(''); setEditor(blankLesson()); setQuizText('[]'); }}><Plus className="h-4 w-4" />Yeni ders</button></div><div className="max-h-[75vh] space-y-2 overflow-y-auto">{lessons.slice().sort((a, b) => a.sort_order - b.sort_order).map((lesson) => <button key={lesson.id} onClick={() => { setSelectedLesson(lesson.id); setEditor({ ...lesson }); setQuizText(JSON.stringify(lesson.quiz_questions ?? [], null, 2)); }} className={`w-full rounded-xl border p-3 text-left ${selectedLesson === lesson.id ? 'border-emerald-500/30 bg-emerald-500/10' : 'border-slate-800 bg-slate-950/50'}`}><span className="flex items-center justify-between gap-2"><strong className="truncate text-xs text-white">{lesson.title}</strong><StatusBadge status={lesson.published ? 'published' : 'hidden'} /></span><span className="mt-1 block text-[10px] text-slate-500">{lesson.id} · sıra {lesson.sort_order}</span></button>)}</div></section>
                <form onSubmit={saveLesson} className={`${panelClass} min-w-0 space-y-4`}>
                    <div className="flex flex-wrap items-start justify-between gap-3"><div><span className="text-[10px] font-bold tracking-widest text-emerald-400">LESSON BUILDER</span><h2 className="mt-1 text-lg font-bold text-white">{selectedLesson ? 'Dersi düzenle' : 'Yeni ders oluştur'}</h2></div>{selectedLesson && <button type="button" className="inline-flex items-center gap-2 rounded-lg border border-rose-500/20 px-3 py-2 text-xs font-bold text-rose-300" onClick={async () => { const existing = lessons.find((lesson) => lesson.id === selectedLesson); if (!existing) return; if (!await confirmDialog({ title: 'Ders kaldırılıp gizlensin mi?', message: `“${existing.title}” yayından kaldırılacak.`, confirmLabel: 'Dersi kaldır', danger: true })) return; void request(`/api/admin/academy?id=${encodeURIComponent(existing.id)}`, 'DELETE'); }}><Trash2 className="h-4 w-4" />Dersi kaldır</button>}</div>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                        <Field label="Ders ID"><input required pattern="[a-z0-9]+(-[a-z0-9]+)*" disabled={Boolean(selectedLesson)} className={inputClass} value={editor.id} onChange={(e) => setEditor({ ...editor, id: e.target.value })} placeholder="lesson-1-1" /></Field>
                        <Field label="Ders başlığı"><input required className={inputClass} value={editor.title} onChange={(e) => setEditor({ ...editor, title: e.target.value })} /></Field>
                        <Field label="Bölüm"><input required className={inputClass} value={editor.chapter_title} onChange={(e) => setEditor({ ...editor, chapter_title: e.target.value })} /></Field>
                        <Field label="Bölüm ID"><input required className={inputClass} value={editor.chapter_id} onChange={(e) => setEditor({ ...editor, chapter_id: e.target.value })} /></Field>
                        <Field label="Seviye"><select className={inputClass} value={editor.level} onChange={(e) => setEditor({ ...editor, level: e.target.value as AcademyLevel })}><option>Başlangıç</option><option>Orta</option><option>İleri</option></select></Field>
                        <Field label="Süre"><input className={inputClass} value={editor.duration} onChange={(e) => setEditor({ ...editor, duration: e.target.value })} /></Field>
                        <Field label="Sıra numarası"><input type="number" className={inputClass} value={editor.sort_order} onChange={(e) => setEditor({ ...editor, sort_order: Number(e.target.value) })} /></Field>
                        <Field label="Yayın durumu"><select className={inputClass} value={String(editor.published)} onChange={(e) => setEditor({ ...editor, published: e.target.value === 'true' })}><option value="true">Yayında</option><option value="false">Taslak / gizli</option></select></Field>
                        <Field label="Kısa özet"><textarea className={inputClass} rows={2} value={editor.summary} onChange={(e) => setEditor({ ...editor, summary: e.target.value })} /></Field>
                        <Field label="Kavramsal açıklama"><textarea className={inputClass} rows={4} value={editor.concept} onChange={(e) => setEditor({ ...editor, concept: e.target.value })} /></Field>
                        <Field label="BİST örneği"><textarea className={inputClass} rows={4} value={editor.bist_example} onChange={(e) => setEditor({ ...editor, bist_example: e.target.value })} /></Field>
                        <Field label="Piyasa uygulaması"><textarea className={inputClass} rows={4} value={editor.application} onChange={(e) => setEditor({ ...editor, application: e.target.value })} /></Field>
                        <Field label="Formül"><textarea className={inputClass} rows={3} value={editor.formula} onChange={(e) => setEditor({ ...editor, formula: e.target.value })} /></Field>
                        <Field label="Tuzaklar (her satır bir madde)"><textarea className={inputClass} rows={4} value={editor.pitfalls.join('\n')} onChange={(e) => setEditor({ ...editor, pitfalls: e.target.value.split('\n').slice(0, 30) })} /></Field>
                        <Field label="Kontrol listesi (her satır bir madde)"><textarea className={inputClass} rows={4} value={editor.checklist.join('\n')} onChange={(e) => setEditor({ ...editor, checklist: e.target.value.split('\n').slice(0, 30) })} /></Field>
                        <Field label="Sınav soruları (JSON dizi)"><textarea className={`${inputClass} font-mono text-xs`} rows={8} value={quizText} onChange={(e) => setQuizText(e.target.value)} placeholder='[{"question":"...","options":["..."],"answer":0}]' /></Field>
                    </div>
                    <button disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2.5 text-xs font-bold text-white shadow-lg shadow-emerald-900/20 transition hover:bg-emerald-500 disabled:opacity-50"><Save className="h-4 w-4" />{busy ? 'Kaydediliyor…' : 'Dersi kaydet'}</button>
                </form>
            </div>}

            {section === 'system' && <div className="space-y-5">
                {systemData && <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">{[
                    ['Veritabanı', systemData.status.database === 'connected' ? 'Bağlı' : 'Kontrol gerekli', systemData.status.database === 'connected'],
                    ['Cron izleyici', systemData.status.orderMonitorJob?.active ? 'Aktif' : 'Çalışmıyor', Boolean(systemData.status.orderMonitorJob?.active)],
                    ['Vault token', systemData.status.vaultTokenConfigured ? 'Tanımlı' : 'Eksik', systemData.status.vaultTokenConfigured],
                    ['Service role', systemData.status.serviceRoleConfigured ? 'Sunucuda tanımlı' : 'Tanımlı değil', systemData.status.serviceRoleConfigured],
                ].map(([label, value, okay]) => <article key={String(label)} className={panelClass}><div className="flex items-center justify-between text-xs text-slate-400">{label}<span className={`h-2.5 w-2.5 rounded-full ${okay ? 'bg-emerald-400' : 'bg-amber-400'}`} /></div><strong className={`mt-3 block text-lg ${okay ? 'text-emerald-300' : 'text-amber-300'}`}>{value}</strong></article>)}</div>}
                <section className={`${panelClass} space-y-4`}>
                    <div>
                        <h2 className="font-bold text-white">BİST seans ve tatil takvimi</h2>
                        <p className="mt-1 text-xs text-slate-500">Varsayılan sürekli işlem seansı hafta içi Türkiye saatiyle 10:00–18:00’dır. Resmî tatil, yarım gün ve özel seansları buradan tanımlayın.</p>
                    </div>
                    <form onSubmit={saveMarketCalendarDay} className="grid grid-cols-1 gap-3 rounded-xl border border-slate-800 bg-slate-950/60 p-4 md:grid-cols-2 xl:grid-cols-6">
                        <Field label="Tarih"><input required type="date" className={inputClass} value={calendarDate} onChange={(event) => setCalendarDate(event.target.value)} /></Field>
                        <Field label="İşlem durumu"><select className={inputClass} value={String(calendarIsOpen)} onChange={(event) => setCalendarIsOpen(event.target.value === 'true')}><option value="false">Kapalı / tatil</option><option value="true">Özel seans açık</option></select></Field>
                        {calendarIsOpen && <>
                            <Field label="Açılış saati"><input required type="time" className={inputClass} value={calendarOpenTime} onChange={(event) => setCalendarOpenTime(event.target.value)} /></Field>
                            <Field label="Kapanış saati"><input required type="time" className={inputClass} value={calendarCloseTime} onChange={(event) => setCalendarCloseTime(event.target.value)} /></Field>
                        </>}
                        <Field label="Duyuru başlığı"><input maxLength={120} className={inputClass} value={calendarTitle} onChange={(event) => setCalendarTitle(event.target.value)} placeholder="Örn. Yarım gün seansı" /></Field>
                        <Field label="Duyuru metni"><input required={calendarNotify} maxLength={500} className={inputClass} value={calendarMessage} onChange={(event) => setCalendarMessage(event.target.value)} placeholder="Kullanıcılara iletilecek bilgi" /></Field>
                        <label className="flex items-center gap-2 self-end rounded-lg border border-slate-800 bg-slate-900 px-3 py-2.5 text-xs text-slate-300 md:col-span-2 xl:col-span-3">
                            <input type="checkbox" checked={calendarNotify} onChange={(event) => setCalendarNotify(event.target.checked)} className="accent-emerald-500" />
                            Kaydedince tüm kullanıcılara piyasa bildirimi gönder
                        </label>
                        <button disabled={busy} className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-50"><Save className="h-4 w-4" />Seans istisnasını kaydet</button>
                    </form>
                    <div className="max-h-72 space-y-2 overflow-y-auto">
                        {marketCalendar.map((day) => <article key={day.trading_date} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                            <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2"><strong className="text-sm text-white">{day.trading_date}</strong><StatusBadge status={day.is_open ? 'active' : 'inactive'} /><span className="text-xs text-slate-400">{day.is_open ? `${day.open_time?.slice(0, 5)}–${day.close_time?.slice(0, 5)} Türkiye saati` : 'İşleme kapalı'}</span>{day.notification_sent && <span className="text-[10px] text-emerald-400">Bildirim gönderildi</span>}</div>
                                <p className="mt-1 text-xs font-semibold text-slate-300">{day.title}</p>
                                {day.message && <p className="mt-1 break-words text-xs text-slate-500">{day.message}</p>}
                            </div>
                            <button type="button" disabled={busy} className="rounded-lg border border-rose-500/20 p-2 text-rose-300 hover:bg-rose-500/10 disabled:opacity-50" aria-label={`${day.trading_date} seans istisnasını sil`} onClick={async () => { if (await confirmDialog({ title: 'Seans istisnası silinsin mi?', message: `${day.trading_date} tarihli özel seans/tatil kaydı kaldırılacak.`, confirmLabel: 'Kaydı sil', danger: true })) void request(`/api/admin/market-calendar?date=${encodeURIComponent(day.trading_date)}`, 'DELETE'); }}><Trash2 className="h-4 w-4" /></button>
                        </article>)}
                        {!marketCalendar.length && <p className="text-xs text-slate-500">Özel tatil veya seans kaydı yok. Hafta sonları otomatik kapalı, diğer hafta içleri 10:00–18:00 açıktır.</p>}
                    </div>
                </section>
                {systemData && <section className={`${panelClass} space-y-3`}><h2 className="font-bold text-white">İzleyici ayrıntıları</h2><div className="grid grid-cols-1 gap-3 text-xs md:grid-cols-3"><div className="rounded-xl border border-slate-800 bg-slate-950 p-3"><span className="text-slate-500">Cron zamanlaması</span><strong className="mt-1 block text-slate-200">{systemData.status.orderMonitorJob?.schedule ?? 'portfolio-order-monitor-every-minute bulunamadı'}</strong></div><div className="rounded-xl border border-slate-800 bg-slate-950 p-3"><span className="text-slate-500">Son çalışma</span><strong className="mt-1 block text-slate-200">{systemData.status.lastOrderMonitorRun?.end_time ? formatDate(systemData.status.lastOrderMonitorRun.end_time) : 'Kayıt yok'}</strong></div><div className="rounded-xl border border-slate-800 bg-slate-950 p-3"><span className="text-slate-500">Son durum</span><strong className="mt-1 block text-slate-200">{systemData.status.lastOrderMonitorRun?.status ?? systemData.status.lastOrderMonitorRun?.error ?? 'Bilinmiyor'}</strong></div></div><p className="text-[11px] text-slate-500">Gizli anahtar değerleri gösterilmez; yalnızca varlık durumları raporlanır. Gerçek hesap dondurma/silme için Service Role key gerekir.</p></section>}
                <div className="grid grid-cols-1 gap-5 2xl:grid-cols-2">
                    <section role={editingAnnouncementId ? 'dialog' : undefined} aria-modal={editingAnnouncementId ? true : undefined} aria-labelledby="announcement-form-title" className={`${panelClass} min-w-0 space-y-4 ${editingAnnouncementId ? 'isolate fixed inset-2 z-[115] mx-auto max-h-[96dvh] w-[calc(100%-1rem)] max-w-6xl overflow-y-auto border-2 border-emerald-500/30 before:fixed before:inset-0 before:-z-10 before:bg-slate-950/80 before:content-[\'\'] shadow-2xl sm:inset-6 sm:w-[calc(100%-3rem)]' : ''}`}>
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <div><h2 id="announcement-form-title" className="font-bold text-white">{editingAnnouncementId ? 'Duyuruyu düzenle' : 'Bildirim / duyuru oluştur'}</h2><p className="mt-1 text-xs text-slate-500">Alıcılar için bildirim oluşturulur ve okundu bilgisi saklanır.</p></div>
                            {editingAnnouncementId && <button type="button" className={secondaryButton} onClick={() => { setEditingAnnouncementId(''); setAnnouncement({ title: '', message: '', category: 'announcement', severity: 'info', audienceRole: 'all', active: true, startsAtDate: '', startsAtTime: '', endsAtDate: '', endsAtTime: '' }); }}>Kapat / vazgeç</button>}
                        </div>
                        <form className="space-y-3 rounded-xl border border-slate-800 bg-slate-950/60 p-4" onSubmit={saveAnnouncement}>
                            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                                <Field label="Başlık"><input required maxLength={120} className={inputClass} placeholder="Bildirim başlığı" value={announcement.title} onChange={(e) => setAnnouncement((previous) => ({ ...previous, title: e.target.value }))} /></Field>
                                <Field label="Kitle"><select className={inputClass} value={announcement.audienceRole} onChange={(e) => setAnnouncement((previous) => ({ ...previous, audienceRole: e.target.value }))}><option value="all">Tüm kullanıcılar</option><option value="user">Standart kullanıcılar</option><option value="pro_trader">Pro Trader</option><option value="analyst">Analistler</option><option value="admin">Yöneticiler</option><option value="super_admin">Super Admin</option></select></Field>
                                <Field label="Kategori"><select className={inputClass} value={announcement.category} onChange={(e) => setAnnouncement((previous) => ({ ...previous, category: e.target.value }))}><option value="announcement">Duyuru</option><option value="market">Piyasa</option><option value="portfolio">Portföy</option><option value="academy">Akademi</option><option value="system">Sistem</option></select></Field>
                                <Field label="Önem seviyesi"><select className={inputClass} value={announcement.severity} onChange={(e) => setAnnouncement((previous) => ({ ...previous, severity: e.target.value }))}><option value="info">Bilgi</option><option value="success">Başarılı</option><option value="warning">Uyarı</option><option value="critical">Kritik</option></select></Field>
                            </div>
                            <Field label="Mesaj"><textarea required maxLength={500} rows={3} className={inputClass} placeholder="Kullanıcılara gösterilecek mesaj" value={announcement.message} onChange={(e) => setAnnouncement((previous) => ({ ...previous, message: e.target.value }))} /></Field>
                            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                                <Field label="Başlangıç tarihi"><div className="grid grid-cols-2 gap-2"><input aria-label="Yayın başlangıç tarihi" type="date" className={inputClass} value={announcement.startsAtDate} onChange={(e) => setAnnouncement((previous) => ({ ...previous, startsAtDate: e.target.value }))} /><input aria-label="Yayın başlangıç saati" type="time" className={inputClass} value={announcement.startsAtTime} onChange={(e) => setAnnouncement((previous) => ({ ...previous, startsAtTime: e.target.value }))} /></div></Field>
                                <Field label="Bitiş tarihi (isteğe bağlı)"><div className="grid grid-cols-2 gap-2"><input aria-label="Yayın bitiş tarihi" type="date" className={inputClass} value={announcement.endsAtDate} onChange={(e) => setAnnouncement((previous) => ({ ...previous, endsAtDate: e.target.value }))} /><input aria-label="Yayın bitiş saati" type="time" className={inputClass} value={announcement.endsAtTime} onChange={(e) => setAnnouncement((previous) => ({ ...previous, endsAtTime: e.target.value }))} /></div></Field>
                            </div>
                            <button disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-50"><Plus className="h-4 w-4" />{busy ? 'Kaydediliyor…' : editingAnnouncementId ? 'Değişiklikleri kaydet' : 'Yayınla'}</button>
                        </form>
                        <div className="max-h-[430px] space-y-2 overflow-y-auto border-t border-slate-800 pt-4">
                            {(systemData?.announcements ?? []).slice(0, announcementLimit).map((item) => <article key={item.id} className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                    <button type="button" className="min-w-0 flex-1 text-left" onClick={() => void loadAnnouncementReaders(item)}>
                                        <span className="flex flex-wrap items-center gap-2"><strong className="text-sm text-white">{item.title}</strong><StatusBadge status={item.category} /><StatusBadge status={item.severity} /><StatusBadge status={item.active ? 'active' : 'inactive'} /></span>
                                        <span className="mt-1 block line-clamp-2 break-words text-xs text-slate-400">{item.message}</span>
                                        <span className="mt-1 block text-[10px] text-slate-500">Kitle: {item.audience_role === 'all' ? 'Tüm kullanıcılar' : item.audience_role.replaceAll('_', ' ')} · {formatDate(item.starts_at)}</span>
                                    </button>
                                    <div className="flex shrink-0 gap-1">
                                        <button title="Okuyanları görüntüle" className="rounded-lg border border-slate-700 p-2 text-slate-300 hover:text-emerald-300" onClick={() => void loadAnnouncementReaders(item)}><UsersIcon className="h-4 w-4" /></button>
                                        <button title="Düzenle" className="rounded-lg border border-slate-700 p-2 text-slate-300 hover:text-emerald-300" onClick={() => editAnnouncement(item)}><Pencil className="h-4 w-4" /></button>
                                        <button title={item.active ? 'Durdur' : 'Yayınla'} className={secondaryButton} onClick={() => void request('/api/admin/system', 'PATCH', { id: item.id, active: !item.active })}>{item.active ? 'Durdur' : 'Yayınla'}</button>
                                        <button aria-label="Duyuruyu sil" className="rounded-lg border border-rose-500/20 p-2 text-rose-300" onClick={async () => { if (await confirmDialog({ title: 'Duyuru silinsin mi?', message: 'Duyuru ve alıcı bildirimleri kalıcı olarak silinecek.', confirmLabel: 'Duyuruyu sil', danger: true })) void request(`/api/admin/system?id=${item.id}`, 'DELETE'); }}><Trash2 className="h-4 w-4" /></button>
                                    </div>
                                </div>
                            </article>)}
                            {(systemData?.announcements.length ?? 0) > 5 && <button type="button" onClick={() => setAnnouncementLimit((current) => current >= (systemData?.announcements.length ?? 0) ? 5 : (systemData?.announcements.length ?? 0))} className={`${secondaryButton} w-full`}>
                                {announcementLimit >= (systemData?.announcements.length ?? 0) ? 'Daha az göster' : `Daha fazla göster (${(systemData?.announcements.length ?? 0) - announcementLimit} duyuru daha)`}
                            </button>}
                        </div>
                    </section>
                    <section className={`${panelClass} min-w-0`}><h2 className="mb-4 flex items-center gap-2 font-bold text-white"><Clock3 className="h-4 w-4 text-emerald-400" />Global audit akışı</h2><div className="max-h-[620px] space-y-2 overflow-y-auto">{systemData?.audit.map((item) => <article key={item.id} className="rounded-xl border border-slate-800 bg-slate-950/60 p-3"><div className="flex flex-wrap items-center justify-between gap-2"><div className="min-w-0"><strong className="block truncate text-xs text-slate-200">{item.display_name || 'Kullanıcı'}</strong><span className="block truncate text-[10px] text-slate-500">{item.user_email || item.user_id}</span>{item.actor_name && <span className="mt-0.5 block truncate text-[10px] text-emerald-400">İşlemi yapan: {item.actor_name}</span>}</div><div className="flex shrink-0 items-center gap-2"><StatusBadge status={item.event_type} /><time className="text-[10px] text-slate-600">{formatDate(item.created_at)}</time></div></div><p className="mt-2 text-xs text-slate-300">{item.description}</p></article>)}</div></section>
                </div>
                <section className={`${panelClass} space-y-4`}>
                    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="flex items-center gap-2 font-bold text-white"><Bell className="h-4 w-4 text-emerald-400" />Otomatik bildirim kuralları</h2><p className="mt-1 text-xs text-slate-500">Kayıt, emir, alış/satış, ders tamamlama ve fiyat alarmı olaylarında gönderilen kullanıcı bildirimlerini yönetin. Mevcut olay şablonlarını aşağıdaki kalemlerden düzenleyin; buton yalnızca eksik uygulama olaylarının şablonunu oluşturur.</p></div><button type="button" onClick={startNewNotificationTemplate} disabled={loading || !systemData} title="Uygulamada tanımlı olup şablonu eksik olan bir olay ekler; yeni otomatik olaylar önce uygulama koduna eklenmelidir." className={secondaryButton}><Plus className="h-4 w-4" />Eksik olay şablonu ekle</button></div>
                    <form onSubmit={saveNotificationTemplate} className="grid grid-cols-1 gap-3 rounded-xl border border-slate-800 bg-slate-950/60 p-4 lg:grid-cols-6">
                        <Field label="Olay"><select className={inputClass} value={editingNotificationTemplate ? selectedNotificationTemplate.event_key : availableNotificationEvents.length ? selectedNotificationTemplate.event_key : ''} disabled={editingNotificationTemplate || availableNotificationEvents.length === 0} onChange={(event) => setNotificationTemplate(notificationTemplateFor(event.target.value))}>
                            {editingNotificationTemplate
                                ? NOTIFICATION_EVENT_OPTIONS.filter((item) => item.key === notificationTemplate.event_key).map((item) => <option key={item.key} value={item.key}>{item.label}</option>)
                                : availableNotificationEvents.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
                            {!editingNotificationTemplate && availableNotificationEvents.length === 0 && <option value="">Tüm tanımlı olaylar için kural mevcut</option>}
                        </select></Field>
                        <div className="lg:col-span-2"><Field label="Başlık"><input required maxLength={120} className={inputClass} value={selectedNotificationTemplate.title} onChange={(event) => setNotificationTemplate((current) => ({ ...current, title: event.target.value }))} /></Field></div>
                        <Field label="Kategori"><select className={inputClass} value={selectedNotificationTemplate.category} onChange={(event) => setNotificationTemplate((current) => ({ ...current, category: event.target.value }))}><option value="system">Sistem</option><option value="portfolio">Portföy</option><option value="academy">Akademi</option><option value="market">Piyasa</option><option value="announcement">Duyuru</option></select></Field>
                        <Field label="Önem"><select className={inputClass} value={selectedNotificationTemplate.severity} onChange={(event) => setNotificationTemplate((current) => ({ ...current, severity: event.target.value }))}><option value="info">Bilgi</option><option value="success">Başarılı</option><option value="warning">Uyarı</option><option value="critical">Kritik</option></select></Field>
                        <Field label="Durum"><select className={inputClass} value={String(selectedNotificationTemplate.active)} onChange={(event) => setNotificationTemplate((current) => ({ ...current, active: event.target.value === 'true' }))}><option value="true">Aktif</option><option value="false">Pasif</option></select></Field>
                        <div className="lg:col-span-5"><Field label="Bildirim metni"><textarea required maxLength={500} rows={2} className={inputClass} value={selectedNotificationTemplate.message} onChange={(event) => setNotificationTemplate((current) => ({ ...current, message: event.target.value }))} /><span className="mt-1 block text-[10px] text-slate-500">Şablon alanları: {'{{symbol}}'}, {'{{quantity}}'}, {'{{price}}'}, {'{{lesson_id}}'}, {'{{market_price}}'}, {'{{target_price}}'}, {'{{direction}}'}, {'{{side}}'}, {'{{order_type}}'}, {'{{error}}'}.</span></Field></div>
                        <div className="flex items-end gap-2"><button disabled={busy || (!editingNotificationTemplate && availableNotificationEvents.length === 0)} className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-3 py-2.5 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-50"><Save className="h-4 w-4" />{editingNotificationTemplate ? 'Değişiklikleri kaydet' : 'Olayı oluştur'}</button>{editingNotificationTemplate && <button type="button" className={secondaryButton} onClick={() => { setEditingNotificationTemplate(false); startNewNotificationTemplate(); }}>Yeni olay</button>}</div>
                    </form>
                    <div className="grid gap-2 md:grid-cols-2">
                        {systemData?.notificationTemplates.map((item) => <article key={item.event_key} className="flex min-w-0 items-center gap-3 rounded-xl border border-slate-800 bg-slate-950/50 p-3">
                            <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><strong className="text-xs text-slate-200">{item.title}</strong><StatusBadge status={item.active ? 'active' : 'inactive'} /><StatusBadge status={item.category} /></div><p className="mt-1 line-clamp-2 break-words text-[10px] text-slate-500">{item.message}</p><span className="mt-1 block text-[9px] text-slate-600">{item.event_key}</span></div>
                            <div className="flex shrink-0 gap-1"><button type="button" title="Kuralı düzenle" className="rounded-lg border border-slate-700 p-2 text-slate-300 hover:text-emerald-300" onClick={() => { setNotificationTemplate(item); setEditingNotificationTemplate(true); }}><Pencil className="h-4 w-4" /></button><button type="button" title="Kuralı sil" className="rounded-lg border border-rose-500/20 p-2 text-rose-300 hover:bg-rose-500/10" onClick={async () => { if (await confirmDialog({ title: 'Otomatik bildirim kuralı silinsin mi?', message: 'Bu olay için tanımlı otomatik bildirim kuralı silinecek.', confirmLabel: 'Kuralı sil', danger: true })) void request(`/api/admin/system/notification-rules?eventKey=${encodeURIComponent(item.event_key)}`, 'DELETE'); }}><Trash2 className="h-4 w-4" /></button></div>
                        </article>)}
                        {!systemData?.notificationTemplates.length && !loading && <p className="text-xs text-slate-500">Otomatik bildirim kuralı bulunmuyor. Yeni bir olay kuralı ekleyebilirsiniz.</p>}
                    </div>
                </section>
                {readerAnnouncement && <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/80 p-3 sm:p-6" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setReaderAnnouncement(null); }}>
                    <section role="dialog" aria-modal="true" aria-labelledby="announcement-readers-title" className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl">
                        <header className="flex items-start justify-between gap-3 border-b border-slate-800 p-5"><div><span className="text-[10px] font-bold tracking-widest text-emerald-400">DUYURU OKUNMA DURUMU</span><h2 id="announcement-readers-title" className="mt-1 text-lg font-bold text-white">{readerAnnouncement.title}</h2></div><button type="button" aria-label="Pencereyi kapat" onClick={() => setReaderAnnouncement(null)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white"><X className="h-5 w-5" /></button></header>
                        {announcementReaders && <div className="grid grid-cols-3 gap-2 p-4 text-center text-xs"><div className="rounded-xl border border-slate-800 bg-slate-950 p-3"><span className="text-slate-500">Alıcı</span><strong className="mt-1 block text-white">{announcementReaders.total}</strong></div><div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3"><span className="text-emerald-300">Okudu</span><strong className="mt-1 block text-white">{announcementReaders.readCount}</strong></div><div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-3"><span className="text-amber-300">Okumadı</span><strong className="mt-1 block text-white">{announcementReaders.unreadCount}</strong></div></div>}
                        <div className="flex gap-2 px-4 pb-3">{(['all', 'read', 'unread'] as const).map((filter) => <button type="button" key={filter} onClick={() => setReaderFilter(filter)} className={`rounded-full px-3 py-1.5 text-xs font-semibold ${readerFilter === filter ? 'bg-emerald-500/10 text-emerald-300' : 'bg-slate-800 text-slate-400'}`}>{filter === 'all' ? 'Tüm alıcılar' : filter === 'read' ? 'Okuyanlar' : 'Okumayanlar'}</button>)}</div>
                        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
                            {readersLoading && <p className="p-8 text-center text-sm text-slate-400">Okunma bilgileri yükleniyor...</p>}
                            {!readersLoading && announcementReaders?.recipients.filter((recipient) => readerFilter === 'all' || (readerFilter === 'read' ? Boolean(recipient.readAt) : !recipient.readAt)).map((recipient) => <article key={recipient.userId} className="flex items-center justify-between gap-3 border-b border-slate-800 py-3"><div className="min-w-0"><strong className="block truncate text-sm text-white">@{recipient.username}</strong><span className="block truncate text-[10px] text-slate-500">{recipient.userId}</span></div><div className="shrink-0 text-right">{recipient.readAt ? <><StatusBadge status="read" /><time className="mt-1 block text-[10px] text-slate-500">{formatDate(recipient.readAt)}</time></> : <StatusBadge status="unread" />}</div></article>)}
                        </div>
                    </section>
                </div>}
            </div>}
        </div>
    </main>;
}

function StatusBadge({ status }: { status: string }) {
    const normalized = status.toLowerCase();
    const labels: Record<string, string> = {
        account_appeal_submitted: 'Hesap itirazı',
        account_appeal_decided: 'Hesap itirazı kararı',
        forum_appeal_submitted: 'Forum itirazı',
        forum_appeal_decided: 'Forum itirazı kararı',
    };
    const tone = ['active', 'published', 'filled', 'completed', 'buy', 'success', 'read'].some((word) => normalized.includes(word))
        ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300'
        : ['cancel', 'failed', 'error', 'hidden', 'critical'].some((word) => normalized.includes(word))
            ? 'border-rose-500/20 bg-rose-500/10 text-rose-300'
            : 'border-amber-500/20 bg-amber-500/10 text-amber-300';
    return <span className={`inline-flex max-w-full items-center rounded-full border px-3 py-1 text-xs font-semibold ${tone}`}>{labels[normalized] ?? status.replaceAll('_', ' ')}</span>;
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return <label className="block min-w-0 space-y-1.5"><span className="text-[11px] font-semibold text-slate-400">{label}</span>{children}</label>;
}
