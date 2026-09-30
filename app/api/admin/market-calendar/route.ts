import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';

type CalendarInput = {
    date?: unknown;
    isOpen?: unknown;
    openTime?: unknown;
    closeTime?: unknown;
    title?: unknown;
    message?: unknown;
    notify?: unknown;
};

function validDate(value: unknown): value is string {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validTime(value: unknown): value is string {
    return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function istanbulDate() {
    const dateParts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(new Date());
    const parts = Object.fromEntries(dateParts.map((part) => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
}

export async function GET() {
    const context = await requireAdmin();
    if (context.response) return context.response;
    const { data, error } = await context.admin.from('bist_trading_calendar')
        .select('trading_date, is_open, open_time, close_time, title, message, notification_sent, updated_at')
        .gte('trading_date', istanbulDate())
        .order('trading_date', { ascending: true })
        .limit(100);
    if (error) {
        console.error('BIST trading calendar listing failed.', error);
        return NextResponse.json({ error: 'BİST takvimi yüklenemedi. Seans kuralları migration durumunu kontrol edin.' }, { status: 503 });
    }
    return NextResponse.json({ success: true, data: data ?? [] });
}

export async function POST(request: Request) {
    const context = await requireAdmin();
    if (context.response) return context.response;
    let body: CalendarInput;
    try {
        body = await request.json() as CalendarInput;
    } catch {
        return NextResponse.json({ error: 'Geçersiz JSON içeriği.' }, { status: 400 });
    }

    const date = body.date;
    const isOpen = body.isOpen;
    const openTime = body.openTime;
    const closeTime = body.closeTime;
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    const notify = body.notify === true;

    if (!validDate(date) || typeof isOpen !== 'boolean'
        || (isOpen && (!validTime(openTime) || !validTime(closeTime) || closeTime <= openTime))
        || title.length > 120 || message.length > 500
        || (notify && (!title || !message))) {
        return NextResponse.json({ error: 'Tarih, seans saatleri ve bildirim alanlarını kontrol edin.' }, { status: 400 });
    }

    const { data, error } = await context.sessionClient.rpc('admin_set_bist_trading_day', {
        p_trading_date: date,
        p_is_open: isOpen,
        p_open_time: isOpen ? openTime : null,
        p_close_time: isOpen ? closeTime : null,
        p_title: title || 'BİST seans istisnası',
        p_message: message || null,
        p_notify: notify,
    });
    if (error) {
        console.error('BIST trading calendar save failed.', error);
        return NextResponse.json({
            error: /function .* does not exist|bist_trading_calendar/i.test(error.message)
                ? 'Seans kuralları migration dosyasını Supabase SQL Editor’da çalıştırın.'
                : error.message || 'BİST seans istisnası kaydedilemedi.',
        }, { status: /function .* does not exist|bist_trading_calendar/i.test(error.message) ? 503 : 400 });
    }
    return NextResponse.json({ success: true, data });
}

export async function DELETE(request: Request) {
    const context = await requireAdmin();
    if (context.response) return context.response;
    const date = new URL(request.url).searchParams.get('date');
    if (!validDate(date)) return NextResponse.json({ error: 'Geçerli bir takvim tarihi belirtin.' }, { status: 400 });
    const { data, error } = await context.sessionClient.rpc('admin_delete_bist_trading_day', { p_trading_date: date });
    if (error) {
        console.error('BIST trading calendar delete failed.', error);
        return NextResponse.json({ error: 'BİST seans istisnası silinemedi.' }, { status: 500 });
    }
    if (!data) return NextResponse.json({ error: 'Belirtilen tarihte seans istisnası bulunamadı.' }, { status: 404 });
    return NextResponse.json({ success: true });
}
