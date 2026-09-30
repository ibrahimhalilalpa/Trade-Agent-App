import { NextResponse } from 'next/server';
import { ACADEMY_LESSONS } from '@/data/academyLessons';
import { requireAdmin } from '@/lib/admin-auth';

const LEVELS = ['Başlangıç', 'Orta', 'İleri'] as const;
type LessonInput = {
    id?: unknown; chapterId?: unknown; chapterTitle?: unknown; title?: unknown;
    level?: unknown; duration?: unknown; summary?: unknown; concept?: unknown;
    bistExample?: unknown; application?: unknown; formula?: unknown;
    pitfalls?: unknown; checklist?: unknown; quizQuestions?: unknown;
    sortOrder?: unknown; published?: unknown;
};

const validText = (value: unknown, maximum: number) => typeof value === 'string' && value.trim().length <= maximum;
const lessonFromInput = (body: LessonInput) => {
    if (typeof body.id !== 'string' || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(body.id)
        || !validText(body.chapterId, 100) || typeof body.chapterId !== 'string' || !body.chapterId.trim()
        || !validText(body.chapterTitle, 160) || typeof body.chapterTitle !== 'string' || !body.chapterTitle.trim()
        || !validText(body.title, 180) || typeof body.title !== 'string' || !body.title.trim()
        || typeof body.level !== 'string' || !LEVELS.includes(body.level as (typeof LEVELS)[number])) return null;
    const list = (value: unknown) => Array.isArray(value)
        && value.length <= 30 && value.every((item) => typeof item === 'string' && item.length <= 400);
    const validQuiz = Array.isArray(body.quizQuestions) && body.quizQuestions.length <= 50
        && body.quizQuestions.every((item) => {
            if (typeof item !== 'object' || item === null) return false;
            const question = item as { question?: unknown; options?: unknown; answer?: unknown; explanation?: unknown };
            return typeof question.question === 'string' && question.question.trim().length > 0 && question.question.length <= 500
                && Array.isArray(question.options) && question.options.length >= 2 && question.options.length <= 8
                && question.options.every((option) => typeof option === 'string' && option.trim().length > 0 && option.length <= 300)
                && Number.isInteger(question.answer) && Number(question.answer) >= 0 && Number(question.answer) < question.options.length
                && (question.explanation === undefined || (typeof question.explanation === 'string' && question.explanation.length <= 1000));
        });
    if (!list(body.pitfalls) || !list(body.checklist) || (body.quizQuestions !== undefined && !validQuiz)) return null;
    const textFields = ['duration', 'summary', 'concept', 'bistExample', 'application', 'formula'] as const;
    if (textFields.some((field) => !validText(body[field], field === 'duration' ? 30 : 5000))) return null;
    return {
        id: body.id, chapter_id: body.chapterId.trim(), chapter_title: body.chapterTitle.trim(),
        title: body.title.trim(), level: body.level,
        duration: typeof body.duration === 'string' && body.duration.trim() ? body.duration.trim() : '15 dk',
        summary: body.summary, concept: body.concept, bist_example: body.bistExample,
        application: body.application, formula: body.formula,
        pitfalls: body.pitfalls, checklist: body.checklist,
        quiz_questions: body.quizQuestions ?? [],
        sort_order: Number.isInteger(body.sortOrder) ? Number(body.sortOrder) : 0,
        published: body.published !== false,
    };
};

export async function GET() {
    const context = await requireAdmin();
    if (context.response) return context.response;
    const { data, error } = await context.admin.from('academy_lessons').select('*').order('sort_order').order('id');
    if (error) {
        console.error('Admin academy lesson query failed.', error);
        return NextResponse.json({ error: 'Akademi içerikleri yüklenemedi. RBAC migration güncel değil.' }, { status: 503 });
    }
    const stored = new Map((data ?? []).map((row) => [row.id, row]));
    const lessons = ACADEMY_LESSONS.map((lesson, index) => stored.get(lesson.id) ?? ({
        id: lesson.id, chapter_id: lesson.chapterId, chapter_title: lesson.chapterTitle,
        title: lesson.title, level: lesson.level, duration: lesson.duration, summary: lesson.summary,
        concept: lesson.concept, bist_example: lesson.bistExample, application: lesson.application,
        formula: lesson.formula, pitfalls: lesson.pitfalls, checklist: lesson.checklist,
        quiz_questions: [],
        sort_order: index, published: true,
    }));
    const known = new Set(ACADEMY_LESSONS.map((lesson) => lesson.id));
    return NextResponse.json({ success: true, data: [...lessons, ...(data ?? []).filter((row) => !known.has(row.id))] });
}

export async function POST(request: Request) {
    const context = await requireAdmin();
    if (context.response) return context.response;
    let body: LessonInput;
    try { body = await request.json() as LessonInput; }
    catch { return NextResponse.json({ error: 'Geçersiz JSON içeriği.' }, { status: 400 }); }
    const lesson = lessonFromInput(body);
    if (!lesson) return NextResponse.json({ error: 'Ders alanlarını ve metin sınırlarını kontrol edin.' }, { status: 400 });
    const { data, error } = await context.admin.from('academy_lessons')
        .upsert({ ...lesson, updated_by: context.user.id }, { onConflict: 'id' }).select().single();
    if (error) {
        console.error('Admin academy lesson save failed.', error);
        return NextResponse.json({ error: 'Ders kaydedilemedi.' }, { status: 500 });
    }
    return NextResponse.json({ success: true, data });
}

export async function DELETE(request: Request) {
    const context = await requireAdmin();
    if (context.response) return context.response;
    const id = new URL(request.url).searchParams.get('id') ?? '';
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) return NextResponse.json({ error: 'Geçersiz ders kimliği.' }, { status: 400 });
    const staticLesson = ACADEMY_LESSONS.find((lesson) => lesson.id === id);
    const query = staticLesson
        ? context.admin.from('academy_lessons').upsert({
            id, chapter_id: staticLesson.chapterId, chapter_title: staticLesson.chapterTitle,
            title: staticLesson.title, level: staticLesson.level, duration: staticLesson.duration,
            summary: staticLesson.summary, concept: staticLesson.concept, bist_example: staticLesson.bistExample,
            application: staticLesson.application, formula: staticLesson.formula, pitfalls: staticLesson.pitfalls,
            checklist: staticLesson.checklist, quiz_questions: [], published: false,
            sort_order: ACADEMY_LESSONS.indexOf(staticLesson), updated_by: context.user.id,
        }, { onConflict: 'id' })
        : context.admin.from('academy_lessons').delete().eq('id', id);
    const { error } = await query;
    if (error) {
        console.error('Admin academy lesson delete failed.', error);
        return NextResponse.json({ error: 'Ders silinemedi.' }, { status: 500 });
    }
    return NextResponse.json({ success: true });
}
