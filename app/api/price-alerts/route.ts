import { NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabase-server';
import type { PriceAlert, PriceAlertEvent } from '@/lib/types';

const SETUP_MESSAGE = 'Fiyat alarmı tabloları eksik veya güncel değil. Supabase SQL Editor’da supabase/price-alerts-lifecycle-migration.sql dosyasını çalıştırın.';
const CROSSING_GUARD_SETUP_MESSAGE = 'Fiyat alarmı geçiş koruması eksik. Supabase SQL Editor’da supabase/price-alert-crossing-guard-migration.sql dosyasını çalıştırın.';

async function getCurrentMarketPrice(symbol: string): Promise<number | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    try {
        const response = await fetch('https://scanner.tradingview.com/turkey/scan', {
            method: 'POST',
            signal: controller.signal,
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            cache: 'no-store',
            body: JSON.stringify({ symbols: { tickers: [`BIST:${symbol}`] }, columns: ['close'] }),
        });
        if (!response.ok) throw new Error(`TradingView quote request failed: ${response.status}`);
        const payload = await response.json() as { data?: Array<{ s?: string; d?: unknown[] }> };
        const quote = payload.data?.find((item) => item.s === `BIST:${symbol}`)?.d?.[0];
        return typeof quote === 'number' && Number.isFinite(quote) && quote > 0 ? quote : null;
    } finally {
        clearTimeout(timeout);
    }
}

function targetPriceError(direction: unknown, targetPrice: number, currentPrice: number): string | null {
    if (direction === 'above' && targetPrice <= currentPrice) {
        return `“Fiyat yükselirse” alarmında hedef, güncel fiyatın (${currentPrice.toLocaleString('tr-TR')} TL) üzerinde olmalıdır.`;
    }
    if (direction === 'below' && targetPrice >= currentPrice) {
        return `“Fiyat düşerse” alarmında hedef, güncel fiyatın (${currentPrice.toLocaleString('tr-TR')} TL) altında olmalıdır.`;
    }
    return null;
}

async function getContext() {
    const supabase = await getSupabaseServerClient();
    if (!supabase) return { supabase: null, user: null };
    const { data: { user } } = await supabase.auth.getUser();
    return { supabase, user };
}

function setupError(error: { code?: string } | null): boolean {
    return error?.code === '42P01' || error?.code === 'PGRST205' || error?.code === 'PGRST204';
}

function errorResponse(error: { code?: string; message?: string } | null, fallback: string) {
    return NextResponse.json({
        error: error?.message?.includes('reference_price')
            ? CROSSING_GUARD_SETUP_MESSAGE
            : setupError(error) ? SETUP_MESSAGE : fallback,
    }, { status: setupError(error) ? 503 : 500 });
}

function mapAlert(row: {
    id: string; symbol: string; direction: string; target_price: number; status: string;
    triggered_price: number | null; created_at: string; triggered_at: string | null;
    last_triggered_at: string | null; expires_at: string | null; repeat_interval_minutes: number;
}): PriceAlert {
    return {
        id: row.id, symbol: row.symbol, direction: row.direction as PriceAlert['direction'],
        targetPrice: Number(row.target_price), status: row.status as PriceAlert['status'],
        triggeredPrice: row.triggered_price === null ? null : Number(row.triggered_price),
        createdAt: row.created_at, triggeredAt: row.triggered_at,
        lastTriggeredAt: row.last_triggered_at, expiresAt: row.expires_at,
        repeatIntervalMinutes: row.repeat_interval_minutes,
    };
}

export async function GET(request: Request) {
    const { supabase, user } = await getContext();
    if (!supabase) return NextResponse.json({ error: 'Supabase bağlantısı yapılandırılmamış.' }, { status: 503 });
    if (!user) return NextResponse.json({ error: 'Fiyat alarmları için giriş yapmalısınız.' }, { status: 401 });

    const symbol = new URL(request.url).searchParams.get('symbol')?.trim().toUpperCase();
    if (!symbol || !/^[A-Z0-9]{3,6}$/.test(symbol)) {
        return NextResponse.json({ error: 'Geçerli bir hisse sembolü gereklidir.' }, { status: 400 });
    }

    const [alertsResult, eventsResult] = await Promise.all([
        supabase.from('price_alerts')
            .select('id, symbol, direction, target_price, status, triggered_price, created_at, triggered_at, last_triggered_at, expires_at, repeat_interval_minutes')
            .eq('user_id', user.id).eq('symbol', symbol).order('created_at', { ascending: false }).limit(100),
        supabase.from('price_alert_events')
            .select('id, alert_id, symbol, direction, event_type, target_price, market_price, created_at')
            .eq('user_id', user.id).eq('symbol', symbol).order('created_at', { ascending: false }).limit(200),
    ]);
    if (alertsResult.error) return errorResponse(alertsResult.error, 'Fiyat alarmları yüklenemedi.');
    if (eventsResult.error) return errorResponse(eventsResult.error, 'Alarm geçmişi yüklenemedi.');

    const alerts = (alertsResult.data ?? []).map(mapAlert);
    const events: PriceAlertEvent[] = (eventsResult.data ?? []).map((event) => ({
        id: event.id, alertId: event.alert_id, symbol: event.symbol,
        direction: event.direction as PriceAlertEvent['direction'],
        eventType: event.event_type as PriceAlertEvent['eventType'],
        targetPrice: Number(event.target_price),
        marketPrice: event.market_price === null ? null : Number(event.market_price),
        createdAt: event.created_at,
    }));
    return NextResponse.json({ success: true, data: { alerts, events } });
}

export async function POST(request: Request) {
    const { supabase, user } = await getContext();
    if (!supabase) return NextResponse.json({ error: 'Supabase bağlantısı yapılandırılmamış.' }, { status: 503 });
    if (!user) return NextResponse.json({ error: 'Fiyat alarmı kurmak için giriş yapmalısınız.' }, { status: 401 });

    let body: { symbol?: unknown; direction?: unknown; targetPrice?: unknown; expiresInHours?: unknown; repeatIntervalMinutes?: unknown };
    try {
        body = await request.json() as typeof body;
    } catch {
        return NextResponse.json({ error: 'İstek gövdesi geçerli JSON olmalıdır.' }, { status: 400 });
    }
    const symbol = typeof body.symbol === 'string' ? body.symbol.trim().toUpperCase() : '';
    const targetPrice = typeof body.targetPrice === 'number' ? body.targetPrice : 0;
    const expiresInHours = body.expiresInHours === null ? null : body.expiresInHours;
    const repeatIntervalMinutes = body.repeatIntervalMinutes ?? 0;
    if (!/^[A-Z0-9]{3,6}$/.test(symbol) || (body.direction !== 'above' && body.direction !== 'below')
        || !Number.isFinite(targetPrice) || targetPrice <= 0
        || (expiresInHours !== null && ![1, 24, 168, 720].includes(expiresInHours as number))
        || ![0, 5, 15, 30, 60].includes(repeatIntervalMinutes as number)) {
        return NextResponse.json({ error: 'Geçerli hisse, yön, hedef fiyat, sona erme süresi ve tekrar aralığı girin.' }, { status: 400 });
    }
    let currentPrice: number | null;
    try {
        currentPrice = await getCurrentMarketPrice(symbol);
    } catch (cause) {
        console.error('Current market price lookup failed while creating an alert.', cause);
        return NextResponse.json({ error: 'Güncel piyasa fiyatı alınamadığı için alarm kurulamadı. Biraz sonra tekrar deneyin.' }, { status: 503 });
    }
    if (currentPrice === null) {
        return NextResponse.json({ error: 'Güncel piyasa fiyatı alınamadığı için alarm kurulamadı. Biraz sonra tekrar deneyin.' }, { status: 503 });
    }
    const directionError = targetPriceError(body.direction, targetPrice, currentPrice);
    if (directionError) return NextResponse.json({ error: directionError }, { status: 400 });
    const { data: existingAlerts, error: duplicateCheckError } = await supabase.from('price_alerts')
        .select('target_price').eq('user_id', user.id).eq('symbol', symbol).eq('status', 'active');
    if (duplicateCheckError) return errorResponse(duplicateCheckError, 'Mevcut alarmlar doğrulanamadı.');
    if ((existingAlerts ?? []).some((alert) => Math.round(Number(alert.target_price) * 100) === Math.round(targetPrice * 100))) {
        return NextResponse.json({ error: 'Bu fiyatta zaten aktif bir alarm var.' }, { status: 409 });
    }
    const expiresAt = expiresInHours === null
        ? null
        : new Date(Date.now() + (expiresInHours as number) * 60 * 60 * 1000).toISOString();
    const { error } = await supabase.from('price_alerts').insert({
        user_id: user.id, symbol, direction: body.direction, target_price: targetPrice, reference_price: currentPrice,
        repeat_interval_minutes: repeatIntervalMinutes, expires_at: expiresAt,
    });
    if (error?.code === '23505') {
        return NextResponse.json({ error: 'Bu fiyatta zaten aktif bir alarm var.' }, { status: 409 });
    }
    if (error) return errorResponse(error, 'Fiyat alarmı kaydedilemedi.');
    return NextResponse.json({ success: true });
}

export async function PATCH(request: Request) {
    const { supabase, user } = await getContext();
    if (!supabase) return NextResponse.json({ error: 'Supabase bağlantısı yapılandırılmamış.' }, { status: 503 });
    if (!user) return NextResponse.json({ error: 'Fiyat alarmını güncellemek için giriş yapmalısınız.' }, { status: 401 });

    let body: { id?: unknown; targetPrice?: unknown; direction?: unknown };
    try {
        body = await request.json() as typeof body;
    } catch {
        return NextResponse.json({ error: 'İstek gövdesi geçerli JSON olmalıdır.' }, { status: 400 });
    }
    if (typeof body.id !== 'string' || typeof body.targetPrice !== 'number'
        || (body.direction !== 'above' && body.direction !== 'below')
        || !Number.isFinite(body.targetPrice) || body.targetPrice <= 0) {
        return NextResponse.json({ error: 'Geçerli alarm, yön ve sıfırdan büyük fiyat gereklidir.' }, { status: 400 });
    }
    const { data: currentAlert, error: currentAlertError } = await supabase.from('price_alerts')
        .select('symbol').eq('id', body.id).eq('user_id', user.id).eq('status', 'active').maybeSingle();
    if (currentAlertError) return errorResponse(currentAlertError, 'Alarm doğrulanamadı.');
    if (!currentAlert) return NextResponse.json({ error: 'Alarm bulunamadı veya artık aktif değil.' }, { status: 404 });
    let currentPrice: number | null;
    try {
        currentPrice = await getCurrentMarketPrice(currentAlert.symbol);
    } catch (cause) {
        console.error('Current market price lookup failed while updating an alert.', cause);
        return NextResponse.json({ error: 'Güncel piyasa fiyatı alınamadığı için alarm güncellenemedi. Biraz sonra tekrar deneyin.' }, { status: 503 });
    }
    if (currentPrice === null) {
        return NextResponse.json({ error: 'Güncel piyasa fiyatı alınamadığı için alarm güncellenemedi. Biraz sonra tekrar deneyin.' }, { status: 503 });
    }
    const directionError = targetPriceError(body.direction, body.targetPrice, currentPrice);
    if (directionError) return NextResponse.json({ error: directionError }, { status: 400 });
    const { data: otherAlerts, error: duplicateCheckError } = await supabase.from('price_alerts')
        .select('id, target_price').eq('user_id', user.id).eq('symbol', currentAlert.symbol).eq('status', 'active')
        .neq('id', body.id);
    if (duplicateCheckError) return errorResponse(duplicateCheckError, 'Mevcut alarmlar doğrulanamadı.');
    if ((otherAlerts ?? []).some((alert) => Math.round(Number(alert.target_price) * 100) === Math.round(body.targetPrice as number * 100))) {
        return NextResponse.json({ error: 'Bu fiyatta zaten aktif bir alarm var.' }, { status: 409 });
    }
    const { error, data } = await supabase.from('price_alerts')
        .update({ target_price: body.targetPrice, direction: body.direction, reference_price: currentPrice, updated_at: new Date().toISOString() })
        .eq('id', body.id).eq('user_id', user.id).eq('status', 'active')
        .select('id').maybeSingle();
    if (error?.code === '23505') {
        return NextResponse.json({ error: 'Bu fiyatta zaten aktif bir alarm var.' }, { status: 409 });
    }
    if (error) return errorResponse(error, 'Fiyat alarmı güncellenemedi.');
    if (!data) return NextResponse.json({ error: 'Alarm bulunamadı veya artık aktif değil.' }, { status: 404 });
    return NextResponse.json({ success: true });
}

export async function DELETE(request: Request) {
    const { supabase, user } = await getContext();
    if (!supabase) return NextResponse.json({ error: 'Supabase bağlantısı yapılandırılmamış.' }, { status: 503 });
    if (!user) return NextResponse.json({ error: 'Fiyat alarmını iptal etmek için giriş yapmalısınız.' }, { status: 401 });

    const id = new URL(request.url).searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'İptal edilecek alarm seçilmedi.' }, { status: 400 });
    const { error, data } = await supabase.from('price_alerts')
        .update({ status: 'cancelled', updated_at: new Date().toISOString() })
        .eq('id', id).eq('user_id', user.id).eq('status', 'active')
        .select('id').maybeSingle();
    if (error) return errorResponse(error, 'Fiyat alarmı iptal edilemedi.');
    if (!data) return NextResponse.json({ error: 'Alarm bulunamadı veya artık aktif değil.' }, { status: 404 });
    return NextResponse.json({ success: true });
}
