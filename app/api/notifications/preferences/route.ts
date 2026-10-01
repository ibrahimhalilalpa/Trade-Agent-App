import { NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabase-server';

const SETUP_MESSAGE = 'Bildirim tercihleri kurulmamış. Supabase SQL Editor’da supabase/notification-preferences-migration.sql dosyasını çalıştırın.';

async function getContext() {
    const supabase = await getSupabaseServerClient();
    if (!supabase) return { supabase: null, user: null };
    const { data: { user } } = await supabase.auth.getUser();
    return { supabase, user };
}

function isSetupError(error: { code?: string } | null): boolean {
    return error?.code === '42P01' || error?.code === 'PGRST205' || error?.code === 'PGRST204';
}

const PREFERENCE_DESCRIPTIONS: Record<string, string> = {
    user_registered: 'Hesabın oluşturulduğunda ve kullanmaya hazır olduğunda haber ver.',
    transaction_buy: 'Sanal portföyünde bir hisse alış işlemi tamamlandığında haber ver.',
    transaction_sell: 'Sanal portföyünde bir hisse satış işlemi tamamlandığında haber ver.',
    lesson_completed: 'Akademide bir dersi tamamladığında haber ver.',
    price_alert_triggered: 'Kurduğun fiyat alarmı tetiklendiğinde hedef ve güncel fiyatla birlikte haber ver.',
    price_alert_created: 'Yeni bir fiyat alarmı kurulduğunda haber ver.',
    order_created: 'Yeni bir sanal emir oluşturulduğunda haber ver.',
    order_filled: 'Bir sanal emir gerçekleştiğinde gerçekleşme fiyatıyla birlikte haber ver.',
    order_cancelled: 'Bir sanal emir iptal edildiğinde haber ver.',
    order_failed: 'Bir sanal emir gerçekleştirilemediğinde nedenini bildir.',
    order_expired: 'Bekleyen bir sanal emrin süresi dolduğunda haber ver.',
    community_followed_topic: 'Takip ettiğin biri yeni bir konu yayınladığında bildir.',
    community_topic_comment: 'Konuna yeni bir yorum geldiğinde bildir.',
    community_comment_reply: 'Yorumuna yanıt geldiğinde bildir.',
    community_topic_vote: 'Konun faydalı bulunduğunda bildir.',
    community_comment_vote: 'Yorumun faydalı bulunduğunda bildir.',
    community_mention: 'Konu veya yorumlarda @kullanıcıadı ile senden bahsedildiğinde bildir.',
};

function preferenceDescription(eventKey: string, title: string): string {
    if (eventKey === 'announcement') return 'Yönetim tarafından yayınlanan duyuruları al.';
    return PREFERENCE_DESCRIPTIONS[eventKey] ?? `"${title}" bildirimi oluştuğunda haber ver.`;
}

export async function GET() {
    const { supabase, user } = await getContext();
    if (!supabase) return NextResponse.json({ error: 'Supabase bağlantısı yapılandırılmamış.' }, { status: 503 });
    if (!user) return NextResponse.json({ error: 'Bildirim tercihlerini görmek için giriş yapmalısınız.' }, { status: 401 });

    const [templates, preferences] = await Promise.all([
        supabase.from('notification_event_templates')
            .select('event_key, title, message, category, active')
            .order('category').order('title'),
        supabase.from('user_notification_preferences')
            .select('event_key, enabled')
            .eq('user_id', user.id),
    ]);
    const failure = templates.error ?? preferences.error;
    if (failure) {
        console.error('Notification preferences could not be loaded.', failure);
        return NextResponse.json({
            error: isSetupError(failure) ? SETUP_MESSAGE : 'Bildirim tercihleri yüklenemedi.',
        }, { status: isSetupError(failure) ? 503 : 500 });
    }

    const enabledByKey = new Map((preferences.data ?? []).map((item) => [item.event_key, item.enabled]));
    const events = [
        { eventKey: 'announcement', title: 'Sistem duyuruları', category: 'announcement', active: true },
        ...(templates.data ?? []).map((item) => ({
            eventKey: item.event_key,
            title: item.title,
            category: item.category,
            active: item.active,
        })),
    ];
    return NextResponse.json({
        success: true,
        data: events.map((event) => ({
            ...event,
            message: preferenceDescription(event.eventKey, event.title),
            enabled: enabledByKey.get(event.eventKey) ?? true,
        })),
    });
}

export async function PATCH(request: Request) {
    const { supabase, user } = await getContext();
    if (!supabase) return NextResponse.json({ error: 'Supabase bağlantısı yapılandırılmamış.' }, { status: 503 });
    if (!user) return NextResponse.json({ error: 'Bildirim tercihlerini değiştirmek için giriş yapmalısınız.' }, { status: 401 });

    let body: { eventKey?: unknown; enabled?: unknown };
    try {
        body = await request.json() as typeof body;
    } catch {
        return NextResponse.json({ error: 'Geçersiz JSON içeriği.' }, { status: 400 });
    }
    if (typeof body.eventKey !== 'string' || typeof body.enabled !== 'boolean'
        || !/^[a-z][a-z0-9_]{1,79}$/.test(body.eventKey)) {
        return NextResponse.json({ error: 'Geçerli bir bildirim türü ve izin durumu seçin.' }, { status: 400 });
    }
    if (body.eventKey !== 'announcement') {
        const { data: template, error: templateError } = await supabase.from('notification_event_templates')
            .select('event_key').eq('event_key', body.eventKey).maybeSingle();
        if (templateError) {
            console.error('Notification preference template validation failed.', templateError);
            return NextResponse.json({
                error: isSetupError(templateError) ? SETUP_MESSAGE : 'Bildirim türü doğrulanamadı.',
            }, { status: isSetupError(templateError) ? 503 : 500 });
        }
        if (!template) return NextResponse.json({ error: 'Bu bildirim türü artık mevcut değil.' }, { status: 404 });
    }

    const { error } = await supabase.from('user_notification_preferences').upsert({
        user_id: user.id,
        event_key: body.eventKey,
        enabled: body.enabled,
        updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,event_key' });
    if (error) {
        console.error('Notification preference could not be saved.', error);
        return NextResponse.json({
            error: isSetupError(error) ? SETUP_MESSAGE : 'Bildirim tercihi kaydedilemedi.',
        }, { status: isSetupError(error) ? 503 : 500 });
    }
    return NextResponse.json({ success: true });
}
