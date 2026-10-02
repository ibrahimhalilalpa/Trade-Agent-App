import { NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabase-server';
import { isPrivatePreferenceAudit } from '@/lib/privacy-policy';
import { cleanText, hasProfanity } from '@/lib/profanityFilter';

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

function localizeActivityDescription(description: string) {
    return description
        .replace(/\bunspecified\b/g, 'belirtmedi')
        .replace(/\bmale\b/g, 'erkek')
        .replace(/\bfemale\b/g, 'kadın')
        .replace(/\bpublic\b/g, 'herkese açık')
        .replace(/\bfollowers\b/g, 'takipçilere açık')
        .replace(/\bprivate\b/g, 'yalnızca bana açık');
}

export async function GET() {
    const { supabase, user } = await getContext();
    if (!supabase) return NextResponse.json({ error: 'Supabase bağlantısı yapılandırılmamış.' }, { status: 503 });
    if (!user) return NextResponse.json({ error: 'Profilini görmek için giriş yapmalısın.' }, { status: 401 });

    const [profileResult, roleResult, rankResult, leaderboardResult] = await Promise.all([
        supabase.from('user_profiles').select('full_name, username, display_name, bio, avatar_url, gender, is_profile_public, leaderboard_visible, leaderboard_gain_visible, updated_at').eq('user_id', user.id).maybeSingle(),
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
        .in('event_type', ['login', 'logout', 'profile_updated', 'password_changed', 'password_failed', 'password_reset_requested', 'account_freeze_requested', 'account_reactivated', 'account_deletion_requested', 'admin_account_status'])
        .order('created_at', { ascending: false }).limit(60);
    if (activityError) {
        console.error('Profile activity lookup failed.', activityError);
        return NextResponse.json({ error: isMissingSchema(activityError) ? PROFILE_SCHEMA_ERROR : 'Hesap hareketleri yüklenemedi.' }, { status: 500 });
    }
    const activityWithoutDuplicateLogouts = (activity ?? []).filter((item, index, records) => {
        if (item.event_type !== 'logout') return true;
        const itemTime = new Date(item.created_at).getTime();
        return !records.slice(0, index).some((previous) =>
            previous.event_type === 'logout'
            && Math.abs(itemTime - new Date(previous.created_at).getTime()) <= 2 * 60_000,
        );
    });
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
            profile: profile ?? { full_name: '', username: '', display_name: '', bio: '', avatar_url: null, gender: 'unspecified', is_profile_public: true, leaderboard_visible: true, leaderboard_gain_visible: true, updated_at: null },
            role: roleResult.data?.role ?? 'user',
            rank: rankResult.data,
            leaderboardRank: ((leaderboardResult.data as PublicLeaderboardRow[] | null) ?? [])
                .findIndex((entry) => entry.user_id === user.id) + 1 || null,
            activity: activityWithoutDuplicateLogouts
                .filter((item) => !isPrivatePreferenceAudit(item.metadata))
                .slice(0, 30)
                .map((item) => ({
                    id: item.id,
                    event_type: item.event_type,
                    description: localizeActivityDescription(item.description),
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
    if (hasProfanity(username)) {
        return NextResponse.json({ error: 'Kullanıcı adı topluluk kurallarına uygun olmayan ifadeler içeremez.' }, { status: 400 });
    }
    const safeFullName = cleanText(fullName);
    const safeBio = cleanText(bio);

    const previousLeaderboardVisible = current?.leaderboard_visible ?? true;
    const previousLeaderboardGainVisible = current?.leaderboard_gain_visible ?? true;
    const { data, error } = await supabase.from('user_profiles').upsert({
        user_id: user.id, full_name: safeFullName, username, display_name: username, bio: safeBio,
        leaderboard_visible: leaderboardVisible, leaderboard_gain_visible: leaderboardGainVisible,
    }, { onConflict: 'user_id' }).select('full_name, username, display_name, bio, leaderboard_visible, leaderboard_gain_visible, updated_at').single();
    if (error?.code === '23505') return NextResponse.json({ error: 'Bu kullanıcı adı başka biri tarafından kullanılıyor.' }, { status: 409 });
    if (error) return NextResponse.json({ error: isMissingSchema(error) ? PROFILE_SCHEMA_ERROR : 'Profil kaydedilemedi.' }, { status: 500 });

    const profileChanges: Record<string, { from: string | boolean; to: string | boolean }> = {};
    const profileChanged = safeFullName !== (current?.full_name ?? '')
        || username !== (current?.username ?? current?.display_name ?? '')
        || safeBio !== (current?.bio ?? '');
    if (username !== (current?.username ?? current?.display_name ?? '')) {
        profileChanges.username = { from: current?.username ?? current?.display_name ?? '', to: username };
    }
    if (safeFullName !== (current?.full_name ?? '')) {
        profileChanges.full_name_changed = { from: Boolean(current?.full_name), to: Boolean(safeFullName) };
    }
    if (safeBio !== (current?.bio ?? '')) {
        profileChanges.bio_changed = { from: Boolean(current?.bio), to: Boolean(safeBio) };
    }
    const auditEntries: Array<{ user_id: string; event_type: 'profile_updated'; description: string; metadata: Record<string, unknown> }> = [];
    if (leaderboardVisible !== previousLeaderboardVisible) {
        auditEntries.push({
            user_id: user.id,
            event_type: 'profile_updated',
            description: `Liderlik tablosu görünürlüğü ${leaderboardVisible ? 'açıldı' : 'kapatıldı'}.`,
            metadata: { changes: { leaderboard_visible: { from: previousLeaderboardVisible, to: leaderboardVisible } } },
        });
    }
    if (leaderboardGainVisible !== previousLeaderboardGainVisible) {
        auditEntries.push({
            user_id: user.id,
            event_type: 'profile_updated',
            description: `Dönem kazanç tutarını paylaşma izni ${leaderboardGainVisible ? 'açıldı' : 'kapatıldı'}.`,
            metadata: { changes: { leaderboard_gain_visible: { from: previousLeaderboardGainVisible, to: leaderboardGainVisible } } },
        });
    }
    if (profileChanged || auditEntries.length === 0) {
        auditEntries.push({
            user_id: user.id,
            event_type: 'profile_updated',
            description: `Profil bilgileri güncellendi${Object.keys(profileChanges).length ? `: ${Object.keys(profileChanges).map((field) => field === 'username' ? 'kullanıcı adı' : field === 'full_name_changed' ? 'ad soyad' : 'biyografi').join(', ')}` : ''}.`,
            metadata: { source: 'account_profile', changes: profileChanges },
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