'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { ArrowUpRight, BarChart3, Bell, BellOff, Eye, Filter, Flame, LockKeyhole, MessageCircle, Pin, Plus, Search, ShieldAlert, ThumbsDown, ThumbsUp, Trash2, TrendingUp, UserMinus, Users } from 'lucide-react';
import CreateTopicModal, { FORUM_CATEGORIES } from '@/components/CreateTopicModal';
import ForumAvatar from '@/components/ForumAvatar';
import ForumReportControl from '@/components/ForumReportControl';
import { useAppPreferences } from '@/components/AppProviders';
import { showError, showSuccess } from '@/lib/ui-alerts';
import defaultTopicCardImage from '@/assets/avatar/forum-kart-default-2.jpg';

type Author = { user_id: string; username: string; display_name: string; avatar_url: string | null; gender: string | null; xp_points: number | null; rank_title: string | null };
type Topic = {
    id: string; user_id: string; title: string; content: string; category: string;
    related_symbol: string | null; cover_image_url: string | null; images: string[]; tags: string[];
    visibility: 'public' | 'followers'; is_pinned: boolean; is_closed: boolean;
    helpful_count: number; unhelpful_count: number; views_count: number; created_at: string; updated_at: string;
    comments_count?: number; author?: Author | null; current_user_vote?: string | null;
};
type OwnComment = { id: string; topic_id: string; content: string; created_at: string };
type OwnActivity = {
    votes: Array<{ topic_id: string | null; comment_id: string | null; vote: 'helpful' | 'unhelpful'; topic: Topic | null; comment: { id: string; topic_id: string; content: string } | null }>;
    followers: Array<{ user_id: string; username: string | null; display_name: string | null; avatar_url: string | null; gender: string | null; rank_title: string | null; created_at: string }>;
    following: Array<{ user_id: string; username: string | null; display_name: string | null; avatar_url: string | null; gender: string | null; rank_title: string | null; created_at: string }>;
    reports: Array<{ id: string; status: 'pending' | 'reviewing' | 'resolved' | 'dismissed' | 'withdrawn'; reason: string; details: string; reporter_resolution_summary: string | null; created_at: string; target_type: 'topic' | 'comment' | 'profile'; target_id: string; target_topic_id: string | null; target_title: string | null; content_snapshot: string }>;
    moderationActions: Array<{ id: string; report_id: string | null; action: 'warning' | 'ban' | 'unban' | 'content_removed'; note: string; created_at: string }>;
};
type FollowNotificationPreference = { mode: 'none' | 'all' | 'selected'; categories: string[] };
type OwnReport = OwnActivity['reports'][number];
type CommunityNotification = { id: string; title: string; message: string; created_at: string; read_at: string | null; action_url?: string | null };
type FeedPayload = { data?: { topics: Topic[]; myComments?: OwnComment[]; currentUserId?: string | null }; error?: string };

const dateLabel = (value: string) => new Date(value).toLocaleString('tr-TR', { dateStyle: 'medium', timeStyle: 'short' });
const CARD_TITLE_LIMIT = 72;
const CARD_CONTENT_LIMIT = 180;
const LEGAL_DISCLAIMER = 'Yasal Uyarı: Burada yer alan yatırım bilgi, yorum ve tavsiyeleri yatırım danışmanlığı kapsamında değildir. Yer alan görüşler kişisel analizlere dayanmaktadır.';
const truncate = (text: string, length: number) => {
    const compactText = text.replace(new RegExp(`\\n*${LEGAL_DISCLAIMER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`), '').trim();
    return compactText.length > length ? `${compactText.slice(0, length).trimEnd()}…` : compactText;
};

export default function CommunityWorkspace() {
    const router = useRouter();
    const { confirmDialog } = useAppPreferences();
    const [symbolParam, setSymbolParam] = useState('');
    const [tagParam, setTagParam] = useState('');
    const [topics, setTopics] = useState<Topic[]>([]);
    const [categoryOptions, setCategoryOptions] = useState<Array<{ slug: string; label: string; sort_order: number }>>(FORUM_CATEGORIES.map(([slug, label], index) => ({
        slug, label, sort_order: (index + 1) * 10,
    })));
    const [category, setCategory] = useState('all');
    const [sort, setSort] = useState<'recent' | 'popular' | 'trending'>('recent');
    const [search, setSearch] = useState('');
    const [busy, setBusy] = useState(false);
    const [voteBusyId, setVoteBusyId] = useState<string | null>(null);
    const [showCreate, setShowCreate] = useState(false);
    const [currentUserId, setCurrentUserId] = useState<string | null>(null);
    const [view, setView] = useState<'feed' | 'mine'>('feed');
    const [mineTab, setMineTab] = useState<'topics' | 'comments' | 'helpful' | 'unhelpful' | 'followers' | 'following' | 'notifications' | 'reports' | 'moderation'>('topics');
    const [myComments, setMyComments] = useState<OwnComment[]>([]);
    const [myActivity, setMyActivity] = useState<OwnActivity>({ votes: [], followers: [], following: [], reports: [], moderationActions: [] });
    const [followNotificationPreferences, setFollowNotificationPreferences] = useState<Record<string, FollowNotificationPreference>>({});
    const [preferenceBusyId, setPreferenceBusyId] = useState<string | null>(null);
    const [reportDrafts, setReportDrafts] = useState<Record<string, { reason: string; details: string }>>({});
    const [communityNotifications, setCommunityNotifications] = useState<CommunityNotification[]>([]);
    const [activityBusy, setActivityBusy] = useState(false);
    const [error, setError] = useState('');
    const categoryLabel = (value: string) => categoryOptions.find((item) => item.slug === value)?.label ?? value.replaceAll('_', ' ');

    useEffect(() => {
        const controller = new AbortController();
        void fetch('/api/forum/categories', { signal: controller.signal, cache: 'no-store' })
            .then(async (response) => {
                const payload = await response.json() as { data?: Array<{ slug: string; label: string; sort_order: number }>; error?: string };
                if (!response.ok || !payload.data) throw new Error(payload.error ?? 'Topluluk kategorileri yüklenemedi.');
                if (payload.data.length) setCategoryOptions(payload.data);
            })
            .catch((cause: unknown) => {
                if (cause instanceof DOMException && cause.name === 'AbortError') return;
                setError(cause instanceof Error ? cause.message : 'Topluluk kategorileri yüklenemedi.');
            });
        return () => controller.abort();
    }, []);

    useEffect(() => {
        const timer = window.setTimeout(() => {
            const query = new URLSearchParams(window.location.search);
            setSymbolParam(query.get('symbol')?.trim().toUpperCase() ?? '');
            setTagParam(query.get('tag')?.trim().replace(/^#/, '').toLocaleLowerCase('tr-TR') ?? '');
            if (query.get('create') === '1') setShowCreate(true);
        }, 0);
        return () => window.clearTimeout(timer);
    }, []);

    const loadTopics = useCallback(async () => {
        setBusy(true);
        setError('');
        try {
            const params = new URLSearchParams({ sort, limit: view === 'mine' ? '1000' : '50' });
            if (view === 'mine') params.set('mine', '1');
            if (category !== 'all') params.set('category', category);
            if (symbolParam) params.set('symbol', symbolParam);
            if (tagParam) params.set('tag', tagParam);
            const response = await fetch(`/api/forum/topics?${params}`, { cache: 'no-store' });
            const payload = await response.json() as FeedPayload;
            if (!response.ok || !payload.data) throw new Error(payload.error ?? 'Topluluk akışı yüklenemedi.');
            setTopics(payload.data.topics ?? []);
            setMyComments(payload.data.myComments ?? []);
            setCurrentUserId(payload.data.currentUserId ?? null);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'Topluluk akışı yüklenemedi.');
        } finally {
            setBusy(false);
        }
    }, [category, sort, symbolParam, tagParam, view]);

    useEffect(() => {
        const timer = window.setTimeout(() => { void loadTopics(); }, 0);
        return () => window.clearTimeout(timer);
    }, [loadTopics]);

    useEffect(() => {
        if (view !== 'mine') return;
        let cancelled = false;
        const loadActivity = async () => {
            setActivityBusy(true);
            try {
                const [activityResponse, notificationResponse, followPreferenceResponse] = await Promise.all([
                    fetch('/api/forum/activity', { cache: 'no-store' }),
                    fetch('/api/notifications?category=community', { cache: 'no-store' }),
                    fetch('/api/forum/follows/notifications', { cache: 'no-store' }),
                ]);
                const [activityPayload, notificationPayload, followPreferencePayload] = await Promise.all([
                    activityResponse.json() as Promise<{ data?: OwnActivity; error?: string }>,
                    notificationResponse.json() as Promise<{ data?: { notifications: CommunityNotification[] }; error?: string }>,
                    followPreferenceResponse.json() as Promise<{ data?: { preferences: Array<{ followed_id: string; mode: FollowNotificationPreference['mode']; categories: string[] }> }; error?: string }>,
                ]);
                if (!activityResponse.ok || !activityPayload.data) throw new Error(activityPayload.error ?? 'Topluluk etkinlikleri yüklenemedi.');
                if (!notificationResponse.ok || !notificationPayload.data) throw new Error(notificationPayload.error ?? 'Topluluk bildirimleri yüklenemedi.');
                if (!followPreferenceResponse.ok || !followPreferencePayload.data) throw new Error(followPreferencePayload.error ?? 'Takip bildirim tercihleri yüklenemedi.');
                if (!cancelled) {
                    setMyActivity({ ...activityPayload.data, reports: activityPayload.data.reports ?? [] });
                    setCommunityNotifications(notificationPayload.data.notifications ?? []);
                    setFollowNotificationPreferences(Object.fromEntries(
                        followPreferencePayload.data.preferences.map((item) => [item.followed_id, { mode: item.mode, categories: item.categories ?? [] }]),
                    ));
                }
            } catch (cause) {
                if (!cancelled) setError(cause instanceof Error ? cause.message : 'Topluluk etkinlikleri yüklenemedi.');
            } finally {
                if (!cancelled) setActivityBusy(false);
            }
        };
        void loadActivity();
        return () => { cancelled = true; };
    }, [view]);

    const filteredTopics = useMemo(() => {
        const query = search.trim().toLocaleLowerCase('tr-TR');
        return topics.filter((topic) => !query || `${topic.title} ${topic.content} ${topic.related_symbol ?? ''} ${topic.author?.username ?? ''}`
            .toLocaleLowerCase('tr-TR').includes(query));
    }, [search, topics]);

    const vote = async (topic: Topic, nextVote: 'helpful' | 'unhelpful') => {
        if (!currentUserId) {
            router.push('/auth?next=%2Fforum');
            return;
        }
        if (voteBusyId) return;
        setVoteBusyId(topic.id);
        setError('');
        try {
            const response = await fetch('/api/forum/votes', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ topic_id: topic.id, vote: topic.current_user_vote === nextVote ? null : nextVote }),
            });
            const payload = await response.json() as { error?: string };
            if (!response.ok) throw new Error(payload.error ?? 'Oylama kaydedilemedi.');
            await loadTopics();
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'Oylama kaydedilemedi.');
        } finally {
            setVoteBusyId(null);
        }
    };

    const updateMyVote = async (item: OwnActivity['votes'][number]) => {
        const response = await fetch('/api/forum/votes', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(item.topic_id ? { topic_id: item.topic_id } : { comment_id: item.comment_id }),
        });
        const payload = await response.json() as { error?: string };
        if (!response.ok) {
            setError(payload.error ?? 'Oy kaldırılamadı.');
            return;
        }
        setMyActivity((current) => ({ ...current, votes: current.votes.filter((voteItem) =>
            item.topic_id ? voteItem.topic_id !== item.topic_id : voteItem.comment_id !== item.comment_id,
        ) }));
        if (item.topic) await loadTopics();
    };

    const unfollowFromList = async (followedId: string) => {
        const response = await fetch('/api/forum/follows', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ followedId }),
        });
        const payload = await response.json() as { error?: string };
        if (!response.ok) {
            setError(payload.error ?? 'Takip kaldırılamadı.');
            showError(payload.error ?? 'Takip kaldırılamadı.');
            return;
        }
        setMyActivity((current) => ({ ...current, following: current.following.filter((profile) => profile.user_id !== followedId) }));
        setFollowNotificationPreferences((current) => {
            const next = { ...current };
            delete next[followedId];
            return next;
        });
        showSuccess('Takip bırakıldı.');
    };

    const saveFollowNotificationPreference = async (followedId: string, preference: FollowNotificationPreference) => {
        setPreferenceBusyId(followedId);
        setError('');
        try {
            const response = await fetch('/api/forum/follows/notifications', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ followed_id: followedId, ...preference }),
            });
            const payload = await response.json() as { error?: string };
            if (!response.ok) throw new Error(payload.error ?? 'Takip bildirimi tercihi kaydedilemedi.');
            setFollowNotificationPreferences((current) => ({ ...current, [followedId]: preference }));
            showSuccess(preference.mode === 'none' ? 'Paylaşım bildirimleri kapatıldı.' : preference.mode === 'all' ? 'Tüm paylaşım bildirimleri açıldı.' : 'Kategori bildirimleri güncellendi.');
        } catch (cause) {
            const message = cause instanceof Error ? cause.message : 'Takip bildirimi tercihi kaydedilemedi.';
            setError(message);
            showError(message);
        } finally {
            setPreferenceBusyId(null);
        }
    };

    const toggleFollowNotifications = (followedId: string) => {
        const current = followNotificationPreferences[followedId] ?? { mode: 'none' as const, categories: [] };
        void saveFollowNotificationPreference(followedId, current.mode === 'none'
            ? { mode: 'all', categories: [] }
            : { mode: 'none', categories: [] });
    };

    const saveOwnReport = async (report: OwnReport) => {
        const draft = reportDrafts[report.id] ?? { reason: report.reason, details: report.details };
        const response = await fetch('/api/forum/reports', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ report_id: report.id, ...draft }),
        });
        const payload = await response.json() as { data?: { report?: OwnReport }; error?: string };
        if (!response.ok || !payload.data?.report) {
            setError(payload.error ?? 'Şikâyet güncellenemedi.');
            return;
        }
        setMyActivity((current) => ({ ...current, reports: current.reports.map((item) => item.id === report.id ? payload.data!.report! : item) }));
        setReportDrafts((current) => { const next = { ...current }; delete next[report.id]; return next; });
    };

    const withdrawOwnReport = async (report: OwnReport) => {
        const confirmed = await confirmDialog({
            title: 'Şikâyeti geri çek?',
            message: 'Şikâyet incelemeden kaldırılacak. Sonuçlanmış şikâyetler geri çekilemez.',
            confirmLabel: 'Şikâyeti geri çek',
            danger: true,
        });
        if (!confirmed) return;
        const response = await fetch('/api/forum/reports', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ report_id: report.id }),
        });
        const payload = await response.json() as { data?: { report?: OwnReport }; error?: string };
        if (!response.ok || !payload.data?.report) {
            setError(payload.error ?? 'Şikâyet geri çekilemedi.');
            return;
        }
        setMyActivity((current) => ({ ...current, reports: current.reports.map((item) => item.id === report.id ? payload.data!.report! : item) }));
    };

    const updateCommunityNotification = async (notification: CommunityNotification, action: 'read' | 'delete') => {
        const response = await fetch('/api/notifications', {
            method: action === 'read' ? 'PATCH' : 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(action === 'read' ? { id: notification.id, read: !notification.read_at } : { ids: [notification.id] }),
        });
        const payload = await response.json() as { error?: string };
        if (!response.ok) {
            setError(payload.error ?? 'Bildirim güncellenemedi.');
            return;
        }
        setCommunityNotifications((current) => action === 'delete'
            ? current.filter((item) => item.id !== notification.id)
            : current.map((item) => item.id === notification.id
                ? { ...item, read_at: item.read_at ? null : new Date().toISOString() }
                : item));
    };

    const updateVisibility = async (topic: Topic, visibility: 'public' | 'followers') => {
        const response = await fetch(`/api/forum/topics/${encodeURIComponent(topic.id)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ visibility }),
        });
        const payload = await response.json() as { error?: string };
        if (!response.ok) {
            setError(payload.error ?? 'İçerik görünürlüğü güncellenemedi.');
            return;
        }
        await loadTopics();
    };

    const deleteOwnContent = async (type: 'topic' | 'comment', id: string) => {
        const confirmed = await confirmDialog({
            title: 'İçerik silinsin mi?',
            message: 'Bu içerik ve konuysa altındaki yorumlar kalıcı olarak silinecek.',
            confirmLabel: 'İçeriği sil',
            danger: true,
        });
        if (!confirmed) return;
        const response = await fetch(type === 'topic'
            ? `/api/forum/topics/${encodeURIComponent(id)}`
            : `/api/forum/comments/${encodeURIComponent(id)}`, { method: 'DELETE' });
        const payload = await response.json() as { error?: string };
        if (!response.ok) {
            setError(payload.error ?? 'İçerik silinemedi.');
            return;
        }
        await loadTopics();
    };

    return <main className="min-h-screen bg-slate-950 px-4 py-8 text-slate-100 md:px-8">
        <div className="mx-auto max-w-7xl space-y-7">
            <header className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-800 pb-6">
                <div><span className="text-xs font-bold tracking-[.18em] text-emerald-400">TRADE ENGINE / TOPLULUK</span>
                    <h1 className="mt-2 flex items-center gap-3 text-3xl font-extrabold text-white"><MessageCircle className="h-8 w-8 text-emerald-400" />{symbolParam ? `${symbolParam} tartışmaları` : tagParam ? `#${tagParam} etiketli konular` : 'Topluluk & Tartışma'}</h1>
                    <p className="mt-2 max-w-2xl text-sm text-slate-400">BİST şirketleri üzerine araştırma, soru ve deneyim paylaş. Paylaşımlar yatırım tavsiyesi değildir.</p></div>
                <button onClick={() => setShowCreate(true)} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2.5 text-xs font-bold text-white shadow-lg shadow-emerald-900/20 transition hover:bg-emerald-500"><Plus size={16} /> Yeni konu</button>
            </header>
            <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-4">
                <aside className="space-y-4 lg:sticky lg:top-24">
                    <section className="rounded-2xl border border-slate-800 bg-slate-900 p-4 shadow-xl">
                        <h2 className="text-sm font-bold text-white">Kategoriler</h2>
                        <nav aria-label="Forum kategorileri" className="mt-3 space-y-1">
                            <button onClick={() => setCategory('all')} className={`w-full rounded-lg px-3 py-2 text-left text-xs font-semibold ${category === 'all' ? 'bg-emerald-500/10 text-emerald-300' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}>Tüm kategoriler</button>
                            {categoryOptions.map(({ slug, label }) => <button key={slug} onClick={() => setCategory(slug)} className={`w-full rounded-lg px-3 py-2 text-left text-xs font-semibold ${category === slug ? 'bg-emerald-500/10 text-emerald-300' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}>{label}</button>)}
                        </nav>
                    </section>
                    <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-xl">
                        <h2 className="flex items-center gap-2 text-sm font-bold text-white"><TrendingUp className="h-4 w-4 text-emerald-400" />Topluluk rehberi</h2>
                        <div className="mt-4 space-y-3 text-xs leading-5 text-slate-400">
                            <p>Kaynak belirt, görüşünü verilerle destekle ve farklı fikirlere saygı göster.</p>
                            <p>Uygunsuz içerikleri şikâyet ederek topluluk moderasyonuna yardımcı olabilirsin.</p>
                        </div>
                        <div className="mt-4 flex items-center gap-2 rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-200"><Flame size={15} className="shrink-0 text-amber-300" /><span>{topics.filter((topic) => topic.helpful_count > 0).length} faydalı tartışma akışta</span></div>
                    </section>
                    <section role="note" className="rounded-2xl border border-rose-500/25 bg-rose-500/10 p-4 shadow-xl">
                        <h2 className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-wide text-rose-300"><ShieldAlert size={15} />Önemli yasal uyarı</h2>
                        <p className="mt-2 text-xs font-semibold leading-5 text-rose-100">Toplulukta paylaşılan içeriklerin hiçbiri yatırım danışmanlığı, alım-satım önerisi veya getiri garantisi değildir.</p>
                        <p className="mt-2 text-[11px] leading-5 text-rose-200/80">Yatırım bilgi, yorum ve tavsiyeleri yatırım danışmanlığı kapsamında değildir. Görüşler kişisel analizlere dayanır; yatırım kararlarınızı kendi araştırmanızla ve risk değerlendirmenizle verin.</p>
                    </section>
                </aside>
                <section className="min-w-0 space-y-4 lg:col-span-3">
                    <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-800 bg-slate-900 p-3 shadow-xl">
                        <div className="flex rounded-lg border border-slate-700 bg-slate-800 p-1">
                            <button onClick={() => setView('feed')} className={`rounded-md px-3 py-2 text-[11px] font-bold ${view === 'feed' ? 'bg-emerald-600 text-white' : 'text-slate-400'}`}>Akış</button>
                            <button onClick={() => { if (!currentUserId) router.push('/auth?next=%2Fforum'); else { setView('mine'); setMineTab('topics'); } }} className={`rounded-md px-3 py-2 text-[11px] font-bold ${view === 'mine' ? 'bg-emerald-600 text-white' : 'text-slate-400'}`}>İçeriklerim</button>
                        </div>
                        <label className="flex min-w-[200px] flex-1 items-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-3"><Search size={15} className="shrink-0 text-slate-500" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Konularda ara" className="min-w-0 flex-1 bg-transparent py-2.5 text-xs text-white outline-none" /></label>
                        <label className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-3 text-xs text-slate-400"><Filter size={14} /><select aria-label="Konu sıralaması" value={sort} onChange={(event) => setSort(event.target.value as typeof sort)} className="bg-transparent py-2.5 text-xs text-white"><option value="recent">En yeni</option><option value="popular">En faydalı</option><option value="trending">Trend</option></select></label>
                    </div>
                    {view === 'mine' && <nav aria-label="Topluluk hesabım" className="flex gap-2 overflow-x-auto rounded-xl border border-slate-800 bg-slate-900 p-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                        {([
                            ['topics', `Paylaşımlarım (${topics.length})`],
                            ['comments', `Yorumlarım (${myComments.length})`],
                            ['helpful', `Faydalı bulduklarım (${myActivity.votes.filter((item) => item.vote === 'helpful').length})`],
                            ['unhelpful', `Faydasız bulduklarım (${myActivity.votes.filter((item) => item.vote === 'unhelpful').length})`],
                            ['followers', `Takipçilerim (${myActivity.followers.length})`],
                            ['following', `Takip ettiklerim (${myActivity.following.length})`],
                            ['reports', `Bildirdiklerim (${myActivity.reports.length})`],
                            ['moderation', `Hesabıma uygulanan işlemler (${myActivity.moderationActions.length})`],
                            ['notifications', `Bildirimlerim (${communityNotifications.length})`],
                        ] as const).map(([key, label]) => <button key={key} type="button" onClick={() => setMineTab(key)} aria-pressed={mineTab === key} className={`shrink-0 rounded-lg px-3 py-2 text-[10px] font-bold transition ${mineTab === key ? 'bg-emerald-500/10 text-emerald-300' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}>{label}</button>)}
                    </nav>}
                    {error && <p role="alert" className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-xs text-rose-300">{error}</p>}
                    {(view === 'feed' || mineTab === 'topics') && busy && topics.length === 0 && <div className="rounded-2xl border border-slate-800 bg-slate-900 p-8 text-center text-sm text-slate-400">Topluluk akışı yükleniyor…</div>}
                    {(view === 'feed' || mineTab === 'topics') && !busy && filteredTopics.length === 0 && <div className="rounded-2xl border border-slate-800 bg-slate-900 p-8 text-center"><MessageCircle className="mx-auto h-8 w-8 text-slate-600" /><h2 className="mt-3 font-bold text-white">Henüz konu yok</h2><p className="mt-1 text-xs text-slate-500">İlk araştırma paylaşımını başlatabilirsin.</p><button onClick={() => setShowCreate(true)} className="mt-4 rounded-lg bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white">Yeni konu oluştur</button></div>}
                    {(view === 'feed' || mineTab === 'topics') && <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    {filteredTopics.map((topic) => <article key={topic.id} className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 shadow-xl transition hover:border-slate-700">
                        <Link href={`/forum/${topic.id}`} aria-label={`${topic.title} konusunu aç`} className="relative block h-40 shrink-0 overflow-hidden bg-slate-800">
                            <Image src={topic.cover_image_url || topic.images?.[0] || defaultTopicCardImage} alt="" fill unoptimized className="object-cover transition duration-300 hover:scale-[1.02]" sizes="(max-width: 640px) 100vw, (max-width: 1280px) 50vw, 33vw" />
                        </Link>
                        <div className="flex flex-1 flex-col gap-3 p-4">
                            <div className="flex min-h-6 flex-wrap items-center gap-1.5">
                                {topic.is_pinned && <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-1 text-[10px] font-semibold text-amber-300"><Pin size={10} />Sabit</span>}
                                <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-1 text-[10px] font-semibold text-emerald-300">{categoryLabel(topic.category)}</span>
                                {topic.related_symbol && <Link href={`/forum?symbol=${topic.related_symbol}`} className="rounded-full border border-slate-700 bg-slate-800 px-2 py-1 text-[10px] font-bold text-slate-200">{topic.related_symbol}</Link>}
                                {topic.is_closed && <span className="rounded-full border border-rose-500/20 bg-rose-500/10 px-2 py-1 text-[10px] font-semibold text-rose-300">Kilitli</span>}
                                {view === 'mine' && <span className="inline-flex items-center gap-1 rounded-full border border-slate-700 bg-slate-800 px-2 py-1 text-[10px] font-semibold text-slate-300">{topic.visibility === 'followers' ? <Users size={10} /> : <LockKeyhole size={10} />}{topic.visibility === 'followers' ? 'Takipçiler' : 'Herkese açık'}</span>}
                            </div>
                            <Link href={`/forum/${topic.id}`} className="group block">
                                <h2 className="line-clamp-2 min-h-12 break-words text-base font-bold leading-6 text-white group-hover:text-emerald-300">{truncate(topic.title, CARD_TITLE_LIMIT)}</h2>
                                <p className="mt-1 line-clamp-3 min-h-[4.5rem] break-words text-xs leading-6 text-slate-400">{truncate(topic.content, CARD_CONTENT_LIMIT)}</p>
                            </Link>
                            {topic.tags?.length > 0 && <div className="flex min-h-6 flex-wrap gap-1.5">{topic.tags.slice(0, 3).map((tag) => <Link key={tag} href={`/forum?tag=${encodeURIComponent(tag)}`} className="rounded-full border border-slate-700 bg-slate-800/80 px-2 py-1 text-[10px] text-slate-400 hover:text-emerald-300">#{tag}</Link>)}{topic.tags.length > 3 && <span className="px-1 py-1 text-[10px] text-slate-500">+{topic.tags.length - 3}</span>}</div>}
                            {view === 'mine' ? <div className="space-y-2">
                                <div className="flex items-center gap-3 text-[10px] text-slate-400"><span className="inline-flex items-center gap-1"><BarChart3 size={12} />{topic.views_count} görüntülenme</span><span className="inline-flex items-center gap-1"><ThumbsUp size={12} />{topic.helpful_count}</span><span className="inline-flex items-center gap-1"><MessageCircle size={12} />{topic.comments_count ?? 0} yorum</span></div>
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <select aria-label="İçerik görünürlüğü" value={topic.visibility} onChange={(event) => void updateVisibility(topic, event.target.value as 'public' | 'followers')} className="min-w-0 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-2 text-[10px] text-slate-200">
                                        <option value="public">Herkese açık</option><option value="followers">Takipçilere açık</option>
                                    </select>
                                    <button type="button" onClick={() => void deleteOwnContent('topic', topic.id)} className="inline-flex items-center gap-1 rounded-lg border border-rose-500/20 px-2.5 py-2 text-[10px] font-semibold text-rose-300 hover:bg-rose-500/10"><Trash2 size={12} />Sil</button>
                                </div>
                            </div> : null}
                            <div className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 pt-3">
                                <Link href={topic.author?.username ? `/profile/${encodeURIComponent(topic.author.username)}` : '#'} className="flex min-w-0 items-center gap-2 text-xs text-slate-300">
                                    <ForumAvatar avatarUrl={topic.author?.avatar_url} gender={topic.author?.gender} username={topic.author?.username} size={32} className="h-8 w-8 rounded-full border border-slate-700 object-cover" />
                                    <span className="min-w-0"><strong className="block truncate">{topic.author?.username ?? 'Trader'}</strong><span className="text-[10px] text-slate-500">{topic.author?.rank_title ?? 'Trader'} · {dateLabel(topic.created_at)}</span></span>
                                </Link>
                                <div className="flex items-center gap-2">
                                    <button disabled={voteBusyId === topic.id} onClick={() => void vote(topic, 'helpful')} aria-label={`Faydalı, ${topic.helpful_count}`} title="Faydalı" className={`inline-flex items-center gap-1 bg-transparent p-1 text-[10px] disabled:opacity-50 ${topic.current_user_vote === 'helpful' ? 'text-emerald-300' : 'text-slate-500 hover:text-emerald-300'}`}><ThumbsUp size={13} />{topic.helpful_count}</button>
                                    <button disabled={voteBusyId === topic.id} onClick={() => void vote(topic, 'unhelpful')} aria-label={`Faydasız, ${topic.unhelpful_count}`} title="Faydasız" className={`inline-flex items-center gap-1 bg-transparent p-1 text-[10px] disabled:opacity-50 ${topic.current_user_vote === 'unhelpful' ? 'text-rose-300' : 'text-slate-500 hover:text-rose-300'}`}><ThumbsDown size={13} />{topic.unhelpful_count}</button>
                                    <span className="inline-flex items-center gap-1 px-1 text-[10px] text-slate-500"><MessageCircle size={13} />{topic.comments_count ?? 0}</span>
                                    <span className="inline-flex items-center gap-1 px-1 text-[10px] text-slate-500"><Eye size={13} />{topic.views_count}</span>
                                    {currentUserId && currentUserId !== topic.user_id && <ForumReportControl targetType="topic" targetId={topic.id} compact />}
                                    <Link href={`/forum/${topic.id}`} aria-label="Konuyu aç" className="rounded-lg border border-slate-700 bg-slate-800 p-2 text-slate-300 hover:text-emerald-300"><ArrowUpRight size={14} /></Link>
                                </div>
                            </div>
                        </div>
                    </article>)}
                    </div>}
                    {view === 'mine' && mineTab === 'comments' && <section className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900 p-4 shadow-xl">
                        <h2 className="text-sm font-bold text-white">Yorumlarım <span className="text-xs font-medium text-slate-500">({myComments.length})</span></h2>
                        {!myComments.length ? <p className="text-xs text-slate-500">Henüz yorum paylaşmadınız.</p> : myComments.map((comment) => <article key={comment.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/50 p-3">
                            <div className="min-w-0 flex-1"><p className="line-clamp-2 break-words text-xs leading-5 text-slate-300">{comment.content}</p><Link href={`/forum/${comment.topic_id}`} className="mt-1 inline-block text-[10px] text-emerald-300 hover:underline">{dateLabel(comment.created_at)} · Konuyu aç</Link></div>
                            <button type="button" onClick={() => void deleteOwnContent('comment', comment.id)} className="inline-flex items-center gap-1 rounded-lg border border-rose-500/20 px-2 py-1.5 text-[10px] text-rose-300"><Trash2 size={11} />Sil</button>
                        </article>)}
                    </section>}
                    {view === 'mine' && ['helpful', 'unhelpful'].includes(mineTab) && <section className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900 p-4 shadow-xl">
                        <h2 className="text-sm font-bold text-white">{mineTab === 'helpful' ? 'Faydalı bulduklarım' : 'Faydasız bulduklarım'}</h2>
                        {activityBusy && <p className="text-xs text-slate-500">Oyların yükleniyor…</p>}
                        {!activityBusy && myActivity.votes.filter((item) => item.vote === mineTab).length === 0 && <p className="text-xs text-slate-500">Bu listede henüz içerik yok.</p>}
                        {myActivity.votes.filter((item) => item.vote === mineTab).map((item) => {
                            const targetTitle = item.topic?.title ?? 'Yorum';
                            const content = item.topic?.content ?? item.comment?.content ?? '';
                            const targetHref = `/forum/${item.topic?.id ?? item.comment?.topic_id}`;
                            return <article key={item.topic_id ?? item.comment_id} className="flex min-w-0 items-start justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                                <Link href={targetHref} className="min-w-0 flex-1"><strong className="block truncate text-xs text-slate-200">{targetTitle}</strong><span className="mt-1 line-clamp-2 break-words text-[10px] leading-4 text-slate-500">{content}</span></Link>
                                <button type="button" onClick={() => void updateMyVote(item)} aria-label="Oyumu geri al" title="Oyumu geri al" className="shrink-0 rounded-lg p-2 text-slate-500 hover:bg-rose-500/10 hover:text-rose-300">{item.vote === 'helpful' ? <ThumbsUp size={14} /> : <ThumbsDown size={14} />}</button>
                            </article>;
                        })}
                    </section>}
                    {view === 'mine' && (mineTab === 'followers' || mineTab === 'following') && <section className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900 p-4 shadow-xl">
                        <h2 className="text-sm font-bold text-white">{mineTab === 'followers' ? 'Takipçilerim' : 'Takip ettiklerim'}</h2>
                        {activityBusy && <p className="text-xs text-slate-500">Kullanıcılar yükleniyor…</p>}
                        {(mineTab === 'followers' ? myActivity.followers : myActivity.following).map((profile) => {
                            const preference = followNotificationPreferences[profile.user_id] ?? { mode: 'none' as const, categories: [] };
                            return <article key={profile.user_id} className="space-y-3 rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                                <div className="flex items-center justify-between gap-3">
                                    <Link href={profile.username ? `/profile/${encodeURIComponent(profile.username)}` : '#'} className="flex min-w-0 items-center gap-2">
                                        <ForumAvatar avatarUrl={profile.avatar_url} gender={profile.gender} username={profile.username ?? 'Trader'} size={34} className="h-9 w-9 rounded-full border border-slate-700 object-cover" />
                                        <span className="min-w-0"><strong className="block truncate text-xs text-slate-200">@{profile.username ?? 'Trader'}</strong><span className="text-[10px] text-slate-500">{profile.rank_title ?? 'Trader'} · {dateLabel(profile.created_at)}</span></span>
                                    </Link>
                                    {mineTab === 'following' && <div className="flex shrink-0 items-center gap-1.5">
                                        <button type="button" disabled={preferenceBusyId === profile.user_id} onClick={() => toggleFollowNotifications(profile.user_id)} title={preference.mode === 'none' ? 'Paylaşım bildirimlerini aç' : 'Paylaşım bildirimlerini kapat'} aria-label={preference.mode === 'none' ? 'Paylaşım bildirimlerini aç' : 'Paylaşım bildirimlerini kapat'} className={`inline-flex h-9 w-9 items-center justify-center rounded-lg border transition disabled:opacity-50 ${preference.mode === 'none' ? 'border-slate-700 bg-slate-900 text-slate-400 hover:border-emerald-500/30 hover:text-emerald-300' : 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/15'}`}>
                                            {preference.mode === 'none' ? <BellOff size={15} /> : <Bell size={15} />}
                                        </button>
                                        <button type="button" onClick={() => void unfollowFromList(profile.user_id)} className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-700 px-2.5 py-2 text-[10px] font-semibold text-slate-400 hover:border-rose-500/30 hover:text-rose-300"><UserMinus size={12} />Takibi bırak</button>
                                    </div>}
                                </div>
                                {mineTab === 'following' && <details className="group">
                                    <summary className="w-fit cursor-pointer list-none text-[10px] font-medium text-slate-500 hover:text-slate-300">{preferenceBusyId === profile.user_id ? 'Kaydediliyor…' : preference.mode === 'none' ? 'Bildirimler kapalı · ayarla' : preference.mode === 'all' ? 'Tüm paylaşımlar için bildirim açık · ayarla' : 'Seçili kategoriler için bildirim açık · ayarla'}</summary>
                                    <div className="mt-2 space-y-2 rounded-lg border border-slate-800 bg-slate-900 p-3">
                                        <label className="block space-y-1 text-[10px] font-medium text-slate-500">Bildirim tercihi
                                            <select disabled={preferenceBusyId === profile.user_id} value={preference.mode} onChange={(event) => {
                                                const mode = event.target.value as FollowNotificationPreference['mode'];
                                                void saveFollowNotificationPreference(profile.user_id, {
                                                    mode,
                                                    categories: mode === 'selected' ? preference.categories : [],
                                                });
                                            }} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-200">
                                                <option value="none">Kapalı</option>
                                                <option value="all">Tüm paylaşımları</option>
                                                <option value="selected">Seçtiğim kategoriler</option>
                                            </select>
                                        </label>
                                        {preference.mode === 'selected' && <div className="flex flex-wrap gap-2 border-t border-slate-800 pt-2">
                                        {categoryOptions.map((option) => <label key={option.slug} className="inline-flex items-center gap-1.5 rounded-full border border-slate-800 px-2.5 py-1.5 text-[10px] text-slate-400">
                                            <input type="checkbox" checked={preference.categories.includes(option.slug)} disabled={preferenceBusyId === profile.user_id} onChange={(event) => {
                                                const categories = event.target.checked
                                                    ? [...preference.categories, option.slug]
                                                    : preference.categories.filter((slug) => slug !== option.slug);
                                                if (categories.length) void saveFollowNotificationPreference(profile.user_id, { mode: 'selected', categories });
                                                else void saveFollowNotificationPreference(profile.user_id, { mode: 'none', categories: [] });
                                            }} className="accent-emerald-500" />{option.label}
                                        </label>)}
                                    </div>}
                                    </div>
                                </details>}
                            </article>;
                        })}
                        {!activityBusy && (mineTab === 'followers' ? myActivity.followers : myActivity.following).length === 0 && <p className="text-xs text-slate-500">Henüz kullanıcı yok.</p>}
                    </section>}
                    {view === 'mine' && mineTab === 'reports' && <section className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900 p-4 shadow-xl">
                        <h2 className="text-sm font-bold text-white">Bildirdiğim içerikler</h2>
                        <p className="text-xs text-slate-500">Şikâyetlerin durumunu buradan takip edebilir, açık olanları düzenleyebilir veya geri çekebilirsin.</p>
                        {activityBusy && <p className="text-xs text-slate-500">Şikâyetlerin yükleniyor…</p>}
                        {myActivity.reports.map((report) => {
                            const editable = report.status === 'pending' || report.status === 'reviewing';
                            const draft = reportDrafts[report.id] ?? { reason: report.reason, details: report.details };
                            const statusLabel = report.status === 'pending' ? 'Alındı' : report.status === 'reviewing' ? 'İnceleniyor' : report.status === 'resolved' ? 'Sonuçlandı' : report.status === 'dismissed' ? 'İşlem yapılmadı' : 'Geri çekildi';
                            return <article key={report.id} className="space-y-3 rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold ${report.status === 'resolved' ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300' : report.status === 'dismissed' || report.status === 'withdrawn' ? 'border-slate-700 bg-slate-800 text-slate-400' : 'border-amber-500/20 bg-amber-500/10 text-amber-300'}`}>{statusLabel}</span>
                                    <time className="text-[10px] text-slate-500">{dateLabel(report.created_at)}</time>
                                </div>
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <strong className="min-w-0 flex-1 truncate text-xs text-white">{report.target_title ?? (report.target_type === 'topic' ? 'Forum konusu' : report.target_type === 'comment' ? 'Forum yorumu' : 'Kullanıcı profili')}</strong>
                                    {report.target_topic_id && <Link href={`/forum/${report.target_topic_id}`} className="text-[10px] font-semibold text-emerald-300 hover:underline">İçeriği aç</Link>}
                                    {report.target_type === 'profile' && report.target_title && <Link href={`/profile/${encodeURIComponent(report.target_title.replace(/^@/, ''))}`} className="text-[10px] font-semibold text-emerald-300 hover:underline">Profili aç</Link>}
                                </div>
                                <p className="line-clamp-3 whitespace-pre-wrap break-words text-xs leading-5 text-slate-400">{report.content_snapshot}</p>
                                <div className="grid gap-2 sm:grid-cols-2">
                                    <label className="space-y-1 text-[10px] font-semibold text-slate-500">Şikâyet nedeni
                                        <select disabled={!editable} value={draft.reason} onChange={(event) => setReportDrafts((current) => ({ ...current, [report.id]: { ...draft, reason: event.target.value } }))} className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-200 disabled:opacity-70">
                                            {report.target_type === 'profile'
                                                ? <><option value="inappropriate_profile_photo">Uygunsuz profil fotoğrafı</option><option value="inappropriate_username">Uygunsuz kullanıcı adı veya görünen ad</option><option value="impersonation">Taklit / sahte hesap</option><option value="profile_other">Diğer profil ihlali</option></>
                                                : <><option value="spam">Spam veya reklam</option><option value="harassment">Taciz veya hakaret</option><option value="misleading">Yanıltıcı içerik</option><option value="personal_info">Kişisel bilgi paylaşımı</option><option value="other">Diğer</option></>}
                                        </select>
                                    </label>
                                    <label className="space-y-1 text-[10px] font-semibold text-slate-500">Açıklaman
                                        <textarea disabled={!editable} maxLength={1000} rows={2} value={draft.details} onChange={(event) => setReportDrafts((current) => ({ ...current, [report.id]: { ...draft, details: event.target.value } }))} className="w-full resize-y rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-200 disabled:opacity-70" placeholder="İsteğe bağlı açıklama" />
                                    </label>
                                </div>
                                {report.reporter_resolution_summary && <p className="rounded-lg border border-slate-800 bg-slate-900 p-3 text-xs leading-5 text-slate-300"><b className="text-emerald-300">Yönetici sonucu:</b> {report.reporter_resolution_summary}</p>}
                                {editable && <div className="flex flex-wrap justify-end gap-2">
                                    <button type="button" onClick={() => void saveOwnReport(report)} disabled={draft.reason === report.reason && draft.details === report.details} className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-[10px] font-bold text-emerald-300 disabled:opacity-40">Değişiklikleri kaydet</button>
                                    <button type="button" onClick={() => void withdrawOwnReport(report)} className="rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-[10px] font-bold text-rose-300">Geri çek</button>
                                </div>}
                            </article>;
                        })}
                        {!activityBusy && myActivity.reports.length === 0 && <p className="rounded-lg border border-slate-800 bg-slate-950/60 p-4 text-xs text-slate-500">Henüz içerik bildirmedin.</p>}
                    </section>}
                    {view === 'mine' && mineTab === 'moderation' && <section className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900 p-4 shadow-xl">
                        <h2 className="text-sm font-bold text-white">Hesabına uygulanan moderasyon işlemleri</h2>
                        <p className="text-xs text-slate-500">Uyarı ve diğer işlemlerin gerekçeleri yalnızca hesabında gösterilir.</p>
                        {activityBusy && <p className="text-xs text-slate-500">İşlemler yükleniyor…</p>}
                        {myActivity.moderationActions.map((action) => {
                            const label = action.action === 'warning' ? 'Uyarı'
                                : action.action === 'ban' ? 'Forum erişimi kısıtlandı'
                                    : action.action === 'unban' ? 'Forum erişimi yeniden açıldı' : 'İçerik kaldırıldı';
                            const color = action.action === 'warning' || action.action === 'ban' || action.action === 'content_removed'
                                ? 'border-rose-500/20 bg-rose-500/10 text-rose-300'
                                : 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300';
                            return <article key={action.id} className="space-y-2 rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold ${color}`}>{label}</span>
                                    <time className="text-[10px] text-slate-500">{dateLabel(action.created_at)}</time>
                                </div>
                                <p className="whitespace-pre-wrap break-words text-xs leading-5 text-slate-300">{action.note}</p>
                            </article>;
                        })}
                        {!activityBusy && myActivity.moderationActions.length === 0 && <p className="rounded-lg border border-slate-800 bg-slate-950/60 p-4 text-xs text-slate-500">Hesabına uygulanmış bir moderasyon işlemi yok.</p>}
                    </section>}
                    {view === 'mine' && mineTab === 'notifications' && <section className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900 p-4 shadow-xl">
                        <h2 className="flex items-center gap-2 text-sm font-bold text-white"><Bell size={15} className="text-emerald-400" />Topluluk bildirimlerim</h2>
                        {activityBusy && <p className="text-xs text-slate-500">Bildirimler yükleniyor…</p>}
                        {communityNotifications.map((notification) => <article key={notification.id} className="flex min-w-0 items-start gap-3 rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                            <button type="button" onClick={() => notification.action_url && router.push(notification.action_url)} className="min-w-0 flex-1 text-left">
                                <strong className={`block text-xs ${notification.read_at ? 'text-slate-300' : 'text-white'}`}>{notification.title}</strong>
                                <span className="mt-1 block text-[10px] leading-4 text-slate-400">{notification.message}</span>
                                <time className="mt-1 block text-[10px] text-slate-600">{dateLabel(notification.created_at)}</time>
                            </button>
                            <button type="button" onClick={() => void updateCommunityNotification(notification, 'read')} aria-label={notification.read_at ? 'Okunmadı işaretle' : 'Okundu işaretle'} title={notification.read_at ? 'Okunmadı işaretle' : 'Okundu işaretle'} className="shrink-0 rounded-lg p-2 text-slate-500 hover:text-emerald-300">{notification.read_at ? <Eye size={14} /> : <Bell size={14} />}</button>
                            <button type="button" onClick={() => void updateCommunityNotification(notification, 'delete')} aria-label="Bildirimi sil" title="Bildirimi sil" className="shrink-0 rounded-lg p-2 text-slate-500 hover:text-rose-300"><Trash2 size={14} /></button>
                        </article>)}
                        {!activityBusy && communityNotifications.length === 0 && <p className="text-xs text-slate-500">Henüz topluluk bildirimin yok.</p>}
                    </section>}
                </section>
            </div>
        </div>
        {showCreate && <CreateTopicModal categories={categoryOptions} initialSymbol={symbolParam} onClose={() => setShowCreate(false)} onCreated={(topicId) => router.push(`/forum/${topicId}`)} />}
    </main>;
}
