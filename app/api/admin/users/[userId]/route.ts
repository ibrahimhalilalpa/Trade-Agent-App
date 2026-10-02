import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { hasProfanity } from '@/lib/profanityFilter';
import { getAuthRedirectUrl } from '@/lib/app-url';

type UserRole = 'user' | 'pro_trader' | 'analyst' | 'admin' | 'super_admin';
const USER_ROLES: UserRole[] = ['user', 'pro_trader', 'analyst', 'admin', 'super_admin'];
const UUID_PATTERN = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

export async function GET(_request: Request, { params }: { params: Promise<{ userId: string }> }) {
    const context = await requireAdmin();
    if (context.response) return context.response;
    const { userId } = await params;
    if (!UUID_PATTERN.test(userId)) {
        return NextResponse.json({ error: 'Geçersiz kullanıcı kimliği.' }, { status: 400 });
    }
    const { admin } = context;
    const [authResult, profile, role, portfolio, rank] = await Promise.all([
        context.serviceClient
            ? context.serviceClient.auth.admin.getUserById(userId).then(({ data, error }) => ({
                data: { user: data.user ? {
                    id: data.user.id, email: data.user.email, created_at: data.user.created_at,
                    last_sign_in_at: data.user.last_sign_in_at, email_confirmed_at: data.user.email_confirmed_at,
                    banned_until: data.user.banned_until,
                } : null }, error,
            }))
            : admin.rpc('admin_get_user_auth', { p_target_id: userId }).then(({ data, error }) => ({
                data: { user: Array.isArray(data) ? data[0] ?? null : null }, error,
            })),
        admin.from('user_profiles').select('username, display_name, full_name, bio, avatar_url, gender, is_profile_public, leaderboard_visible, leaderboard_gain_visible, rank_xp_adjustment').eq('user_id', userId).maybeSingle(),
        admin.from('user_roles').select('role').eq('user_id', userId).maybeSingle(),
        admin.from('user_portfolios').select('id, balance, created_at').eq('user_id', userId).maybeSingle(),
        admin.rpc('get_trader_rank', { p_user_id: userId }),
    ]);
    const restriction = await admin.from('account_moderation_restrictions')
        .select('restriction_type, reason_title, explanation, starts_at, ends_at, is_active')
        .eq('user_id', userId).eq('is_active', true).maybeSingle();
    const portfolioId = portfolio.data?.id;
    const [positions, orders, transactions] = portfolioId ? await Promise.all([
        admin.from('user_positions').select('symbol, quantity, average_price, current_price, pnl, updated_at')
            .eq('portfolio_id', portfolioId),
        admin.from('portfolio_orders').select('id, symbol, side, order_type, quantity, trigger_price, status, created_at')
            .eq('portfolio_id', portfolioId).order('created_at', { ascending: false }).limit(50),
        admin.from('portfolio_transactions').select('id, symbol, transaction_type, quantity, price, cash_delta, realized_pnl, created_at')
            .eq('portfolio_id', portfolioId).order('created_at', { ascending: false }).limit(50),
    ]) : [{ data: [], error: null }, { data: [], error: null }, { data: [], error: null }];
    const failure = authResult.error ?? profile.error ?? role.error ?? portfolio.error ?? rank.error ?? positions.error ?? orders.error ?? transactions.error ?? restriction.error;
    if (failure) {
        console.error('Admin user detail query failed.', failure);
        return NextResponse.json({ error: restriction.error ? 'Hesap moderasyonu verileri yüklenemedi. account-moderation-migration.sql dosyasını çalıştırın.' : 'Kullanıcı detayları yüklenemedi.' }, { status: 500 });
    }
    const user = authResult.data.user;
    if (!user) return NextResponse.json({ error: 'Kullanıcı bulunamadı.' }, { status: 404 });
    return NextResponse.json({
        success: true,
        data: {
            id: user.id,
            email: user.email ?? '',
            createdAt: user.created_at,
            lastSignInAt: user.last_sign_in_at ?? null,
            emailVerifiedAt: user.email_confirmed_at ?? null,
            banned: Boolean(user.banned_until && new Date(user.banned_until).getTime() > Date.now()),
            restriction: restriction.data && (!restriction.data.ends_at || new Date(restriction.data.ends_at).getTime() > Date.now())
                ? restriction.data
                : null,
            profile: profile.data,
            role: role.data?.role ?? 'user',
            rank: rank.data,
            portfolio: portfolio.data,
            positions: positions.data ?? [],
            pendingOrders: (orders.data ?? []).filter((item) => ['pending', 'open', 'partially_filled'].includes(item.status)),
            recentTransactions: transactions.data ?? [],
        },
    });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ userId: string }> }) {
    const context = await requireAdmin();
    if (context.response) return context.response;
    const { userId } = await params;
    if (!UUID_PATTERN.test(userId)) return NextResponse.json({ error: 'Geçersiz kullanıcı kimliği.' }, { status: 400 });
    let body: { role?: unknown; rankXpAdjustment?: unknown; rankNote?: unknown; displayName?: unknown; fullName?: unknown; bio?: unknown };
    try {
        body = await request.json() as typeof body;
    } catch {
        return NextResponse.json({ error: 'Geçersiz JSON içeriği.' }, { status: 400 });
    }
    const hasProfileUpdate = body.displayName !== undefined || body.fullName !== undefined || body.bio !== undefined;
    if (body.role === undefined && body.rankXpAdjustment === undefined && !hasProfileUpdate) {
        return NextResponse.json({ error: 'Güncellenecek kullanıcı alanı gerekli.' }, { status: 400 });
    }
    if (body.role !== undefined && (typeof body.role !== 'string' || !USER_ROLES.includes(body.role as UserRole))) {
        return NextResponse.json({ error: 'Geçersiz kullanıcı rolü.' }, { status: 400 });
    }
    const { admin, user } = context;
    if (hasProfileUpdate) {
        const displayName = typeof body.displayName === 'string' ? body.displayName.trim() : '';
        const fullName = typeof body.fullName === 'string' ? body.fullName.trim() : '';
        const bio = typeof body.bio === 'string' ? body.bio.trim() : '';
        if (!/^[a-z][a-z0-9_]{2,23}$/.test(displayName.toLowerCase())
            || fullName.length > 120 || bio.length > 280) {
            return NextResponse.json({ error: 'Kullanıcı adı 3–24 karakter olmalı; ad soyad 120, biyografi 280 karakteri aşamaz.' }, { status: 400 });
        }
        if (hasProfanity(displayName) || hasProfanity(fullName) || hasProfanity(bio)) {
            return NextResponse.json({ error: 'Profil alanları topluluk kurallarına uygun olmayan ifadeler içeremez.' }, { status: 400 });
        }
        const { error } = await admin.rpc('admin_update_user_profile', {
            p_actor_id: user.id, p_target_id: userId,
            p_display_name: displayName.toLowerCase(), p_full_name: fullName, p_bio: bio,
        });
        if (error) {
            console.error('Admin profile update failed.', error);
            if (error.code === '23505') return NextResponse.json({ error: 'Bu kullanıcı adı başka biri tarafından kullanılıyor.' }, { status: 409 });
            return NextResponse.json({ error: 'Profil bilgileri kaydedilemedi. RBAC migration güncel mi kontrol edin.' }, { status: 400 });
        }
    }
    if (body.role !== undefined) {
        const { data: result, error } = await admin.rpc('admin_set_user_role', {
            p_actor_id: user.id, p_target_id: userId, p_role: body.role,
        });
        if (error || !result) {
            if (error) console.error('Admin role update failed.', error);
            return NextResponse.json({ error: 'Rol güncellenemedi. Yetki ve hedef rol kurallarını kontrol edin.' }, { status: 403 });
        }
    }
    if (body.rankXpAdjustment !== undefined) {
        const adjustment = Number(body.rankXpAdjustment);
        if (body.rankNote !== undefined && typeof body.rankNote !== 'string') {
            return NextResponse.json({ error: 'Rank değişikliği mesajı geçersiz.' }, { status: 400 });
        }
        const note = typeof body.rankNote === 'string' ? body.rankNote.trim() : '';
        if (!Number.isInteger(adjustment) || adjustment < -1000000 || adjustment > 1000000) {
            return NextResponse.json({ error: 'Trader Rank XP düzeltmesi geçersiz.' }, { status: 400 });
        }
        if (note.length > 180) {
            return NextResponse.json({ error: 'Rank değişikliği mesajı en fazla 180 karakter olabilir.' }, { status: 400 });
        }
        const { error } = await admin.rpc('admin_set_rank_xp_adjustment', {
            p_actor_id: user.id, p_target_id: userId, p_adjustment: adjustment, p_note: note || null,
        });
        if (error) {
            console.error('Admin rank adjustment failed.', error);
            return NextResponse.json({ error: 'Trader Rank güncellenemedi. RBAC migration güncel mi kontrol edin.' }, { status: 400 });
        }
    }
    return NextResponse.json({ success: true });
}

export async function POST(request: Request, { params }: { params: Promise<{ userId: string }> }) {
    const context = await requireAdmin();
    if (context.response) return context.response;
    const { userId } = await params;
    if (!UUID_PATTERN.test(userId)) return NextResponse.json({ error: 'Geçersiz kullanıcı kimliği.' }, { status: 400 });
    let body: { action?: unknown; amount?: unknown; note?: unknown; reasonId?: unknown; explanation?: unknown; days?: unknown };
    try {
        body = await request.json() as { action?: unknown; amount?: unknown; note?: unknown };
    } catch {
        return NextResponse.json({ error: 'Geçersiz JSON içeriği.' }, { status: 400 });
    }
    const { admin, user, role: actorRole, sessionClient, serviceClient } = context;
    const { data: targetRole, error: roleError } = await admin.from('user_roles').select('role').eq('user_id', userId).maybeSingle();
    if (roleError) return NextResponse.json({ error: 'Hedef kullanıcının rolü doğrulanamadı.' }, { status: 500 });
    if (!targetRole) return NextResponse.json({ error: 'Kullanıcı bulunamadı.' }, { status: 404 });
    if (actorRole !== 'super_admin' && ['admin', 'super_admin'].includes(targetRole.role)) {
        return NextResponse.json({ error: 'Yalnızca super admin bu yönetici hesabında işlem yapabilir.' }, { status: 403 });
    }

    if (body.action === 'cash_adjustment') {
        if (actorRole !== 'super_admin') {
            return NextResponse.json({ error: 'Sanal bakiye düzenlemesi yalnızca super admin tarafından yapılabilir.' }, { status: 403 });
        }
        const amount = typeof body.amount === 'number' ? body.amount : Number(body.amount);
        const note = typeof body.note === 'string' ? body.note.trim() : '';
        if (!Number.isFinite(amount) || amount === 0 || Math.abs(amount) > 1000000000 || note.length < 1 || note.length > 180) {
            return NextResponse.json({ error: 'Geçerli bir tutar ve 1–180 karakterlik açıklama girin.' }, { status: 400 });
        }
        const { error } = await admin.rpc('admin_adjust_portfolio_cash', {
            p_actor_id: user.id, p_target_id: userId, p_delta: amount, p_note: note,
        });
        if (error) {
            console.error('Admin cash adjustment failed.', error);
            return NextResponse.json({ error: error.message }, { status: 400 });
        }
        return NextResponse.json({ success: true });
    }

    if (body.action === 'ban' || body.action === 'unban' || body.action === 'delete') {
        if (!serviceClient) {
            return NextResponse.json({ error: 'Hesap moderasyonu Supabase Auth Admin API gerektirir. Sunucu ortamında SUPABASE_SERVICE_ROLE_KEY tanımlayın.' }, { status: 503 });
        }
        if (body.action !== 'unban' && user.id === userId) {
            return NextResponse.json({ error: 'Kendi hesabınıza kısıtlama uygulayamazsınız.' }, { status: 400 });
        }
        const { data: targetAuth, error: targetAuthError } = await serviceClient.auth.admin.getUserById(userId);
        if (targetAuthError || !targetAuth.user) {
            if (targetAuthError) console.error('Admin account status target lookup failed.', targetAuthError);
            return NextResponse.json({ error: 'Hedef hesabın e-posta bilgisi doğrulanamadı.' }, { status: 404 });
        }
        let reasonTitle = '';
        let explanation = '';
        let reasonId: string | null = null;
        let endsAt: string | null = null;
        let restrictionType: 'suspension' | 'closure' | null = null;
        if (body.action !== 'unban') {
            if (typeof body.reasonId !== 'string' || !UUID_PATTERN.test(body.reasonId)) {
                return NextResponse.json({ error: 'Bir dondurma nedeni seçin.' }, { status: 400 });
            }
            const { data: reason, error: reasonError } = await serviceClient.from('account_moderation_reasons')
                .select('id, title, explanation').eq('id', body.reasonId).eq('is_active', true).maybeSingle();
            if (reasonError || !reason) {
                if (reasonError) console.error('Admin account moderation reason lookup failed.', reasonError);
                return NextResponse.json({ error: 'Seçilen neden bulunamadı veya devre dışı bırakılmış.' }, { status: 400 });
            }
            reasonTitle = reason.title;
            explanation = typeof body.explanation === 'string' ? body.explanation.trim() : '';
            if (explanation.length < 10 || explanation.length > 1000) {
                return NextResponse.json({ error: 'Açıklama 10-1000 karakter arasında olmalıdır.' }, { status: 400 });
            }
            reasonId = reason.id;
            restrictionType = body.action === 'delete' ? 'closure' : 'suspension';
            if (restrictionType === 'suspension') {
                const days = Number(body.days);
                if (!Number.isInteger(days) || days < 1 || days > 3650) {
                    return NextResponse.json({ error: 'Dondurma süresi 1-3650 gün arasında bir tam sayı olmalıdır.' }, { status: 400 });
                }
                endsAt = new Date(Date.now() + days * 86400000).toISOString();
            }
            const email = targetAuth.user.email?.trim().toLocaleLowerCase('en-US');
            if (!email) return NextResponse.json({ error: 'Hedef hesabın e-posta adresi bulunamadı.' }, { status: 400 });
            const startsAt = new Date().toISOString();
            const { data: previousRestriction, error: previousRestrictionError } = await serviceClient
                .from('account_moderation_restrictions').select('*').eq('user_id', userId).maybeSingle();
            if (previousRestrictionError) {
                console.error('Existing account restriction could not be loaded.', previousRestrictionError);
                return NextResponse.json({ error: 'Mevcut hesap kısıtlaması doğrulanamadı.' }, { status: 500 });
            }
            const { error: restrictionError } = await serviceClient.from('account_moderation_restrictions').upsert({
                user_id: userId,
                email_hash: createHash('sha256').update(email).digest('hex'),
                restriction_type: restrictionType,
                reason_id: reasonId,
                reason_title: reasonTitle,
                explanation,
                starts_at: startsAt,
                ends_at: endsAt,
                is_active: true,
                moderator_id: user.id,
                updated_at: startsAt,
            });
            if (restrictionError) {
                console.error('Admin account restriction could not be saved.', restrictionError);
                return NextResponse.json({ error: 'Hesap kısıtlaması kaydedilemedi. account-moderation-migration.sql migration dosyasını uygulayın.' }, { status: 500 });
            }
            const duration = restrictionType === 'closure' ? '876000h' : `${Number(body.days) * 24}h`;
            const { error: authError } = await serviceClient.auth.admin.updateUserById(userId, { ban_duration: duration });
            if (authError) {
                console.error('Admin account restriction could not be applied to Supabase Auth.', authError);
                const rollback = previousRestriction
                    ? await serviceClient.from('account_moderation_restrictions').upsert(previousRestriction)
                    : await serviceClient.from('account_moderation_restrictions')
                        .update({ is_active: false, updated_at: new Date().toISOString() }).eq('user_id', userId);
                const rollbackError = rollback.error;
                if (rollbackError) console.error('Failed to roll back account restriction after Auth error.', rollbackError);
                return NextResponse.json({ error: 'Hesap kısıtlaması giriş sistemine uygulanamadı.' }, { status: 500 });
            }
        } else {
            const { error: authError } = await serviceClient.auth.admin.updateUserById(userId, { ban_duration: 'none' });
            if (authError) {
                console.error('Admin account reactivation failed.', authError);
                return NextResponse.json({ error: 'Hesap durumu güncellenemedi.' }, { status: 500 });
            }
            const { error: restrictionError } = await serviceClient.from('account_moderation_restrictions')
                .update({ is_active: false, updated_at: new Date().toISOString() }).eq('user_id', userId).eq('is_active', true);
            if (restrictionError) {
                console.error('Admin account restriction could not be cleared.', restrictionError);
                return NextResponse.json({ error: 'Hesap açıldı ancak moderasyon kaydı kapatılamadı.' }, { status: 500 });
            }
        }
        const { error: auditError } = await admin.from('user_activity_logs').insert({
            user_id: userId,
            event_type: 'admin_account_status',
            description: body.action === 'unban'
                ? 'Hesap yönetici tarafından yeniden etkinleştirildi.'
                : body.action === 'delete' ? 'Hesap yönetici tarafından itiraz hakkı korunarak kapatıldı.' : 'Hesap yönetici tarafından süreli olarak donduruldu.',
            metadata: { actor_id: user.id, action: body.action, reason_title: reasonTitle, explanation, ends_at: endsAt },
        });
        if (auditError) console.error('Admin account status audit logging failed.', auditError);
        if (auditError) return NextResponse.json({ error: 'Hesap durumu değişti ancak denetim kaydı eklenemedi.' }, { status: 500 });
        return NextResponse.json({ success: true });
    }

    if (body.action === 'recovery_link') {
        const { data: userAuth, error: authError } = serviceClient
            ? await serviceClient.auth.admin.getUserById(userId).then((result) => ({ data: result.data.user, error: result.error }))
            : await admin.rpc('admin_get_user_auth', { p_target_id: userId }).then((result) => ({
                data: Array.isArray(result.data) ? result.data[0] ?? null : null, error: result.error,
            }));
        if (authError || !userAuth?.email) {
            if (authError) console.error('Admin recovery email lookup failed.', authError);
            return NextResponse.json({ error: 'Kullanıcının e-posta adresi bulunamadı.' }, { status: 404 });
        }
        const { data, error } = serviceClient
            ? await serviceClient.auth.admin.generateLink({
                type: 'recovery', email: userAuth.email,
                options: { redirectTo: `${getAuthRedirectUrl('/auth/callback', request)}?next=${encodeURIComponent('/profile?recovery=1')}` },
            })
            : await sessionClient.auth.resetPasswordForEmail(userAuth.email, {
                redirectTo: `${getAuthRedirectUrl('/auth/callback', request)}?next=${encodeURIComponent('/profile?recovery=1')}`,
            }).then((result) => ({ data: { properties: { action_link: null } }, error: result.error }));
        if (error) {
            console.error('Admin recovery link generation failed.', error);
            return NextResponse.json({ error: 'Parola sıfırlama e-postası gönderilemedi.' }, { status: 500 });
        }
        const { error: auditError } = await admin.from('user_activity_logs').insert({
            user_id: userId,
            event_type: 'admin_account_status',
            description: 'Yönetici parola yenileme bağlantısı oluşturdu.',
            metadata: { actor_id: user.id, action: 'recovery_link' },
        });
        if (auditError) {
            console.error('Admin recovery link audit logging failed.', auditError);
            return NextResponse.json({ error: 'Bağlantı oluşturuldu ancak denetim kaydı eklenemedi; bağlantıyı güvenli işlem için tekrar oluşturun.' }, { status: 500 });
        }
        return NextResponse.json({ success: true, emailSent: !serviceClient, actionLink: data.properties.action_link });
    }

    return NextResponse.json({ error: 'Desteklenmeyen yönetim işlemi.' }, { status: 400 });
}
