import { NextResponse } from 'next/server';
import { ACADEMY_LESSONS, type AcademyLesson } from '@/data/academyLessons';
import { getSupabaseServerClient } from '@/lib/supabase-server';

type PublicLessonRow = {
    id: string; published: boolean; chapter_id: string; chapter_title: string; title: string; level: AcademyLesson['level'];
    duration: string; summary: string; concept: string; bist_example: string; application: string; formula: string;
    pitfalls: string[]; checklist: string[]; quiz_questions: AcademyLesson['quizQuestions'];
};

export async function GET() {
    const supabase = await getSupabaseServerClient();
    if (!supabase) return NextResponse.json({ data: ACADEMY_LESSONS });
    const { data, error } = await supabase.rpc('get_public_academy_lessons');
    if (error) {
        if (error.code === '42P01' || error.code === 'PGRST205') return NextResponse.json({ data: ACADEMY_LESSONS });
        console.error('Published academy lessons query failed.', error);
        return NextResponse.json({ error: 'Akademi dersleri yüklenemedi.' }, { status: 500 });
    }
    const rows = (data ?? []) as PublicLessonRow[];
    const overrides = new Map(rows.map((row) => [row.id, row]));
    const staticIds = new Set(ACADEMY_LESSONS.map((lesson) => lesson.id));
    const mappedStatic = ACADEMY_LESSONS.flatMap((lesson) => {
        const row = overrides.get(lesson.id);
        if (row) overrides.delete(lesson.id);
        if (row && !row.published) return [];
        return row ? [{
            ...lesson, chapterId: row.chapter_id, chapterTitle: row.chapter_title, title: row.title,
            level: row.level, duration: row.duration, summary: row.summary, concept: row.concept,
            bistExample: row.bist_example, application: row.application, formula: row.formula,
            pitfalls: row.pitfalls, checklist: row.checklist, quizQuestions: row.quiz_questions,
        }] : [lesson];
    });
    const added = rows.filter((row) => !staticIds.has(row.id) && row.published).map((row) => ({
        id: row.id, chapterId: row.chapter_id, chapterTitle: row.chapter_title, title: row.title,
        level: row.level, duration: row.duration, summary: row.summary, concept: row.concept,
        bistExample: row.bist_example, application: row.application, formula: row.formula,
        pitfalls: row.pitfalls, checklist: row.checklist, quizQuestions: row.quiz_questions,
    }));
    return NextResponse.json({ data: [...mappedStatic, ...added] });
}
