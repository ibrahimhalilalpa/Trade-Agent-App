'use client';

import { FormEvent, useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Eye, ImagePlus, LoaderCircle, Save, ShieldAlert } from 'lucide-react';
import { getSupabaseBrowserClient } from '@/lib/supabase-browser';
import { showError, showSuccess } from '@/lib/ui-alerts';
import ForumAvatar from '@/components/ForumAvatar';

type Audience = 'public' | 'followers' | 'private';
type ProfileField = 'avatar_url' | 'bio' | 'gender' | 'rank' | 'followers' | 'following' | 'cover_image' | 'topics' | 'helpful_topics';
type SocialProfile = {
    username: string;
    avatar_url: string | null;
    cover_image_url: string | null;
    profile_field_visibility: Record<ProfileField, Audience>;
    bio: string;
    gender: 'male' | 'female' | 'unspecified';
    is_profile_public: boolean;
};
const VISIBILITY_FIELDS: Array<{ key: ProfileField; label: string }> = [
    { key: 'avatar_url', label: 'Profil görseli' },
    { key: 'bio', label: 'Biyografi' },
    { key: 'gender', label: 'Cinsiyet' },
    { key: 'rank', label: 'Trader Rank ve XP' },
    { key: 'followers', label: 'Takipçi sayısı' },
    { key: 'following', label: 'Takip edilen sayısı' },
    { key: 'cover_image', label: 'Kapak görseli' },
    { key: 'topics', label: 'Paylaşımlar' },
    { key: 'helpful_topics', label: 'Faydalı bulduklarım' },
];
const DEFAULT_VISIBILITY: Record<ProfileField, Audience> = {
    avatar_url: 'public', bio: 'public', gender: 'public', rank: 'public',
    followers: 'public', following: 'public', cover_image: 'public', topics: 'public', helpful_topics: 'public',
};
const INPUT = 'w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 text-xs text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50';

export default function SocialProfileSettings({ onSaved }: { onSaved?: () => void | Promise<void> }) {
    const [profile, setProfile] = useState<SocialProfile | null>(null);
    const [avatarFile, setAvatarFile] = useState<File | null>(null);
    const [coverFile, setCoverFile] = useState<File | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        let active = true;
        void fetch('/api/forum/profile', { cache: 'no-store' })
            .then(async (response) => {
                const payload = await response.json() as { data?: { profile?: SocialProfile }; error?: string };
                if (!response.ok || !payload.data?.profile) throw new Error(payload.error ?? 'Sosyal profil yüklenemedi.');
                if (active) setProfile({
                    ...payload.data.profile,
                    cover_image_url: payload.data.profile.cover_image_url ?? null,
                    profile_field_visibility: { ...DEFAULT_VISIBILITY, ...payload.data.profile.profile_field_visibility },
                });
            })
            .catch((cause) => {
                if (active) setError(cause instanceof Error ? cause.message : 'Sosyal profil yüklenemedi.');
            });
        return () => { active = false; };
    }, []);

    const save = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!profile) return;
        setBusy(true);
        setError('');
        try {
            let avatarUrl = profile.avatar_url;
            let coverImageUrl = profile.cover_image_url;
            if (avatarFile || coverFile) {
                const client = getSupabaseBrowserClient();
                if (!client) throw new Error('Supabase bağlantısı yapılandırılmamış.');
                const { data: { user }, error: authError } = await client.auth.getUser();
                if (authError || !user) throw new Error('Profil görseli yüklemek için giriş yapın.');
                for (const [file, folder, kind] of [[avatarFile, 'avatar', 'Profil'], [coverFile, 'cover', 'Kapak']] as const) {
                    if (!file) continue;
                    const suffix = file.name.split('.').pop()?.toLowerCase() || 'jpg';
                    const path = `${user.id}/${folder}/${crypto.randomUUID()}.${suffix}`;
                    const { error: uploadError } = await client.storage.from('community-media').upload(path, file, {
                        contentType: file.type,
                        upsert: false,
                    });
                    if (uploadError) throw new Error(`${kind} görseli yüklenemedi: ${uploadError.message}`);
                    const publicUrl = client.storage.from('community-media').getPublicUrl(path).data.publicUrl;
                    if (folder === 'avatar') avatarUrl = publicUrl;
                    else coverImageUrl = publicUrl;
                }
            }
            const response = await fetch('/api/forum/profile', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    avatar_url: avatarUrl,
                    cover_image_url: coverImageUrl,
                    bio: profile.bio,
                    gender: profile.gender,
                    is_profile_public: profile.is_profile_public,
                    profile_field_visibility: profile.profile_field_visibility,
                }),
            });
            const payload = await response.json() as { data?: SocialProfile & { auditWarning?: string }; error?: string };
            if (!response.ok || !payload.data) throw new Error(payload.error ?? 'Sosyal profil kaydedilemedi.');
            setProfile(payload.data);
            setAvatarFile(null);
            setCoverFile(null);
            await onSaved?.();
            if (payload.data.auditWarning) {
                setError(payload.data.auditWarning);
                showError(`Profil güncellendi ancak hareket kaydı oluşturulamadı. ${payload.data.auditWarning}`);
            } else {
                showSuccess('Topluluk profilin güncellendi.');
            }
        } catch (cause) {
            const message = cause instanceof Error ? cause.message : 'Sosyal profil kaydedilemedi.';
            setError(message);
            showError(message);
        } finally {
            setBusy(false);
        }
    };

    if (!profile) return <section className="space-y-3 rounded-xl border border-slate-800 bg-slate-950/60 p-4"><h3 className="text-sm font-bold text-white">Topluluk profili</h3><p className="text-xs text-slate-500">{error || 'Profil ayarları yükleniyor…'}</p></section>;
    return <form onSubmit={(event) => void save(event)} className="space-y-3 rounded-xl border border-slate-800 bg-slate-950/60 p-4">
        <div><h3 className="text-sm font-bold text-white">Topluluk profili ve gizlilik</h3><p className="mt-1 text-[10px] text-slate-500">Her bilgi için herkese, takipçilerine veya yalnızca kendine görünürlük belirle.</p></div>
        <Link href={`/profile/${encodeURIComponent(profile.username)}?preview=1`} className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-200 transition hover:border-emerald-500/30 hover:text-emerald-300"><Eye size={14} />Dışarıdan nasıl görünüyor?</Link>
        <div className="flex min-w-0 items-center gap-3">
            <ForumAvatar avatarUrl={profile.avatar_url} gender={profile.gender} username={profile.username} size={48} className="h-12 w-12 shrink-0 aspect-square rounded-full border border-slate-700 object-cover object-center" />
            <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 text-xs text-slate-300 hover:border-emerald-500/30"><ImagePlus size={15} className="shrink-0 text-emerald-400" /><span className="truncate">{avatarFile?.name ?? 'Profil resmi seç (5 MB maks.)'}</span><input type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="sr-only" onChange={(event) => {
                const file = event.target.files?.[0] ?? null;
                if (file && (file.size > 5 * 1024 * 1024 || !['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type))) {
                    setError('JPG, PNG, WebP veya GIF biçiminde, en fazla 5 MB görsel seçin.');
                    setAvatarFile(null);
                } else {
                    setError('');
                    setAvatarFile(file);
                }
            }} /></label>
        </div>
        {profile.avatar_url && <button type="button" onClick={() => { setProfile({ ...profile, avatar_url: null }); setAvatarFile(null); }} className="text-left text-[10px] font-semibold text-slate-400 hover:text-emerald-300">Yüklediğim resmi kaldır, cinsiyete göre varsayılan görseli kullan</button>}
        <div className="flex items-center gap-3">
            {profile.cover_image_url && <Image src={profile.cover_image_url} alt="Profil kapak görseli" width={112} height={48} unoptimized className="h-12 w-28 rounded-lg border border-slate-700 object-cover" />}
            <label className="flex min-w-0 cursor-pointer items-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 text-xs text-slate-300 hover:border-emerald-500/30"><ImagePlus size={15} className="shrink-0 text-emerald-400" /><span className="truncate">{coverFile?.name ?? (profile.cover_image_url ? 'Kapak görselini değiştir' : 'Kapak görseli ekle (5 MB maks.)')}</span><input type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="sr-only" onChange={(event) => {
                const file = event.target.files?.[0] ?? null;
                if (file && (file.size > 5 * 1024 * 1024 || !['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type))) {
                    setError('JPG, PNG, WebP veya GIF biçiminde, en fazla 5 MB kapak görseli seçin.');
                    setCoverFile(null);
                } else {
                    setError('');
                    setCoverFile(file);
                }
            }} /></label>
            {profile.cover_image_url && <button type="button" onClick={() => { setProfile({ ...profile, cover_image_url: null }); setCoverFile(null); }} className="text-[10px] font-semibold text-rose-300">Kaldır</button>}
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
            <label className="space-y-1 text-[10px] font-semibold text-slate-400">Cinsiyet<select value={profile.gender} onChange={(event) => setProfile({ ...profile, gender: event.target.value as SocialProfile['gender'] })} className={INPUT}><option value="unspecified">Belirtmek istemiyorum</option><option value="female">Kadın</option><option value="male">Erkek</option></select></label>
            <label className="space-y-1 text-[10px] font-semibold text-slate-400">Profil sayfası<select value={profile.is_profile_public ? 'public' : 'followers'} onChange={(event) => setProfile({ ...profile, is_profile_public: event.target.value === 'public' })} className={INPUT}><option value="public">Herkese açık</option><option value="followers">Yalnızca takipçilerim ve ben</option></select></label>
        </div>
        <label className="block space-y-1 text-[10px] font-semibold text-slate-400">Hakkında<textarea maxLength={280} rows={3} value={profile.bio} onChange={(event) => setProfile({ ...profile, bio: event.target.value })} placeholder="Kendinden kısaca bahset" className={`${INPUT} resize-y`} /></label>
        <fieldset className="space-y-2 rounded-xl border border-slate-800 bg-slate-900/70 p-3">
            <legend className="px-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">Alan bazında görünürlük</legend>
            <div className="grid gap-2 sm:grid-cols-2">
                {VISIBILITY_FIELDS.map(({ key, label }) => <label key={key} className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(7rem,9rem)] items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-2 text-[10px] text-slate-300">
                    <span className="min-w-0 whitespace-normal break-words leading-4">{label}</span>
                    <select value={profile.profile_field_visibility[key]} onChange={(event) => setProfile({
                        ...profile,
                        profile_field_visibility: { ...profile.profile_field_visibility, [key]: event.target.value as Audience },
                    })} className={`${INPUT} min-w-0 px-2 py-1.5`}>
                        <option value="public">Herkes</option>
                        <option value="followers">Takipçiler</option>
                        <option value="private">Yalnızca ben</option>
                    </select>
                </label>)}
            </div>
            <p className="text-[10px] leading-4 text-slate-500">Gizli profil seçiliyse profil alanlarını yalnızca takipçilerin ve sen görebilirsin; “Yalnızca ben” ayarı takipçilerden de gizler.</p>
        </fieldset>
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-[10px] leading-4 text-amber-200"><ShieldAlert size={14} className="mt-0.5 shrink-0 text-amber-300" /><span>Ahlak dışı, yanıltıcı veya uygunsuz profil resmi kullanan hesaplar topluluk kurallarına göre süresiz olarak (hesap/forum) engellenebilir. Görsel yüklemeleri yönetim incelemesine tabidir.</span></div>
        {error && <p role="alert" className="text-xs text-rose-300">{error}</p>}
        <button disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-50">{busy ? <LoaderCircle size={14} className="animate-spin" /> : <Save size={14} />}Değişiklikleri kaydet</button>
    </form>;
}
