import { NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabase-server';

export async function GET() {
    const supabase = await getSupabaseServerClient();
    if (!supabase) return NextResponse.json({ error: 'Supabase bağlantısı yapılandırılmamış.' }, { status: 503 });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ role: null });
    const { data, error } = await supabase.from('user_roles').select('role').eq('user_id', user.id).maybeSingle();
    if (error) return NextResponse.json({ error: 'Kullanıcı rolü doğrulanamadı.' }, { status: 500 });
    return NextResponse.json({ role: data?.role ?? 'user' });
}
