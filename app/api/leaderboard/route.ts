import { NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabase-server';

const PERIODS = ['day', 'week', 'month', 'all'] as const;
type Period = (typeof PERIODS)[number];

export async function GET(request: Request) {
    const periodValue = new URL(request.url).searchParams.get('period') ?? 'all';
    if (!PERIODS.includes(periodValue as Period)) {
        return NextResponse.json({ error: 'Geçersiz liderlik tablosu dönemi.' }, { status: 400 });
    }
    const supabase = await getSupabaseServerClient();
    if (!supabase) return NextResponse.json({ error: 'Supabase bağlantısı yapılandırılmamış.' }, { status: 503 });
    const { data, error } = await supabase.rpc('get_public_leaderboard', { p_period: periodValue });
    if (error) {
        console.error('Public leaderboard query failed.', error);
        return NextResponse.json({ error: 'Liderlik tablosu yüklenemedi. RBAC migration durumunu kontrol edin.' }, { status: 500 });
    }
    const { data: { user } } = await supabase.auth.getUser();
    const entries = (data ?? []) as Array<{ user_id: string } & Record<string, unknown>>;
    if (entries.some((entry) => !Object.prototype.hasOwnProperty.call(entry, 'pnl_amount'))) {
        console.error('Leaderboard RPC response is missing pnl_amount. Apply leaderboard-owner-privacy-migration.sql and leaderboard-owner-rank-migration.sql.');
        return NextResponse.json({
            error: 'Dönem kazancı veritabanı fonksiyonu tarafından döndürülmüyor. Supabase’te leaderboard-owner-privacy-migration.sql ve ardından leaderboard-owner-rank-migration.sql dosyalarını çalıştırın.',
        }, { status: 503 });
    }
    const { data: profiles, error: profilesError } = await supabase.rpc('forum_public_profiles', {
        p_user_ids: entries.map((entry) => entry.user_id),
    });
    if (profilesError) {
        console.error('Leaderboard profile image lookup failed.', profilesError);
        return NextResponse.json({
            error: 'Lider profil görselleri yüklenemedi. Supabase’te community-forum-migration.sql ve ardından community-profile-privacy-migration.sql dosyalarını çalıştırın.',
        }, { status: 500 });
    }
    const visibleProfiles = (profiles ?? []) as Array<{
        user_id: string;
        avatar_url: string | null;
        gender: string | null;
    }>;
    const profileById = new Map(visibleProfiles.map((profile) => [
        profile.user_id,
        { avatar_url: profile.avatar_url, gender: profile.gender },
    ]));
    return NextResponse.json({
        success: true,
        data: entries.map((entry) => {
            const profile = profileById.get(entry.user_id);
            return {
                ...entry,
                avatar_url: profile?.avatar_url ?? null,
                gender: profile?.gender ?? null,
                is_self: entry.user_id === user?.id,
            };
        }),
    });
}
