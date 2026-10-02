import { hasProfanity } from '@/lib/profanityFilter';
import {
    apiError, apiSuccess, apiValidationError, databaseError, forumCommentDatabaseError, getForumClient, isApiError,
    attachTopicDetails, ForumPublicProfile, ForumTopicRecord, isUuid, normalizeSymbol, publicProfiles, readJson, requireForumUser, safeHttpsUrl, textField, isCategory,
} from '@/lib/forum';

type RouteContext = { params: Promise<{ topicId: string }> };

export async function GET(_request: Request, { params }: RouteContext) {
    const { topicId } = await params;
    if (!isUuid(topicId)) return apiError('Konu kimliği geçersiz.', 400, 'INVALID_UUID');
    const client = await getForumClient();
    if (!client) return apiError('Supabase bağlantısı yapılandırılmamış.', 503, 'SERVICE_UNAVAILABLE');
    const { data: authData, error: authError } = await client.auth.getUser();
    if (authError) console.error('Forum topic could not resolve the optional viewer session.', authError);
    const user = authError ? null : authData.user;
    if (user) {
        const view = await client.rpc('record_forum_topic_view', { p_topic_id: topicId });
        if (view.error) console.error('Forum topic view could not be recorded.', { topicId, error: view.error });
    }
    const topicResult = await client.from('forum_topics')
        .select('id, user_id, title, content, category, related_symbol, cover_image_url, images, tags, visibility, is_pinned, is_closed, helpful_count, unhelpful_count, views_count, created_at, updated_at')
        .eq('id', topicId).maybeSingle();
    if (topicResult.error) return databaseError(topicResult.error, 'Konu yüklenemedi.');
    if (!topicResult.data) return apiError('Konu bulunamadı.', 404, 'NOT_FOUND');
    const commentsResult = await client.from('forum_comments')
        .select('id, topic_id, parent_comment_id, user_id, content, attachment_url, helpful_count, unhelpful_count, created_at, updated_at')
        .eq('topic_id', topicId).order('created_at', { ascending: true }).limit(500);
    let commentRows = commentsResult.data;
    if (commentsResult.error?.code === '42703' || commentsResult.error?.code === 'PGRST204') {
        console.error('Forum reply column is unavailable; loading topic comments without reply threading.', commentsResult.error);
        const legacyComments = await client.from('forum_comments')
            .select('id, topic_id, user_id, content, attachment_url, helpful_count, unhelpful_count, created_at, updated_at')
            .eq('topic_id', topicId).order('created_at', { ascending: true }).limit(500);
        if (legacyComments.error) return forumCommentDatabaseError(legacyComments.error, 'Yorumlar yüklenemedi.');
        commentRows = (legacyComments.data ?? []).map((comment) => ({ ...comment, parent_comment_id: null }));
    } else if (commentsResult.error) {
        return forumCommentDatabaseError(commentsResult.error, 'Yorumlar yüklenemedi.');
    }
    const allUserIds = [topicResult.data.user_id, ...(commentRows ?? []).map((comment) => comment.user_id)];
    const profileResult = await publicProfiles(client, allUserIds);
    if (profileResult.error) return databaseError(profileResult.error, 'Kullanıcı profilleri yüklenemedi.');
    const attachedTopic = await attachTopicDetails(client, [topicResult.data as ForumTopicRecord], user?.id ?? null);
    if (attachedTopic.error) return databaseError(attachedTopic.error, 'Konu yazarı veya oyu yüklenemedi.');
    const profileById = new Map(((profileResult.data ?? []) as ForumPublicProfile[])
        .map((profile) => [profile.user_id, profile]));
    const commentIds = (commentRows ?? []).map((comment) => comment.id);
    const commentVotesResult = user && commentIds.length
        ? await client.from('topic_votes').select('comment_id, vote')
            .eq('user_id', user.id).in('comment_id', commentIds)
        : { data: [], error: null };
    if (commentVotesResult.error && commentVotesResult.error.code !== '42703') {
        return databaseError(commentVotesResult.error, 'Yorum oyları yüklenemedi.');
    }
    if (commentVotesResult.error) {
        console.error('Comment vote lookup is unavailable; loading comments without the current user vote.', commentVotesResult.error);
    }
    const currentCommentVote = new Map(
        (commentVotesResult.data ?? []).flatMap((vote) =>
            vote.comment_id && (vote.vote === 'helpful' || vote.vote === 'unhelpful')
                ? [[vote.comment_id, vote.vote] as [string, string]]
                : [],
        ),
    );
    return apiSuccess({
        topic: attachedTopic.topics[0],
        comments: (commentRows ?? []).map((comment) => ({
            ...comment,
            author: profileById.get(comment.user_id) ?? null,
            current_user_vote: currentCommentVote.get(comment.id) ?? null,
        })),
        currentUserId: user?.id ?? null,
    });
}

export async function PATCH(request: Request, { params }: RouteContext) {
    const { topicId } = await params;
    if (!isUuid(topicId)) return apiError('Konu kimliği geçersiz.', 400, 'INVALID_UUID');
    const auth = await requireForumUser();
    if (auth.response) return auth.response;
    const body = await readJson(request);
    if (!body) return apiError('Geçersiz JSON isteği.');
    const patch: Record<string, unknown> = {};
    if ('title' in body) {
        const title = textField(body.title, 'Başlık', 3, 180, true);
        if (isApiError(title)) return apiValidationError(title);
        patch.title = title;
    }
    if ('content' in body) {
        const content = textField(body.content, 'İçerik', 1, 13800, true);
        if (isApiError(content)) return apiValidationError(content);
        patch.content = content;
    }
    if ('category' in body) {
        if (!isCategory(body.category)) return apiError('Kategori geçersiz.', 400, 'INVALID_CATEGORY');
        const { data: categoryRecord, error: categoryError } = await auth.client.from('forum_categories')
            .select('slug').eq('slug', body.category).eq('is_active', true).maybeSingle();
        if (categoryError) return databaseError(categoryError, 'Topluluk kategorisi doğrulanamadı.');
        if (!categoryRecord) return apiError('Seçilen kategori artık kullanılamıyor.', 400, 'INVALID_CATEGORY');
        patch.category = body.category;
    }
    if ('related_symbol' in body) {
        const symbol = normalizeSymbol(body.related_symbol);
        if (isApiError(symbol)) return apiValidationError(symbol);
        patch.related_symbol = symbol;
    }
    if ('cover_image_url' in body) {
        const coverImageUrl = safeHttpsUrl(body.cover_image_url, 'Kapak görseli');
        if (isApiError(coverImageUrl)) return apiValidationError(coverImageUrl);
        patch.cover_image_url = coverImageUrl;
    }
    if ('images' in body) {
        if (!Array.isArray(body.images) || body.images.length > 5) return apiError('En fazla 5 içerik görseli ekleyebilirsiniz.', 400, 'INVALID_IMAGES');
        const images: string[] = [];
        for (const [index, value] of body.images.entries()) {
            const imageUrl = safeHttpsUrl(value, `İçerik görseli ${index + 1}`);
            if (isApiError(imageUrl)) return apiValidationError(imageUrl);
            if (imageUrl) images.push(imageUrl);
        }
        patch.images = images;
    }
    if ('tags' in body) {
        if (!Array.isArray(body.tags) || body.tags.length > 5) return apiError('En fazla 5 etiket ekleyebilirsiniz.', 400, 'INVALID_TAGS');
        const tags: string[] = [];
        for (const value of body.tags) {
            const tag = textField(value, 'Etiket', 1, 30, true);
            if (isApiError(tag)) return apiValidationError(tag);
            const normalizedTag = tag.replace(/^#/, '').trim().toLocaleLowerCase('tr-TR');
            if (!/^[\p{L}\p{N}_-]{1,30}$/u.test(normalizedTag) || hasProfanity(normalizedTag)) return apiError('Etiket yalnızca uygun ifadelerle harf, rakam, alt çizgi ve tire içerebilir.', 400, 'INVALID_TAG');
            if (normalizedTag && !tags.includes(normalizedTag)) tags.push(normalizedTag);
        }
        patch.tags = tags;
    }
    if ('visibility' in body) {
        if (body.visibility !== 'public' && body.visibility !== 'followers') return apiError('Gönderi görünürlüğü geçersiz.', 400, 'INVALID_VISIBILITY');
        patch.visibility = body.visibility;
    }
    let isAdmin = false;
    if ('is_pinned' in body || 'is_closed' in body) {
        const { data: roleData, error: roleError } = await auth.client.from('user_roles')
            .select('role').eq('user_id', auth.user.id).maybeSingle();
        if (roleError) return databaseError(roleError, 'Yetki bilgisi doğrulanamadı.');
        isAdmin = roleData?.role === 'admin' || roleData?.role === 'super_admin';
    }
    for (const field of ['is_pinned', 'is_closed'] as const) {
        if (field in body) {
            if (!isAdmin) return apiError('Bu alanı yalnızca yöneticiler değiştirebilir.', 403, 'FORBIDDEN');
            if (typeof body[field] !== 'boolean') return apiError(`${field} true veya false olmalıdır.`);
            patch[field] = body[field];
        }
    }
    if (!Object.keys(patch).length) return apiError('Güncellenecek bir alan belirtilmedi.');
    const { data, error } = await auth.client.from('forum_topics').update(patch)
        .eq('id', topicId).select('id, user_id, title, content, category, related_symbol, cover_image_url, images, tags, visibility, is_pinned, is_closed, helpful_count, unhelpful_count, views_count, created_at, updated_at').maybeSingle();
    if (error?.code === 'P0001' && error.message.includes('one-hour edit window')) {
        console.error('Forum topic update was rejected because its edit window expired.', { topicId, error });
        return apiError('Konuyu oluşturduktan sonraki 1 saat içinde düzenleyebilirsiniz.', 403, 'EDIT_WINDOW_EXPIRED');
    }
    if (error?.code === '42501') {
        console.error('Forum topic update was rejected by row-level security.', { topicId, error });
        return apiError('Konu düzenleme yetkiniz yok veya düzenleme süresi sona erdi.', 403, 'FORBIDDEN');
    }
    if (error?.code === '42703' || error?.code === 'PGRST204' || error?.code === 'PGRST205') {
        return databaseError(error, 'Forum veritabanı güncellemesi eksik. community-forum-migration.sql ve sonraki forum migration dosyalarını çalıştırın.');
    }
    if (error) return databaseError(error, 'Konu güncellenemedi.');
    if (!data) return apiError('Konu bulunamadı veya düzenleme yetkiniz yok.', 404, 'NOT_FOUND');
    const attached = await attachTopicDetails(auth.client, [data as ForumTopicRecord], auth.user.id);
    if (attached.error) return databaseError(attached.error, 'Konu yazarı veya oyu yüklenemedi.');
    const commentsResult = await auth.client.from('forum_comments')
        .select('id, topic_id, user_id, content, attachment_url, helpful_count, unhelpful_count, created_at, updated_at')
        .eq('topic_id', topicId).order('created_at', { ascending: true }).limit(500);
    if (commentsResult.error) return databaseError(commentsResult.error, 'Yorumlar yüklenemedi.');
    const profileResult = await publicProfiles(auth.client, (commentsResult.data ?? []).map((comment) => comment.user_id));
    if (profileResult.error) return databaseError(profileResult.error, 'Yorum yazarları yüklenemedi.');
    const profileById = new Map(((profileResult.data ?? []) as ForumPublicProfile[])
        .map((profile) => [profile.user_id, profile]));
    const commentIds = (commentsResult.data ?? []).map((comment) => comment.id);
    const commentVotesResult = commentIds.length
        ? await auth.client.from('topic_votes').select('comment_id, vote')
            .eq('user_id', auth.user.id).in('comment_id', commentIds)
        : { data: [], error: null };
    if (commentVotesResult.error) return databaseError(commentVotesResult.error, 'Yorum oyları yüklenemedi.');
    const commentVotes = new Map(
        (commentVotesResult.data ?? []).flatMap((vote) =>
            vote.comment_id && (vote.vote === 'helpful' || vote.vote === 'unhelpful')
                ? [[vote.comment_id, vote.vote] as [string, string]]
                : [],
        ),
    );
    return apiSuccess({
        topic: attached.topics[0],
        comments: (commentsResult.data ?? []).map((comment) => ({
            ...comment,
            author: profileById.get(comment.user_id) ?? null,
            current_user_vote: commentVotes.get(comment.id) ?? null,
        })),
        currentUserId: auth.user.id,
    });
}

export async function DELETE(_request: Request, { params }: RouteContext) {
    const { topicId } = await params;
    if (!isUuid(topicId)) return apiError('Konu kimliği geçersiz.', 400, 'INVALID_UUID');
    const auth = await requireForumUser();
    if (auth.response) return auth.response;
    const { data, error } = await auth.client.from('forum_topics').delete().eq('id', topicId).select('id').maybeSingle();
    if (error) return databaseError(error, 'Konu silinemedi.');
    if (!data) return apiError('Konu bulunamadı veya silme yetkiniz yok.', 404, 'NOT_FOUND');
    return apiSuccess({ topic: null, comments: [], currentUserId: auth.user.id });
}
