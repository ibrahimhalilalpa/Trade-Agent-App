import { requireAdmin } from '@/lib/admin-auth';
import type { NextResponse } from 'next/server';
import {
    apiError, apiSuccess, attachTopicDetails, databaseError, ForumTopicRecord, isUuid, parseLimit, parseOffset,
} from '@/lib/forum';

type CommunityAdminContext = {
    admin: NonNullable<Awaited<ReturnType<typeof requireAdmin>>['admin']>;
    sessionClient: NonNullable<Awaited<ReturnType<typeof requireAdmin>>['sessionClient']>;
    serviceClient: Awaited<ReturnType<typeof requireAdmin>>['serviceClient'];
    user: { id: string };
};

async function refreshReporterSummary(
    admin: CommunityAdminContext['admin'],
    reportId: string,
    fallback: string,
) {
    const { data: actions, error: actionsError } = await admin.from('forum_moderation_actions')
        .select('action').eq('report_id', reportId);
    if (actionsError) return actionsError;
    const actionTypes = new Set((actions ?? []).map(({ action }) => action));
    const summaries: string[] = [];
    if (actionTypes.has('warning')) summaries.push('Kullanıcıya uyarı gönderildi.');
    if (actionTypes.has('ban')) summaries.push('Kullanıcıya forum erişim kısıtlaması uygulandı.');
    if (actionTypes.has('unban')) summaries.push('Forum erişim kısıtlaması kaldırıldı.');
    if (actionTypes.has('content_removed')) summaries.push('Bildirilen içerik ayrıca kaldırıldı.');
    const { error } = await admin.from('forum_reports')
        .update({ reporter_resolution_summary: summaries.length ? summaries.join(' ') : fallback })
        .eq('id', reportId);
    return error;
}

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
            serviceClient: context.serviceClient,
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
    const term = (params.get('q') ?? '').trim().replace(/[^\p{L}\p{N}\s_-]/gu, '').slice(0, 80);
    const pattern = `%${term}%`;
    const topicQuery = admin.from('forum_topics')
        .select('id, user_id, title, content, category, related_symbol, cover_image_url, images, tags, visibility, is_pinned, is_closed, helpful_count, unhelpful_count, views_count, created_at, updated_at')
        .order('created_at', { ascending: false }).range(offset, offset + limit - 1);
    const commentQuery = admin.from('forum_comments')
        .select('id, topic_id, user_id, content, attachment_url, helpful_count, unhelpful_count, created_at, updated_at')
        .order('created_at', { ascending: false }).range(offset, offset + limit - 1);
    const userQuery = admin.from('user_profiles')
        .select('user_id, username, display_name, avatar_url, bio, xp_points, rank_title, is_banned, forum_ban_until, is_profile_public')
        .order('username', { ascending: true }).range(offset, offset + limit - 1);
    const reportQuery = admin.from('forum_reports')
        .select('id, reporter_id, reported_user_id, target_type, target_id, target_topic_id, target_title, content_snapshot, reason, details, status, moderator_id, resolution_note, created_at, resolved_at')
        .order('created_at', { ascending: false }).range(offset, offset + limit - 1);
    if (term) {
        topicQuery.or(`title.ilike.${pattern},content.ilike.${pattern},category.ilike.${pattern},related_symbol.ilike.${pattern}`);
        commentQuery.ilike('content', pattern);
        userQuery.or(`username.ilike.${pattern},display_name.ilike.${pattern}`);
        reportQuery.or(`target_title.ilike.${pattern},content_snapshot.ilike.${pattern},details.ilike.${pattern},reason.ilike.${pattern},target_type.ilike.${pattern}`);
    }
    const reportStatus = params.get('reportStatus');
    if (reportStatus === 'pending') reportQuery.in('status', ['pending', 'reviewing']);
    else if (reportStatus === 'closed') reportQuery.not('status', 'in', '(pending,reviewing)');

    const [topicsResult, commentsResult, usersResult, reportsResult, actionsResult, viewer, categoriesResult, userStatsResult] = await Promise.all([
        topicQuery,
        commentQuery,
        userQuery,
        reportQuery,
        admin.from('forum_moderation_actions')
            .select('id, user_id, report_id, action, note, moderator_id, created_at')
            .order('created_at', { ascending: false }).limit(500),
        sessionClient.auth.getUser(),
        admin.from('forum_categories')
            .select('slug, label, sort_order, is_active')
            .order('sort_order', { ascending: true }).order('label', { ascending: true }),
        admin.rpc('admin_forum_user_stats'),
    ]);
    if (topicsResult.error) return databaseError(topicsResult.error, 'Yönetici konu listesi yüklenemedi.');
    if (commentsResult.error) return databaseError(commentsResult.error, 'Yönetici yorum listesi yüklenemedi.');
    if (usersResult.error) return databaseError(usersResult.error, 'Yönetici kullanıcı listesi yüklenemedi.');
    if (reportsResult.error) return databaseError(reportsResult.error, 'Şikâyet kuyruğu yüklenemedi.');
    if (actionsResult.error) return databaseError(actionsResult.error, 'Moderasyon geçmişi yüklenemedi.');
    if (categoriesResult.error) return databaseError(categoriesResult.error, 'Forum kategorileri yüklenemedi. community-category-admin-migration.sql dosyasını çalıştırın.');
    if (userStatsResult.error) return databaseError(userStatsResult.error, 'Kullanıcı topluluk istatistikleri yüklenemedi. community-category-admin-migration.sql dosyasını çalıştırın.');
    const commentTopicIds = [...new Set((commentsResult.data ?? []).map((comment) => comment.topic_id))];
    const [commentTopicsResult] = await Promise.all([
        commentTopicIds.length
            ? admin.from('forum_topics').select('id, title, category').in('id', commentTopicIds)
            : Promise.resolve({ data: [], error: null }),
    ]);
    if (commentTopicsResult.error) return databaseError(commentTopicsResult.error, 'Yorumların konu/kategori bilgileri yüklenemedi.');
    const topicDetails = new Map((commentTopicsResult.data ?? []).map((topic) => [topic.id, topic]));
    const reportUserIds = [...new Set((reportsResult.data ?? []).flatMap((report) =>
        [report.reporter_id, report.reported_user_id].filter((id): id is string => Boolean(id)),
    ))];
    const [reportUsersResult, reportHistoryResult] = await Promise.all([
        reportUserIds.length
            ? admin.from('user_profiles').select('user_id, username, display_name, is_banned, forum_ban_until').in('user_id', reportUserIds)
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
    const userStats = (userStatsResult.data ?? []) as Array<{
        user_id: string;
        topics_count: number;
        comments_count: number;
        reports_count: number;
        pending_reports_count: number;
    }>;
    const statsByUser = new Map(userStats.map((stats) => [stats.user_id, stats]));
    const users = (usersResult.data ?? []).map((user) => ({
        ...user,
        topics_count: Number(statsByUser.get(user.user_id)?.topics_count ?? 0),
        comments_count: Number(statsByUser.get(user.user_id)?.comments_count ?? 0),
        reports_count: Number(statsByUser.get(user.user_id)?.reports_count ?? 0),
        pending_reports_count: Number(statsByUser.get(user.user_id)?.pending_reports_count ?? 0),
        forum_ban_active: user.is_banned
            || Boolean(user.forum_ban_until && new Date(user.forum_ban_until).getTime() > now),
    }));
    const reports = (reportsResult.data ?? []).map((report) => ({
        ...report,
        reporter: reportUsersResult.data?.find((profile) => profile.user_id === report.reporter_id) ?? null,
        reported_user: (() => {
            const profile = reportUsersResult.data?.find((item) => item.user_id === report.reported_user_id);
            return profile ? {
                ...profile,
                forum_ban_active: profile.is_banned
                    || Boolean(profile.forum_ban_until && new Date(profile.forum_ban_until).getTime() > now),
            } : null;
        })(),
        previous_reports: (reportHistoryResult.data ?? []).filter((item) =>
            item.reported_user_id === report.reported_user_id && item.id !== report.id),
        moderation_history: (actionsResult.data ?? []).filter((action) => action.user_id === report.reported_user_id),
    }));
    return apiSuccess({
        topics: topics.topics,
        comments: (commentsResult.data ?? []).map((comment) => ({
            ...comment,
            topic_title: topicDetails.get(comment.topic_id)?.title ?? null,
            topic_category: topicDetails.get(comment.topic_id)?.category ?? null,
        })),
        users,
        reports,
        actions: actionsResult.data ?? [],
        categories: categoriesResult.data ?? [],
    });
}

export async function PATCH(request: Request) {
    const access = await communityAdmin();
    if (access.response) return access.response;
    const { admin, sessionClient, serviceClient, user } = access.context;
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
    if (body.action === 'review_account_appeal') {
        if (!serviceClient) return apiError('Hesap itirazını sonuçlandırmak için SUPABASE_SERVICE_ROLE_KEY gereklidir.', 503, 'ADMIN_SERVICE_REQUIRED');
        if (!isUuid(body.appeal_id)) return apiError('İtiraz kimliği geçersiz.', 400, 'INVALID_UUID');
        if (body.status !== 'approved' && body.status !== 'rejected') return apiError('İtiraz kararı geçersiz.', 400, 'INVALID_STATUS');
        if (typeof body.admin_note !== 'string' || body.admin_note.trim().length < 2 || body.admin_note.trim().length > 1000) {
            return apiError('Karar notu 2-1000 karakter arasında olmalıdır.', 400, 'INVALID_NOTE');
        }
        const { data: appeal, error: appealLookupError } = await serviceClient.from('account_moderation_appeals')
            .select('id, user_id, email, restriction_id, status, restriction_type, restriction_ends_at, reason_title, decided_at')
            .eq('id', body.appeal_id).neq('status', 'superseded').maybeSingle();
        if (appealLookupError) return databaseError(appealLookupError, 'Hesap itirazı yüklenemedi.');
        if (!appeal) return apiError('Değerlendirilebilir hesap itirazı bulunamadı.', 409, 'APPEAL_NOT_OPEN');
        const now = new Date();
        const restrictionActive = appeal.restriction_type === 'closure'
            || Boolean(appeal.restriction_ends_at && new Date(appeal.restriction_ends_at).getTime() > now.getTime());
        const decidedAt = now.toISOString();
        let decisionUpdate = serviceClient.from('account_moderation_appeals')
            .update({
                status: body.status,
                admin_note: body.admin_note.trim(),
                moderator_id: user.id,
                decided_at: decidedAt,
            }).eq('id', appeal.id).eq('status', appeal.status);
        decisionUpdate = appeal.decided_at ? decisionUpdate.eq('decided_at', appeal.decided_at) : decisionUpdate.is('decided_at', null);
        const { data: updatedAppeal, error: updateError } = await decisionUpdate
            .select('id, user_id, status, admin_note, decided_at').maybeSingle();
        if (updateError) return databaseError(updateError, 'İtiraz kararı kaydedilemedi.');
        if (!updatedAppeal) return apiError('İtiraz başka bir yönetici tarafından güncellendi. Listeyi yenileyip tekrar deneyin.', 409, 'APPEAL_NOT_OPEN');

        if (body.status === 'approved') {
            const { error: unbanError } = await serviceClient.auth.admin.updateUserById(appeal.user_id, { ban_duration: 'none' });
            if (unbanError) {
                console.error('Account appeal approval could not reactivate the user.', unbanError);
                return apiError('İtiraz kabul edilemedi; hesap yeniden açılamadı.', 500, 'ACCOUNT_REACTIVATION_FAILED');
            }
            const { error: restrictionError } = await serviceClient.from('account_moderation_restrictions')
                .update({ is_active: false, updated_at: new Date().toISOString() }).eq('user_id', appeal.user_id).eq('is_active', true);
            if (restrictionError) {
                console.error('Approved account restriction could not be closed.', restrictionError);
                return apiError('Hesap açıldı ancak kısıtlama kaydı kapatılamadı.', 500, 'RESTRICTION_UPDATE_FAILED');
            }
        } else if (restrictionActive) {
            const banDuration = appeal.restriction_type === 'closure'
                ? '876000h'
                : `${Math.max(1, Math.ceil((new Date(appeal.restriction_ends_at!).getTime() - now.getTime()) / 1000))}s`;
            const { error: banError } = await serviceClient.auth.admin.updateUserById(appeal.user_id, { ban_duration: banDuration });
            if (banError) return databaseError(banError, 'Reddedilen itiraz yeniden değerlendirildi ancak hesap kısıtlaması uygulanamadı.');
            let restrictionUpdate = serviceClient.from('account_moderation_restrictions')
                .update({ is_active: true, updated_at: now.toISOString() })
                .eq('user_id', appeal.user_id);
            if (appeal.restriction_id) {
                restrictionUpdate = restrictionUpdate.eq('user_id', appeal.restriction_id);
            } else {
                restrictionUpdate = restrictionUpdate.eq('restriction_type', appeal.restriction_type).eq('reason_title', appeal.reason_title);
                restrictionUpdate = appeal.restriction_ends_at
                    ? restrictionUpdate.eq('ends_at', appeal.restriction_ends_at)
                    : restrictionUpdate.is('ends_at', null);
            }
            const { error: restrictionError } = await restrictionUpdate;
            if (restrictionError) return databaseError(restrictionError, 'Hesap erişimi kısıtlandı ancak moderasyon kaydı güncellenemedi.');
        }
        const auditResults = await Promise.all([
            serviceClient.from('user_activity_logs').insert({
                user_id: appeal.user_id,
                event_type: 'account_appeal_decided',
                description: body.status === 'approved' ? 'Hesap itirazı kabul edildi; erişim yeniden açıldı.' : restrictionActive ? 'Hesap itirazı reddedildi; kısıtlama yeniden uygulandı.' : 'Hesap itirazı yönetici tarafından reddedildi.',
                metadata: {
                    actor_id: user.id,
                    action: 'review_account_appeal',
                    appeal_id: appeal.id,
                    status: body.status,
                    admin_note: body.admin_note.trim(),
                },
            }),
            serviceClient.from('user_notifications').insert({
                user_id: appeal.user_id,
                category: 'system',
                severity: body.status === 'approved' ? 'success' : 'info',
                title: body.status === 'approved' ? 'Hesap itirazı kabul edildi' : 'Hesap itirazı sonuçlandı',
                message: body.status === 'approved'
                    ? `Hesap erişiminiz yeniden açıldı.\n\nYönetici mesajı: ${body.admin_note.trim()}`
                    : restrictionActive
                        ? `Hesap itirazınız yeniden değerlendirildi ve reddedildi; hesap kısıtlaması devam ediyor.\n\nYönetici mesajı: ${body.admin_note.trim()}`
                        : `Hesap itirazınız reddedildi.\n\nYönetici mesajı: ${body.admin_note.trim()}`,
            }),
        ]);
        if (auditResults[0].error) return databaseError(auditResults[0].error, 'İtiraz kararı verildi ancak hesap hareketi kaydedilemedi.');
        if (auditResults[1].error) return databaseError(auditResults[1].error, 'İtiraz kararı verildi ancak kullanıcı bildirimi gönderilemedi.');
        return apiSuccess(updatedAppeal);
    }
    if (body.action === 'review_appeal') {
        const appealId = body.appeal_id;
        if (!isUuid(appealId)) return apiError('İtiraz kimliği geçersiz.', 400, 'INVALID_UUID');
        if (body.status !== 'approved' && body.status !== 'rejected') return apiError('İtiraz kararı geçersiz.', 400, 'INVALID_STATUS');
        if (typeof body.admin_note !== 'string' || body.admin_note.trim().length < 2 || body.admin_note.trim().length > 1000) {
            return apiError('Karar notu 2-1000 karakter arasında olmalıdır.', 400, 'INVALID_NOTE');
        }
        const { data: openAppeal, error: lookupError } = await admin.from('forum_moderation_appeals')
            .select('id, user_id, status, decided_at, restriction_was_banned, restriction_ban_until')
            .eq('id', appealId).neq('status', 'superseded').maybeSingle();
        if (lookupError) return databaseError(lookupError, 'İtiraz bilgileri yüklenemedi.');
        if (!openAppeal) return apiError('Değerlendirilebilir itiraz bulunamadı.', 409, 'APPEAL_NOT_OPEN');
        const decidedAt = new Date().toISOString();
        let decisionUpdate = admin.from('forum_moderation_appeals')
            .update({
                status: body.status,
                admin_note: body.admin_note.trim(),
                moderator_id: user.id,
                updated_at: decidedAt,
                decided_at: decidedAt,
            }).eq('id', appealId).eq('status', openAppeal.status);
        decisionUpdate = openAppeal.decided_at ? decisionUpdate.eq('decided_at', openAppeal.decided_at) : decisionUpdate.is('decided_at', null);
        const { data: appeal, error: appealError } = await decisionUpdate
            .select('id, user_id, status, admin_note').maybeSingle();
        if (appealError) return databaseError(appealError, 'İtiraz kararı kaydedilemedi.');
        if (!appeal) return apiError('İtiraz başka bir yönetici tarafından güncellendi. Listeyi yenileyip tekrar deneyin.', 409, 'APPEAL_NOT_OPEN');

        const profileUpdate = body.status === 'approved'
            ? { is_banned: false, forum_ban_until: null }
            : { is_banned: openAppeal.restriction_was_banned, forum_ban_until: openAppeal.restriction_ban_until };
        const { data: updatedProfile, error: profileUpdateError } = await sessionClient.from('user_profiles')
            .update(profileUpdate).eq('user_id', openAppeal.user_id).select('user_id').maybeSingle();
        if (profileUpdateError) return databaseError(profileUpdateError, 'İtiraz kararı kaydedilemedi; forum erişimi güncellenemedi.');
        if (!updatedProfile) return apiError('İtiraz işleme alınamadı; kullanıcı profili bulunamadı.', 404, 'PROFILE_NOT_FOUND');
        const { error: auditError } = await admin.from('user_activity_logs').insert({
            user_id: openAppeal.user_id,
            event_type: 'forum_appeal_decided',
            description: body.status === 'approved' ? 'Forum kısıtlaması itiraz üzerine kaldırıldı.' : 'Forum kısıtlaması itirazı reddedildi.',
            metadata: {
                actor_id: user.id,
                action: 'review_appeal',
                appeal_id: appealId,
                status: body.status,
                admin_note: body.admin_note.trim(),
            },
        });
        if (auditError) return databaseError(auditError, 'İtiraz kararı verildi ancak global hareket kaydı oluşturulamadı.');
        if (appeal.status === 'approved') {
            const { error: historyError } = await admin.from('forum_moderation_actions').insert({
                user_id: appeal.user_id,
                action: 'unban',
                note: `Forum yasağı itiraz üzerine kaldırıldı. Not: ${appeal.admin_note}`,
                moderator_id: user.id,
            });
            if (historyError) return databaseError(historyError, 'Yasak kaldırıldı ancak moderasyon geçmişi kaydedilemedi.');
        }
        const { error: notificationError } = await admin.from('user_notifications').insert({
            user_id: appeal.user_id,
            category: 'system',
            severity: appeal.status === 'approved' ? 'success' : 'info',
            title: appeal.status === 'approved' ? 'Forum yasağı itirazı kabul edildi' : 'Forum yasağı itirazı sonuçlandı',
            message: appeal.status === 'approved'
                ? `İtirazınız kabul edildi; forum erişiminiz yeniden açıldı. ${appeal.admin_note}`
                : `Forum yasağı itirazınız reddedildi. ${appeal.admin_note}`,
        });
        if (notificationError) return databaseError(notificationError, 'İtiraz sonucu kaydedildi ancak kullanıcı bildirimi gönderilemedi.');
        return apiSuccess(appeal);
    }
    if (body.action === 'save_category') {
        if (typeof body.slug !== 'string' || !/^[a-z][a-z0-9_]{1,39}$/.test(body.slug)) {
            return apiError('Kategori kodu 2-40 karakter olmalı; küçük harfle başlamalı ve yalnızca küçük harf, rakam veya alt çizgi içermelidir.');
        }
        if (typeof body.label !== 'string' || body.label.trim().length < 2 || body.label.trim().length > 48) {
            return apiError('Kategori adı 2-48 karakter olmalıdır.');
        }
        if (!Number.isInteger(body.sort_order) || Number(body.sort_order) < 0 || Number(body.sort_order) > 9999) {
            return apiError('Sıralama 0-9999 arasında bir tam sayı olmalıdır.');
        }
        if (typeof body.is_active !== 'boolean') return apiError('Kategori durumu belirtilmelidir.');
        const { data, error } = await admin.from('forum_categories').update({
            label: body.label.trim(),
            sort_order: body.sort_order,
            is_active: body.is_active,
            updated_at: new Date().toISOString(),
        }).eq('slug', body.slug).select('slug, label, sort_order, is_active').maybeSingle();
        if (error) return databaseError(error, 'Kategori güncellenemedi.');
        if (!data) return apiError('Kategori bulunamadı.', 404, 'CATEGORY_NOT_FOUND');
        return apiSuccess(data);
    }
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
            if (isUuid(reportIdValue)) {
                const summaryError = await refreshReporterSummary(admin, reportIdValue, 'Şikâyet incelendi; içerik kaldırıldı.');
                if (summaryError) return databaseError(summaryError, 'Konu silindi ancak şikâyet sonucu güncellenemedi.');
            }
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
            if (isUuid(reportIdValue)) {
                const summaryError = await refreshReporterSummary(admin, reportIdValue, 'Şikâyet incelendi; içerik kaldırıldı.');
                if (summaryError) return databaseError(summaryError, 'Yorum silindi ancak şikâyet sonucu güncellenemedi.');
            }
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
    if (body.action === 'start_review' && isUuid(reportIdValue)) {
        const { data, error } = await admin.from('forum_reports').update({
            status: 'reviewing',
            moderator_id: user.id,
            resolved_at: null,
            resolution_note: null,
            reporter_resolution_summary: null,
        }).eq('id', reportIdValue).eq('status', 'pending')
            .select('id, status').maybeSingle();
        if (error) return databaseError(error, 'Şikâyet incelemeye alınamadı.');
        if (!data) return apiError('İncelemeye alınabilecek bekleyen şikâyet bulunamadı.', 409, 'REPORT_NOT_PENDING');
        return apiSuccess(data);
    }
    if ((body.action === 'resolve_report' || body.action === 'dismiss_report' || body.action === 'update_report_result') && isUuid(reportIdValue)) {
        const status = body.action === 'resolve_report'
            ? 'resolved'
            : body.action === 'dismiss_report'
                ? 'dismissed'
                : body.status;
        if (!['pending', 'reviewing', 'resolved', 'dismissed'].includes(String(status))) {
            return apiError('Şikâyet sonucu geçersiz.', 400, 'INVALID_REPORT_STATUS');
        }
        const note = typeof body.note === 'string' ? body.note.trim().slice(0, 1000) : '';
        const { data, error } = await admin.from('forum_reports').update({
            status,
            moderator_id: user.id,
            resolution_note: note || null,
            reporter_resolution_summary: status === 'resolved'
                ? 'Şikâyet incelendi ve sonuçlandırıldı.'
                : status === 'dismissed' ? 'Şikâyet incelendi; işlem yapılmadı.' : null,
            resolved_at: status === 'pending' || status === 'reviewing' ? null : new Date().toISOString(),
        }).eq('id', reportIdValue).select('id, status, resolution_note, resolved_at').maybeSingle();
        if (error) return databaseError(error, 'Şikâyet sonucu kaydedilemedi.');
        if (!data) return apiError('Şikâyet bulunamadı.', 404, 'REPORT_NOT_FOUND');
        if (status === 'resolved' || status === 'dismissed') {
            const summaryError = await refreshReporterSummary(
                admin,
                reportIdValue,
                status === 'resolved' ? 'Şikâyet incelendi ve sonuçlandırıldı.' : 'Şikâyet incelendi; işlem yapılmadı.',
            );
            if (summaryError) return databaseError(summaryError, 'Şikâyet sonucu kaydedildi ancak güvenli özet güncellenemedi.');
        }
        return apiSuccess(data);
    }
    if (body.action === 'warn_user' && isUuid(userIdValue)) {
        if (typeof reportIdValue !== 'string' || !isUuid(reportIdValue)) return apiError('Uyarı için şikâyet kaydı belirtilmelidir.');
        if (typeof body.note !== 'string' || !body.note.trim() || body.note.trim().length > 500) return apiError('Uyarı metni 1-500 karakter olmalıdır.');
        const note = body.note.trim();
        const { data: report, error: reportLookupError } = await admin.from('forum_reports')
            .select('id, reported_user_id, target_type, target_id, target_topic_id, target_title, content_snapshot')
            .eq('id', reportIdValue).maybeSingle();
        if (reportLookupError) return databaseError(reportLookupError, 'Uyarı için şikâyet bilgileri yüklenemedi.');
        if (!report || report.reported_user_id !== userIdValue) return apiError('Şikâyet ile kullanıcı eşleşmiyor.', 409, 'REPORT_USER_MISMATCH');
        const targetTitle = (report.target_title || (report.target_type === 'topic' ? 'Forum konusu' : 'Forum yorumu'))
            .replace(/\s+/g, ' ').trim().slice(0, 90);
        const contentDetail = (report.content_snapshot || '').replace(/\s+/g, ' ').trim().slice(0, 120);
        const messagePrefix = `Kaynak: Sistem\nKonu: ${targetTitle}\nTopluluk kuralı gerekçesi: `;
        const contentSuffix = contentDetail ? `\nBildirilen içerik: ${contentDetail}` : '';
        const noteBudget = Math.max(0, 500 - messagePrefix.length - contentSuffix.length);
        const notificationMessage = `${messagePrefix}${note.slice(0, noteBudget)}${note.length > noteBudget ? '…' : ''}${contentSuffix}`;
        const targetTopicId = report.target_topic_id ?? (report.target_type === 'topic' ? report.target_id : null);
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
            title: `Topluluk kuralları · ${targetTitle}`.slice(0, 120),
            message: notificationMessage,
            action_url: targetTopicId
                ? `/forum/${targetTopicId}`
                : report.target_type === 'profile'
                    ? `/profile/${encodeURIComponent(report.target_title?.replace(/^@/, '') ?? '')}`
                    : null,
        });
        if (notificationError) return databaseError(notificationError, 'Uyarı kaydedildi ancak kullanıcı bildirimi gönderilemedi.');
        const { error: reportError } = await admin.from('forum_reports').update({
            status: 'resolved',
            moderator_id: user.id,
            resolution_note: `Kullanıcıya uyarı gönderildi: ${note}`,
            reporter_resolution_summary: 'Kullanıcıya uyarı gönderildi.',
            resolved_at: new Date().toISOString(),
        }).eq('id', reportIdValue);
        if (reportError) return databaseError(reportError, 'Uyarı gönderildi ancak şikâyet durumu güncellenemedi.');
        const summaryError = await refreshReporterSummary(admin, reportIdValue, 'Kullanıcıya uyarı gönderildi.');
        if (summaryError) return databaseError(summaryError, 'Uyarı gönderildi ancak şikâyet sonucu güncellenemedi.');
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
    if (body.action === 'create_category') {
        const slug = typeof body.slug === 'string' ? body.slug.trim() : '';
        const label = typeof body.label === 'string' ? body.label.trim() : '';
        const sortOrder = body.sort_order;
        if (!/^[a-z][a-z0-9_]{1,39}$/.test(slug)) {
            return apiError('Kategori kodu 2-40 karakter olmalı; küçük harfle başlamalı ve yalnızca küçük harf, rakam veya alt çizgi içermelidir.');
        }
        if (label.length < 2 || label.length > 48) return apiError('Kategori adı 2-48 karakter olmalıdır.');
        if (!Number.isInteger(sortOrder) || Number(sortOrder) < 0 || Number(sortOrder) > 9999) {
            return apiError('Sıralama 0-9999 arasında bir tam sayı olmalıdır.');
        }
        const { data, error } = await admin.from('forum_categories').insert({
            slug,
            label,
            sort_order: sortOrder,
            is_active: true,
        }).select('slug, label, sort_order, is_active').maybeSingle();
        if (error) {
            if (error.code === '23505') return apiError('Bu kategori kodu zaten kullanılıyor.', 409, 'CATEGORY_EXISTS');
            return databaseError(error, 'Kategori oluşturulamadı.');
        }
        return apiSuccess(data);
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
    if (body.action === 'ban' && typeof body.note === 'string' && body.note.trim().length > 500) {
        return apiError('Yasak gerekçesi en fazla 500 karakter olabilir.', 400, 'NOTE_TOO_LONG');
    }
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
    const durationLabel = body.duration === '1d' ? '1 gün'
        : body.duration === '7d' ? '7 gün'
            : body.duration === '30d' ? '30 gün'
                : body.duration === 'permanent' ? 'süresiz'
                    : typeof body.until === 'string' ? `${new Date(body.until).toLocaleDateString('tr-TR')} tarihine kadar`
                        : 'süresiz';
    const suppliedNote = typeof body.note === 'string' ? body.note.trim().slice(0, 500) : '';
    const { error: historyError } = await admin.from('forum_moderation_actions').insert({
        user_id: userIdValue,
        report_id: isUuid(reportIdValue) ? reportIdValue : null,
        action: body.action === 'ban' ? 'ban' : 'unban',
        note: body.action === 'ban'
            ? `${durationLabel} forum erişim kısıtlaması uygulandı.${suppliedNote ? ` Gerekçe: ${suppliedNote}` : ''}`
            : `Forum yasağı kaldırıldı.${suppliedNote ? ` Not: ${suppliedNote}` : ''}`,
        moderator_id: user.id,
    });
    if (historyError) return databaseError(historyError, 'Yasak uygulandı ancak moderasyon geçmişine kaydedilemedi.');
    if (isUuid(reportIdValue)) {
        const reopening = body.action === 'unban';
        const reportNote = reopening
            ? suppliedNote || 'Yasak kaldırıldı; şikâyet yeniden incelemeye açıldı.'
            : `${durationLabel} forum erişim kısıtlaması uygulandı.${suppliedNote ? ` Gerekçe: ${suppliedNote}` : ''}`;
        const { error: reportError } = await admin.from('forum_reports').update({
            status: reopening ? 'reviewing' : 'resolved',
            moderator_id: user.id,
            resolution_note: reportNote,
            reporter_resolution_summary: reopening ? null
                : body.action === 'ban' ? 'Kullanıcıya forum erişim kısıtlaması uygulandı.'
                    : 'Forum erişim kısıtlaması kaldırıldı; şikâyet yeniden incelemeye açıldı.',
            resolved_at: reopening ? null : new Date().toISOString(),
        }).eq('id', reportIdValue);
        if (reportError) return databaseError(reportError, 'Yasak durumu değiştirildi ancak şikâyet durumu güncellenemedi.');
        const summaryError = await refreshReporterSummary(
            admin,
            reportIdValue,
            reopening ? 'Forum erişim kısıtlaması kaldırıldı; şikâyet yeniden incelemeye açıldı.' : 'Kullanıcıya forum erişim kısıtlaması uygulandı.',
        );
        if (summaryError) return databaseError(summaryError, 'Yasak durumu değiştirildi ancak şikâyet sonucu güncellenemedi.');
    }
    if (body.action === 'ban') {
        const { error: notificationError } = await admin.from('user_notifications').insert({
            user_id: userIdValue,
            category: 'system',
            severity: 'warning',
            title: 'Forum erişimin kısıtlandı',
            message: `${patch.is_banned ? 'Topluluk kuralları nedeniyle forum erişimin süresiz olarak kısıtlandı.' : `Topluluk kuralları nedeniyle forum erişimin ${durationLabel} süreyle kısıtlandı.`}${suppliedNote ? ` Gerekçe: ${suppliedNote}` : ''}`,
        });
        if (notificationError) return databaseError(notificationError, 'Forum yasağı uygulandı ancak kullanıcı bildirimi gönderilemedi.');
    } else {
        const { error: notificationError } = await admin.from('user_notifications').insert({
            user_id: userIdValue,
            category: 'system',
            severity: 'success',
            title: 'Forum erişim kısıtlaması kaldırıldı',
            message: 'Forum erişim kısıtlaman yönetici tarafından kaldırıldı.',
        });
        if (notificationError) return databaseError(notificationError, 'Yasak kaldırıldı ancak kullanıcı bildirimi gönderilemedi.');
    }
    return apiSuccess(data);
}
