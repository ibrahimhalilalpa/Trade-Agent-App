import {
    apiError, apiSuccess, databaseError, isUuid, readJson, requireForumUser, textField,
} from '@/lib/forum';

const REPORT_REASONS = [
    'spam', 'harassment', 'misleading', 'personal_info', 'other',
    'inappropriate_profile_photo', 'inappropriate_username', 'impersonation', 'profile_other',
] as const;
const contentExcerpt = (content: string) => Array.from(content).slice(0, 6000).join('');
const safeOwnReport = (report: Record<string, unknown>) => {
    const safeReport = { ...report };
    delete safeReport.resolution_note;
    return { ...safeReport, reporter_resolution_summary: null };
};

export async function GET(request: Request) {
    const auth = await requireForumUser();
    if (auth.response) return auth.response;
    const params = new URL(request.url).searchParams;
    if (params.get('mine') === '1') {
        const { data, error } = await auth.client.from('forum_reports')
            .select('id, status, reason, details, reporter_resolution_summary, created_at, resolved_at, target_type, target_id, target_topic_id, target_title, content_snapshot')
            .eq('reporter_id', auth.user.id)
            .order('created_at', { ascending: false })
            .limit(200);
        if (error) return databaseError(error, 'Şikâyet geçmişiniz yüklenemedi.');
        return apiSuccess({ reports: data ?? [] });
    }
    const targetType = params.get('target_type');
    const targetId = params.get('target_id');
    if ((targetType !== 'topic' && targetType !== 'comment' && targetType !== 'profile') || !isUuid(targetId)) {
        return apiError('Şikâyet edilecek konu, yorum veya profil geçersiz.', 400, 'INVALID_REPORT_TARGET');
    }
    const { data, error } = await auth.client.from('forum_reports')
        .select('id, status').eq('reporter_id', auth.user.id)
        .eq('target_type', targetType).eq('target_id', targetId)
        .maybeSingle();
    if (error) return databaseError(error, 'Şikâyet durumu yüklenemedi.');
    return apiSuccess({ report: data });
}

export async function DELETE(request: Request) {
    const auth = await requireForumUser();
    if (auth.response) return auth.response;
    const body = await readJson(request);
    if (!body || !isUuid(body.report_id)) return apiError('Şikâyet kaydı geçersiz.', 400, 'INVALID_REPORT');
    const { data, error } = await auth.client.rpc('manage_own_forum_report', {
        p_action: 'withdraw',
        p_report_id: body.report_id,
        p_reason: null,
        p_details: null,
    });
    if (error) return databaseError(error, 'Şikâyet geri çekilemedi.');
    if (!data?.length) return apiError('Geri çekilebilecek açık bir şikâyet bulunamadı.', 404, 'REPORT_NOT_FOUND');
    return apiSuccess({ withdrawn: true, report: safeOwnReport(data[0] as Record<string, unknown>) });
}

export async function PATCH(request: Request) {
    const auth = await requireForumUser();
    if (auth.response) return auth.response;
    const body = await readJson(request);
    if (!body || !isUuid(body.report_id)) return apiError('Şikâyet kaydı geçersiz.', 400, 'INVALID_REPORT');
    if (typeof body.reason !== 'string' || !REPORT_REASONS.includes(body.reason as (typeof REPORT_REASONS)[number])) {
        return apiError('Şikâyet nedeni seçilmelidir.', 400, 'INVALID_REPORT_REASON');
    }
    const detailsValue = body.details === undefined ? '' : body.details;
    const details = detailsValue === '' ? '' : textField(detailsValue, 'Açıklama', 0, 1000, true);
    if (typeof details !== 'string') return apiError(details.message, 400, details.code);
    const { data, error } = await auth.client.rpc('manage_own_forum_report', {
        p_action: 'edit',
        p_report_id: body.report_id,
        p_reason: body.reason,
        p_details: details,
    });
    if (error) return databaseError(error, 'Şikâyet güncellenemedi.');
    if (!data?.length) return apiError('Güncellenebilecek açık bir şikâyet bulunamadı.', 404, 'REPORT_NOT_FOUND');
    return apiSuccess({ report: safeOwnReport(data[0] as Record<string, unknown>) });
}

export async function POST(request: Request) {
    const auth = await requireForumUser();
    if (auth.response) return auth.response;

    const body = await readJson(request);
    if (!body) return apiError('Geçersiz JSON isteği.');
    const targetType = body.target_type;
    const targetId = body.target_id;
    const reason = body.reason;
    if ((targetType !== 'topic' && targetType !== 'comment' && targetType !== 'profile') || !isUuid(targetId)) {
        return apiError('Şikâyet edilecek konu, yorum veya profil geçersiz.', 400, 'INVALID_REPORT_TARGET');
    }
    if (typeof reason !== 'string' || !REPORT_REASONS.includes(reason as (typeof REPORT_REASONS)[number])) {
        return apiError('Şikâyet nedeni seçilmelidir.', 400, 'INVALID_REPORT_REASON');
    }
    const profileReasons = ['inappropriate_profile_photo', 'inappropriate_username', 'impersonation', 'profile_other'];
    if (targetType === 'profile' && !profileReasons.includes(String(reason))) {
        return apiError('Profil şikâyeti için geçerli bir neden seçin.', 400, 'INVALID_REPORT_REASON');
    }
    if (targetType !== 'profile' && profileReasons.includes(String(reason))) {
        return apiError('Bu şikâyet nedeni yalnızca profiller için kullanılabilir.', 400, 'INVALID_REPORT_REASON');
    }
    const detailsValue = body.details === undefined ? '' : body.details;
    const details = detailsValue === '' ? '' : textField(detailsValue, 'Açıklama', 0, 1000, true);
    if (typeof details !== 'string') return apiError(details.message, 400, details.code);

    let reportedUserId: string;
    let targetTitle: string;
    let targetTopicId: string | null = targetType === 'topic' ? targetId : null;
    let snapshot: string;
    if (targetType === 'profile') {
        const requestedUsername = typeof body.username === 'string' ? body.username.trim().replace(/^@/, '') : '';
        if (!/^[a-z0-9_]{3,24}$/i.test(requestedUsername)) return apiError('Profil kullanıcı adı geçersiz.', 400, 'INVALID_USERNAME');
        const { data: profiles, error } = await auth.client.rpc('forum_public_profile', { p_username: requestedUsername });
        if (error) return databaseError(error, 'Bildirilecek profil yüklenemedi.');
        const profile = profiles?.[0];
        if (!profile || profile.user_id !== targetId) return apiError('Profil bulunamadı veya artık erişilebilir değil.', 404, 'PROFILE_NOT_FOUND');
        reportedUserId = profile.user_id;
        targetTitle = `@${profile.username}`;
        snapshot = contentExcerpt([
            `Kullanıcı adı: @${profile.username}`,
            profile.display_name ? `Görünen ad: ${profile.display_name}` : '',
            profile.bio ? `Profil açıklaması: ${profile.bio}` : '',
            profile.avatar_url ? `Profil görseli: ${profile.avatar_url}` : '',
        ].filter(Boolean).join('\n'));
    } else if (targetType === 'topic') {
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
