import {
    apiError, apiSuccess, databaseError, isUuid, readJson, requireForumUser, textField,
} from '@/lib/forum';

const REPORT_REASONS = ['spam', 'harassment', 'misleading', 'personal_info', 'other'] as const;
const contentExcerpt = (content: string) => Array.from(content).slice(0, 6000).join('');

export async function GET(request: Request) {
    const auth = await requireForumUser();
    if (auth.response) return auth.response;
    const params = new URL(request.url).searchParams;
    const targetType = params.get('target_type');
    const targetId = params.get('target_id');
    if ((targetType !== 'topic' && targetType !== 'comment') || !isUuid(targetId)) {
        return apiError('Şikâyet edilecek konu veya yorum geçersiz.', 400, 'INVALID_REPORT_TARGET');
    }
    const { data, error } = await auth.client.from('forum_reports')
        .select('id, status').eq('reporter_id', auth.user.id)
        .eq('target_type', targetType).eq('target_id', targetId)
        .eq('status', 'pending').maybeSingle();
    if (error) return databaseError(error, 'Şikâyet durumu yüklenemedi.');
    return apiSuccess({ report: data });
}

export async function DELETE(request: Request) {
    const auth = await requireForumUser();
    if (auth.response) return auth.response;
    const body = await readJson(request);
    if (!body || !isUuid(body.report_id)) return apiError('Şikâyet kaydı geçersiz.', 400, 'INVALID_REPORT');
    const { data, error } = await auth.client.from('forum_reports')
        .update({ status: 'withdrawn', resolution_note: 'Şikâyeti bildiren kullanıcı geri çekti.', resolved_at: new Date().toISOString() })
        .eq('id', body.report_id).eq('reporter_id', auth.user.id).eq('status', 'pending')
        .select('id').maybeSingle();
    if (error) return databaseError(error, 'Şikâyet geri çekilemedi.');
    if (!data) return apiError('Geri çekilebilecek bekleyen bir şikâyet bulunamadı.', 404, 'REPORT_NOT_FOUND');
    return apiSuccess({ withdrawn: true });
}

export async function POST(request: Request) {
    const auth = await requireForumUser();
    if (auth.response) return auth.response;

    const body = await readJson(request);
    if (!body) return apiError('Geçersiz JSON isteği.');
    const targetType = body.target_type;
    const targetId = body.target_id;
    const reason = body.reason;
    if ((targetType !== 'topic' && targetType !== 'comment') || !isUuid(targetId)) {
        return apiError('Şikâyet edilecek konu veya yorum geçersiz.', 400, 'INVALID_REPORT_TARGET');
    }
    if (typeof reason !== 'string' || !REPORT_REASONS.includes(reason as (typeof REPORT_REASONS)[number])) {
        return apiError('Şikâyet nedeni seçilmelidir.', 400, 'INVALID_REPORT_REASON');
    }
    const detailsValue = body.details === undefined ? '' : body.details;
    const details = detailsValue === '' ? '' : textField(detailsValue, 'Açıklama', 0, 1000, true);
    if (typeof details !== 'string') return apiError(details.message, 400, details.code);

    let reportedUserId: string;
    let targetTitle: string;
    let targetTopicId = targetId;
    let snapshot: string;
    if (targetType === 'topic') {
        const { data, error } = await auth.client.from('forum_topics')
            .select('id, user_id, title, content').eq('id', targetId).maybeSingle();
        if (error) return databaseError(error, 'Şikâyet edilecek konu yüklenemedi.');
        if (!data) return apiError('Konu bulunamadı veya artık görüntülenemiyor.', 404, 'REPORT_TARGET_NOT_FOUND');
        reportedUserId = data.user_id;
        targetTopicId = data.id;
        targetTitle = data.title;
        snapshot = contentExcerpt(data.content);
    } else {
        const { data, error } = await auth.client.from('forum_comments')
            .select('id, topic_id, user_id, content').eq('id', targetId).maybeSingle();
        if (error) return databaseError(error, 'Şikâyet edilecek yorum yüklenemedi.');
        if (!data) return apiError('Yorum bulunamadı veya artık görüntülenemiyor.', 404, 'REPORT_TARGET_NOT_FOUND');
        reportedUserId = data.user_id;
        targetTopicId = data.topic_id;
        snapshot = contentExcerpt(data.content);
        const topicResult = await auth.client.from('forum_topics')
            .select('title').eq('id', data.topic_id).maybeSingle();
        if (topicResult.error) return databaseError(topicResult.error, 'Yorumun konusu yüklenemedi.');
        targetTitle = topicResult.data?.title ?? 'Forum yorumu';
    }

    if (reportedUserId === auth.user.id) return apiError('Kendi içeriğinizi şikâyet edemezsiniz.', 400, 'SELF_REPORT');
    const { data, error } = await auth.client.from('forum_reports').insert({
        reporter_id: auth.user.id,
        reported_user_id: reportedUserId,
        target_type: targetType,
        target_id: targetId,
        target_topic_id: targetTopicId,
        target_title: targetTitle,
        content_snapshot: snapshot,
        reason,
        details,
    }).select('id, status').single();
    if (error?.code === '23505') return apiError('Bu içerik için daha önce şikâyet gönderdiniz.', 409, 'DUPLICATE_REPORT');
    if (error) return databaseError(error, 'Şikâyetiniz kaydedilemedi.');
    return apiSuccess(data, 201);
}
