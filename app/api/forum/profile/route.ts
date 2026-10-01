import { hasProfanity } from '@/lib/profanityFilter';
import {
    apiError, apiSuccess, apiValidationError, attachTopicDetails, databaseError, ForumTopicRecord, getForumClient,
    isApiError, publicHelpfulTopicIds, readJson, requireForumUser, safeHttpsUrl, textField,
} from '@/lib/forum';

const USERNAME_PATTERN = /^[a-z0-9_]{3,24}$/;
const GENDERS = ['male', 'female', 'unspecified'] as const;
const PROFILE_FIELDS = ['avatar_url', 'bio', 'gender', 'rank', 'followers', 'following', 'cover_image', 'topics', 'helpful_topics'] as const;
const PROFILE_AUDIENCES = ['public', 'followers', 'private'] as const;
const PROFILE_FIELD_LABELS: Record<(typeof PROFILE_FIELDS)[number], string> = {
    avatar_url: 'profil görseli',
    bio: 'biyografi',
    gender: 'cinsiyet',
    rank: 'Trader Rank ve XP',
    followers: 'takipçi sayısı',
    following: 'takip edilen sayısı',
    cover_image: 'kapak görseli',
    topics: 'paylaşımlar',
    helpful_topics: 'faydalı bulduklarım',
};
const AUDIENCE_LABELS: Record<(typeof PROFILE_AUDIENCES)[number], string> = {
    public: 'herkese açık',
    followers: 'takipçilere açık',
    private: 'yalnızca bana açık',
};
const GENDER_LABELS: Record<(typeof GENDERS)[number], string> = {
    male: 'erkek',
    female: 'kadın',
    unspecified: 'belirtilmedi',
};

export async function GET(request: Request) {
    const params = new URL(request.url).searchParams;
    let username = params.get('username')?.trim().replace(/^@/, '').toLowerCase();
    const client = await getForumClient();
    if (!client) return apiError('Supabase bağlantısı yapılandırılmamış.', 503, 'SERVICE_UNAVAILABLE');
    const { data: authData, error: authError } = await client.auth.getUser();
    if (authError) return databaseError(authError, 'Oturum bilgisi okunamadı.');
    const viewerId = authData.user?.id ?? null;
    const isCurrentProfile = !username;
    if (!username) {
        if (!viewerId) return apiError('Bu işlem için giriş yapmalısınız.', 401, 'UNAUTHENTICATED');
        const { data, error } = await client.from('user_profiles').select('username')
            .eq('user_id', viewerId).maybeSingle();
        if (error) return databaseError(error, 'Profil yüklenemedi.');
        if (!data?.username) return apiError('Profil bulunamadı.', 404, 'NOT_FOUND');
        username = data.username;
    }
    if (!username || !/^[a-z0-9_]{3,24}$/.test(username)) return apiError('Kullanıcı adı geçersiz.', 400, 'INVALID_USERNAME');
    const { data: profiles, error: profileError } = await client.rpc('forum_public_profile', { p_username: username });
    if (profileError) return databaseError(profileError, 'Profil yüklenemedi.');
    const profile = profiles?.[0];
    if (!profile) return apiError('Profil bulunamadı veya gizli.', 404, 'NOT_FOUND');
    if (isCurrentProfile && viewerId === profile.user_id) {
        const { data: liveRank, error: rankError } = await client.rpc('sync_forum_rank', { p_user_id: viewerId });
        if (rankError) return databaseError(rankError, 'Trader Rank bilgisi yüklenemedi.');
        const { data: ownProfile, error: ownProfileError } = await client.from('user_profiles')
            .select('user_id, username, avatar_url, cover_image_url, profile_field_visibility, bio, gender, is_profile_public, xp_points, rank_title, leaderboard_visible, leaderboard_gain_visible')
            .eq('user_id', viewerId).maybeSingle();
        if (ownProfileError) return databaseError(ownProfileError, 'Profil yüklenemedi.');
        if (!ownProfile) return apiError('Kullanıcı profili bulunamadı.', 404, 'NOT_FOUND');
        Object.assign(profile, ownProfile);
        profile.xp_points = Number(liveRank?.xp ?? profile.xp_points);
        profile.rank_title = String(liveRank?.rank ?? profile.rank_title);
    }
    const topicsVisibility = await client.rpc('forum_profile_field_is_visible', {
        p_user_id: profile.user_id,
        p_field: 'topics',
    });
    if (topicsVisibility.error) return databaseError(topicsVisibility.error, 'Paylaşım görünürlüğü doğrulanamadı.');
    const topicsResult = topicsVisibility.data
        ? await client.from('forum_topics')
            .select('id, user_id, title, content, category, related_symbol, cover_image_url, images, tags, visibility, is_pinned, is_closed, helpful_count, unhelpful_count, views_count, created_at, updated_at')
            .eq('user_id', profile.user_id).order('created_at', { ascending: false }).limit(20)
        : { data: [], error: null };
    if (topicsResult.error) return databaseError(topicsResult.error, 'Profil konuları yüklenemedi.');
    const topics = await attachTopicDetails(client, (topicsResult.data ?? []) as ForumTopicRecord[], viewerId);
    if (topics.error) return databaseError(topics.error, 'Profil konuları yüklenemedi.');
    let helpfulTopics: Array<ForumTopicRecord & { author: unknown; current_user_vote: unknown }> = [];
    const helpfulIds = await publicHelpfulTopicIds(client, profile.user_id);
    if (helpfulIds.error) return databaseError(helpfulIds.error, 'Beğenilen konular yüklenemedi.');
    if (helpfulIds.ids.length) {
        const helpfulResult = await client.from('forum_topics')
            .select('id, user_id, title, content, category, related_symbol, cover_image_url, images, tags, visibility, is_pinned, is_closed, helpful_count, unhelpful_count, views_count, created_at, updated_at')
            .in('id', helpfulIds.ids).order('created_at', { ascending: false });
        if (helpfulResult.error) return databaseError(helpfulResult.error, 'Beğenilen konular yüklenemedi.');
        const attached = await attachTopicDetails(client, (helpfulResult.data ?? []) as ForumTopicRecord[], viewerId);
        if (attached.error) return databaseError(attached.error, 'Beğenilen konu yazarları veya oylar yüklenemedi.');
        helpfulTopics = attached.topics;
    }
    return apiSuccess({ profile, topics: topics.topics, helpfulTopics });
}

export async function PATCH(request: Request) {
    const auth = await requireForumUser();
    if (auth.response) return auth.response;
    const body = await readJson(request);
    if (!body) return apiError('Geçersiz JSON isteği.');
    const patch: Record<string, unknown> = {};
    if ('username' in body) {
        const username = textField(body.username, 'Kullanıcı adı', 3, 24);
        if (isApiError(username)) return apiValidationError(username);
        const normalized = username.toLowerCase();
        if (!USERNAME_PATTERN.test(normalized)) return apiError('Kullanıcı adı 3-24 karakter olmalı; yalnızca İngilizce harf, rakam ve alt çizgi içerebilir.', 400, 'INVALID_USERNAME');
        if (hasProfanity(normalized)) return apiError('Kullanıcı adı uygun olmayan ifadeler içeremez.', 400, 'PROFANITY');
        patch.username = normalized;
    }
    if ('displayName' in body) {
        if (body.displayName === null || body.displayName === '') {
            patch.display_name = null;
        } else {
            const displayName = textField(body.displayName, 'Görünen ad', 1, 80, true);
            if (isApiError(displayName)) return apiValidationError(displayName);
            patch.display_name = displayName;
        }
    }
    if ('bio' in body) {
        if (body.bio === null || body.bio === '') {
            patch.bio = '';
        } else {
            const bio = textField(body.bio, 'Biyografi', 0, 280, true);
            if (isApiError(bio)) return apiValidationError(bio);
            patch.bio = bio;
        }
    }
    if ('gender' in body) {
        if (typeof body.gender !== 'string' || !GENDERS.includes(body.gender as (typeof GENDERS)[number])) {
            return apiError('Cinsiyet alanı geçersiz.', 400, 'INVALID_GENDER');
        }
        patch.gender = body.gender;
    }
    if ('avatar_url' in body || 'avatarUrl' in body) {
        const avatarUrl = safeHttpsUrl(body.avatar_url ?? body.avatarUrl, 'Profil görseli');
        if (isApiError(avatarUrl)) return apiValidationError(avatarUrl);
        patch.avatar_url = avatarUrl;
    }
    if ('is_profile_public' in body || 'isProfilePublic' in body) {
        const visibility = body.is_profile_public ?? body.isProfilePublic;
        if (typeof visibility !== 'boolean') return apiError('Profil görünürlüğü true veya false olmalıdır.', 400, 'INVALID_FIELD');
        patch.is_profile_public = visibility;
    }
    if ('cover_image_url' in body || 'coverImageUrl' in body) {
        const coverImageUrl = safeHttpsUrl(body.cover_image_url ?? body.coverImageUrl, 'Kapak görseli');
        if (isApiError(coverImageUrl)) return apiValidationError(coverImageUrl);
        patch.cover_image_url = coverImageUrl;
    }
    if ('profile_field_visibility' in body || 'profileFieldVisibility' in body) {
        const visibility = body.profile_field_visibility ?? body.profileFieldVisibility;
        if (!visibility || typeof visibility !== 'object' || Array.isArray(visibility)) {
            return apiError('Profil alanı görünürlük ayarları geçersiz.', 400, 'INVALID_VISIBILITY');
        }
        const entries = Object.entries(visibility);
        if (entries.some(([field, audience]) =>
            !PROFILE_FIELDS.includes(field as (typeof PROFILE_FIELDS)[number])
            || !PROFILE_AUDIENCES.includes(audience as (typeof PROFILE_AUDIENCES)[number]))) {
            return apiError('Her profil alanı herkese açık, takipçilere açık veya gizli olmalıdır.', 400, 'INVALID_VISIBILITY');
        }
        patch.profile_field_visibility = visibility;
    }
    if (!Object.keys(patch).length) return apiError('Güncellenecek bir alan belirtilmedi.');
    const { data: previous, error: previousError } = await auth.client.from('user_profiles')
        .select('username, avatar_url, cover_image_url, profile_field_visibility, bio, gender, is_profile_public')
        .eq('user_id', auth.user.id).maybeSingle();
    if (previousError) return databaseError(previousError, 'Mevcut profil bilgileri okunamadı.');
    if (!previous) return apiError('Kullanıcı profili bulunamadı.', 404, 'NOT_FOUND');
    const { data, error } = await auth.client.from('user_profiles').update(patch).eq('user_id', auth.user.id)
        .select('user_id, username, display_name, avatar_url, cover_image_url, profile_field_visibility, bio, gender, xp_points, rank_title, is_profile_public')
        .maybeSingle();
    if (error) return databaseError(error, 'Profil güncellenemedi.');
    if (!data) return apiError('Kullanıcı profili bulunamadı veya güncelleme yetkiniz yok.', 404, 'NOT_FOUND');
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    const descriptions: string[] = [];
    if (previous.avatar_url !== data.avatar_url) {
        changes.avatar_url = { from: previous.avatar_url, to: data.avatar_url };
        descriptions.push('profil görseli değiştirildi');
    }
    if (previous.cover_image_url !== data.cover_image_url) {
        changes.cover_image_url = { from: previous.cover_image_url, to: data.cover_image_url };
        descriptions.push('profil kapak görseli güncellendi');
    }
    if (JSON.stringify(previous.profile_field_visibility) !== JSON.stringify(data.profile_field_visibility)) {
        changes.profile_field_visibility = { from: previous.profile_field_visibility, to: data.profile_field_visibility };
        for (const field of PROFILE_FIELDS) {
            const previousAudience = previous.profile_field_visibility?.[field] ?? 'public';
            const nextAudience = data.profile_field_visibility?.[field] ?? 'public';
            if (previousAudience !== nextAudience) {
                descriptions.push(
                    `${PROFILE_FIELD_LABELS[field]} görünürlüğü ${AUDIENCE_LABELS[previousAudience as (typeof PROFILE_AUDIENCES)[number]] ?? 'herkese açık'} → ${AUDIENCE_LABELS[nextAudience as (typeof PROFILE_AUDIENCES)[number]] ?? 'herkese açık'}`,
                );
            }
        }
    }
    if (previous.gender !== data.gender) {
        changes.gender = { from: previous.gender, to: data.gender };
        const previousGender = GENDER_LABELS[previous.gender as (typeof GENDERS)[number]] ?? 'belirtilmedi';
        const nextGender = GENDER_LABELS[data.gender as (typeof GENDERS)[number]] ?? 'belirtilmedi';
        descriptions.push(`cinsiyet ${previousGender} → ${nextGender} olarak değiştirildi`);
    }
    if (previous.is_profile_public !== data.is_profile_public) {
        changes.is_profile_public = { from: previous.is_profile_public, to: data.is_profile_public };
        descriptions.push(`profil görünürlüğü ${data.is_profile_public ? 'herkese açık' : 'gizli'} yapıldı`);
    }
    if (previous.username !== data.username) {
        changes.username = { from: previous.username, to: data.username };
        descriptions.push('kullanıcı adı değiştirildi');
    }
    if (previous.bio !== data.bio) {
        changes.bio_changed = { from: previous.bio !== '', to: data.bio !== '' };
        descriptions.push('biyografi güncellendi');
    }
    if (descriptions.length) {
        const { error: auditError } = await auth.client.from('user_activity_logs').insert({
            user_id: auth.user.id,
            event_type: 'profile_updated',
            description: `Topluluk profili güncellendi: ${descriptions.join('; ')}.`,
            metadata: { source: 'community_profile', changes },
        });
        if (auditError) {
            console.error('Community profile audit logging failed.', auditError);
            return apiSuccess({ ...data, auditWarning: 'Profil kaydedildi ancak yönetim etkinlik kaydı eklenemedi.' });
        }
    }
    return apiSuccess(data);
}
