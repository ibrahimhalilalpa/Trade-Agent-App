import { NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabase-server';
import { isPrivatePreferenceAudit } from '@/lib/privacy-policy';

const PROFILE_SCHEMA_ERROR = 'Profil veritabanı şeması eksik. schema.sql tek başına yeterli değildir: proje kurulum sırasındaki user-roles-rank-migration.sql, username-migration.sql ve leaderboard-gain-visibility-migration.sql dosyalarının da uygulanmış olduğunu doğrulayın.';
type PublicLeaderboardRow = { user_id: string };

async function getContext() {
    const supabase = await getSupabaseServerClient();
    if (!supabase) return { supabase: null, user: null };
    const { data: { user } } = await supabase.auth.getUser();
    return { supabase, user };
}

function isMissingSchema(error: { code?: string; message?: string } | null) {
    return error?.code === '42P01'
        || error?.code === 'PGRST205'
        || error?.code === '42703'
        || error?.code === 'PGRST204';
}

export async function GET() {
    const { supabase, user } = await getContext();
    if (!supabase) return NextResponse.json({ error: 'Supabase bağlantısı yapılandırılmamış.' }, { status: 503 });
    if (!user) return NextResponse.json({ error: 'Profilini görmek için giriş yapmalısın.' }, { status: 401 });

    const [profileResult, roleResult, rankResult, leaderboardResult] = await Promise.all([
        supabase.from('user_profiles').select('full_name, username, display_name, bio, leaderboard_visible, leaderboard_gain_visible, updated_at').eq('user_id', user.id).maybeSingle(),
        supabase.from('user_roles').select('role').eq('user_id', user.id).maybeSingle(),
        supabase.rpc('get_trader_rank', { p_user_id: user.id }),
        supabase.rpc('get_public_leaderboard', { p_period: 'all' }),
    ]);
    const profile = profileResult.data;
    const profileError = profileResult.error;
    if (profileError) {
        console.error('Profile schema lookup failed.', profileError);
        return NextResponse.json({ error: isMissingSchema(profileError) ? PROFILE_SCHEMA_ERROR : 'Profil bilgileri yüklenemedi.' }, { status: 500 });
    }
    const { data: activity, error: activityError } = await supabase.from('user_activity_logs')
        .select('id, event_type, description, created_at, metadata')
        .eq('user_id', user.id)
        .in('event_type', ['login', 'logout', 'profile_updated', 'password_changed', 'password_failed', 'password_reset_requested'])
        .order('created_at', { ascending: false }).limit(60);
    if (activityError) {
        console.error('Profile activity lookup failed.', activityError);
        return NextResponse.json({ error: isMissingSchema(activityError) ? PROFILE_SCHEMA_ERROR : 'Hesap hareketleri yüklenemedi.' }, { status: 500 });
    }
    if (roleResult.error || rankResult.error || leaderboardResult.error) {
        console.error('Profile rank metadata lookup failed.', roleResult.error ?? rankResult.error ?? leaderboardResult.error);
        return NextResponse.json({ error: 'Rol ve seviye bilgileri yüklenemedi. RBAC migration durumunu kontrol edin.' }, { status: 500 });
    }

    return NextResponse.json({
        success: true, data: {
            email: user.email ?? '',
            accountCreatedAt: user.created_at,
            lastSignInAt: user.last_sign_in_at,
            emailVerifiedAt: user.email_confirmed_at,
            profile: profile ?? { full_name: '', username: '', display_name: '', bio: '', leaderboard_visible: true, leaderboard_gain_visible: true, updated_at: null },
            role: roleResult.data?.role ?? 'user',
            rank: rankResult.data,
            leaderboardRank: ((leaderboardResult.data as PublicLeaderboardRow[] | null) ?? [])
                .findIndex((entry) => entry.user_id === user.id) + 1 || null,
            activity: (activity ?? [])
                .filter((item) => !isPrivatePreferenceAudit(item.metadata))
                .slice(0, 30)
                .map((item) => ({
                    id: item.id,
                    event_type: item.event_type,
                    description: item.description,
                    created_at: item.created_at,
                })),
        }
    });
}

export async function PATCH(request: Request) {
    const { supabase, user } = await getContext();
    if (!supabase) return NextResponse.json({ error: 'Supabase bağlantısı yapılandırılmamış.' }, { status: 503 });
    if (!user) return NextResponse.json({ error: 'Profilini güncellemek için giriş yapmalısın.' }, { status: 401 });
    let body: { fullName?: unknown; username?: unknown; displayName?: unknown; bio?: unknown; leaderboardVisible?: unknown; leaderboardGainVisible?: unknown };
    try {
        body = await request.json() as { fullName?: unknown; username?: unknown; displayName?: unknown; bio?: unknown; leaderboardVisible?: unknown; leaderboardGainVisible?: unknown };
    } catch {
        return NextResponse.json({ error: 'Geçersiz JSON içeriği.' }, { status: 400 });
    }
    const { data: current, error: currentError } = await supabase.from('user_profiles')
        .select('full_name, username, display_name, bio, leaderboard_visible, leaderboard_gain_visible').eq('user_id', user.id).maybeSingle();
    if (currentError) return NextResponse.json({ error: isMissingSchema(currentError) ? PROFILE_SCHEMA_ERROR : 'Profil bilgileri yüklenemedi.' }, { status: 500 });
    const fullName = typeof body.fullName === 'string' ? body.fullName.trim() : current?.full_name ?? '';
    const username = typeof body.username === 'string'
        ? body.username.trim().toLowerCase()
        : typeof body.displayName === 'string'
            ? body.displayName.trim().toLowerCase()
            : current?.username ?? current?.display_name ?? '';
    const bio = typeof body.bio === 'string' ? body.bio.trim() : current?.bio ?? '';
    const leaderboardVisible = typeof body.leaderboardVisible === 'boolean'
        ? body.leaderboardVisible
        : current?.leaderboard_visible ?? true;
    const leaderboardGainVisible = typeof body.leaderboardGainVisible === 'boolean'
        ? body.leaderboardGainVisible
        : current?.leaderboard_gain_visible ?? true;
    if (fullName.length > 120 || bio.length > 280) {
        return NextResponse.json({ error: 'Ad 120, açıklama 280 karakteri aşamaz.' }, { status: 400 });
    }
    if (!/^[a-z][a-z0-9_]{2,23}$/.test(username)) {
        return NextResponse.json({ error: 'Kullanıcı adı 3–24 karakter olmalı; küçük harfle başlamalı ve yalnızca küçük harf, rakam, alt çizgi içermelidir.' }, { status: 400 });
    }

    const previousLeaderboardVisible = current?.leaderboard_visible ?? true;
    const previousLeaderboardGainVisible = current?.leaderboard_gain_visible ?? true;
    const { data, error } = await supabase.from('user_profiles').upsert({
        user_id: user.id, full_name: fullName, username, display_name: username, bio,
        leaderboard_visible: leaderboardVisible, leaderboard_gain_visible: leaderboardGainVisible,
    }, { onConflict: 'user_id' }).select('full_name, username, display_name, bio, leaderboard_visible, leaderboard_gain_visible, updated_at').single();
    if (error?.code === '23505') return NextResponse.json({ error: 'Bu kullanıcı adı başka biri tarafından kullanılıyor.' }, { status: 409 });
    if (error) return NextResponse.json({ error: isMissingSchema(error) ? PROFILE_SCHEMA_ERROR : 'Profil kaydedilemedi.' }, { status: 500 });

    const auditEntries: Array<{ user_id: string; event_type: 'profile_updated'; description: string; metadata: Record<string, boolean> }> = [];
    const profileChanged = fullName !== (current?.full_name ?? '')
        || username !== (current?.username ?? current?.display_name ?? '')
        || bio !== (current?.bio ?? '');
    if (leaderboardVisible !== previousLeaderboardVisible) {
        auditEntries.push({
            user_id: user.id,
            event_type: 'profile_updated',
            description: `Liderlik tablosu görünürlüğü ${leaderboardVisible ? 'açıldı' : 'kapatıldı'}.`,
            metadata: { leaderboard_visible: leaderboardVisible },
        });
    }
    if (leaderboardGainVisible !== previousLeaderboardGainVisible) {
        auditEntries.push({
            user_id: user.id,
            event_type: 'profile_updated',
            description: `Dönem kazanç tutarını paylaşma izni ${leaderboardGainVisible ? 'açıldı' : 'kapatıldı'}.`,
            metadata: { leaderboard_gain_visible: leaderboardGainVisible },
        });
    }
    if (profileChanged || auditEntries.length === 0) {
        auditEntries.push({
            user_id: user.id,
            event_type: 'profile_updated',
            description: 'Profil bilgileri güncellendi.',
            metadata: {},
        });
    }
    if (auditEntries.length > 0) {
        const { error: auditError } = await supabase.from('user_activity_logs').insert(auditEntries);
        if (auditError) {
            console.error('Profile and privacy preference audit logging failed.', auditError);
            return NextResponse.json({
                success: true,
                data,
                warning: 'Değişiklik kaydedildi ancak hareket günlüğüne eklenemedi.',
            });
        }
    }
    return NextResponse.json({ success: true, data });
}