import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';

export async function GET(request: Request) {
    const context = await requireAdmin();
    if (context.response) return context.response;
    const status = new URL(request.url).searchParams.get('status');
    const { admin } = context;
    let ordersQuery = admin.from('portfolio_orders').select('id, portfolio_id, symbol, side, order_type, quantity, trigger_price, take_profit_price, stop_loss_price, status, executed_price, error, created_at, updated_at')
        .order('created_at', { ascending: false }).limit(500);
    if (status && status !== 'all') ordersQuery = ordersQuery.eq('status', status);
    const [orders, alerts, alertEvents, transactions, portfolios, profiles] = await Promise.all([
        ordersQuery,
        admin.from('price_alerts').select('id, user_id, symbol, direction, target_price, status, triggered_price, triggered_at, expires_at, created_at, repeat_interval_minutes').order('created_at', { ascending: false }).limit(1000),
        admin.from('price_alert_events').select('id, alert_id, user_id, symbol, event_type, target_price, market_price, created_at').order('created_at', { ascending: false }).limit(250),
        admin.from('portfolio_transactions').select('id, portfolio_id, symbol, transaction_type, quantity, price, cash_delta, realized_pnl, created_at').order('created_at', { ascending: false }).limit(500),
        admin.from('user_portfolios').select('id, user_id'),
        admin.from('user_profiles').select('user_id, display_name, full_name'),
    ]);
    const failure = orders.error ?? alerts.error ?? alertEvents.error ?? transactions.error ?? portfolios.error ?? profiles.error;
    if (failure) {
        console.error('Admin orders and alerts query failed.', failure);
        return NextResponse.json({ error: 'Emir, alarm ve işlem kayıtları yüklenemedi.' }, { status: 500 });
    }
    const owners = new Map((portfolios.data ?? []).map((item) => [item.id, item.user_id]));
    const displayNames = new Map((profiles.data ?? []).map((item) => [item.user_id, item.display_name || item.full_name || 'Trader']));
    return NextResponse.json({
        success: true,
        data: {
            orders: (orders.data ?? []).map((item) => ({ ...item, user_id: owners.get(item.portfolio_id) ?? '', display_name: displayNames.get(owners.get(item.portfolio_id) ?? '') ?? 'Trader' })),
            alerts: (alerts.data ?? []).map((item) => ({ ...item, display_name: displayNames.get(item.user_id) ?? 'Trader' })),
            alertEvents: alertEvents.data ?? [],
            transactions: (transactions.data ?? []).map((item) => ({ ...item, user_id: owners.get(item.portfolio_id) ?? '', display_name: displayNames.get(owners.get(item.portfolio_id) ?? '') ?? 'Trader' })),
        },
    });
}

export async function PATCH(request: Request) {
    const context = await requireAdmin();
    if (context.response) return context.response;
    let body: { kind?: unknown; id?: unknown; status?: unknown; targetPrice?: unknown; reason?: unknown };
    try {
        body = await request.json() as typeof body;
    } catch {
        return NextResponse.json({ error: 'Geçersiz JSON içeriği.' }, { status: 400 });
    }
    if (typeof body.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.id)) {
        return NextResponse.json({ error: 'Geçersiz kayıt kimliği.' }, { status: 400 });
    }
    const { error } = body.kind === 'alert'
        ? await context.sessionClient.rpc('admin_update_alert', {
            p_actor_id: context.user.id, p_alert_id: body.id,
            p_status: body.status, p_target_price: body.targetPrice === undefined ? null : Number(body.targetPrice),
        })
        : await context.sessionClient.rpc('admin_update_order_status', {
            p_actor_id: context.user.id, p_order_id: body.id, p_status: body.status,
            p_reason: typeof body.reason === 'string' ? body.reason.slice(0, 180) : null,
        });
    if (error) {
        console.error('Admin order or alert update failed.', error);
        return NextResponse.json({ error: 'Kayıt güncellenemedi. Durum veya yetki uygun değil.' }, { status: 400 });
    }
    return NextResponse.json({ success: true });
}
