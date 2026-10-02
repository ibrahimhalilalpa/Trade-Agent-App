import {
    apiError, apiSuccess, databaseError, isUuid, readJson, requireForumUser,
} from '@/lib/forum';

export async function GET() {
    const auth = await requireForumUser();
    if (auth.response) return auth.response;

    const [categories, preferences] = await Promise.all([
        auth.client.from('forum_categories').select('slug, label, sort_order')
            .eq('is_active', true).order('sort_order', { ascending: true }),
        auth.client.from('forum_follow_notification_preferences')
            .select('followed_id, mode, categories').eq('follower_id', auth.user.id),
    ]);
    if (categories.error) return databaseError(categories.error, 'Topluluk kategorileri yüklenemedi.');
    if (preferences.error) return databaseError(preferences.error, 'Takip bildirim tercihleri yüklenemedi.');
    return apiSuccess({ categories: categories.data ?? [], preferences: preferences.data ?? [] });
}

export async function PUT(request: Request) {
    const auth = await requireForumUser();
    if (auth.response) return auth.response;
    const body = await readJson(request);
    if (!body || !isUuid(body.followed_id)) return apiError('Takip edilen kullanıcı geçersiz.', 400, 'INVALID_USER');
    if (!['none', 'all', 'selected'].includes(String(body.mode))) return apiError('Bildirim tercihi geçersiz.', 400, 'INVALID_MODE');
    const mode = body.mode as 'none' | 'all' | 'selected';
    const categories = body.categories;
    if (mode === 'selected' && (!Array.isArray(categories) || categories.length === 0 || categories.length > 30
        || categories.some((category) => typeof category !== 'string'))) {
        return apiError('Belirli kategoriler için en az bir kategori seçin.', 400, 'INVALID_CATEGORIES');
    }
    if (mode === 'none') {
        const { error } = await auth.client.from('forum_follow_notification_preferences')
            .delete().eq('follower_id', auth.user.id).eq('followed_id', body.followed_id);
        if (error) return databaseError(error, 'Takip bildirimi tercihi kapatılamadı.');
        return apiSuccess({ followed_id: body.followed_id, mode: 'none', categories: [] });
    }
    const { data: follow, error: followError } = await auth.client.from('user_follows')
        .select('followed_id').eq('follower_id', auth.user.id).eq('followed_id', body.followed_id).maybeSingle();
    if (followError) return databaseError(followError, 'Takip durumu doğrulanamadı.');
    if (!follow) return apiError('Bildirim tercihi için önce bu kullanıcıyı takip etmelisiniz.', 409, 'FOLLOW_REQUIRED');

    let selectedCategories: string[] = [];
    if (mode === 'selected') {
        const requested = [...new Set(categories as string[])];
        const { data: available, error: categoryError } = await auth.client.from('forum_categories')
            .select('slug').eq('is_active', true).in('slug', requested);
        if (categoryError) return databaseError(categoryError, 'Seçilen kategoriler doğrulanamadı.');
        if ((available ?? []).length !== requested.length) return apiError('Kategorilerden biri artık kullanılmıyor.', 400, 'INVALID_CATEGORIES');
        selectedCategories = requested;
    }
    const { data, error } = await auth.client.from('forum_follow_notification_preferences').upsert({
        follower_id: auth.user.id,
        followed_id: body.followed_id,
        mode,
        categories: selectedCategories,
        updated_at: new Date().toISOString(),
    }, { onConflict: 'follower_id,followed_id' }).select('followed_id, mode, categories').single();
    if (error) return databaseError(error, 'Takip bildirimi tercihi kaydedilemedi.');
    return apiSuccess(data);
}
