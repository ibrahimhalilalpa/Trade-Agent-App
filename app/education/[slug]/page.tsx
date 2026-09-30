import LessonCompletion from '@/components/LessonCompletion';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getAcademyLesson } from '@/data/academyLessons';
import { ArrowRight } from 'lucide-react';
import { getSupabaseServerClient } from '@/lib/supabase-server';
import LessonQuiz from '@/components/LessonQuiz';
import type { AcademyLesson } from '@/data/academyLessons';

type LessonRow = { id: string; published: boolean; chapter_id: string; chapter_title: string; title: string; level: AcademyLesson['level']; duration: string; summary: string; concept: string; bist_example: string; application: string; formula: string; pitfalls: string[]; checklist: string[]; quiz_questions: AcademyLesson['quizQuestions'] };

export default async function LessonPage({ params }: { params: Promise<{ slug: string }> }) {
    const { slug } = await params;
    let lesson = getAcademyLesson(slug);
    const supabase = await getSupabaseServerClient();
    if (supabase) {
        const { data, error } = await supabase.rpc('get_public_academy_lessons');
        if (!error) {
            const row = ((data ?? []) as LessonRow[]).find((item) => item.id === slug);
            if (row && !row.published) notFound();
            if (row?.published) {
                lesson = {
                    id: row.id, chapterId: row.chapter_id, chapterTitle: row.chapter_title,
                    title: row.title, level: row.level, duration: row.duration, summary: row.summary,
                    concept: row.concept, bistExample: row.bist_example, application: row.application,
                    formula: row.formula, pitfalls: row.pitfalls, checklist: row.checklist,
                    quizQuestions: row.quiz_questions,
                };
            }
        } else if (error.code !== '42883' && error.code !== 'PGRST202') {
            throw new Error('Akademi dersi yüklenemedi.');
        }
    }
    if (!lesson) notFound();
    return <main className="app-shell ds-shell"><div className="app-container ds-container ds-lesson-page"><article className="lesson-article ds-lesson-article"><Link className="back-link" href="/education">← Akademi merkezine dön</Link><header className="article-header"><span className="ds-eyebrow">{lesson.chapterTitle} · {lesson.level} · {lesson.duration}</span><h1>{lesson.title}</h1><p>{lesson.summary}</p><div className="article-meta"><span>5 kritik bölüm</span><span>{lesson.id}</span><span>Pratik kontrol listesi</span></div></header><LessonCompletion lessonId={lesson.id} /><div className="article-layout"><div className="article-body"><section><span className="article-kicker">01 · KAVRAMSAL AÇIKLAMA & MANTIK</span><h2>Bu konu nasıl çalışır?</h2><p>{lesson.concept}</p></section><section><span className="article-kicker">02 · GERÇEK BİST ÖRNEĞİ & FORMÜL</span><h2>Hesaplama ve piyasa senaryosu</h2><div className="lesson-example"><strong>BİST SENARYOSU</strong><p>{lesson.bistExample}</p></div><p className="formula-copy">{lesson.formula}</p></section><section><span className="article-kicker">03 · PİYASA UYGULAMASI</span><h2>Grafik, KAP veya bilançoda nasıl okunur?</h2><p>{lesson.application}</p><div className="lesson-visual"><div className="visual-grid" /><div className="visual-line line-one" /><div className="visual-line line-two" /><div className="visual-label label-support">Ölçüm / teyit</div><div className="visual-label label-resistance">Risk / geçersizlik</div>{[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((item) => <i className={`candle candle-${item}`} key={item} />)}</div></section><section><span className="article-kicker">04 · TUZAKLAR & GEÇERSİZLİK</span><h2>Ne zaman çalışmayabilir?</h2><ul className="academy-pitfalls">{lesson.pitfalls.map((pitfall) => <li key={pitfall}>{pitfall}</li>)}</ul></section><section><span className="article-kicker">05 · PRATİK KONTROL LİSTESİ</span><h2>İşlemden önce üç adım</h2><ul className="academy-checklist">{lesson.checklist.map((item) => <li key={item}><span>✓</span>{item}</li>)}</ul></section><LessonQuiz questions={lesson.quizQuestions ?? []} /></div><aside className="article-aside"><div className="aside-card"><span className="ds-eyebrow">DERS KARTI</span><h3>{lesson.id}</h3><p>{lesson.chapterTitle} bölümünde bu dersi tamamladıktan sonra kendi notlarını ve BİST örneklerini işlem günlüğüne ekle.</p><Link className="primary-button ds-primary-button" href="/education">Akademiye dön <ArrowRight size={14} /></Link></div><div className="aside-card"><span className="ds-eyebrow">KARAR DESTEĞİ</span><p>Bu içerik eğitim amaçlıdır. Hiçbir formül tek başına yatırım kararı veya getiri garantisi değildir.</p></div></aside></div></article></div></main>;
}
