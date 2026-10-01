import {
    apiError, apiSuccess, apiValidationError, forumCommentDatabaseError, isApiError, isUuid,
    readJson, requireForumUser, safeHttpsUrl, textField,
} from '@/lib/forum';

export async function POST(request: Request) {
    const auth = await requireForumUser();
    if (auth.response) return auth.response;
    const body = await readJson(request);
    if (!body) return apiError('Geçersiz JSON isteği.');
    if (!isUuid(body.topic_id)) return apiError('Konu kimliği geçersiz.', 400, 'INVALID_UUID');
    const content = textField(body.content, 'Yorum', 1, 6000, true);
    if (isApiError(content)) return apiValidationError(content);
    if (body.parent_comment_id !== undefined && body.parent_comment_id !== null && !isUuid(body.parent_comment_id)) {
        return apiError('Yanıtlanacak yorum kimliği geçersiz.', 400, 'INVALID_PARENT_COMMENT');
    }
    const parentCommentId = typeof body.parent_comment_id === 'string' ? body.parent_comment_id : null;
    if (parentCommentId) {
        const { data: parent, error: parentError } = await auth.client.from('forum_comments')
            .select('id').eq('id', parentCommentId).eq('topic_id', body.topic_id).maybeSingle();
        if (parentError) return forumCommentDatabaseError(parentError, 'Yanıtlanacak yorum doğrulanamadı.');
        if (!parent) return apiError('Yanıtlanacak yorum bu konu altında bulunamadı.', 400, 'INVALID_PARENT_COMMENT');
    }
    const attachmentUrl = safeHttpsUrl(body.attachment_url, 'Ek dosya');
    if (isApiError(attachmentUrl)) return apiValidationError(attachmentUrl);
    const { data, error } = await auth.client.from('forum_comments').insert({
        topic_id: body.topic_id,
        parent_comment_id: parentCommentId,
        user_id: auth.user.id,
        content,
        attachment_url: attachmentUrl,
    }).select('id, topic_id, parent_comment_id, user_id, content, attachment_url, helpful_count, unhelpful_count, created_at, updated_at').single();
    if (error) return forumCommentDatabaseError(error, 'Yorum oluşturulamadı.');
    return apiSuccess(data, 201);
}
