import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { isPrivatePreferenceAudit } from '@/lib/privacy-policy';

export async function GET() {
    const context = await requireAdmin();
    if (context.response) return context.response;
    const [status, announcements, activity, directory, notificationTemplates] = await Promise.all([
        context.sessionClient.rpc('admin_get_system_status', { p_actor_id: context.user.id }),
        context.admin.from('system_announcements')
            .select('id, title, message, category, severity, active, starts_at, ends_at, audience_role, created_at')
            .order('created_at', { ascending: false }).limit(100),
        context.admin.from('user_activity_logs').select('id, user_id, event_type, description, created_at, metadata').order('created_at', { ascending: false }).limit(100),
        context.admin.rpc('admin_list_users'),
        context.serviceClient
            ? context.serviceClient.from('notification_event_templates')
                .select('event_key, title, message, category, severity, active, updated_at')
                .order('event_key')
            : Promise.resolve({ data: [], error: null }),
    ]);
    const failure = status.error ?? announcements.error ?? activity.error ?? directory.error ?? notificationTemplates.error;
    if (failure) {
        console.error('Admin system status query failed.', failure);
        return NextResponse.json({ error: 'Sistem durumu yüklenemedi. RBAC migration ve cron izinlerini kontrol edin.' }, { status: 503 });
    }
    const directoryRows = (directory.data ?? []) as Array<{ id: string; email: string; displayName: string }>;
    const userById = new Map(directoryRows.map((user) => [user.id, user]));
    const latestLoginByUser = new Map<string, number>();
    const auditRows = (activity.data ?? []).filter((item) => {
        if (item.event_type !== 'login') return true;
        const timestamp = new Date(item.created_at).getTime();
        const latestTimestamp = latestLoginByUser.get(item.user_id);
        if (latestTimestamp !== undefined && latestTimestamp - timestamp <= 15_000) return false;
        latestLoginByUser.set(item.user_id, timestamp);
        return true;
    });
    return NextResponse.json({
        success: true,
        data: {
            status: { ...status.data, serviceRoleConfigured: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY) },
            announcements: announcements.data ?? [],
            notificationTemplates: notificationTemplates.data ?? [],
            audit: auditRows.map((item) => {
                const user = userById.get(item.user_id);
                const actorId = item.metadata && typeof item.metadata === 'object' && 'actor_id' in item.metadata
                    ? item.metadata.actor_id
                    : null;
                const actor = typeof actorId === 'string' ? userById.get(actorId) : undefined;
                const isPrivacyChange = isPrivatePreferenceAudit(item.metadata);
                return {
                    ...item,
                    event_type: isPrivacyChange ? 'privacy_preference_changed' : item.event_type,
                    user_email: user?.email ?? '',
                    display_name: user?.displayName ?? '',
                    actor_name: actor?.displayName || actor?.email || '',
                };
            }),
        },
    });
}

export async function POST(request: Request) {
    const context = await requireAdmin();
    if (context.response) return context.response;
    let body: { title?: unknown; message?: unknown; category?: unknown; severity?: unknown; startsAt?: unknown; endsAt?: unknown; audienceRole?: unknown; active?: unknown };
    try { body = await request.json() as typeof body; }
    catch { return NextResponse.json({ error: 'Geçersiz JSON içeriği.' }, { status: 400 }); }
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    const category = typeof body.category === 'string' ? body.category : 'announcement';
    const severity = body.severity;
    const audienceRole = typeof body.audienceRole === 'string' ? body.audienceRole : 'all';
    if ((body.startsAt !== undefined && body.startsAt !== null && typeof body.startsAt !== 'string')
        || (body.endsAt !== undefined && body.endsAt !== null && typeof body.endsAt !== 'string')) {
        return NextResponse.json({ error: 'Duyuru tarihleri ISO-8601 tarih metni olmalıdır.' }, { status: 400 });
    }
    const startsAt = typeof body.startsAt === 'string' && body.startsAt ? body.startsAt : new Date().toISOString();
    const endsAt = typeof body.endsAt === 'string' && body.endsAt ? body.endsAt : null;
    if (!title || title.length > 120 || !message || message.length > 500
        || !['announcement', 'market', 'portfolio', 'academy', 'system'].includes(category)
        || !['info', 'success', 'warning', 'critical'].includes(String(severity))
        || !['all', 'user', 'pro_trader', 'analyst', 'admin', 'super_admin'].includes(audienceRole)
        || !Number.isFinite(Date.parse(startsAt)) || (endsAt && (!Number.isFinite(Date.parse(endsAt))
            || Date.parse(endsAt) <= Date.parse(startsAt)))) {
        return NextResponse.json({ error: 'Duyuru alanlarını ve tarihlerini kontrol edin.' }, { status: 400 });
    }
    const { data, error } = await context.sessionClient.rpc('admin_publish_announcement', {
        p_title: title, p_message: message, p_category: category, p_severity: severity,
        p_starts_at: new Date(startsAt).toISOString(),
        p_ends_at: endsAt ? new Date(endsAt).toISOString() : null,
        p_audience_role: audienceRole, p_active: body.active !== false,
    });
    if (error) {
        console.error('Admin announcement create failed.', error);
        return NextResponse.json({ error: 'Duyuru yayınlanamadı. Bildirim migration durumunu ve yönetici yetkisini kontrol edin.' }, { status: 500 });
    }
    return NextResponse.json({ success: true, data });
}

export async function PATCH(request: Request) {
    const context = await requireAdmin();
    if (context.response) return context.response;
    let body: { id?: unknown; active?: unknown; title?: unknown; message?: unknown; category?: unknown; severity?: unknown; startsAt?: unknown; endsAt?: unknown; audienceRole?: unknown };
    try { body = await request.json() as typeof body; }
    catch { return NextResponse.json({ error: 'Geçersiz JSON içeriği.' }, { status: 400 }); }
    if (typeof body.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.id)) {
        return NextResponse.json({ error: 'Geçersiz duyuru güncellemesi.' }, { status: 400 });
    }
    if (body.title !== undefined) {
        const title = typeof body.title === 'string' ? body.title.trim() : '';
        const message = typeof body.message === 'string' ? body.message.trim() : '';
        const category = typeof body.category === 'string' ? body.category : '';
        const severity = typeof body.severity === 'string' ? body.severity : '';
        const audienceRole = typeof body.audienceRole === 'string' ? body.audienceRole : '';
        const startsAt = typeof body.startsAt === 'string' && body.startsAt
            ? Date.parse(body.startsAt) : Date.now();
        const endsAt = typeof body.endsAt === 'string' && body.endsAt ? Date.parse(body.endsAt) : null;
        if (title.length < 1 || title.length > 120 || message.length < 1 || message.length > 500
            || !['announcement', 'market', 'portfolio', 'academy', 'system'].includes(category)
            || !['info', 'success', 'warning', 'critical'].includes(severity)
            || !['all', 'user', 'pro_trader', 'analyst', 'admin', 'super_admin'].includes(audienceRole)
            || !Number.isFinite(startsAt) || (endsAt !== null && (!Number.isFinite(endsAt) || endsAt <= startsAt))
            || typeof body.active !== 'boolean') {
            return NextResponse.json({ error: 'Duyuru alanlarını ve tarihlerini kontrol edin.' }, { status: 400 });
        }
        const { error } = await context.sessionClient.rpc('admin_update_announcement', {
            p_announcement_id: body.id, p_title: title, p_message: message, p_category: category,
            p_severity: severity, p_starts_at: new Date(startsAt).toISOString(),
            p_ends_at: endsAt === null ? null : new Date(endsAt).toISOString(),
            p_audience_role: audienceRole, p_active: body.active,
        });
        if (error) {
            console.error('Admin announcement update failed.', error);
            return NextResponse.json({ error: 'Duyuru güncellenemedi. Bildirim migration durumunu kontrol edin.' }, { status: 500 });
        }
        return NextResponse.json({ success: true });
    }
    if (typeof body.active !== 'boolean') return NextResponse.json({ error: 'Geçersiz duyuru güncellemesi.' }, { status: 400 });
    const { error } = await context.admin.from('system_announcements').update({ active: body.active }).eq('id', body.id);
    if (error) {
        console.error('Admin announcement update failed.', error);
        return NextResponse.json({ error: 'Duyuru güncellenemedi.' }, { status: 500 });
    }
    return NextResponse.json({ success: true });
}

export async function DELETE(request: Request) {
    const context = await requireAdmin();
    if (context.response) return context.response;
    const id = new URL(request.url).searchParams.get('id') ?? '';
    if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Geçersiz duyuru kimliği.' }, { status: 400 });
    const { data, error } = await context.sessionClient.rpc('admin_remove_announcement', { p_announcement_id: id });
    if (error || !data) {
        if (error) console.error('Admin announcement delete failed.', error);
        return NextResponse.json({ error: 'Duyuru silinemedi.' }, { status: 500 });
    }
    return NextResponse.json({ success: true });
}
