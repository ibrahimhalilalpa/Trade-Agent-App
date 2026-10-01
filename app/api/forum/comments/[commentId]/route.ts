import {
    apiError, apiSuccess, apiValidationError, databaseError, isApiError, isUuid,
    readJson, requireForumUser, safeHttpsUrl, textField,
} from '@/lib/forum';

type RouteContext = { params: Promise<{ commentId: string }> };

export async function PATCH(request: Request, { params }: RouteContext) {
    const { commentId } = await params;
    if (!isUuid(commentId)) return apiError('Yorum kimliği geçersiz.', 400, 'INVALID_UUID');
    const auth = await requireForumUser();
    if (auth.response) return auth.response;
    const body = await readJson(request);
    if (!body) return apiError('Geçersiz JSON isteği.');
    const patch: Record<string, unknown> = {};
    if ('content' in body) {
        const content = textField(body.content, 'Yorum', 1, 6000, true);
        if (isApiError(content)) return apiValidationError(content);
        patch.content = content;
    }
    if ('attachment_url' in body) {
        const attachmentUrl = safeHttpsUrl(body.attachment_url, 'Ek dosya');
        if (isApiError(attachmentUrl)) return apiValidationError(attachmentUrl);
        patch.attachment_url = attachmentUrl;
    }
    if (!Object.keys(patch).length) return apiError('Güncellenecek bir alan belirtilmedi.');
    const { data, error } = await auth.client.from('forum_comments').update(patch).eq('id', commentId)
        .select('id, topic_id, parent_comment_id, user_id, content, attachment_url, helpful_count, unhelpful_count, created_at, updated_at').maybeSingle();
    if (error) return databaseError(error, 'Yorum güncellenemedi.');
    if (!data) return apiError('Yorum bulunamadı veya düzenleme yetkiniz yok.', 404, 'NOT_FOUND');
    return apiSuccess(data);
}

export async function DELETE(_request: Request, { params }: RouteContext) {
    const { commentId } = await params;
    if (!isUuid(commentId)) return apiError('Yorum kimliği geçersiz.', 400, 'INVALID_UUID');
    const auth = await requireForumUser();
    if (auth.response) return auth.response;
    const { data, error } = await auth.client.from('forum_comments').delete().eq('id', commentId).select('id').maybeSingle();
    if (error) return databaseError(error, 'Yorum silinemedi.');
    if (!data) return apiError('Yorum bulunamadı veya silme yetkiniz yok.', 404, 'NOT_FOUND');
    return apiSuccess({ id: commentId, deleted: true });
}
