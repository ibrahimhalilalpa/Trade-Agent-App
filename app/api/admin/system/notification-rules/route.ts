import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';

const EVENT_KEYS = [
    'user_registered', 'transaction_buy', 'transaction_sell', 'lesson_completed',
    'price_alert_triggered', 'price_alert_created', 'order_created', 'order_filled',
    'order_cancelled', 'order_failed', 'order_expired',
    'balance_request_approved', 'balance_request_rejected', 'admin_balance_adjustment',
] as const;
const CATEGORIES = ['announcement', 'market', 'portfolio', 'academy', 'system'] as const;
const SEVERITIES = ['info', 'success', 'warning', 'critical'] as const;
type EventKey = (typeof EVENT_KEYS)[number];

export async function GET() {
    const context = await requireAdmin();
    if (context.response) return context.response;
    const { data, error } = await context.admin.from('notification_event_templates')
        .select('event_key, title, message, category, severity, active, updated_at')
        .order('event_key');
    if (error) {
        console.error('Admin notification rule listing failed.', error);
        return NextResponse.json({ error: 'Otomatik bildirim kuralları yüklenemedi. Bildirim migration durumunu kontrol edin.' }, { status: 503 });
    }
    return NextResponse.json({ success: true, data: data ?? [] });
}

export async function POST(request: Request) {
    const context = await requireAdmin();
    if (context.response) return context.response;
    if (!context.serviceClient) {
        return NextResponse.json({ error: 'Otomatik bildirim kurallarını yönetmek için sunucu Service Role yapılandırılmalıdır.' }, { status: 503 });
    }
    let body: { eventKey?: unknown; title?: unknown; message?: unknown; category?: unknown; severity?: unknown; active?: unknown };
    try {
        body = await request.json() as typeof body;
    } catch {
        return NextResponse.json({ error: 'Geçersiz JSON içeriği.' }, { status: 400 });
    }
    const eventKey = typeof body.eventKey === 'string' ? body.eventKey : '';
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    const category = typeof body.category === 'string' ? body.category : '';
    const severity = typeof body.severity === 'string' ? body.severity : '';
    if (!EVENT_KEYS.includes(eventKey as EventKey) || title.length < 1 || title.length > 120
        || message.length < 1 || message.length > 500
        || !CATEGORIES.includes(category as (typeof CATEGORIES)[number])
        || !SEVERITIES.includes(severity as (typeof SEVERITIES)[number])
        || typeof body.active !== 'boolean') {
        return NextResponse.json({ error: 'Bildirim kuralı alanlarını kontrol edin.' }, { status: 400 });
    }
    const { data, error } = await context.serviceClient.from('notification_event_templates')
        .upsert({
            event_key: eventKey, title, message, category, severity,
            active: body.active, updated_by: context.user.id, updated_at: new Date().toISOString(),
        }, { onConflict: 'event_key' })
        .select('event_key, title, message, category, severity, active, updated_at')
        .single();
    if (error) {
        console.error('Admin notification rule save failed.', error);
        return NextResponse.json({ error: 'Otomatik bildirim kuralı kaydedilemedi.' }, { status: 500 });
    }
    return NextResponse.json({ success: true, data });
}

export async function DELETE(request: Request) {
    const context = await requireAdmin();
    if (context.response) return context.response;
    if (!context.serviceClient) {
        return NextResponse.json({ error: 'Otomatik bildirim kurallarını yönetmek için sunucu Service Role yapılandırılmalıdır.' }, { status: 503 });
    }
    const eventKey = new URL(request.url).searchParams.get('eventKey') ?? '';
    if (!EVENT_KEYS.includes(eventKey as EventKey)) {
        return NextResponse.json({ error: 'Geçersiz otomatik bildirim türü.' }, { status: 400 });
    }
    const { error } = await context.serviceClient.from('notification_event_templates').delete().eq('event_key', eventKey);
    if (error) {
        console.error('Admin notification rule delete failed.', error);
        return NextResponse.json({ error: 'Otomatik bildirim kuralı silinemedi.' }, { status: 500 });
    }
    return NextResponse.json({ success: true });
}
