import { NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabase-server';

const UUID_PATTERN = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const PERIODS = ['day', 'week', 'month', 'all'] as const;
type PublicLeaderboardRow = {
    user_id: string;
    display_name: string;
    trader_rank: string;
    xp: number;
    pnl_percent: number;
    pnl_amount: number | null;
};

export async function GET(request: Request, { params }: { params: Promise<{ userId: string }> }) {
    const { userId } = await params;
    if (!UUID_PATTERN.test(userId)) return NextResponse.json({ error: 'Geçersiz profil kimliği.' }, { status: 400 });
    const period = new URL(request.url).searchParams.get('period') ?? 'all';
    if (!PERIODS.includes(period as (typeof PERIODS)[number])) {
        return NextResponse.json({ error: 'Geçersiz getiri dönemi.' }, { status: 400 });
    }
    const supabase = await getSupabaseServerClient();
    if (!supabase) return NextResponse.json({ error: 'Supabase bağlantısı yapılandırılmamış.' }, { status: 503 });
    const { data, error } = await supabase.rpc('get_public_leaderboard', { p_period: period });
    if (error) {
        console.error('Public trader profile lookup failed.', error);
        return NextResponse.json({ error: 'Trader profili yüklenemedi.' }, { status: 500 });
    }
    const profile = ((data as PublicLeaderboardRow[] | null) ?? []).find((entry) => entry.user_id === userId);
    if (!profile) return NextResponse.json({ error: 'Bu trader seçili dönemin görünür ilk 50 sırasında bulunmuyor.' }, { status: 404 });
    return NextResponse.json({ success: true, data: profile });
}
