import { hasProfanity } from '@/lib/profanityFilter';
import {
    apiError, apiSuccess, apiValidationError, attachTopicDetails, databaseError, ForumTopicRecord, getForumClient, isApiError,
    isCategory, normalizeSymbol, parseLimit, parseOffset, readJson,
    requireForumUser, safeHttpsUrl, textField,
} from '@/lib/forum';

export async function GET(request: Request) {
    const client = await getForumClient();
    if (!client) return apiError('Supabase bağlantısı yapılandırılmamış.', 503, 'SERVICE_UNAVAILABLE');
    const params = new URL(request.url).searchParams;
    const category = params.get('category');
    if (category && !isCategory(category)) return apiError('Kategori geçersiz.', 400, 'INVALID_CATEGORY');
    const symbol = normalizeSymbol(params.get('symbol'));
    if (isApiError(symbol)) return apiValidationError(symbol);
    const tag = params.get('tag')?.trim().replace(/^#/, '').toLocaleLowerCase('tr-TR');
    if (tag && (tag.length > 30 || !/^[\p{L}\p{N}_-]+$/u.test(tag))) return apiError('Etiket filtresi geçersiz.', 400, 'INVALID_TAG');
    const requestedSort = params.get('sort') ?? 'recent';
    const mine = params.get('mine') === '1';
    if (!['recent', 'trending', 'latest', 'newest', 'popular', 'helpful', 'views', 'top'].includes(requestedSort)) {
        return apiError('Sıralama değeri geçersiz.', 400, 'INVALID_SORT');
    }
    const sort = requestedSort === 'recent' ? 'latest' : requestedSort === 'trending' ? 'popular' : requestedSort;
    const limit = parseLimit(params.get('limit'), mine ? 1000 : 20, mine ? 1000 : 50);
    const offset = parseOffset(params.get('offset'));
    let query = client.from('forum_topics')
        .select('id, user_id, title, content, category, related_symbol, cover_image_url, images, tags, visibility, is_pinned, is_closed, helpful_count, unhelpful_count, views_count, created_at, updated_at')
        .order('is_pinned', { ascending: false });
    if (sort === 'popular' || sort === 'helpful' || sort === 'top') query = query.order('helpful_count', { ascending: false });
    else if (sort === 'views') query = query.order('views_count', { ascending: false });
    query = query.order('created_at', { ascending: false }).range(offset, offset + limit - 1);
    if (category) query = query.eq('category', category);
    if (symbol) query = query.eq('related_symbol', symbol);
    if (tag) query = query.contains('tags', [tag]);
    const { data: authData, error: authError } = await client.auth.getUser();
    if (authError) console.error('Forum feed could not resolve the optional viewer session.', authError);
    const viewerId = authError ? null : authData.user?.id ?? null;
    if (mine && !viewerId) return apiError('Kendi içeriklerinizi görmek için giriş yapmalısınız.', 401, 'UNAUTHENTICATED');
    if (mine && viewerId) query = query.eq('user_id', viewerId);
    const { data, error } = await query;
    if (error) return databaseError(error, 'Konu akışı yüklenemedi.');
    const attached = await attachTopicDetails(client, (data ?? []) as ForumTopicRecord[], viewerId);
    if (attached.error) return databaseError(attached.error, 'Konu yazarları veya oylar yüklenemedi.');
    const topicIds = attached.topics.map((topic) => topic.id);
    const { data: feedComments, error: feedCommentsError } = topicIds.length
        ? await client.from('forum_comments').select('topic_id').in('topic_id', topicIds)
        : { data: [], error: null };
    if (feedCommentsError) return databaseError(feedCommentsError, 'Yorum istatistikleri yüklenemedi.');
    const commentsByTopic = new Map<string, number>();
    for (const comment of feedComments ?? []) commentsByTopic.set(comment.topic_id, (commentsByTopic.get(comment.topic_id) ?? 0) + 1);
    const topicsWithCounts = attached.topics.map((topic) => ({ ...topic, comments_count: commentsByTopic.get(topic.id) ?? 0 }));
    if (!mine || !viewerId) return apiSuccess({ topics: topicsWithCounts, currentUserId: viewerId });

    const { data: ownComments, error: ownCommentsError } = await client.from('forum_comments')
        .select('id, topic_id, user_id, content, created_at')
        .eq('user_id', viewerId).order('created_at', { ascending: false }).limit(1000);
    if (ownCommentsError) return databaseError(ownCommentsError, 'Yorumlarınız yüklenemedi.');
    return apiSuccess({
        topics: topicsWithCounts,
        myComments: ownComments ?? [],
        currentUserId: viewerId,
    });
}

export async function POST(request: Request) {
    const auth = await requireForumUser();
    if (auth.response) return auth.response;
    const body = await readJson(request);
    if (!body) return apiError('Geçersiz JSON isteği.');
    const title = textField(body.title, 'Başlık', 3, 180, true);
    const content = textField(body.content, 'İçerik', 1, 13800, true);
    if (isApiError(title)) return apiValidationError(title);
    if (isApiError(content)) return apiValidationError(content);
    if (!isCategory(body.category)) return apiError('Kategori geçersiz.', 400, 'INVALID_CATEGORY');
    const { data: categoryRecord, error: categoryError } = await auth.client.from('forum_categories')
        .select('slug').eq('slug', body.category).eq('is_active', true).maybeSingle();
    if (categoryError) return databaseError(categoryError, 'Topluluk kategorisi doğrulanamadı.');
    if (!categoryRecord) return apiError('Seçilen kategori artık kullanılamıyor.', 400, 'INVALID_CATEGORY');
    const relatedSymbol = normalizeSymbol(body.related_symbol);
    if (isApiError(relatedSymbol)) return apiValidationError(relatedSymbol);
    const coverImageUrl = safeHttpsUrl(body.cover_image_url, 'Kapak görseli');
    if (isApiError(coverImageUrl)) return apiValidationError(coverImageUrl);
    const imagesValue = body.images === undefined ? [] : body.images;
    if (!Array.isArray(imagesValue) || imagesValue.length > 5) return apiError('En fazla 5 içerik görseli ekleyebilirsiniz.', 400, 'INVALID_IMAGES');
    const images: string[] = [];
    for (const [index, value] of imagesValue.entries()) {
        const imageUrl = safeHttpsUrl(value, `İçerik görseli ${index + 1}`);
        if (isApiError(imageUrl)) return apiValidationError(imageUrl);
        if (imageUrl) images.push(imageUrl);
    }
    const tagsValue = body.tags === undefined ? [] : body.tags;
    if (!Array.isArray(tagsValue) || tagsValue.length > 5) return apiError('En fazla 5 etiket ekleyebilirsiniz.', 400, 'INVALID_TAGS');
    const tags: string[] = [];
    for (const value of tagsValue) {
        const tag = textField(value, 'Etiket', 1, 30, true);
        if (isApiError(tag)) return apiValidationError(tag);
        const normalizedTag = tag.replace(/^#/, '').trim().toLocaleLowerCase('tr-TR');
        if (!normalizedTag) continue;
        if (!/^[\p{L}\p{N}_-]{1,30}$/u.test(normalizedTag) || hasProfanity(normalizedTag)) return apiError('Etiket yalnızca uygun ifadelerle harf, rakam, alt çizgi ve tire içerebilir.', 400, 'INVALID_TAG');
        if (!tags.includes(normalizedTag)) tags.push(normalizedTag);
    }
    const visibility = body.visibility ?? 'public';
    if (visibility !== 'public' && visibility !== 'followers') return apiError('Gönderi görünürlüğü geçersiz.', 400, 'INVALID_VISIBILITY');
    const { data, error } = await auth.client.from('forum_topics').insert({
        user_id: auth.user.id,
        title,
        content,
        category: body.category,
        related_symbol: relatedSymbol,
        cover_image_url: coverImageUrl,
        images,
        tags,
        visibility,
    }).select('id, user_id, title, content, category, related_symbol, cover_image_url, images, tags, visibility, is_pinned, is_closed, helpful_count, unhelpful_count, views_count, created_at, updated_at').single();
    if (error) return databaseError(error, 'Konu oluşturulamadı.');
    const attached = await attachTopicDetails(auth.client, [data as ForumTopicRecord], auth.user.id);
    if (attached.error) return databaseError(attached.error, 'Konu yazarı veya oyu yüklenemedi.');
    return apiSuccess(attached.topics[0], 201);
}
