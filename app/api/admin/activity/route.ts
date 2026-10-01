import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';

export async function GET() {
    const context = await requireAdmin();
    if (context.response) return context.response;
    const { admin } = context;
    const [authEvents, orderEvents, tradeEvents, alertEvents, lessonEvents] = await Promise.all([
        admin.from('user_activity_logs').select('id, user_id, event_type, description, created_at, metadata')
            .order('created_at', { ascending: false }).limit(30),
        admin.from('portfolio_order_events').select('id, portfolio_id, symbol, side, event_type, created_at')
            .order('created_at', { ascending: false }).limit(30),
        admin.from('portfolio_transactions').select('id, portfolio_id, symbol, transaction_type, quantity, price, cash_delta, created_at')
            .order('created_at', { ascending: false }).limit(30),
        admin.from('price_alert_events').select('id, user_id, symbol, event_type, target_price, market_price, created_at')
            .order('created_at', { ascending: false }).limit(30),
        admin.from('user_education_progress').select('id, user_id, lesson_id, completed_at')
            .eq('completed', true).order('completed_at', { ascending: false }).limit(30),
    ]);
    const failure = authEvents.error ?? orderEvents.error ?? tradeEvents.error ?? alertEvents.error ?? lessonEvents.error;
    if (failure) {
        console.error('Admin activity feed query failed.', failure);
        return NextResponse.json({ error: 'Sistem etkinlik akışı yüklenemedi.' }, { status: 500 });
    }

    const portfolioIds = [...new Set([
        ...(orderEvents.data ?? []).map((item) => item.portfolio_id),
        ...(tradeEvents.data ?? []).map((item) => item.portfolio_id),
    ])];
    const portfolioResult = portfolioIds.length
        ? await admin.from('user_portfolios').select('id, user_id').in('id', portfolioIds)
        : { data: [], error: null };
    if (portfolioResult.error) {
        console.error('Admin activity portfolio lookup failed.', portfolioResult.error);
        return NextResponse.json({ error: 'Emir etkinlikleri kullanıcılarla eşleştirilemedi.' }, { status: 500 });
    }
    const portfolioOwner = new Map((portfolioResult.data ?? []).map((item) => [item.id, item.user_id]));
    const directory = await admin.rpc('admin_list_users');
    if (directory.error) {
        console.error('Admin activity identities lookup failed.', directory.error);
        return NextResponse.json({ error: 'Etkinlik kullanıcıları yüklenemedi.' }, { status: 500 });
    }
    const directoryUsers = (directory.data ?? []) as Array<{ id: string; email: string; displayName: string }>;
    const userById = new Map<string, { id: string; email: string; displayName: string }>(
        directoryUsers.map((item) => [item.id, item]),
    );
    const result = [
        ...(authEvents.data ?? []).map((item) => ({
            id: item.id, userId: item.user_id, kind: item.event_type,
            description: item.description, createdAt: item.created_at, metadata: item.metadata,
        })),
        ...(orderEvents.data ?? []).map((item) => ({
            id: item.id, userId: portfolioOwner.get(item.portfolio_id) ?? '',
            kind: `order_${item.event_type}`,
            description: `${item.symbol} · ${item.side === 'buy' ? 'Alış' : 'Satış'} emri ${item.event_type}`,
            createdAt: item.created_at, metadata: null,
        })),
        ...(tradeEvents.data ?? []).map((item) => ({
            id: item.id, userId: portfolioOwner.get(item.portfolio_id) ?? '',
            kind: `trade_${item.transaction_type}`,
            description: item.transaction_type === 'cash_adjustment'
                ? `Sanal bakiye hareketi · ${item.cash_delta} TL`
                : `${item.symbol ?? 'Hisse'} · ${item.transaction_type === 'buy' ? 'Alış' : 'Satış'} · ${item.quantity} adet · ${item.price} TL`,
            createdAt: item.created_at, metadata: null,
        })),
        ...(alertEvents.data ?? []).map((item) => ({
            id: item.id, userId: item.user_id, kind: `alert_${item.event_type}`,
            description: `${item.symbol} fiyat alarmı ${item.event_type} · hedef ${item.target_price} · fiyat ${item.market_price}`,
            createdAt: item.created_at, metadata: null,
        })),
        ...(lessonEvents.data ?? []).map((item) => ({
            id: item.id, userId: item.user_id, kind: 'lesson_completed',
            description: `Akademi dersi tamamlandı: ${item.lesson_id}`,
            createdAt: item.completed_at, metadata: null,
        })),
    ].map((item) => {
        const user = userById.get(item.userId);
        return {
            ...item,
            email: user?.email ?? '',
            displayName: user?.displayName ?? '',
        };
    }).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 60);
    return NextResponse.json({ success: true, data: result });
}
