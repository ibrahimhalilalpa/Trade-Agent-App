import { NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabase-server';

export async function GET() {
    const supabase = await getSupabaseServerClient();
    if (!supabase) return NextResponse.json({ data: [] });
    const { data, error } = await supabase.from('system_announcements')
        .select('id, title, message, severity, starts_at, ends_at')
        .eq('active', true).lte('starts_at', new Date().toISOString())
        .order('created_at', { ascending: false }).limit(3);
    if (error) {
        if (error.code === '42P01' || error.code === 'PGRST205') return NextResponse.json({ data: [] });
        console.error('Public announcements query failed.', error);
        return NextResponse.json({ error: 'Duyurular yüklenemedi.' }, { status: 500 });
    }
    const active = (data ?? []).filter((item) => !item.ends_at || new Date(item.ends_at).getTime() > Date.now());
    return NextResponse.json({ data: active });
}
