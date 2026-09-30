import { NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabase-server';
import { ACADEMY_LESSON_IDS } from '@/data/academyLessons';

const SCHEMA_ERROR = 'İlerleme tablosu henüz kurulmamış. Supabase SQL Editor’da güncel supabase/schema.sql dosyasını çalıştırın.';

async function getContext() {
    const supabase = await getSupabaseServerClient();
    if (!supabase) return { supabase: null, user: null };
    const { data: { user } } = await supabase.auth.getUser();
    return { supabase, user };
}

function isSchemaError(error: { code?: string; message?: string } | null): boolean {
    return error?.code === '42P01' || error?.code === 'PGRST205' || error?.message?.includes('user_education_progress') === true;
}

function response(completedLessonIds: string[], validLessonIds: string[] = ACADEMY_LESSON_IDS) {
    const completed = new Set(completedLessonIds.filter((id) => validLessonIds.includes(id)));
    const completedCount = completed.size;
    const totalCount = validLessonIds.length;
    return { completedLessonIds: [...completed], completedCount, totalCount, percentage: totalCount ? Math.round((completedCount / totalCount) * 100) : 0 };
}

async function getLessonIds(supabase: Awaited<ReturnType<typeof getSupabaseServerClient>>) {
    if (!supabase) return ACADEMY_LESSON_IDS;
    const { data, error } = await supabase.rpc('get_public_academy_lessons');
    if (error) {
        if (isSchemaError(error)) return ACADEMY_LESSON_IDS;
        throw error;
    }
    const rows = (data ?? []) as Array<{ id: string; published: boolean }>;
    const visibleIds = rows.filter((item) => item.published).map((item) => item.id);
    const hiddenIds = new Set(rows.filter((item) => !item.published).map((item) => item.id));
    return [...new Set([...ACADEMY_LESSON_IDS.filter((id) => !hiddenIds.has(id)), ...visibleIds])];
}

export async function GET() {
    const { supabase, user } = await getContext();
    if (!supabase) return NextResponse.json({ error: 'Supabase bağlantısı yapılandırılmamış.' }, { status: 503 });
    if (!user) return NextResponse.json({ error: 'İlerlemeyi görmek için giriş yapmalısınız.' }, { status: 401 });
    const { data, error } = await supabase.from('user_education_progress').select('lesson_id').eq('completed', true);
    if (error) return NextResponse.json({ error: isSchemaError(error) ? SCHEMA_ERROR : 'İlerleme yüklenemedi.' }, { status: 500 });
    return NextResponse.json({ success: true, data: response((data ?? []).map((item) => item.lesson_id), await getLessonIds(supabase)) });
}

export async function PUT(request: Request) {
    const { supabase, user } = await getContext();
    if (!supabase) return NextResponse.json({ error: 'Supabase bağlantısı yapılandırılmamış.' }, { status: 503 });
    if (!user) return NextResponse.json({ error: 'Dersi tamamlamak için giriş yapmalısınız.' }, { status: 401 });
    const body = await request.json() as { lessonId?: unknown; completed?: unknown };
    const lessonId = typeof body.lessonId === 'string' ? body.lessonId : '';
    const completed = body.completed !== false;
    const lessonIds = await getLessonIds(supabase);
    if (!lessonIds.includes(lessonId)) return NextResponse.json({ error: 'Geçersiz ders kodu.' }, { status: 400 });
    const query = completed
        ? supabase.from('user_education_progress').upsert({ user_id: user.id, lesson_id: lessonId, completed: true, completed_at: new Date().toISOString() }, { onConflict: 'user_id,lesson_id' })
        : supabase.from('user_education_progress').delete().eq('user_id', user.id).eq('lesson_id', lessonId);
    const { error } = await query;
    if (error) return NextResponse.json({ error: isSchemaError(error) ? SCHEMA_ERROR : 'İlerleme kaydedilemedi.' }, { status: 500 });
    const { data } = await supabase.from('user_education_progress').select('lesson_id').eq('completed', true);
    return NextResponse.json({ success: true, data: response((data ?? []).map((item) => item.lesson_id), lessonIds) });
}