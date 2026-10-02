import { apiError, apiSuccess, databaseError, getForumClient } from '@/lib/forum';

export async function GET() {
    const client = await getForumClient();
    if (!client) return apiError('Supabase bağlantısı yapılandırılmamış.', 503, 'SERVICE_UNAVAILABLE');

    const { data, error } = await client.from('forum_categories')
        .select('slug, label, sort_order')
        .eq('is_active', true)
        .order('sort_order', { ascending: true })
        .order('label', { ascending: true });
    if (error) return databaseError(error, 'Topluluk kategorileri yüklenemedi.');

    return apiSuccess(data ?? []);
}
