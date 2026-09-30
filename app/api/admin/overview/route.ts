import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { isPrivatePreferenceAudit } from '@/lib/privacy-policy';

export async function GET() {
    const context = await requireAdmin();
    if (context.response) return context.response;
    const [users, transactions, positions, activity, status] = await Promise.all([
        context.admin.rpc('admin_list_users'),
        context.admin.from('portfolio_transactions').select('transaction_type, quantity, price, created_at').in('transaction_type', ['buy', 'sell']).gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()).limit(10000),
        context.admin.from('user_positions').select('pnl').limit(10000),
        context.admin.from('user_activity_logs').select('id, user_id, event_type, description, created_at, metadata').order('created_at', { ascending: false }).limit(12),
        context.sessionClient.rpc('admin_get_system_status', { p_actor_id: context.user.id }),
    ]);
    const failure = users.error ?? transactions.error ?? positions.error ?? activity.error ?? status.error;
    if (failure) {
        console.error('Admin overview query failed.', failure);
        return NextResponse.json({ error: 'Yönetim özeti yüklenemedi.' }, { status: 503 });
    }
    const now = Date.now();
    const userRows = (users.data ?? []) as Array<{ id: string; email: string; displayName: string; role: string; createdAt: string; lastSignInAt: string | null; portfolioValue: number; realizedPnl: number; positionsCount: number }>;
    const transactionRows = (transactions.data ?? []) as Array<{ quantity: number; price: number }>;
    const positionRows = (positions.data ?? []) as Array<{ pnl: number }>;
    const turnover24h = transactionRows.reduce((sum, item) => sum + Math.abs(Number(item.quantity) * Number(item.price)), 0);
    const identityById = new Map(userRows.map((item) => [item.id, { email: item.email, displayName: item.displayName }]));
    const recentUsers = userRows.filter((item) => item.lastSignInAt)
        .sort((first, second) => new Date(second.lastSignInAt ?? second.createdAt).getTime() - new Date(first.lastSignInAt ?? first.createdAt).getTime())
        .slice(0, 6);
    return NextResponse.json({
        success: true,
        data: {
            totalUsers: userRows.length,
            activeUsers24h: userRows.filter((item) => item.lastSignInAt && now - new Date(item.lastSignInAt).getTime() <= 24 * 60 * 60 * 1000).length,
            totalPortfolioValue: userRows.reduce((sum, item) => sum + Number(item.portfolioValue), 0),
            totalRealizedPnl: userRows.reduce((sum, item) => sum + Number(item.realizedPnl), 0),
            totalUnrealizedPnl: positionRows.reduce((sum, item) => sum + Number(item.pnl), 0),
            turnover24h,
            openPositions: userRows.reduce((sum, item) => sum + Number(item.positionsCount), 0),
            monitor: status.data,
            activity: (activity.data ?? []).map((item) => ({
                ...item,
                event_type: isPrivatePreferenceAudit(item.metadata)
                    ? 'privacy_preference_changed'
                    : item.event_type,
                email: identityById.get(item.user_id)?.email ?? '',
                display_name: identityById.get(item.user_id)?.displayName ?? '',
            })),
            recentUsers,
        },
    });
}
