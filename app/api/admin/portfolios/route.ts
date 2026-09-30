import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';

export async function GET(request: Request) {
    const context = await requireAdmin();
    if (context.response) return context.response;
    const { admin } = context;
    const url = new URL(request.url);
    const query = url.searchParams.get('q')?.trim().toLocaleUpperCase('tr-TR') ?? '';
    const [portfolios, positions, profiles, roles, users] = await Promise.all([
        admin.from('user_portfolios').select('id, user_id, balance, created_at, updated_at').order('updated_at', { ascending: false }).limit(1000),
        admin.from('user_positions').select('id, portfolio_id, symbol, quantity, average_price, current_price, pnl, updated_at').order('updated_at', { ascending: false }).limit(5000),
        admin.from('user_profiles').select('user_id, display_name, full_name'),
        admin.from('user_roles').select('user_id, role'),
        admin.rpc('admin_list_users'),
    ]);
    const failure = portfolios.error ?? positions.error ?? profiles.error ?? roles.error ?? users.error;
    if (failure) {
        console.error('Admin portfolio listing failed.', failure);
        return NextResponse.json({ error: 'Portföy ve pozisyon verileri yüklenemedi.' }, { status: 500 });
    }
    const portfolioById = new Map((portfolios.data ?? []).map((item) => [item.id, item]));
    const profileByUser = new Map((profiles.data ?? []).map((item) => [item.user_id, item]));
    const roleByUser = new Map((roles.data ?? []).map((item) => [item.user_id, item.role]));
    const userRows = (users.data ?? []) as Array<{ id: string; email: string }>;
    const userById = new Map(userRows.map((item) => [item.id, item]));
    const rows = (positions.data ?? []).map((position) => {
        const portfolio = portfolioById.get(position.portfolio_id);
        const profile = portfolio ? profileByUser.get(portfolio.user_id) : null;
        return {
            ...position,
            userId: portfolio?.user_id ?? '',
            email: userById.get(portfolio?.user_id ?? '')?.email ?? '',
            displayName: profile?.display_name || profile?.full_name || 'Trader',
            role: portfolio ? roleByUser.get(portfolio.user_id) ?? 'user' : 'user',
            cashBalance: Number(portfolio?.balance ?? 0),
        };
    }).filter((item) => !query || item.symbol.includes(query) || item.displayName.toLocaleUpperCase('tr-TR').includes(query));
    const totals = rows.reduce((sum, item) => ({
        marketValue: sum.marketValue + Number(item.quantity) * Number(item.current_price),
        unrealizedPnl: sum.unrealizedPnl + Number(item.pnl),
    }), { marketValue: 0, unrealizedPnl: 0 });
    return NextResponse.json({
        success: true,
        data: {
            portfolios: (portfolios.data ?? []).map((item) => {
                const profile = profileByUser.get(item.user_id);
                return {
                    id: item.id, userId: item.user_id, cashBalance: Number(item.balance),
                    email: userById.get(item.user_id)?.email ?? '',
                    displayName: profile?.display_name || profile?.full_name || 'Trader',
                    role: roleByUser.get(item.user_id) ?? 'user',
                };
            }),
            positions: rows,
            totals: { portfolios: portfolios.data?.length ?? 0, openPositions: rows.length, ...totals },
        },
    });
}

export async function PATCH(request: Request) {
    const context = await requireAdmin();
    if (context.response) return context.response;
    let body: { positionId?: unknown; action?: unknown; quantity?: unknown; averagePrice?: unknown };
    try {
        body = await request.json() as typeof body;
    } catch {
        return NextResponse.json({ error: 'Geçersiz JSON içeriği.' }, { status: 400 });
    }
    if (typeof body.positionId !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.positionId)) {
        return NextResponse.json({ error: 'Geçersiz pozisyon kimliği.' }, { status: 400 });
    }
    if (body.action !== 'delete' && body.action !== 'update') {
        return NextResponse.json({ error: 'Desteklenmeyen pozisyon işlemi.' }, { status: 400 });
    }
    const quantity = body.quantity === undefined ? null : Number(body.quantity);
    const averagePrice = body.averagePrice === undefined ? null : Number(body.averagePrice);
    if (body.action === 'update' && (!Number.isFinite(quantity) || quantity === null || quantity <= 0
        || !Number.isFinite(averagePrice) || averagePrice === null || averagePrice <= 0)) {
        return NextResponse.json({ error: 'Miktar ve ortalama maliyet pozitif sayı olmalıdır.' }, { status: 400 });
    }
    const { error } = await context.sessionClient.rpc('admin_adjust_position', {
        p_actor_id: context.user.id, p_position_id: body.positionId, p_action: body.action,
        p_quantity: quantity, p_average_price: averagePrice,
    });
    if (error) {
        console.error('Admin position adjustment failed.', error);
        return NextResponse.json({ error: 'Pozisyon güncellenemedi. Yetkiyi ve migration durumunu kontrol edin.' }, { status: 400 });
    }
    return NextResponse.json({ success: true });
}
