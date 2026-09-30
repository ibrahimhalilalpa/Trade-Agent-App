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
    return NextResponse.json({
        success: true,
        data: entries.map((entry) => ({ ...entry, is_self: entry.user_id === user?.id })),
    });
}
