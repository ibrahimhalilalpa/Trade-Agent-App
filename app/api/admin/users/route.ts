import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { getAuthRedirectUrl } from '@/lib/app-url';

type AuthUser = {
    id: string;
    email?: string;
    created_at: string;
    last_sign_in_at?: string;
    email_confirmed_at?: string;
    banned_until?: string;
};

export async function GET() {
    const context = await requireAdmin();
    if (context.response) return context.response;
    const { admin, serviceClient } = context;
    if (!serviceClient) {
        const { data, error } = await admin.rpc('admin_list_users');
        if (error) {
            console.error('Admin user directory RPC failed.', error);
            return NextResponse.json({ error: 'Kullanıcı listesi yüklenemedi. RBAC migration güncel değil.' }, { status: 503 });
        }

        return NextResponse.json({ success: true, data: data ?? [] });
    }
    const users: AuthUser[] = [];
    for (let page = 1; ; page += 1) {
        const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
        if (error) {
            console.error('Admin user listing failed.', error);
            return NextResponse.json({ error: 'Kullanıcı listesi yüklenemedi.' }, { status: 500 });
        }
        const pageUsers = data.users as AuthUser[];
        users.push(...pageUsers);
        if (pageUsers.length < 1000) break;
    }
    const ids = users.map((item) => item.id);
    if (ids.length === 0) return NextResponse.json({ success: true, data: [] });

    const profileRows: Array<{ user_id: string; display_name: string; full_name: string }> = [];
    const roleRows: Array<{ user_id: string; role: string }> = [];
    const portfolioRows: Array<{ id: string; user_id: string; balance: number }> = [];
    for (let offset = 0; offset < ids.length; offset += 100) {
        const batch = ids.slice(offset, offset + 100);
        const [profiles, roles, portfolios] = await Promise.all([
            admin.from('user_profiles').select('user_id, display_name, full_name').in('user_id', batch),
            admin.from('user_roles').select('user_id, role').in('user_id', batch),
            admin.from('user_portfolios').select('id, user_id, balance').in('user_id', batch),
        ]);
        const queryError = profiles.error ?? roles.error ?? portfolios.error;
        if (queryError) {
            console.error('Admin user directory query failed.', queryError);
            return NextResponse.json({ error: 'Kullanıcı özetleri yüklenemedi.' }, { status: 500 });
        }
        profileRows.push(...(profiles.data ?? []));
        roleRows.push(...(roles.data ?? []));
        portfolioRows.push(...(portfolios.data ?? []));
    }
    const portfolioIds = (portfolioRows ?? []).map((item) => item.id);
    const positionRows: Array<{ portfolio_id: string; quantity: number; current_price: number; pnl: number }> = [];
    const transactionRows: Array<{ portfolio_id: string; realized_pnl: number; transaction_type: string; cash_delta: number }> = [];
    for (let offset = 0; offset < portfolioIds.length; offset += 100) {
        const batch = portfolioIds.slice(offset, offset + 100);
        const [positions, transactions] = await Promise.all([
            admin.from('user_positions').select('portfolio_id, quantity, current_price, pnl').in('portfolio_id', batch),
            admin.from('portfolio_transactions').select('portfolio_id, realized_pnl, transaction_type, cash_delta').in('portfolio_id', batch),
        ]);
        const queryError = positions.error ?? transactions.error;
        if (queryError) {
            console.error('Admin portfolio summary query failed.', queryError);
            return NextResponse.json({ error: 'Portföy özetleri yüklenemedi.' }, { status: 500 });
        }
        positionRows.push(...(positions.data ?? []));
        transactionRows.push(...(transactions.data ?? []));
    }
    const profileByUser = new Map(profileRows.map((item) => [item.user_id, item]));
    const roleByUser = new Map(roleRows.map((item) => [item.user_id, item.role]));
    const portfolioByUser = new Map((portfolioRows ?? []).map((item) => [item.user_id, item]));
    const stats = new Map<string, { positionValue: number; unrealizedPnl: number; realizedPnl: number; cashAdjustments: number; positionsCount: number }>();
    for (const portfolio of portfolioRows ?? []) {
        stats.set(portfolio.id, { positionValue: 0, unrealizedPnl: 0, realizedPnl: 0, cashAdjustments: 0, positionsCount: 0 });
    }
    for (const position of positionRows) {
        const current = stats.get(position.portfolio_id);
        if (!current) continue;
        current.positionValue += Number(position.quantity) * Number(position.current_price);
        current.unrealizedPnl += Number(position.pnl);
        current.positionsCount += 1;
    }
    for (const transaction of transactionRows) {
        const current = stats.get(transaction.portfolio_id);
        if (!current) continue;
        current.realizedPnl += Number(transaction.realized_pnl);
        if (transaction.transaction_type === 'cash_adjustment') current.cashAdjustments += Number(transaction.cash_delta);
    }

    return NextResponse.json({
        success: true,
        data: users.map((item) => {
            const portfolio = portfolioByUser.get(item.id);
            const summary = portfolio ? stats.get(portfolio.id) : undefined;
            return {
                id: item.id,
                email: item.email ?? '',
                createdAt: item.created_at,
                lastSignInAt: item.last_sign_in_at ?? null,
                emailVerifiedAt: item.email_confirmed_at ?? null,
                banned: Boolean(item.banned_until && new Date(item.banned_until).getTime() > Date.now()),
                displayName: profileByUser.get(item.id)?.display_name || profileByUser.get(item.id)?.full_name || '',
                role: roleByUser.get(item.id) ?? 'user',
                balance: Number(portfolio?.balance ?? 0),
                portfolioValue: Number(portfolio?.balance ?? 0) + (summary?.positionValue ?? 0),
                realizedPnl: summary?.realizedPnl ?? 0,
                unrealizedPnl: summary?.unrealizedPnl ?? 0,
                positionsCount: summary?.positionsCount ?? 0,
                cashAdjustments: summary?.cashAdjustments ?? 0,
            };
        }),
    });
}

export async function POST(request: Request) {
    const context = await requireAdmin();
    if (context.response) return context.response;
    if (!context.serviceClient) {
        return NextResponse.json({ error: 'Kullanıcı daveti Supabase Auth Admin API gerektirir. Sunucu ortamında SUPABASE_SERVICE_ROLE_KEY tanımlayın.' }, { status: 503 });
    }
    let body: { email?: unknown; displayName?: unknown };
    try {
        body = await request.json() as typeof body;
    } catch {
        return NextResponse.json({ error: 'Geçersiz JSON içeriği.' }, { status: 400 });
    }
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const displayName = typeof body.displayName === 'string' ? body.displayName.trim().toLowerCase() : '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254
        || (displayName && !/^[a-z][a-z0-9_]{2,23}$/.test(displayName))) {
        return NextResponse.json({ error: 'Geçerli e-posta ve kurallara uygun kullanıcı adı girin.' }, { status: 400 });
    }
    if (displayName) {
        const { data: existingUsername, error: usernameError } = await context.admin
            .from('user_profiles').select('user_id').eq('username', displayName).maybeSingle();
        if (usernameError) {
            console.error('Invitation username availability lookup failed.', usernameError);
            return NextResponse.json({ error: 'Kullanıcı adı kontrol edilemedi.' }, { status: 500 });
        }
        if (existingUsername) return NextResponse.json({ error: 'Bu kullanıcı adı başka biri tarafından kullanılıyor.' }, { status: 409 });
    }
    const { data, error } = await context.serviceClient.auth.admin.inviteUserByEmail(email, {
        data: { display_name: displayName },
        redirectTo: `${getAuthRedirectUrl('/auth/callback', request)}?next=${encodeURIComponent('/profile')}`,
    });
    if (error || !data.user) {
        if (error) console.error('Admin user invitation failed.', error);
        return NextResponse.json({ error: 'Kullanıcı davet edilemedi. E-posta zaten kayıtlı olabilir veya e-posta sağlayıcısını kontrol edin.' }, { status: 400 });
    }
    const { error: profileError } = await context.admin.from('user_profiles').upsert({
        user_id: data.user.id, ...(displayName ? { username: displayName, display_name: displayName } : {}),
    }, { onConflict: 'user_id' });
    if (profileError) {
        console.error('Invited user profile initialization failed.', profileError);
        if (profileError.code === '23505') return NextResponse.json({ error: 'Davet oluşturuldu ancak seçilen kullanıcı adı başka bir kullanıcı tarafından alındı.' }, { status: 409 });
        return NextResponse.json({ error: 'Davet oluşturuldu ancak profil başlangıç kaydı yazılamadı. Kullanıcı e-postasını kontrol edin.' }, { status: 500 });
    }
    const { error: auditError } = await context.admin.from('user_activity_logs').insert({
        user_id: data.user.id,
        event_type: 'admin_user_invited',
        description: 'Yönetici yeni kullanıcı daveti gönderdi.',
        metadata: { actor_id: context.user.id, email },
    });
    if (auditError) {
        console.error('Admin user invitation audit failed.', auditError);
        return NextResponse.json({ error: 'Davet gönderildi ancak denetim kaydı eklenemedi; davet edilen e-postayı kontrol edin.' }, { status: 500 });
    }
    return NextResponse.json({ success: true, data: { id: data.user.id, email, invited: true } }, { status: 201 });
}
