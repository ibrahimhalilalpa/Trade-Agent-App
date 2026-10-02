import { NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabase-server';
import type { UserActivityType } from '@/lib/activity-log';

const CLIENT_EVENTS: Partial<Record<UserActivityType, string>> = {
    login: 'Hesaba giriş yapıldı.',
    logout: 'Oturum kapatıldı.',
    password_changed: 'Hesap parolası güncellendi.',
    password_failed: 'Parola doğrulaması başarısız oldu.',
    password_reset_requested: 'Parola sıfırlama bağlantısı istendi.',
};

export async function POST(request: Request) {
    const supabase = await getSupabaseServerClient();
    if (!supabase) return NextResponse.json({ error: 'Supabase bağlantısı yapılandırılmamış.' }, { status: 503 });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Bu işlem için giriş yapmalısın.' }, { status: 401 });
    const body = await request.json() as { eventType?: unknown };
    const eventType = typeof body.eventType === 'string' && Object.hasOwn(CLIENT_EVENTS, body.eventType)
        ? body.eventType as UserActivityType : null;
    const description = eventType ? CLIENT_EVENTS[eventType] : undefined;
    if (!eventType || !description) return NextResponse.json({ error: 'Geçersiz hareket türü.' }, { status: 400 });
    if (eventType === 'logout') {
        const recentCutoff = new Date(Date.now() - 2 * 60_000).toISOString();
        const { data: recentLogout, error: lookupError } = await supabase.from('user_activity_logs')
            .select('id').eq('user_id', user.id).eq('event_type', 'logout')
            .gte('created_at', recentCutoff).limit(1).maybeSingle();
        if (lookupError) {
            console.error('Recent logout activity lookup failed.', lookupError);
            return NextResponse.json({ error: lookupError.code === 'PGRST205' ? 'Hareket kayıt tablosu henüz kurulmamış.' : 'Çıkış hareketi doğrulanamadı.' }, { status: 500 });
        }
        if (recentLogout) return NextResponse.json({ success: true, duplicate: true });
    }
    const { error } = await supabase.from('user_activity_logs').insert({ user_id: user.id, event_type: eventType, description });
    if (error) return NextResponse.json({ error: error.code === 'PGRST205' ? 'Hareket kayıt tablosu henüz kurulmamış.' : 'Hareket kaydedilemedi.' }, { status: 500 });
    return NextResponse.json({ success: true });
}