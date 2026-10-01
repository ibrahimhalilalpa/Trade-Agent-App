import {
    apiError, apiSuccess, attachTopicDetails, databaseError, ForumTopicRecord, getForumClient,
    publicHelpfulTopicIds, requireForumUser,
} from '@/lib/forum';
import { PATCH as updateCurrentProfile } from '../../profile/route';

type RouteContext = { params: Promise<{ username: string }> };

export async function GET(_request: Request, { params }: RouteContext) {
    const { username } = await params;
    const normalizedUsername = username.trim().replace(/^@/, '').toLowerCase();
    if (!/^[a-z0-9_]{3,24}$/.test(normalizedUsername)) return apiError('Kullanıcı adı geçersiz.', 400, 'INVALID_USERNAME');
    const client = await getForumClient();
    if (!client) return apiError('Supabase bağlantısı yapılandırılmamış.', 503, 'SERVICE_UNAVAILABLE');
    const { data, error } = await client.rpc('forum_public_profile', { p_username: normalizedUsername });
    if (error) return databaseError(error, 'Profil yüklenemedi.');
    const profile = data?.[0];
    if (!profile) return apiError('Profil bulunamadı veya gizli.', 404, 'NOT_FOUND');
    const { data: authData } = await client.auth.getUser();
    const viewerId = authData.user?.id ?? null;
    if (viewerId === profile.user_id) {
        const { data: liveRank, error: rankError } = await client.rpc('sync_forum_rank', { p_user_id: viewerId });
        if (rankError) return databaseError(rankError, 'Trader Rank bilgisi yüklenemedi.');
        profile.xp_points = Number(liveRank?.xp ?? profile.xp_points);
        profile.rank_title = String(liveRank?.rank ?? profile.rank_title);
    }
    const topicsVisibility = await client.rpc('forum_profile_field_is_visible', {
        p_user_id: profile.user_id,
        p_field: 'topics',
    });
    if (topicsVisibility.error) return databaseError(topicsVisibility.error, 'Paylaşım görünürlüğü doğrulanamadı.');
    let topics: Awaited<ReturnType<typeof attachTopicDetails>> = { topics: [], error: null };
    if (topicsVisibility.data) {
        const topicsResult = await client.from('forum_topics')
            .select('id, user_id, title, content, category, related_symbol, cover_image_url, images, tags, visibility, is_pinned, is_closed, helpful_count, unhelpful_count, views_count, created_at, updated_at')
            .eq('user_id', profile.user_id).order('created_at', { ascending: false }).limit(20);
        if (topicsResult.error) return databaseError(topicsResult.error, 'Profil konuları yüklenemedi.');
        topics = await attachTopicDetails(client, (topicsResult.data ?? []) as ForumTopicRecord[], viewerId);
        if (topics.error) return databaseError(topics.error, 'Profil konuları yüklenemedi.');
    }
    let helpfulTopics: Array<ForumTopicRecord & { author: unknown; current_user_vote: unknown }> = [];
    const helpfulIds = await publicHelpfulTopicIds(client, profile.user_id);
    if (helpfulIds.error) return databaseError(helpfulIds.error, 'Beğenilen konular yüklenemedi.');
    if (helpfulIds.ids.length) {
        const rows = await client.from('forum_topics')
            .select('id, user_id, title, content, category, related_symbol, cover_image_url, images, tags, visibility, is_pinned, is_closed, helpful_count, unhelpful_count, views_count, created_at, updated_at')
            .in('id', helpfulIds.ids).order('created_at', { ascending: false });
        if (rows.error) return databaseError(rows.error, 'Beğenilen konular yüklenemedi.');
        const attached = await attachTopicDetails(client, (rows.data ?? []) as ForumTopicRecord[], viewerId);
        if (attached.error) return databaseError(attached.error, 'Beğenilen konu yazarları veya oylar yüklenemedi.');
        helpfulTopics = attached.topics;
    }
    return apiSuccess({ profile, topics: topics.topics, helpfulTopics });
}

export async function PATCH(request: Request, { params }: RouteContext) {
    const { username } = await params;
    const auth = await requireForumUser();
    if (auth.response) return auth.response;
    const { data, error } = await auth.client.from('user_profiles').select('username')
        .eq('user_id', auth.user.id).maybeSingle();
    if (error) return databaseError(error, 'Profil yüklenemedi.');
    if (!data?.username || data.username.toLowerCase() !== username.trim().replace(/^@/, '').toLowerCase()) {
        return apiError('Yalnızca kendi profilinizi güncelleyebilirsiniz.', 403, 'FORBIDDEN');
    }
    return updateCurrentProfile(request);
}
