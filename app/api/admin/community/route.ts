import { requireAdmin } from '@/lib/admin-auth';
import type { NextResponse } from 'next/server';
import {
    apiError, apiSuccess, attachTopicDetails, databaseError, ForumTopicRecord, isUuid, parseLimit, parseOffset,
} from '@/lib/forum';

type CommunityAdminContext = {
    admin: NonNullable<Awaited<ReturnType<typeof requireAdmin>>['admin']>;
    sessionClient: NonNullable<Awaited<ReturnType<typeof requireAdmin>>['sessionClient']>;
    user: { id: string };
};

async function communityAdmin(): Promise<
    | { context: CommunityAdminContext; response: null }
    | { context: null; response: NextResponse }
> {
    const context = await requireAdmin();
    const response = context.response;
    if (!context.admin || !context.sessionClient || !context.user) {
        if (!response) return { context: null, response: apiError('Yönetici yetkisi doğrulanamadı.', 500, 'ADMIN_REQUIRED') };
        const body = await response.json().catch(() => ({})) as { error?: string };
        return {
            context: null,
            response: apiError(body.error || 'Yönetici yetkisi doğrulanamadı.', response.status, 'ADMIN_REQUIRED'),
        };
    }
    return {
        context: {
            admin: context.admin,
            sessionClient: context.sessionClient,
            user: context.user,
        },
        response: null,
    };
}

export async function GET(request: Request) {
    const access = await communityAdmin();
    if (access.response) return access.response;
    const { admin, sessionClient } = access.context;
    const params = new URL(request.url).searchParams;
    const limit = parseLimit(params.get('limit'), 30, 100);
    const offset = parseOffset(params.get('offset'));
    const [topicsResult, commentsResult, usersResult, reportsResult, actionsResult, viewer] = await Promise.all([
        admin.from('forum_topics')
            .select('id, user_id, title, content, category, related_symbol, cover_image_url, images, tags, visibility, is_pinned, is_closed, helpful_count, unhelpful_count, views_count, created_at, updated_at')
            .order('created_at', { ascending: false }).range(offset, offset + limit - 1),
        admin.from('forum_comments')
            .select('id, topic_id, user_id, content, attachment_url, helpful_count, unhelpful_count, created_at, updated_at')
            .order('created_at', { ascending: false }).range(offset, offset + limit - 1),
        admin.from('user_profiles')
            .select('user_id, username, display_name, avatar_url, bio, xp_points, rank_title, is_banned, forum_ban_until, is_profile_public')
            .order('username', { ascending: true }).range(offset, offset + limit - 1),
        admin.from('forum_reports')
            .select('id, reporter_id, reported_user_id, target_type, target_id, target_topic_id, target_title, content_snapshot, reason, details, status, moderator_id, resolution_note, created_at, resolved_at')
            .order('created_at', { ascending: false }).range(offset, offset + limit - 1),
        admin.from('forum_moderation_actions')
            .select('id, user_id, report_id, action, note, moderator_id, created_at')
            .order('created_at', { ascending: false }).limit(500),
        sessionClient.auth.getUser(),
    ]);
    if (topicsResult.error) return databaseError(topicsResult.error, 'Yönetici konu listesi yüklenemedi.');
    if (commentsResult.error) return databaseError(commentsResult.error, 'Yönetici yorum listesi yüklenemedi.');
    if (usersResult.error) return databaseError(usersResult.error, 'Yönetici kullanıcı listesi yüklenemedi.');
    if (reportsResult.error) return databaseError(reportsResult.error, 'Şikâyet kuyruğu yüklenemedi.');
    if (actionsResult.error) return databaseError(actionsResult.error, 'Moderasyon geçmişi yüklenemedi.');
    const reportUserIds = [...new Set((reportsResult.data ?? []).flatMap((report) =>
        [report.reporter_id, report.reported_user_id].filter((id): id is string => Boolean(id)),
    ))];
    const [reportUsersResult, reportHistoryResult] = await Promise.all([
        reportUserIds.length
            ? admin.from('user_profiles').select('user_id, username, display_name').in('user_id', reportUserIds)
            : Promise.resolve({ data: [], error: null }),
        reportUserIds.length
            ? admin.from('forum_reports')
                .select('id, reported_user_id, reason, status, created_at, target_title')
                .in('reported_user_id', reportUserIds).order('created_at', { ascending: false }).limit(1000)
            : Promise.resolve({ data: [], error: null }),
    ]);
    if (reportUsersResult.error) return databaseError(reportUsersResult.error, 'Şikâyet kullanıcıları yüklenemedi.');
    if (reportHistoryResult.error) return databaseError(reportHistoryResult.error, 'Önceki şikâyet geçmişi yüklenemedi.');
    const topics = await attachTopicDetails(admin, (topicsResult.data ?? []) as ForumTopicRecord[], viewer.data.user?.id ?? null);
    if (topics.error) return databaseError(topics.error, 'Yönetici konu yazarları veya oylar yüklenemedi.');
    const now = Date.now();
    const users = (usersResult.data ?? []).map((user) => ({
        ...user,
        forum_ban_active: user.is_banned
            || Boolean(user.forum_ban_until && new Date(user.forum_ban_until).getTime() > now),
    }));
    const reports = (reportsResult.data ?? []).map((report) => ({
        ...report,
        reporter: reportUsersResult.data?.find((profile) => profile.user_id === report.reporter_id) ?? null,
        reported_user: reportUsersResult.data?.find((profile) => profile.user_id === report.reported_user_id) ?? null,
        previous_reports: (reportHistoryResult.data ?? []).filter((item) =>
            item.reported_user_id === report.reported_user_id && item.id !== report.id),
        moderation_history: (actionsResult.data ?? []).filter((action) => action.user_id === report.reported_user_id),
    }));
    return apiSuccess({ topics: topics.topics, comments: commentsResult.data ?? [], users, reports, actions: actionsResult.data ?? [] });
}

export async function PATCH(request: Request) {
    const access = await communityAdmin();
    if (access.response) return access.response;
    const { admin, sessionClient, user } = access.context;
    let body: Record<string, unknown>;
    try {
        const input: unknown = await request.json();
        if (!input || typeof input !== 'object' || Array.isArray(input)) return apiError('Geçersiz JSON isteği.');
        body = input as Record<string, unknown>;
    } catch {
        return apiError('Geçersiz JSON isteği.');
    }
    const topicIdValue = body.topic_id ?? body.topicId ?? body.targetId;
    const commentIdValue = body.comment_id ?? body.commentId ?? body.targetId;
    const userIdValue = body.user_id ?? body.userId;
    const reportIdValue = body.report_id ?? body.reportId;
    if (body.action === 'delete_topic' && isUuid(topicIdValue)) {
        const topicId = topicIdValue;
        const owner = await admin.from('forum_topics').select('user_id').eq('id', topicId).maybeSingle();
        if (owner.error) return databaseError(owner.error, 'Konu moderasyonu başarısız oldu.');
        const { data, error } = await sessionClient.from('forum_topics').delete().eq('id', topicId).select('id').maybeSingle();
        if (error) return databaseError(error, 'Konu moderasyonu başarısız oldu.');
        if (!data) return apiError('Konu bulunamadı.', 404, 'NOT_FOUND');
        if (owner.data?.user_id) {
            const { error: historyError } = await admin.from('forum_moderation_actions').insert({
                user_id: owner.data.user_id, report_id: isUuid(reportIdValue) ? reportIdValue : null,
                action: 'content_removed', note: 'Şikâyet incelemesi sonrasında konu kaldırıldı.', moderator_id: user.id,
            });
            if (historyError) return databaseError(historyError, 'Konu silindi ancak moderasyon geçmişine yazılamadı.');
        }
        return apiSuccess({ id: topicId, deleted: true });
    }
    if (body.action === 'delete_comment' && isUuid(commentIdValue)) {
        const commentId = commentIdValue;
        const owner = await admin.from('forum_comments').select('user_id').eq('id', commentId).maybeSingle();
        if (owner.error) return databaseError(owner.error, 'Yorum moderasyonu başarısız oldu.');
        const { data, error } = await sessionClient.from('forum_comments').delete().eq('id', commentId).select('id').maybeSingle();
        if (error) return databaseError(error, 'Yorum moderasyonu başarısız oldu.');
        if (!data) return apiError('Yorum bulunamadı.', 404, 'NOT_FOUND');
        if (owner.data?.user_id) {
            const { error: historyError } = await admin.from('forum_moderation_actions').insert({
                user_id: owner.data.user_id, report_id: isUuid(reportIdValue) ? reportIdValue : null,
                action: 'content_removed', note: 'Şikâyet incelemesi sonrasında yorum kaldırıldı.', moderator_id: user.id,
            });
            if (historyError) return databaseError(historyError, 'Yorum silindi ancak moderasyon geçmişine yazılamadı.');
        }
        return apiSuccess({ id: commentId, deleted: true });
    }
    if ((body.action === 'pin' || body.action === 'close') && isUuid(topicIdValue)) {
        const field = body.action === 'pin' ? 'is_pinned' : 'is_closed';
        const value = body.value ?? body[field];
        if (typeof value !== 'boolean') return apiError('Moderasyon değeri true veya false olmalıdır.');
        const topicId = topicIdValue;
        const { data, error } = await sessionClient.from('forum_topics').update({ [field]: value })
            .eq('id', topicId).select('id, is_pinned, is_closed, updated_at').maybeSingle();
        if (error) return databaseError(error, 'Konu moderasyonu başarısız oldu.');
        if (!data) return apiError('Konu bulunamadı.', 404, 'NOT_FOUND');
        return apiSuccess(data);
    }
    if ((body.action === 'resolve_report' || body.action === 'dismiss_report') && isUuid(reportIdValue)) {
        const status = body.action === 'resolve_report' ? 'resolved' : 'dismissed';
        const note = typeof body.note === 'string' ? body.note.trim().slice(0, 1000) : '';
        const { data, error } = await admin.from('forum_reports').update({
            status,
            moderator_id: user.id,
            resolution_note: note || null,
            resolved_at: new Date().toISOString(),
        }).eq('id', reportIdValue).select('id, status, resolution_note, resolved_at').maybeSingle();
        if (error) return databaseError(error, 'Şikâyet sonucu kaydedilemedi.');
        if (!data) return apiError('Şikâyet bulunamadı.', 404, 'REPORT_NOT_FOUND');
        return apiSuccess(data);
    }
    if (body.action === 'warn_user' && isUuid(userIdValue)) {
        if (typeof reportIdValue !== 'string' || !isUuid(reportIdValue)) return apiError('Uyarı için şikâyet kaydı belirtilmelidir.');
        if (typeof body.note !== 'string' || !body.note.trim() || body.note.trim().length > 500) return apiError('Uyarı metni 1-500 karakter olmalıdır.');
        const note = body.note.trim();
        const { error: actionError } = await admin.from('forum_moderation_actions').insert({
            user_id: userIdValue,
            report_id: reportIdValue,
            action: 'warning',
            note,
            moderator_id: user.id,
        });
        if (actionError) return databaseError(actionError, 'Uyarı moderasyon geçmişine kaydedilemedi.');
        const { error: notificationError } = await admin.from('user_notifications').insert({
            user_id: userIdValue,
            category: 'system',
            severity: 'warning',
            title: 'Topluluk kuralı uyarısı',
            message: note,
        });
        if (notificationError) return databaseError(notificationError, 'Uyarı kaydedildi ancak kullanıcı bildirimi gönderilemedi.');
        const { error: reportError } = await admin.from('forum_reports').update({
            status: 'resolved',
            moderator_id: user.id,
            resolution_note: 'Kullanıcıya uyarı gönderildi.',
            resolved_at: new Date().toISOString(),
        }).eq('id', reportIdValue);
        if (reportError) return databaseError(reportError, 'Uyarı gönderildi ancak şikâyet durumu güncellenemedi.');
        return apiSuccess({ user_id: userIdValue, warned: true });
    }
    if (body.targetType === 'topic' && isUuid(body.targetId)) {
        const patch: Record<string, boolean> = {};
        if (body.action === 'pin' && typeof body.value === 'boolean') patch.is_pinned = body.value;
        else if (body.action === 'close' && typeof body.value === 'boolean') patch.is_closed = body.value;
        else if (body.action === 'delete') {
            const { data, error } = await sessionClient.from('forum_topics').delete().eq('id', body.targetId).select('id').maybeSingle();
            if (error) return databaseError(error, 'Konu moderasyonu başarısız oldu.');
            if (!data) return apiError('Konu bulunamadı.', 404, 'NOT_FOUND');
            return apiSuccess({ id: body.targetId, deleted: true });
        } else return apiError('Konu moderasyonu için geçerli bir pin, close veya delete işlemi belirtin.');
        const { data, error } = await sessionClient.from('forum_topics').update(patch).eq('id', body.targetId)
            .select('id, is_pinned, is_closed, updated_at').maybeSingle();
        if (error) return databaseError(error, 'Konu moderasyonu başarısız oldu.');
        if (!data) return apiError('Konu bulunamadı.', 404, 'NOT_FOUND');
        return apiSuccess(data);
    }
    if (body.targetType === 'comment' && isUuid(body.targetId) && body.action === 'delete') {
        const { data, error } = await sessionClient.from('forum_comments').delete().eq('id', body.targetId).select('id').maybeSingle();
        if (error) return databaseError(error, 'Yorum moderasyonu başarısız oldu.');
        if (!data) return apiError('Yorum bulunamadı.', 404, 'NOT_FOUND');
        return apiSuccess({ id: body.targetId, deleted: true });
    }
    return apiError('Moderasyon hedefi veya işlemi geçersiz.', 400, 'INVALID_MODERATION');
}

export async function POST(request: Request) {
    const access = await communityAdmin();
    if (access.response) return access.response;
    const { admin, sessionClient, user } = access.context;
    let body: Record<string, unknown>;
    try {
        const input: unknown = await request.json();
        if (!input || typeof input !== 'object' || Array.isArray(input)) return apiError('Geçersiz JSON isteği.');
        body = input as Record<string, unknown>;
    } catch {
        return apiError('Geçersiz JSON isteği.');
    }
    const topicIdValue = body.topic_id ?? body.topicId ?? body.targetId;
    const commentIdValue = body.comment_id ?? body.commentId ?? body.targetId;
    const userIdValue = body.user_id ?? body.userId;
    const reportIdValue = body.report_id ?? body.reportId;
    if (body.action === 'delete_topic' && isUuid(topicIdValue)) {
        const topicId = topicIdValue;
        const { data, error } = await sessionClient.from('forum_topics').delete().eq('id', topicId).select('id').maybeSingle();
        if (error) return databaseError(error, 'Konu moderasyonu başarısız oldu.');
        if (!data) return apiError('Konu bulunamadı.', 404, 'NOT_FOUND');
        return apiSuccess({ id: topicId, deleted: true });
    }
    if (body.action === 'delete_comment' && isUuid(commentIdValue)) {
        const commentId = commentIdValue;
        const { data, error } = await sessionClient.from('forum_comments').delete().eq('id', commentId).select('id').maybeSingle();
        if (error) return databaseError(error, 'Yorum moderasyonu başarısız oldu.');
        if (!data) return apiError('Yorum bulunamadı.', 404, 'NOT_FOUND');
        return apiSuccess({ id: commentId, deleted: true });
    }
    if ((body.action === 'pin' || body.action === 'close') && isUuid(topicIdValue)) {
        const field = body.action === 'pin' ? 'is_pinned' : 'is_closed';
        const value = body.value ?? body[field];
        if (typeof value !== 'boolean') return apiError('Moderasyon değeri true veya false olmalıdır.');
        const topicId = topicIdValue;
        const { data, error } = await sessionClient.from('forum_topics').update({ [field]: value })
            .eq('id', topicId).select('id, is_pinned, is_closed, updated_at').maybeSingle();
        if (error) return databaseError(error, 'Konu moderasyonu başarısız oldu.');
        if (!data) return apiError('Konu bulunamadı.', 404, 'NOT_FOUND');
        return apiSuccess(data);
    }
    if (!isUuid(userIdValue)) return apiError('Kullanıcı kimliği geçersiz.', 400, 'INVALID_UUID');
    if (body.action !== 'ban' && body.action !== 'unban') return apiError('İşlem ban veya unban olmalıdır.', 400, 'INVALID_ACTION');
    const patch: Record<string, unknown> = body.action === 'ban'
        ? { is_banned: true, forum_ban_until: null }
        : { is_banned: false, forum_ban_until: null };
    if (body.action === 'ban' && body.duration !== undefined) {
        const durationMs: Record<string, number> = {
            '1d': 24 * 60 * 60 * 1000,
            '7d': 7 * 24 * 60 * 60 * 1000,
            '30d': 30 * 24 * 60 * 60 * 1000,
        };
        if (body.duration === 'permanent') {
            patch.is_banned = true;
        } else if (typeof body.duration === 'string' && durationMs[body.duration]) {
            patch.is_banned = false;
            patch.forum_ban_until = new Date(Date.now() + durationMs[body.duration]).toISOString();
        } else {
            return apiError('Forum yasağı süresi geçersiz.', 400, 'INVALID_DURATION');
        }
    } else if (body.action === 'ban' && body.until !== undefined && body.until !== null) {
        if (typeof body.until !== 'string') return apiError('Ban bitiş zamanı ISO tarih metni olmalıdır.', 400, 'INVALID_DATE');
        const until = new Date(body.until);
        if (Number.isNaN(until.getTime()) || until.getTime() <= Date.now()) return apiError('Ban bitiş zamanı gelecekte olmalıdır.', 400, 'INVALID_DATE');
        patch.is_banned = false;
        patch.forum_ban_until = until.toISOString();
    }
    const { data, error } = await sessionClient.from('user_profiles').update(patch).eq('user_id', userIdValue)
        .select('user_id, username, is_banned, forum_ban_until').maybeSingle();
    if (error) return databaseError(error, 'Kullanıcı ban durumu değiştirilemedi.');
    if (!data) return apiError('Kullanıcı profili bulunamadı.', 404, 'NOT_FOUND');
    const { error: historyError } = await admin.from('forum_moderation_actions').insert({
        user_id: userIdValue,
        report_id: isUuid(reportIdValue) ? reportIdValue : null,
        action: body.action === 'ban' ? 'ban' : 'unban',
        note: body.action === 'ban'
            ? body.duration === 'permanent' ? 'Süresiz forum yasağı uygulandı.' : `Forum yasağı uygulandı: ${String(body.duration ?? 'süresiz')}.`
            : 'Forum yasağı kaldırıldı.',
        moderator_id: user.id,
    });
    if (historyError) return databaseError(historyError, 'Yasak uygulandı ancak moderasyon geçmişine kaydedilemedi.');
    if (body.action === 'ban' && isUuid(reportIdValue)) {
        const { error: reportError } = await admin.from('forum_reports').update({
            status: 'resolved',
            moderator_id: user.id,
            resolution_note: 'Kullanıcıya forum yasağı uygulandı.',
            resolved_at: new Date().toISOString(),
        }).eq('id', reportIdValue);
        if (reportError) return databaseError(reportError, 'Yasak uygulandı ancak şikâyet durumu güncellenemedi.');
    }
    if (body.action === 'ban') {
        const { error: notificationError } = await admin.from('user_notifications').insert({
            user_id: userIdValue,
            category: 'system',
            severity: 'warning',
            title: 'Forum erişimin kısıtlandı',
            message: patch.is_banned ? 'Topluluk kuralları nedeniyle forum erişimin süresiz olarak kısıtlandı.' : `Topluluk kuralları nedeniyle forum erişimin ${String(body.duration ?? 'belirtilen süre')} süreyle kısıtlandı.`,
        });
        if (notificationError) return databaseError(notificationError, 'Forum yasağı uygulandı ancak kullanıcı bildirimi gönderilemedi.');
    }
    return apiSuccess(data);
}
