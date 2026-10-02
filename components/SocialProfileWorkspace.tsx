'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { ArrowUpRight, Bell, BellOff, Flag, LockKeyhole, MessageCircle, ThumbsUp, UserMinus, UserPlus, Users, X } from 'lucide-react';
import ForumAvatar from '@/components/ForumAvatar';
import { showError, showSuccess } from '@/lib/ui-alerts';

type Profile = {
    user_id: string; username: string; display_name: string; avatar_url: string | null; cover_image_url: string | null; bio: string | null;
    gender: 'male' | 'female' | 'unspecified' | null; xp_points: number | null; rank_title: string | null;
    is_profile_public: boolean; profile_field_visibility: Record<string, 'public' | 'followers' | 'private'>;
    followers_count: number | null; following_count: number | null; is_following: boolean; is_owner: boolean;
};
type Topic = { id: string; title: string; content: string; category: string; related_symbol: string | null; cover_image_url?: string | null; images?: string[]; helpful_count: number; created_at: string; tags?: string[]; visibility?: 'public' | 'followers' };
type ProfilePayload = { data?: { profile: Profile; topics: Topic[]; helpfulTopics: Topic[] }; error?: string };
type FollowNotificationPreference = { mode: 'none' | 'all' | 'selected'; categories: string[] };

const dateLabel = (value: string) => new Date(value).toLocaleDateString('tr-TR', { dateStyle: 'medium' });

export default function SocialProfileWorkspace({ username }: { username: string }) {
    const router = useRouter();
    const [profile, setProfile] = useState<Profile | null>(null);
    const [topics, setTopics] = useState<Topic[]>([]);
    const [helpfulTopics, setHelpfulTopics] = useState<Topic[]>([]);
    const [tab, setTab] = useState<'topics' | 'helpful'>('topics');
    const [busy, setBusy] = useState(false);
    const [notificationBusy, setNotificationBusy] = useState(false);
    const [notificationPreference, setNotificationPreference] = useState<FollowNotificationPreference>({ mode: 'none', categories: [] });
    const [reportOpen, setReportOpen] = useState(false);
    const [reportReason, setReportReason] = useState('inappropriate_profile_photo');
    const [reportDetails, setReportDetails] = useState('');
    const [reportBusy, setReportBusy] = useState(false);
    const [existingReport, setExistingReport] = useState<{ status: string } | null>(null);
    const [error, setError] = useState('');
    const [previewMode, setPreviewMode] = useState(false);

    const load = useCallback(async () => {
        setError('');
        try {
            const response = await fetch(`/api/forum/profiles/${encodeURIComponent(username)}`, { cache: 'no-store' });
            const payload = await response.json() as ProfilePayload;
            if (!response.ok || !payload.data) throw new Error(payload.error ?? 'Profil bulunamadı veya gizli.');
            setProfile(payload.data.profile);
            setTopics(payload.data.topics ?? []);
            setHelpfulTopics(payload.data.helpfulTopics ?? []);
            if (payload.data.profile.is_following && !payload.data.profile.is_owner) {
                const preferenceResponse = await fetch('/api/forum/follows/notifications', { cache: 'no-store' });
                const preferencePayload = await preferenceResponse.json() as {
                    data?: { preferences: Array<{ followed_id: string; mode: FollowNotificationPreference['mode']; categories: string[] }> };
                    error?: string;
                };
                if (!preferenceResponse.ok || !preferencePayload.data) {
                    throw new Error(preferencePayload.error ?? 'Bildirim tercihi yüklenemedi.');
                }
                const preference = preferencePayload.data.preferences.find((item) => item.followed_id === payload.data!.profile.user_id);
                setNotificationPreference(preference
                    ? { mode: preference.mode, categories: preference.categories ?? [] }
                    : { mode: 'none', categories: [] });
            } else {
                setNotificationPreference({ mode: 'none', categories: [] });
            }
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'Profil yüklenemedi.');
        }
    }, [username]);

    useEffect(() => {
        const timer = window.setTimeout(() => { void load(); }, 0);
        return () => window.clearTimeout(timer);
    }, [load]);

    useEffect(() => {
        const timer = window.setTimeout(() => {
            setPreviewMode(new URLSearchParams(window.location.search).get('preview') === '1');
        }, 0);
        return () => window.clearTimeout(timer);
    }, []);

    const toggleFollow = async () => {
        if (!profile) return;
        setBusy(true);
        try {
            const response = await fetch('/api/forum/follows', {
                method: profile.is_following ? 'DELETE' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ followedId: profile.user_id }),
            });
            const payload = await response.json() as { error?: string };
            if (!response.ok) throw new Error(payload.error ?? 'Takip işlemi tamamlanamadı.');
            await load();
            showSuccess(profile.is_following ? 'Takip bırakıldı.' : 'Kullanıcı takip ediliyor.');
        } catch (cause) {
            const message = cause instanceof Error ? cause.message : 'Takip işlemi tamamlanamadı.';
            setError(message);
            showError(message);
            if (cause instanceof Error && /giriş/i.test(cause.message)) router.push(`/auth?next=${encodeURIComponent(`/profile/${username}`)}`);
        } finally {
            setBusy(false);
        }
    };

    const toggleFollowNotifications = async () => {
        if (!profile) return;
        setNotificationBusy(true);
        setError('');
        const preference = notificationPreference.mode === 'none'
            ? { mode: 'all' as const, categories: [] }
            : { mode: 'none' as const, categories: [] };
        try {
            const response = await fetch('/api/forum/follows/notifications', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ followed_id: profile.user_id, ...preference }),
            });
            const payload = await response.json() as { error?: string };
            if (!response.ok) throw new Error(payload.error ?? 'Bildirim tercihi kaydedilemedi.');
            setNotificationPreference(preference);
            showSuccess(preference.mode === 'none' ? 'Paylaşım bildirimleri kapatıldı.' : 'Paylaşım bildirimleri açıldı.');
        } catch (cause) {
            const message = cause instanceof Error ? cause.message : 'Bildirim tercihi kaydedilemedi.';
            setError(message);
            showError(message);
        } finally {
            setNotificationBusy(false);
        }
    };

    const openProfileReport = async () => {
        if (!profile) return;
        setReportBusy(true);
        try {
            const query = new URLSearchParams({ target_type: 'profile', target_id: profile.user_id });
            const response = await fetch(`/api/forum/reports?${query}`, { cache: 'no-store' });
            const payload = await response.json() as { data?: { report: { status: string } | null }; error?: string };
            if (response.status === 401) {
                router.push(`/auth?next=${encodeURIComponent(`/profile/${username}`)}`);
                return;
            }
            if (!response.ok || !payload.data) throw new Error(payload.error ?? 'Profil şikâyet durumu yüklenemedi.');
            setExistingReport(payload.data.report);
            setReportOpen(true);
        } catch (cause) {
            const message = cause instanceof Error ? cause.message : 'Profil şikâyeti açılamadı.';
            setError(message);
            showError(message);
        } finally {
            setReportBusy(false);
        }
    };

    const submitProfileReport = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!profile) return;
        setReportBusy(true);
        try {
            const response = await fetch('/api/forum/reports', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    target_type: 'profile',
                    target_id: profile.user_id,
                    username: profile.username,
                    reason: reportReason,
                    details: reportDetails,
                }),
            });
            const payload = await response.json() as { error?: string };
            if (response.status === 401) {
                router.push(`/auth?next=${encodeURIComponent(`/profile/${username}`)}`);
                return;
            }
            if (!response.ok) throw new Error(payload.error ?? 'Profil şikâyeti gönderilemedi.');
            setReportOpen(false);
            setReportDetails('');
            setExistingReport({ status: 'pending' });
            showSuccess('Profil şikâyetin incelemeye gönderildi.');
        } catch (cause) {
            const message = cause instanceof Error ? cause.message : 'Profil şikâyeti gönderilemedi.';
            setError(message);
            showError(message);
        } finally {
            setReportBusy(false);
        }
    };

    if (!profile) return <main className="min-h-screen bg-slate-950 px-4 py-10 text-slate-100"><div className="mx-auto max-w-5xl rounded-2xl border border-slate-800 bg-slate-900 p-6">{error || 'Profil yükleniyor…'}</div></main>;
    const content = tab === 'topics' ? topics : helpfulTopics;
    const canSeeField = (field: string) => {
        const audience = profile.profile_field_visibility?.[field] ?? 'public';
        if (previewMode) return profile.is_profile_public && audience === 'public';
        return profile.is_owner || ((profile.is_profile_public || profile.is_following)
            && audience !== 'private'
            && (audience === 'public' || profile.is_following));
    };
    const canSeeTopics = canSeeField('topics');
    const canSeeHelpfulTopics = canSeeField('helpful_topics');
    const visibleContent = previewMode
        ? content.filter((topic) => profile.is_profile_public
            && (tab === 'topics' ? canSeeTopics : canSeeHelpfulTopics)
            && (topic.visibility ?? 'public') === 'public')
        : content;
    return <main className="min-h-screen bg-slate-950 px-4 py-8 text-slate-100 md:px-8">
        <div className="mx-auto max-w-5xl space-y-6">
            <Link href="/forum" className="text-xs font-semibold text-slate-400 hover:text-emerald-300">← Topluluk akışına dön</Link>
            {previewMode && <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-xs text-emerald-200"><span>Önizleme: Bu sayfa, takip etmeyen ve oturum açmamış bir ziyaretçinin görebileceği alanlarla gösteriliyor.</span><Link href={`/profile/${encodeURIComponent(profile.username)}`} className="font-bold underline">Önizlemeden çık</Link></div>}
            <section className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 shadow-xl">
                <div className="h-28 bg-gradient-to-r from-emerald-950 via-slate-800 to-slate-900">{canSeeField('cover_image') && profile.cover_image_url && <Image src={profile.cover_image_url} alt="" width={1200} height={400} unoptimized className="h-full w-full object-cover" />}</div>
                <div className="p-5 pt-0 md:p-7 md:pt-0">
                    <div className="-mt-10 flex flex-wrap items-end justify-between gap-4">
                        {canSeeField('avatar_url') && <ForumAvatar avatarUrl={profile.avatar_url} gender={profile.gender} username={profile.username} size={80} className="h-20 w-20 rounded-2xl border-4 border-slate-900 bg-slate-800 object-cover" />}
                        {!profile.is_owner && <div className="flex items-center gap-2">
                            <button disabled={busy} onClick={() => void toggleFollow()} className={`inline-flex items-center gap-2 rounded-lg border px-4 py-2.5 text-xs font-bold transition disabled:opacity-50 ${profile.is_following ? 'border-slate-700 bg-slate-800 text-slate-200 hover:border-rose-500/30 hover:text-rose-300' : 'border-emerald-500/20 bg-emerald-600 text-white hover:bg-emerald-500'}`}>{profile.is_following ? <UserMinus size={15} /> : <UserPlus size={15} />}{profile.is_following ? 'Takibi bırak' : 'Takip et'}</button>
                            {profile.is_following && <button type="button" disabled={notificationBusy} onClick={() => void toggleFollowNotifications()} title={notificationPreference.mode === 'none' ? 'Yeni paylaşımlar için bildirimleri aç' : 'Yeni paylaşım bildirimlerini kapat'} aria-label={notificationPreference.mode === 'none' ? 'Paylaşım bildirimlerini aç' : 'Paylaşım bildirimlerini kapat'} className={`inline-flex h-10 w-10 items-center justify-center rounded-lg border transition disabled:opacity-50 ${notificationPreference.mode === 'none' ? 'border-slate-700 bg-slate-800 text-slate-400 hover:border-emerald-500/30 hover:text-emerald-300' : 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/15'}`}>
                                {notificationPreference.mode === 'none' ? <BellOff size={16} /> : <Bell size={16} />}
                            </button>}
                            {!previewMode && <button type="button" disabled={reportBusy} onClick={() => void openProfileReport()} title="Profili bildir" aria-label="Profili bildir" className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-700 bg-slate-800 text-slate-400 transition hover:border-amber-500/30 hover:text-amber-300 disabled:opacity-50"><Flag size={15} /></button>}
                        </div>}
                    </div>
                    <div className="mt-4 flex flex-wrap items-center gap-2">
                        <h1 className="text-2xl font-extrabold text-white">@{profile.username}</h1>
                        {canSeeField('rank') && profile.rank_title && profile.xp_points !== null && <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-300">{profile.rank_title} · {Number(profile.xp_points).toLocaleString('tr-TR')} XP</span>}
                        {canSeeField('gender') && profile.gender && <span className="rounded-full border border-slate-700 bg-slate-800 px-3 py-1 text-xs text-slate-300">{profile.gender === 'female' ? 'Kadın' : profile.gender === 'male' ? 'Erkek' : 'Belirtmedi'}</span>}
                    </div>
                    {canSeeField('bio') && profile.bio !== null && <p className="mt-3 max-w-3xl whitespace-pre-wrap text-sm leading-6 text-slate-400">{profile.bio || 'Henüz bir profil açıklaması eklenmemiş.'}</p>}
                    <div className="mt-5 flex flex-wrap gap-5 text-xs text-slate-400">
                        {canSeeField('followers') && profile.followers_count !== null && <span className="inline-flex items-center gap-1.5"><Users size={14} className="text-emerald-400" /><strong className="text-white">{Number(profile.followers_count).toLocaleString('tr-TR')}</strong> takipçi</span>}
                        {canSeeField('following') && profile.following_count !== null && <span><strong className="text-white">{Number(profile.following_count).toLocaleString('tr-TR')}</strong> takip</span>}
                        {canSeeTopics && <span><strong className="text-white">{topics.length}</strong> paylaşım</span>}
                    </div>
                </div>
            </section>
            {error && <p role="alert" className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-xs text-rose-300">{error}</p>}
            {reportOpen && <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setReportOpen(false); }}>
                <section role="dialog" aria-modal="true" aria-labelledby="profile-report-title" className="w-full max-w-md space-y-4 rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl">
                    <header className="flex items-start justify-between gap-3">
                        <div><h2 id="profile-report-title" className="font-bold text-white">Profili bildir</h2><p className="mt-1 text-xs leading-5 text-slate-400">@{profile.username} profilini topluluk kuralları açısından yönetime ilet.</p></div>
                        <button type="button" onClick={() => setReportOpen(false)} aria-label="Kapat" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"><X size={17} /></button>
                    </header>
                    {existingReport ? <div className="space-y-2 rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-200">
                        <p>Bu profili daha önce bildirdin. Durum: {existingReport.status === 'pending' ? 'İncelemede bekliyor' : existingReport.status === 'reviewing' ? 'İnceleniyor' : existingReport.status === 'resolved' ? 'Sonuçlandı' : existingReport.status === 'dismissed' ? 'İşlem yapılmadı' : 'Geri çekildi'}.</p>
                        <p>Her profili bir kez bildirebilirsin. Şikâyetini İçeriklerim → Bildirdiklerim bölümünden takip edebilirsin.</p>
                    </div> : <form onSubmit={(event) => void submitProfileReport(event)} className="space-y-4">
                        <label className="block space-y-1.5 text-xs font-semibold text-slate-300">Bildirme nedeni
                            <select value={reportReason} onChange={(event) => setReportReason(event.target.value)} className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 text-sm text-white">
                                <option value="inappropriate_profile_photo">Uygunsuz profil fotoğrafı</option>
                                <option value="inappropriate_username">Uygunsuz kullanıcı adı veya görünen ad</option>
                                <option value="impersonation">Taklit / sahte hesap</option>
                                <option value="profile_other">Diğer profil ihlali</option>
                            </select>
                        </label>
                        <label className="block space-y-1.5 text-xs font-semibold text-slate-300">Açıklama (isteğe bağlı)
                            <textarea maxLength={1000} rows={3} value={reportDetails} onChange={(event) => setReportDetails(event.target.value)} className="w-full resize-y rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 text-sm text-white outline-none focus:ring-2 focus:ring-emerald-500/50" placeholder="Sorunu kısaca açıklayabilirsin." />
                        </label>
                        <div className="flex justify-end gap-2">
                            <button type="button" onClick={() => setReportOpen(false)} className="rounded-lg border border-slate-700 px-4 py-2 text-xs font-semibold text-slate-300">Vazgeç</button>
                            <button disabled={reportBusy} className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-50"><Flag size={13} />{reportBusy ? 'Gönderiliyor…' : 'Şikâyeti gönder'}</button>
                        </div>
                    </form>}
                    {existingReport && <div className="flex justify-end"><button type="button" onClick={() => setReportOpen(false)} className="rounded-lg border border-slate-700 px-4 py-2 text-xs font-semibold text-slate-300">Kapat</button></div>}
                </section>
            </div>}
            <section className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-xl md:p-6">
                <div className="flex gap-2 border-b border-slate-800 pb-3">
                    {canSeeTopics && <button onClick={() => setTab('topics')} className={`rounded-lg px-4 py-2 text-xs font-bold ${tab === 'topics' ? 'bg-emerald-500/10 text-emerald-300' : 'text-slate-400 hover:bg-slate-800'}`}>Paylaşımları</button>}
                    {canSeeHelpfulTopics && <button onClick={() => setTab('helpful')} className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold ${tab === 'helpful' ? 'bg-emerald-500/10 text-emerald-300' : 'text-slate-400 hover:bg-slate-800'}`}><ThumbsUp size={13} />Faydalı buldukları</button>}
                </div>
                {!canSeeTopics && !canSeeHelpfulTopics && <p className="text-xs text-slate-500">Bu kullanıcı paylaşımlarını gizlemiş.</p>}
                {visibleContent.length ? visibleContent.map((topic) => <article key={topic.id} className="rounded-xl border border-slate-800 bg-slate-950/50 p-4">
                    <div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-slate-800 px-2.5 py-1 text-[10px] text-slate-400">{topic.category.replaceAll('_', ' ')}</span>{topic.related_symbol && <Link href={`/forum?symbol=${topic.related_symbol}`} className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-bold text-emerald-300">{topic.related_symbol}</Link>}<span className="inline-flex items-center gap-1 rounded-full border border-slate-700 bg-slate-800 px-2.5 py-1 text-[10px] text-slate-300">{topic.visibility === 'followers' ? <Users size={11} /> : <LockKeyhole size={11} />}{topic.visibility === 'followers' ? 'Takipçilere açık' : 'Herkese açık'}</span><time className="ml-auto text-[10px] text-slate-500">{dateLabel(topic.created_at)}</time></div>
                    {!!topic.tags?.length && <div className="mt-2 flex flex-wrap gap-1.5">{topic.tags.map((tag) => <Link key={tag} href={`/forum?tag=${encodeURIComponent(tag)}`} className="rounded-full border border-slate-700 bg-slate-800/80 px-2 py-1 text-[10px] text-slate-400 hover:text-emerald-300">#{tag}</Link>)}</div>}
                    <Link href={`/forum/${topic.id}`} className="mt-3 block text-base font-bold text-white hover:text-emerald-300">{topic.title}</Link>
                    <p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-slate-400">{topic.content.length > 350 ? `${topic.content.slice(0, 350)}…` : topic.content}</p>
                    {(Boolean(topic.cover_image_url) || (topic.images?.length ?? 0) > 0) && <div className="mt-3 grid grid-cols-3 gap-2">{[topic.cover_image_url, ...(topic.images ?? [])].filter((imageUrl): imageUrl is string => Boolean(imageUrl)).slice(0, 3).map((imageUrl, index) => <Image key={imageUrl} src={imageUrl} alt={`Gönderi görseli ${index + 1}`} width={320} height={180} unoptimized className="h-24 w-full rounded-lg border border-slate-800 object-cover" />)}</div>}
                    <Link href={`/forum/${topic.id}`} className="mt-3 inline-flex items-center gap-1 text-[10px] font-bold text-emerald-300"><MessageCircle size={12} />Tartışmaya katıl <ArrowUpRight size={12} /></Link>
                </article>) : (tab === 'topics' ? canSeeTopics : canSeeHelpfulTopics) && <div className="py-8 text-center text-xs text-slate-500"><LockKeyhole className="mx-auto mb-2 h-5 w-5" />{previewMode && (tab === 'topics' ? topics.length : helpfulTopics.length) > 0 ? 'Bu alan dışarıdan görünür değil.' : tab === 'topics' ? 'Henüz paylaşım yok.' : 'Henüz faydalı olarak işaretlenmiş paylaşım yok.'}</div>}
            </section>
        </div>
    </main>;
}
