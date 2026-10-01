import { apiError, apiSuccess, databaseError, requireForumUser } from '@/lib/forum';

export async function GET(request: Request) {
    const auth = await requireForumUser();
    if (auth.response) return auth.response;
    const query = new URL(request.url).searchParams.get('q')?.trim() ?? '';
    if (query.length < 1 || query.length > 24 || !/^[\p{L}\p{N}_]+$/u.test(query)) {
        return apiError('Kullanıcı adı araması geçersiz.', 400, 'INVALID_MENTION_QUERY');
    }
    const { data, error } = await auth.client.rpc('forum_suggest_usernames', { p_query: query });
    if (error) return databaseError(error, 'Kullanıcı önerileri yüklenemedi.');
    return apiSuccess({ usernames: (data ?? []).flatMap((profile: { username?: unknown }) =>
        typeof profile.username === 'string' ? [profile.username] : [],
    ) });
}
