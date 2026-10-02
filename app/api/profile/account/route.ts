import { createHash, randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase-admin';
import { getSupabaseServerClient } from '@/lib/supabase-server';
import { getAuthRedirectUrl } from '@/lib/app-url';

const FREEZE_DURATIONS = [1, 7, 14, 30] as const;
const ACCOUNT_MIGRATION_ERROR = 'Hesap dondurma ve e-posta onaylı silme tabloları bulunamadı. Supabase SQL Editor’da supabase/account-deletion-confirmation-migration.sql dosyasını çalıştırın.';

async function recordAccountActivity(
    admin: NonNullable<ReturnType<typeof getSupabaseAdminClient>>,
    userId: string,
    eventType: 'account_freeze_requested' | 'account_reactivated' | 'account_deletion_requested',
    description: string,
    metadata: Record<string, string | number>,
) {
    const { error } = await admin.from('user_activity_logs').insert({
        user_id: userId,
        event_type: eventType,
        description,
        metadata,
    });
    return error;
}

function isMissingAccountTable(error: { code?: string; message?: string }) {
    return error.code === '42P01'
        || error.code === 'PGRST205'
        || /account_freeze_requests|pending_account_deletions|schema cache/i.test(error.message ?? '');
}

async function getAuthenticatedContext() {
    const sessionClient = await getSupabaseServerClient();
    if (!sessionClient) return { sessionClient: null, user: null, admin: null };
    const { data: { user }, error } = await sessionClient.auth.getUser();
    if (error) console.error('Self-service account authentication failed.', error);
    return { sessionClient, user: error ? null : user, admin: getSupabaseAdminClient() };
}

function parseBody(body: unknown): { action?: unknown; days?: unknown; password?: unknown; confirmation?: unknown } | null {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
    return body as { action?: unknown; days?: unknown; password?: unknown; confirmation?: unknown };
}

async function verifyPassword(email: string | undefined, password: unknown) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anonKey || typeof password !== 'string' || !password) return false;
    const verifier = createClient(url, anonKey, {
        auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error } = await verifier.auth.signInWithPassword({ email: email ?? '', password });
    return !error;
}

export async function GET() {
    const { user, admin } = await getAuthenticatedContext();
    if (!user) return NextResponse.json({ error: 'Bu işlem için giriş yapmalısın.' }, { status: 401 });
    if (!admin) return NextResponse.json({ error: 'Hesap güvenliği işlemleri için sunucu ortamında SUPABASE_SERVICE_ROLE_KEY tanımlanmalıdır.' }, { status: 503 });

    const { data: request, error } = await admin.from('account_freeze_requests')
        .select('requested_at, unfreeze_at, delete_after')
        .eq('user_id', user.id)
        .maybeSingle();
    if (error) {
        console.error('Account freeze status lookup failed.', error);
        return NextResponse.json({ error: isMissingAccountTable(error) ? ACCOUNT_MIGRATION_ERROR : 'Hesap durumu yüklenemedi.' }, { status: 500 });
    }
    if (request && user.last_sign_in_at && new Date(user.last_sign_in_at) > new Date(request.requested_at)) {
        const { error: deleteError } = await admin.from('account_freeze_requests').delete().eq('user_id', user.id);
        if (deleteError) {
            console.error('Returned account freeze request could not be cleared.', deleteError);
            return NextResponse.json({ error: 'Dondurma isteği iptal edilemedi.' }, { status: 500 });
        }
        const { error: unbanError } = await admin.auth.admin.updateUserById(user.id, { ban_duration: 'none' });
        if (unbanError) {
            console.error('Returned account could not be reactivated.', unbanError);
            return NextResponse.json({ error: 'Hesap yeniden etkinleştirilemedi.' }, { status: 500 });
        }
        const activityError = await recordAccountActivity(
            admin,
            user.id,
            'account_reactivated',
            'Hesap giriş yapılarak yeniden etkinleştirildi; dondurma ve silme planı iptal edildi.',
            {},
        );
        if (activityError) console.error('Account reactivation activity could not be recorded.', activityError);
        return NextResponse.json({ success: true, data: null });
    }
    return NextResponse.json({ success: true, data: request ?? null });
}

export async function POST(request: Request) {
    const { user, admin } = await getAuthenticatedContext();
    if (!user) return NextResponse.json({ error: 'Bu işlem için giriş yapmalısın.' }, { status: 401 });
    if (!admin) return NextResponse.json({ error: 'Hesap güvenliği işlemleri için sunucu ortamında SUPABASE_SERVICE_ROLE_KEY tanımlanmalıdır.' }, { status: 503 });

    let body: ReturnType<typeof parseBody>;
    try {
        body = parseBody(await request.json());
    } catch {
        return NextResponse.json({ error: 'İstek içeriği okunamadı.' }, { status: 400 });
    }
    if (!body || (body.action !== 'freeze' && body.action !== 'delete')) {
        return NextResponse.json({ error: 'Geçersiz hesap işlemi.' }, { status: 400 });
    }
    if (!await verifyPassword(user.email, body.password)) {
        return NextResponse.json({ error: 'Parola doğrulanamadı.' }, { status: 403 });
    }

    if (body.action === 'delete') {
        if (body.confirmation !== 'SİL') return NextResponse.json({ error: 'Kalıcı silme onayı geçersiz.' }, { status: 400 });
        if (!user.email) return NextResponse.json({ error: 'Hesap e-posta adresi doğrulanamadı.' }, { status: 400 });
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
        if (!url || !anonKey) return NextResponse.json({ error: 'Supabase bağlantısı yapılandırılmamış.' }, { status: 503 });

        const token = randomBytes(32).toString('hex');
        const tokenHash = createHash('sha256').update(token).digest('hex');
        const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
        const { error: requestError } = await admin.from('pending_account_deletions').upsert({
            user_id: user.id,
            token_hash: tokenHash,
            expires_at: expiresAt,
        });
        if (requestError) {
            console.error('Account deletion confirmation could not be prepared.', requestError);
            return NextResponse.json({ error: isMissingAccountTable(requestError) ? ACCOUNT_MIGRATION_ERROR : 'E-posta doğrulama isteği oluşturulamadı. Lütfen tekrar deneyin.' }, { status: 500 });
        }
        const authClient = createClient(url, anonKey, {
            auth: { autoRefreshToken: false, persistSession: false },
        });
        const redirectTo = new URL(getAuthRedirectUrl('/auth/callback', request));
        redirectTo.searchParams.set('next', '/profile');
        redirectTo.searchParams.set('deleteAccount', '1');
        redirectTo.searchParams.set('deleteToken', token);
        const { error: emailError } = await authClient.auth.signInWithOtp({
            email: user.email,
            options: {
                shouldCreateUser: false,
                emailRedirectTo: redirectTo.toString(),
            },
        });
        if (emailError) {
            console.error('Account deletion confirmation email could not be sent.', emailError);
            const { error: cleanupError } = await admin.from('pending_account_deletions').delete().eq('user_id', user.id);
            if (cleanupError) console.error('Failed to clean up pending account deletion.', cleanupError);
            return NextResponse.json({ error: 'Doğrulama e-postası gönderilemedi. Hesap silinmedi; e-posta ayarlarını kontrol edip tekrar deneyin.' }, { status: 502 });
        }
        const activityError = await recordAccountActivity(
            admin,
            user.id,
            'account_deletion_requested',
            'Hesap kalıcı silme talebi oluşturuldu; e-posta doğrulaması bekleniyor.',
            { expires_at: expiresAt },
        );
        if (activityError) {
            console.error('Account deletion request activity could not be recorded.', activityError);
            const { error: cleanupError } = await admin.from('pending_account_deletions').delete().eq('user_id', user.id);
            if (cleanupError) console.error('Failed to clean up unlogged account deletion request.', cleanupError);
            return NextResponse.json({ error: 'Doğrulama e-postası gönderildi ancak silme talebi hareket kaydına yazılamadı; bağlantı iptal edildi. Hesap hareketi migration’ını uygulayıp tekrar deneyin.' }, { status: 500 });
        }
        return NextResponse.json({ success: true, emailSent: true });
    }

    if (!FREEZE_DURATIONS.includes(body.days as (typeof FREEZE_DURATIONS)[number])) {
        return NextResponse.json({ error: 'Dondurma süresi 1, 7, 14 veya 30 gün olmalıdır.' }, { status: 400 });
    }
    const { data: existing, error: lookupError } = await admin.from('account_freeze_requests')
        .select('requested_at').eq('user_id', user.id).maybeSingle();
    if (lookupError) {
        console.error('Existing account freeze lookup failed.', lookupError);
        return NextResponse.json({ error: isMissingAccountTable(lookupError) ? ACCOUNT_MIGRATION_ERROR : 'Hesap dondurma durumu doğrulanamadı.' }, { status: 500 });
    }
    if (existing && user.last_sign_in_at && new Date(user.last_sign_in_at) > new Date(existing.requested_at)) {
        const { error: clearError } = await admin.from('account_freeze_requests').delete().eq('user_id', user.id);
        if (clearError) {
            console.error('Returned account freeze request could not be cleared before a new request.', clearError);
            return NextResponse.json({ error: 'Önceki dondurma isteği iptal edilemedi.' }, { status: 500 });
        }
        const { error: unbanError } = await admin.auth.admin.updateUserById(user.id, { ban_duration: 'none' });
        if (unbanError) {
            console.error('Account could not be reactivated before a new freeze request.', unbanError);
            return NextResponse.json({ error: 'Hesap yeniden etkinleştirilemedi.' }, { status: 500 });
        }
    } else if (existing) {
        return NextResponse.json({ error: 'Bu hesap için zaten bir dondurma isteği var.' }, { status: 409 });
    }

    const days = body.days as (typeof FREEZE_DURATIONS)[number];
    const requestedTime = Date.now();
    const requestedAt = new Date(requestedTime).toISOString();
    const unfreezeAt = new Date(requestedTime + days * 24 * 60 * 60 * 1000).toISOString();
    const deleteAfter = new Date(requestedTime + 30 * 24 * 60 * 60 * 1000).toISOString();
    const { error: insertError } = await admin.from('account_freeze_requests').insert({
        user_id: user.id,
        requested_at: requestedAt,
        unfreeze_at: unfreezeAt,
        delete_after: deleteAfter,
    });
    if (insertError) {
        console.error('Account freeze request could not be recorded.', insertError);
        return NextResponse.json({ error: 'Dondurma isteği kaydedilemedi.' }, { status: 500 });
    }
    const activityError = await recordAccountActivity(
        admin,
        user.id,
        'account_freeze_requested',
        `Hesap ${days} günlüğüne dondurma planına alındı; ${dateLabelForActivity(unfreezeAt)} tarihinde yeniden etkinleşecek.`,
        { days, unfreeze_at: unfreezeAt, delete_after: deleteAfter },
    );
    if (activityError) {
        console.error('Account freeze activity could not be recorded.', activityError);
        const { error: cleanupError } = await admin.from('account_freeze_requests').delete().eq('user_id', user.id);
        if (cleanupError) console.error('Failed to clean up unlogged account freeze request.', cleanupError);
        return NextResponse.json({ error: 'Dondurma talebi hareket kaydına yazılamadı; talep oluşturulmadı. Hesap hareketi migration’ının uygulandığını kontrol edin.' }, { status: 500 });
    }
    return NextResponse.json({ success: true, unfreezeAt, deleteAfter });
}

export async function PUT(request: Request) {
    const { user, admin } = await getAuthenticatedContext();
    if (!user) return NextResponse.json({ error: 'E-posta bağlantısıyla tekrar giriş yaptıktan sonra bu işlem tamamlanabilir.' }, { status: 401 });
    if (!admin) return NextResponse.json({ error: 'Hesap güvenliği işlemleri için sunucu ortamında SUPABASE_SERVICE_ROLE_KEY tanımlanmalıdır.' }, { status: 503 });
    let body: { token?: unknown };
    try {
        body = await request.json() as { token?: unknown };
    } catch {
        return NextResponse.json({ error: 'Doğrulama isteği okunamadı.' }, { status: 400 });
    }
    if (typeof body.token !== 'string' || !/^[a-f0-9]{64}$/.test(body.token)) {
        return NextResponse.json({ error: 'Doğrulama bağlantısı geçersiz veya süresi dolmuş.' }, { status: 400 });
    }

    const tokenHash = createHash('sha256').update(body.token).digest('hex');
    const { data: pending, error: lookupError } = await admin.from('pending_account_deletions')
        .select('user_id').eq('user_id', user.id).eq('token_hash', tokenHash)
        .gt('expires_at', new Date().toISOString()).maybeSingle();
    if (lookupError) {
        console.error('Pending account deletion verification failed.', lookupError);
        return NextResponse.json({ error: 'Silme doğrulaması kontrol edilemedi.' }, { status: 500 });
    }
    if (!pending) return NextResponse.json({ error: 'Doğrulama bağlantısı geçersiz, süresi dolmuş veya daha önce kullanılmış.' }, { status: 400 });

    const { error: deleteError } = await admin.auth.admin.deleteUser(user.id);
    if (deleteError) {
        console.error('Email-confirmed self-service account deletion failed.', deleteError);
        return NextResponse.json({ error: 'Doğrulama tamamlandı ancak hesap silinemedi. Lütfen daha sonra tekrar deneyin.' }, { status: 500 });
    }
    return NextResponse.json({ success: true, deleted: true });
}

export async function DELETE() {
    const { user, admin } = await getAuthenticatedContext();
    if (!user) return NextResponse.json({ error: 'Bu işlem için giriş yapmalısın.' }, { status: 401 });
    if (!admin) return NextResponse.json({ error: 'Hesap güvenliği işlemleri için sunucu ortamında SUPABASE_SERVICE_ROLE_KEY tanımlanmalıdır.' }, { status: 503 });

    const { data: request, error: lookupError } = await admin.from('account_freeze_requests')
        .select('user_id').eq('user_id', user.id).maybeSingle();
    if (lookupError) {
        console.error('Account freeze request lookup before reactivation failed.', lookupError);
        return NextResponse.json({ error: isMissingAccountTable(lookupError) ? ACCOUNT_MIGRATION_ERROR : 'Dondurma isteği doğrulanamadı.' }, { status: 500 });
    }
    if (!request) return NextResponse.json({ success: true, reactivated: false });

    const { error: deleteError } = await admin.from('account_freeze_requests').delete().eq('user_id', user.id);
    if (deleteError) {
        console.error('Account freeze request cancellation failed.', deleteError);
        return NextResponse.json({ error: 'Dondurma isteği iptal edilemedi.' }, { status: 500 });
    }
    const { error: unbanError } = await admin.auth.admin.updateUserById(user.id, { ban_duration: 'none' });
    if (unbanError) {
        console.error('Account reactivation failed.', unbanError);
        return NextResponse.json({ error: 'Hesap yeniden etkinleştirilemedi.' }, { status: 500 });
    }
    const activityError = await recordAccountActivity(
        admin,
        user.id,
        'account_reactivated',
        'Hesap yeniden etkinleştirildi; bekleyen dondurma ve silme planı iptal edildi.',
        {},
    );
    if (activityError) {
        console.error('Account reactivation activity could not be recorded.', activityError);
        return NextResponse.json({ error: 'Hesap yeniden etkinleştirildi ancak hareket kaydı yazılamadı.' }, { status: 500 });
    }
    return NextResponse.json({ success: true, reactivated: true });
}

function dateLabelForActivity(value: string) {
    return new Date(value).toLocaleString('tr-TR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Istanbul' });
}
