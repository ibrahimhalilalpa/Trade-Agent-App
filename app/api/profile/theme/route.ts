import { NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabase-server';

type Theme = 'dark' | 'light';

async function getUserContext() {
    const supabase = await getSupabaseServerClient();
    if (!supabase) return { supabase: null, user: null };
    const { data: { user }, error } = await supabase.auth.getUser();
    return { supabase, user: error ? null : user };
}

function isMissingThemeColumn(error: { code?: string } | null) {
    return error?.code === '42703' || error?.code === 'PGRST204' || error?.code === 'PGRST205';
}

const THEME_MIGRATION_MESSAGE = 'Hesap teması için supabase/user-theme-preference-migration.sql dosyasını Supabase SQL Editor’da çalıştırın.';

export async function GET() {
    const { supabase, user } = await getUserContext();
    if (!supabase) return NextResponse.json({ error: 'Supabase bağlantısı yapılandırılmamış.' }, { status: 503 });
    if (!user) return NextResponse.json({ error: 'Tema tercihini yüklemek için oturum açın.' }, { status: 401 });

    const { data, error } = await supabase.from('user_profiles').select('theme').eq('user_id', user.id).maybeSingle();
    if (error) {
        console.error('Account theme preference lookup failed.', error);
        return NextResponse.json({ error: isMissingThemeColumn(error) ? THEME_MIGRATION_MESSAGE : 'Hesap teması yüklenemedi.' }, { status: 503 });
    }
    return NextResponse.json({ success: true, data: { theme: data?.theme === 'light' ? 'light' : 'dark' } });
}

export async function PATCH(request: Request) {
    const { supabase, user } = await getUserContext();
    if (!supabase) return NextResponse.json({ error: 'Supabase bağlantısı yapılandırılmamış.' }, { status: 503 });
    if (!user) return NextResponse.json({ error: 'Tema tercihini kaydetmek için oturum açın.' }, { status: 401 });

    let body: { theme?: unknown };
    try {
        body = await request.json() as typeof body;
    } catch {
        return NextResponse.json({ error: 'Geçersiz JSON içeriği.' }, { status: 400 });
    }
    if (body.theme !== 'dark' && body.theme !== 'light') {
        return NextResponse.json({ error: 'Tema tercihi aydınlık veya karanlık olmalıdır.' }, { status: 400 });
    }

    const theme = body.theme as Theme;
    const { data, error } = await supabase.from('user_profiles')
        .update({ theme, updated_at: new Date().toISOString() })
        .eq('user_id', user.id)
        .select('theme')
        .maybeSingle();
    if (error) {
        console.error('Account theme preference save failed.', error);
        return NextResponse.json({ error: isMissingThemeColumn(error) ? THEME_MIGRATION_MESSAGE : 'Tema tercihi hesaba kaydedilemedi.' }, { status: 503 });
    }
    if (!data) return NextResponse.json({ error: 'Hesap profili bulunamadı. Önce profil sayfasını açıp tekrar deneyin.' }, { status: 404 });
    return NextResponse.json({ success: true, data: { theme: data.theme } });
}