import { NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabase-server';

const CATEGORIES = ['all', 'announcement', 'market', 'portfolio', 'academy', 'system', 'community'] as const;
type Category = (typeof CATEGORIES)[number];

async function getContext() {
    const supabase = await getSupabaseServerClient();
    if (!supabase) return { supabase: null, user: null };
    const { data: { user } } = await supabase.auth.getUser();
    return { supabase, user };
}

export async function GET(request: Request) {
    const { supabase, user } = await getContext();
    if (!supabase) return NextResponse.json({ error: 'Supabase bağlantısı yapılandırılmamış.' }, { status: 503 });
    if (!user) return NextResponse.json({ error: 'Bildirimleri görmek için giriş yapmalısınız.' }, { status: 401 });

    const requestedCategory = new URL(request.url).searchParams.get('category') ?? 'all';
    if (!CATEGORIES.includes(requestedCategory as Category)) {
        return NextResponse.json({ error: 'Geçersiz bildirim kategorisi.' }, { status: 400 });
    }
    const { data, error } = await supabase.from('user_notifications')
        .select('id, announcement_id, category, severity, title, message, created_at, read_at, action_url, announcement:system_announcements!user_notifications_announcement_id_fkey(active, starts_at, ends_at)')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(100);
    if (error) {
        console.error('User notifications query failed.', error);
        return NextResponse.json({ error: 'Bildirimler yüklenemedi. Bildirim migration durumunu kontrol edin.' }, { status: 500 });
    }
    const visible = (data ?? []).filter((notification) => {
        if (requestedCategory !== 'all' && notification.category !== requestedCategory) return false;
        if (!notification.announcement_id) return true;
        const announcement = Array.isArray(notification.announcement) ? notification.announcement[0] : notification.announcement;
        return Boolean(announcement?.active
            && new Date(announcement.starts_at).getTime() <= Date.now()
            && (!announcement.ends_at || new Date(announcement.ends_at).getTime() > Date.now()));
    });
    const [{ data: count, error: countError }] = await Promise.all([
        supabase.rpc('get_user_unread_notification_count'),
    ]);
    if (countError) {
        console.error('Unread notification count query failed.', countError);
        return NextResponse.json({ error: 'Okunmamış bildirim sayısı alınamadı. Bildirim migration durumunu kontrol edin.' }, { status: 500 });
    }
    return NextResponse.json({
        success: true,
        data: {
            notifications: visible.map((item) => ({
                id: item.id,
                announcement_id: item.announcement_id,
                category: item.category,
                severity: item.severity,
                title: item.title,
                message: item.message,
                created_at: item.created_at,
                read_at: item.read_at,
                action_url: item.action_url,
            })),
            unreadCount: Number(count ?? 0),
        },
    });
}

export async function PATCH(request: Request) {
    const { supabase, user } = await getContext();
    if (!supabase) return NextResponse.json({ error: 'Supabase bağlantısı yapılandırılmamış.' }, { status: 503 });
    if (!user) return NextResponse.json({ error: 'Bildirimleri güncellemek için giriş yapmalısınız.' }, { status: 401 });

    let body: { id?: unknown; read?: unknown; all?: unknown };
    try {
        body = await request.json() as typeof body;
    } catch {
        return NextResponse.json({ error: 'Geçersiz JSON içeriği.' }, { status: 400 });
    }
    if (typeof body.read !== 'boolean' || (body.all !== true
        && (typeof body.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.id)))) {
        return NextResponse.json({ error: 'Geçersiz bildirim güncellemesi.' }, { status: 400 });
    }

    let query = supabase.from('user_notifications').update({ read_at: body.read ? new Date().toISOString() : null })
        .eq('user_id', user.id);
    if (body.all !== true && typeof body.id === 'string') query = query.eq('id', body.id);
    if (body.all === true && !body.read) {
        return NextResponse.json({ error: 'Tüm bildirimleri okunmadı olarak topluca değiştiremezsiniz.' }, { status: 400 });
    }
    if (body.all === true) query = query.is('read_at', null);
    const { error } = await query;
    if (error) {
        console.error('User notification read-state update failed.', error);
        return NextResponse.json({ error: 'Bildirim okundu durumu güncellenemedi.' }, { status: 500 });
    }
    return NextResponse.json({ success: true });
}

export async function DELETE(request: Request) {
    const { supabase, user } = await getContext();
    if (!supabase) return NextResponse.json({ error: 'Supabase bağlantısı yapılandırılmamış.' }, { status: 503 });
    if (!user) return NextResponse.json({ error: 'Bildirimleri silmek için giriş yapmalısınız.' }, { status: 401 });

    let body: { ids?: unknown; all?: unknown };
    try {
        body = await request.json() as typeof body;
    } catch {
        return NextResponse.json({ error: 'Geçersiz JSON içeriği.' }, { status: 400 });
    }
    const ids = body.ids;
    if (body.all !== true && !(Array.isArray(ids) && ids.length > 0 && ids.length <= 100
        && ids.every((id): id is string => typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id)))) {
        return NextResponse.json({ error: 'Silinecek bildirimleri seçin.' }, { status: 400 });
    }
    if (body.all === true && body.ids !== undefined) {
        return NextResponse.json({ error: 'Tümünü silme isteği tek başına gönderilmelidir.' }, { status: 400 });
    }

    const query = supabase.from('user_notifications').delete().eq('user_id', user.id);
    if (body.all === true) {
        const { error } = await query;
        if (error) {
            console.error('User notifications delete failed.', error);
            return NextResponse.json({ error: 'Bildirimler silinemedi. Bildirim silme migration durumunu kontrol edin.' }, { status: 500 });
        }
        return NextResponse.json({ success: true, deletedIds: [], all: true });
    }
    const { data, error } = await query.in('id', ids as string[]).select('id');
    if (error) {
        console.error('User notifications delete failed.', error);
        return NextResponse.json({ error: 'Bildirimler silinemedi. Bildirim silme migration durumunu kontrol edin.' }, { status: 500 });
    }
    return NextResponse.json({ success: true, deletedIds: (data ?? []).map((item) => item.id) });
}
