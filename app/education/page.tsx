import EducationCenter from '@/components/EducationCenter';
import { getSupabaseServerClient } from '@/lib/supabase-server';
import { ACADEMY_LESSON_IDS } from '@/data/academyLessons';

async function getInitialProgress() {
    const empty = { completedLessonIds: [], completedCount: 0, totalCount: ACADEMY_LESSON_IDS.length, percentage: 0 };
    const supabase = await getSupabaseServerClient();
    if (!supabase) return { initialProgress: empty, initialSignedIn: false };
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { initialProgress: empty, initialSignedIn: false };
    const [{ data }, lessons] = await Promise.all([
        supabase.from('user_education_progress').select('lesson_id').eq('completed', true),
        supabase.rpc('get_public_academy_lessons'),
    ]);
    const rows = (lessons.data ?? []) as Array<{ id: string; published: boolean }>;
    const lessonIdsFromDb = rows.filter((item) => item.published).map((item) => item.id);
    const hiddenIds = new Set(rows.filter((item) => !item.published).map((item) => item.id));
    const lessonIds = [...new Set([...ACADEMY_LESSON_IDS.filter((id) => !hiddenIds.has(id)), ...lessonIdsFromDb])];
    const totalCount = lessonIds.length;
    const completedLessonIds = (data ?? []).map((item) => item.lesson_id).filter((id) => lessonIds.includes(id));
    return { initialProgress: { completedLessonIds, completedCount: completedLessonIds.length, totalCount, percentage: totalCount ? Math.round((completedLessonIds.length / totalCount) * 100) : 0 }, initialSignedIn: true };
}

export default async function EducationPage() {
    const initial = await getInitialProgress();
    return <main className="app-shell ds-shell"><div className="app-container ds-container"><EducationCenter {...initial} /></div></main>;
}
