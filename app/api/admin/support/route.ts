import { requireAdmin } from '@/lib/admin-auth';
import { apiError, apiSuccess, databaseError, isUuid } from '@/lib/forum';
import { signSupportAttachments } from '@/lib/support-attachments';

export async function GET(request: Request) {
    const access = await requireAdmin();
    if (!access.admin || !access.user) return access.response ?? apiError('Yönetici yetkisi doğrulanamadı.', 500, 'ADMIN_REQUIRED');

    const params = new URL(request.url).searchParams;
    const limit = Math.min(50, Math.max(10, Number.parseInt(params.get('limit') ?? '25', 10) || 25));
    const offset = Math.max(0, Number.parseInt(params.get('offset') ?? '0', 10) || 0);
    const lane = params.get('lane') === 'resolved' ? 'resolved' : 'waiting';
    const statuses = lane === 'waiting' ? ['pending', 'reviewing'] : ['answered', 'closed'];
    const appealStatuses = lane === 'waiting' ? ['pending', 'reviewing'] : ['approved', 'rejected', 'superseded'];
    const range = { from: offset, to: offset + limit - 1 };
    const [requests, accountAppeals, forumAppeals, questionCount, suggestionCount, feedbackCount, accountWaiting, forumWaiting, requestsResolved, accountResolved, forumResolved] = await Promise.all([
        access.admin.from('user_support_requests')
            .select('id, user_id, request_type, subject, details, status, admin_reply, attachment_url, created_at, updated_at, answered_at, resolved_by, resolved_at', { count: 'exact' })
            .in('status', statuses)
            .order('created_at', { ascending: false }).range(range.from, range.to),
        access.admin.from('account_moderation_appeals')
            .select('id, user_id, email, restriction_type, reason_title, restriction_explanation, restriction_ends_at, subject, details, status, admin_note, attachment_url, created_at, decided_at', { count: 'exact' })
            .in('status', appealStatuses)
            .order('created_at', { ascending: false }).range(range.from, range.to),
        access.admin.from('forum_moderation_appeals')
            .select('id, user_id, subject, details, status, admin_note, attachment_url, restriction_was_banned, restriction_ban_until, created_at, decided_at', { count: 'exact' })
            .in('status', appealStatuses)
            .order('created_at', { ascending: false }).range(range.from, range.to),
        access.admin.from('user_support_requests').select('id', { count: 'exact', head: true }).eq('request_type', 'question').in('status', ['pending', 'reviewing']),
        access.admin.from('user_support_requests').select('id', { count: 'exact', head: true }).eq('request_type', 'suggestion').in('status', ['pending', 'reviewing']),
        access.admin.from('user_support_requests').select('id', { count: 'exact', head: true }).eq('request_type', 'feedback').in('status', ['pending', 'reviewing']),
        access.admin.from('account_moderation_appeals').select('id', { count: 'exact', head: true }).in('status', ['pending', 'reviewing']),
        access.admin.from('forum_moderation_appeals').select('id', { count: 'exact', head: true }).in('status', ['pending', 'reviewing']),
        access.admin.from('user_support_requests').select('id', { count: 'exact', head: true }).in('status', ['answered', 'closed']),
        access.admin.from('account_moderation_appeals').select('id', { count: 'exact', head: true }).in('status', ['approved', 'rejected', 'superseded']),
        access.admin.from('forum_moderation_appeals').select('id', { count: 'exact', head: true }).in('status', ['approved', 'rejected', 'superseded']),
    ]);
    const countQueries = [questionCount, suggestionCount, feedbackCount, accountWaiting, forumWaiting, requestsResolved, accountResolved, forumResolved];
    const queryError = requests.error ?? accountAppeals.error ?? forumAppeals.error ?? countQueries.find((result) => result.error)?.error;
    if (queryError) return databaseError(queryError, 'Yardım ve itiraz kuyruğu yüklenemedi. İlgili migration dosyalarının uygulandığını kontrol edin.');

    const userIds = [...new Set([
        ...(requests.data ?? []).map((item) => item.user_id),
        ...(forumAppeals.data ?? []).map((item) => item.user_id),
        ...(accountAppeals.data ?? []).map((item) => item.user_id),
    ])];
    const { data: profiles, error: profileError } = userIds.length
        ? await access.admin.from('user_profiles').select('user_id, username, display_name, xp_points, rank_title, is_banned, forum_ban_until').in('user_id', userIds)
        : { data: [], error: null };
    if (profileError) return databaseError(profileError, 'Talep sahiplerinin profilleri yüklenemedi.');
    const profileById = new Map((profiles ?? []).map((profile) => [profile.user_id, profile]));
    const requestIds = (requests.data ?? []).map((item) => item.id);
    const { data: events, error: eventsError } = requestIds.length
        ? await access.admin.from('user_support_request_events')
            .select('id, request_id, user_id, actor_id, actor_role, event_type, previous_status, status, message, created_at')
            .in('request_id', requestIds).order('created_at', { ascending: false })
        : { data: [], error: null };
    if (eventsError) return databaseError(eventsError, 'Talep hareketleri yüklenemedi. user-support-activity-migration.sql dosyasının uygulandığını kontrol edin.');
    const evaluatorIds = [...new Set([
        ...(requests.data ?? []).map((item) => item.resolved_by),
        ...(events ?? []).map((event) => event.actor_id),
    ].filter((id): id is string => Boolean(id)))];
    const { data: evaluators, error: evaluatorError } = evaluatorIds.length
        ? await access.admin.from('user_profiles').select('user_id, username, display_name, rank_title, xp_points').in('user_id', evaluatorIds)
        : { data: [], error: null };
    if (evaluatorError) return databaseError(evaluatorError, 'Talep değerlendiren yöneticiler yüklenemedi.');
    const evaluatorById = new Map((evaluators ?? []).map((profile) => [profile.user_id, profile]));
    let signedRequests = requests.data ?? [];
    let signedAccountAppeals = accountAppeals.data ?? [];
    let signedForumAppeals = forumAppeals.data ?? [];
    try {
        [signedRequests, signedAccountAppeals, signedForumAppeals] = await Promise.all([
            signSupportAttachments(access.admin, signedRequests),
            signSupportAttachments(access.admin, signedAccountAppeals),
            signSupportAttachments(access.admin, signedForumAppeals),
        ]);
    } catch (error) {
        console.error('Admin support attachment links could not be signed.', error);
        return apiError('Talep ekleri güvenli biçimde yüklenemedi.', 500, 'ATTACHMENT_SIGNING_FAILED');
    }

    return apiSuccess({
        requests: signedRequests.map((item) => ({
            ...item,
            user: profileById.get(item.user_id) ?? null,
            evaluator: item.resolved_by ? evaluatorById.get(item.resolved_by) ?? null : null,
            events: (events ?? []).filter((event) => event.request_id === item.id).map((event) => ({
                ...event,
                actor: event.actor_id ? evaluatorById.get(event.actor_id) ?? null : null,
            })),
        })),
        accountAppeals: signedAccountAppeals.map((item) => ({ ...item, user: profileById.get(item.user_id) ?? null })),
        forumAppeals: signedForumAppeals.map((item) => ({ ...item, user: profileById.get(item.user_id) ?? null })),
        totalCount: (requests.count ?? 0) + (accountAppeals.count ?? 0) + (forumAppeals.count ?? 0),
        resolvedCount: (requestsResolved.count ?? 0) + (accountResolved.count ?? 0) + (forumResolved.count ?? 0),
        offset,
        limit,
        hasMore: [requests.count, accountAppeals.count, forumAppeals.count].some((count) => (count ?? 0) > offset + limit),
        lane,
        waitingCounts: {
            question: questionCount.count ?? 0,
            suggestion: suggestionCount.count ?? 0,
            feedback: feedbackCount.count ?? 0,
            appeals: (accountWaiting.count ?? 0) + (forumWaiting.count ?? 0),
            all: (questionCount.count ?? 0) + (suggestionCount.count ?? 0) + (feedbackCount.count ?? 0) + (accountWaiting.count ?? 0) + (forumWaiting.count ?? 0),
        },
        evaluators: Object.fromEntries(evaluatorById),
    });
}

export async function PATCH(request: Request) {
    const access = await requireAdmin();
    if (!access.admin || !access.user) return access.response ?? apiError('Yönetici yetkisi doğrulanamadı.', 500, 'ADMIN_REQUIRED');
    let body: { request_id?: unknown; status?: unknown; admin_reply?: unknown } | null;
    try {
        const parsed: unknown = await request.json();
        body = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? parsed as { request_id?: unknown; status?: unknown; admin_reply?: unknown }
            : null;
    } catch {
        return apiError('İstek içeriği okunamadı.', 400, 'INVALID_JSON');
    }
    if (typeof body?.request_id !== 'string' || !isUuid(body.request_id)) return apiError('Talep kimliği geçersiz.', 400, 'INVALID_UUID');
    if (!['pending', 'reviewing', 'answered', 'closed'].includes(String(body?.status))) return apiError('Talep durumu geçersiz.', 400, 'INVALID_STATUS');
    if (body?.admin_reply !== undefined && (typeof body.admin_reply !== 'string' || body.admin_reply.trim().length > 3000)) {
        return apiError('Yanıt en fazla 3000 karakter olabilir.', 400, 'INVALID_REPLY');
    }
    const status = body.status as 'pending' | 'reviewing' | 'answered' | 'closed';
    const requestId = body.request_id;
    const reply = typeof body.admin_reply === 'string' ? body.admin_reply.trim() : undefined;
    if (status === 'answered' && (!reply || reply.length < 2)) return apiError('Yanıtlanan talepler için en az 2 karakterlik bir yanıt yazın.', 400, 'REPLY_REQUIRED');

    const { data: existing, error: lookupError } = await access.admin.from('user_support_requests')
        .select('id, user_id, subject, status, admin_reply, updated_at').eq('id', requestId).maybeSingle();
    if (lookupError) return databaseError(lookupError, 'Destek talebi yüklenemedi.');
    if (!existing) return apiError('Destek talebi bulunamadı.', 404, 'REQUEST_NOT_FOUND');
    const now = new Date().toISOString();
    const resolved = status === 'answered' || status === 'closed';
    const { data: updated, error: updateError } = await access.admin.from('user_support_requests').update({
        status,
        ...(reply !== undefined ? { admin_reply: reply || null } : {}),
        moderator_id: access.user.id,
        updated_at: now,
        answered_at: status === 'answered' ? now : null,
        resolved_by: resolved ? access.user.id : null,
        resolved_at: resolved ? now : null,
    }).eq('id', existing.id).eq('status', existing.status).eq('updated_at', existing.updated_at)
        .select('id, user_id, request_type, subject, details, status, admin_reply, created_at, updated_at, answered_at, resolved_by, resolved_at').maybeSingle();
    if (updateError) return databaseError(updateError, 'Destek talebi güncellenemedi.');
    if (!updated) return apiError('Talep başka bir yönetici tarafından güncellendi. Listeyi yenileyip tekrar deneyin.', 409, 'REQUEST_CHANGED');

    const replyChanged = reply !== undefined && (reply || null) !== existing.admin_reply;
    const statusChanged = status !== existing.status;
    const events = [
        ...(statusChanged ? [{
            request_id: existing.id,
            user_id: existing.user_id,
            actor_id: access.user.id,
            actor_role: 'admin' as const,
            event_type: 'status_changed' as const,
            previous_status: existing.status,
            status,
            message: null,
        }] : []),
        ...(replyChanged ? [{
            request_id: existing.id,
            user_id: existing.user_id,
            actor_id: access.user.id,
            actor_role: 'admin' as const,
            event_type: 'reply_updated' as const,
            previous_status: existing.status,
            status,
            message: null,
        }] : []),
    ];
    if (events.length) {
        const { error: eventError } = await access.admin.from('user_support_request_events').insert(events);
        if (eventError) return databaseError(eventError, 'Talep güncellendi ancak işlem geçmişi kaydedilemedi. user-support-activity-migration.sql dosyasının uygulandığını kontrol edin.');

        const activityEvents = events.map((event) => ({
            user_id: existing.user_id,
            event_type: 'support_request_updated',
            description: event.event_type === 'status_changed'
                ? `Yardım talebinizin durumu “${status === 'pending' ? 'Bekliyor' : status === 'reviewing' ? 'İnceleniyor' : status === 'answered' ? 'Yanıtlandı' : 'Kapandı'}” olarak güncellendi.`
                : 'Yardım talebinize yeni bir yanıt eklendi.',
            metadata: { request_id: existing.id, actor_id: access.user.id, actor_role: 'admin', event_type: event.event_type, previous_status: existing.status, status },
        }));
        const { error: activityError } = await access.admin.from('user_activity_logs').insert(activityEvents);
        if (activityError) return databaseError(activityError, 'Talep güncellendi ancak kullanıcı hareket kaydı oluşturulamadı.');
    }

    if (statusChanged || replyChanged) {
        const statusMessage = status === 'pending'
            ? 'Talebiniz yeniden değerlendirme sırasına alındı.'
            : status === 'reviewing'
                ? 'Yardım talebiniz Yönetici tarafından incelemeye alındı.'
                : status === 'answered'
                    ? 'Yardım talebiniz Yönetici tarafından yanıtlandı.'
                    : 'Yardım talebiniz Yönetici tarafından sonuçlandırıldı.';
        const { error: notificationError } = await access.admin.from('user_notifications').insert({
            user_id: existing.user_id,
            category: 'system',
            severity: resolved ? 'success' : status === 'reviewing' ? 'info' : 'warning',
            title: status === 'answered' ? 'Yardım talebinize yanıt verildi' : 'Yardım talebiniz güncellendi',
            message: `${existing.subject}: ${statusMessage}`,
        });
        if (notificationError) return databaseError(notificationError, 'Talep güncellendi ancak kullanıcı bildirimi gönderilemedi.');
    }
    if (['answered', 'closed'].includes(status) && !['answered', 'closed'].includes(existing.status)) {
        const { error: quotaCreditError } = await access.admin.rpc('grant_user_support_quota_credit', {
            p_user_id: existing.user_id,
            p_source_type: 'request',
            p_source_id: existing.id,
        });
        if (quotaCreditError) return databaseError(quotaCreditError, 'Talep değerlendirildi ve hareketi kaydedildi ancak kullanıcıya günlük hak tanımlanamadı.');
    }
    return apiSuccess(updated);
}
