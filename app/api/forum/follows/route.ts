import {
    apiError, apiSuccess, databaseError, isUuid, readJson, requireForumUser,
} from '@/lib/forum';

export async function POST(request: Request) {
    const auth = await requireForumUser();
    if (auth.response) return auth.response;
    const body = await readJson(request);
    if (!body || !isUuid(body.followedId)) return apiError('Kullanıcı kimliği geçersiz.', 400, 'INVALID_UUID');
    if (body.followedId === auth.user.id) return apiError('Kendinizi takip edemezsiniz.', 400, 'INVALID_FOLLOW');
    const { data, error } = await auth.client.from('user_follows').upsert({
        follower_id: auth.user.id,
        followed_id: body.followedId,
    }, { onConflict: 'follower_id,followed_id', ignoreDuplicates: true })
        .select('follower_id, followed_id, created_at').maybeSingle();
    if (error) return databaseError(error, 'Kullanıcı takip edilemedi.');
    return apiSuccess(data ?? { follower_id: auth.user.id, followed_id: body.followedId, following: true }, 201);
}

export async function DELETE(request: Request) {
    const auth = await requireForumUser();
    if (auth.response) return auth.response;
    const body = await readJson(request);
    if (!body || !isUuid(body.followedId)) return apiError('Kullanıcı kimliği geçersiz.', 400, 'INVALID_UUID');
    const { data, error } = await auth.client.from('user_follows').delete().eq('follower_id', auth.user.id)
        .eq('followed_id', body.followedId).select('followed_id').maybeSingle();
    if (error) return databaseError(error, 'Takip kaldırılamadı.');
    return apiSuccess({ followedId: body.followedId, following: false, removed: Boolean(data) });
}
