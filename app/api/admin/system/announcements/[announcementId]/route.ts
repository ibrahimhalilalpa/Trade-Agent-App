import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';

const UUID_PATTERN = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

export async function GET(_request: Request, { params }: { params: Promise<{ announcementId: string }> }) {
    const context = await requireAdmin();
    if (context.response) return context.response;
    const { announcementId } = await params;
    if (!UUID_PATTERN.test(announcementId)) return NextResponse.json({ error: 'Geçersiz duyuru kimliği.' }, { status: 400 });

    const { data: notifications, error } = await context.admin.from('user_notifications')
        .select('user_id, read_at')
        .eq('announcement_id', announcementId)
        .order('read_at', { ascending: false, nullsFirst: true });
    if (error) {
        console.error('Announcement readership query failed.', error);
        return NextResponse.json({ error: 'Duyuru okuma bilgileri alınamadı. Bildirim migration durumunu kontrol edin.' }, { status: 500 });
    }
    const ids = [...new Set((notifications ?? []).map((row) => row.user_id))];
    const { data: profiles, error: profilesError } = ids.length
        ? await context.admin.from('user_profiles').select('user_id, username, display_name, full_name').in('user_id', ids)
        : { data: [], error: null };
    if (profilesError) {
        console.error('Announcement reader profile lookup failed.', profilesError);
        return NextResponse.json({ error: 'Duyuru alıcı bilgileri alınamadı.' }, { status: 500 });
    }
    const profileMap = new Map((profiles ?? []).map((profile) => [
        profile.user_id, profile.username || profile.display_name || profile.full_name || 'Trader',
    ]));
    const recipients = (notifications ?? []).map((row) => ({
        userId: row.user_id,
        username: profileMap.get(row.user_id) ?? 'Trader',
        readAt: row.read_at,
    }));
    return NextResponse.json({
        success: true,
        data: {
            total: recipients.length,
            readCount: recipients.filter((row) => row.readAt).length,
            unreadCount: recipients.filter((row) => !row.readAt).length,
            recipients,
        },
    });
}
