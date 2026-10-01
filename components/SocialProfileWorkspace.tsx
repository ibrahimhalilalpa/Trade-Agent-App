'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { ArrowUpRight, LockKeyhole, MessageCircle, ThumbsUp, UserMinus, UserPlus, Users } from 'lucide-react';
import ForumAvatar from '@/components/ForumAvatar';

type Profile = {
    user_id: string; username: string; display_name: string; avatar_url: string | null; cover_image_url: string | null; bio: string | null;
    gender: 'male' | 'female' | 'unspecified' | null; xp_points: number | null; rank_title: string | null;
    is_profile_public: boolean; profile_field_visibility: Record<string, 'public' | 'followers' | 'private'>;
    followers_count: number | null; following_count: number | null; is_following: boolean; is_owner: boolean;
};
type Topic = { id: string; title: string; content: string; category: string; related_symbol: string | null; cover_image_url?: string | null; images?: string[]; helpful_count: number; created_at: string; tags?: string[]; visibility?: 'public' | 'followers' };
type ProfilePayload = { data?: { profile: Profile; topics: Topic[]; helpfulTopics: Topic[] }; error?: string };

const dateLabel = (value: string) => new Date(value).toLocaleDateString('tr-TR', { dateStyle: 'medium' });

export default function SocialProfileWorkspace({ username }: { username: string }) {
    const router = useRouter();
    const [profile, setProfile] = useState<Profile | null>(null);
    const [topics, setTopics] = useState<Topic[]>([]);
    const [helpfulTopics, setHelpfulTopics] = useState<Topic[]>([]);
    const [tab, setTab] = useState<'topics' | 'helpful'>('topics');
    const [busy, setBusy] = useState(false);
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
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'Takip işlemi tamamlanamadı.');
            if (cause instanceof Error && /giriş/i.test(cause.message)) router.push(`/auth?next=${encodeURIComponent(`/profile/${username}`)}`);
        } finally {
            setBusy(false);
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
                        {!profile.is_owner && <button disabled={busy} onClick={() => void toggleFollow()} className={`inline-flex items-center gap-2 rounded-lg border px-4 py-2.5 text-xs font-bold transition disabled:opacity-50 ${profile.is_following ? 'border-slate-700 bg-slate-800 text-slate-200 hover:border-rose-500/30 hover:text-rose-300' : 'border-emerald-500/20 bg-emerald-600 text-white hover:bg-emerald-500'}`}>{profile.is_following ? <UserMinus size={15} /> : <UserPlus size={15} />}{profile.is_following ? 'Takibi bırak' : 'Takip et'}</button>}
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
                    {(topic.cover_image_url || topic.images?.length) && <div className="mt-3 grid grid-cols-3 gap-2">{[topic.cover_image_url, ...(topic.images ?? [])].filter((imageUrl): imageUrl is string => Boolean(imageUrl)).slice(0, 3).map((imageUrl, index) => <Image key={imageUrl} src={imageUrl} alt={`Gönderi görseli ${index + 1}`} width={320} height={180} unoptimized className="h-24 w-full rounded-lg border border-slate-800 object-cover" />)}</div>}
                    <Link href={`/forum/${topic.id}`} className="mt-3 inline-flex items-center gap-1 text-[10px] font-bold text-emerald-300"><MessageCircle size={12} />Tartışmaya katıl <ArrowUpRight size={12} /></Link>
                </article>) : (tab === 'topics' ? canSeeTopics : canSeeHelpfulTopics) && <div className="py-8 text-center text-xs text-slate-500"><LockKeyhole className="mx-auto mb-2 h-5 w-5" />{previewMode && (tab === 'topics' ? topics.length : helpfulTopics.length) > 0 ? 'Bu alan dışarıdan görünür değil.' : tab === 'topics' ? 'Henüz paylaşım yok.' : 'Henüz faydalı olarak işaretlenmiş paylaşım yok.'}</div>}
            </section>
        </div>
    </main>;
}
