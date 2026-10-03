'use client';

import { useEffect, useMemo, useState } from 'react';
import { Activity, BookOpen, CheckCircle2, Circle, Clock3, GraduationCap, LockKeyhole, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { ACADEMY_CHAPTERS, ACADEMY_LESSONS, type AcademyChapter, type AcademyLesson } from '@/data/academyLessons';
import { getSupabaseBrowserClient } from '@/lib/supabase-browser';

type Progress = { completedLessonIds: string[]; completedCount: number; totalCount: number; percentage: number };
const EMPTY_PROGRESS: Progress = { completedLessonIds: [], completedCount: 0, totalCount: ACADEMY_LESSONS.length, percentage: 0 };
interface EducationCenterProps { initialProgress?: Progress; initialSignedIn?: boolean; initialChapterId?: string; }

export default function EducationCenter({ initialProgress = EMPTY_PROGRESS, initialSignedIn = false, initialChapterId = ACADEMY_CHAPTERS[0].id }: EducationCenterProps) {
    const [activeChapterId, setActiveChapterId] = useState(initialChapterId);
    const [progress, setProgress] = useState<Progress>(initialProgress);
    const [signedIn, setSignedIn] = useState(initialSignedIn);
    const [authLoading, setAuthLoading] = useState(false);
    const [progressError, setProgressError] = useState('');
    const [lessons, setLessons] = useState<AcademyLesson[]>(ACADEMY_LESSONS);
    const chapters = useMemo<AcademyChapter[]>(() => {
        const known = new Map(ACADEMY_CHAPTERS.map((chapter) => [chapter.id, chapter.title]));
        for (const lesson of lessons) known.set(lesson.chapterId, lesson.chapterTitle);
        return [...known].map(([id, title]) => ({
            id, title, lessons: lessons.filter((lesson) => lesson.chapterId === id),
        })).filter((chapter) => chapter.lessons.length > 0);
    }, [lessons]);
    const activeChapter: AcademyChapter = chapters.find((chapter) => chapter.id === activeChapterId) ?? chapters[0] ?? ACADEMY_CHAPTERS[0];
    const completed = new Set(progress.completedLessonIds);

    useEffect(() => {
        let active = true;
        void fetch('/api/academy/lessons', { cache: 'no-store' })
            .then(async (response) => {
                const payload = await response.json() as { data?: AcademyLesson[] };
                if (active && response.ok && payload.data) setLessons(payload.data);
            })
            .catch(() => undefined);
        const client = getSupabaseBrowserClient();
        if (!client) return () => { active = false; };
        const syncProgress = async () => {
            const { data: { user } } = await client.auth.getUser();
            if (!active) return;
            setSignedIn(Boolean(user));
            if (!user) { setProgress(EMPTY_PROGRESS); setAuthLoading(false); return; }
            const response = await fetch('/api/academy/progress', { cache: 'no-store' });
            const payload = await response.json() as { data?: Progress; error?: string };
            if (!active) return;
            if (!response.ok || !payload.data) setProgressError(payload.error ?? 'İlerleme yüklenemedi.');
            else { setProgressError(''); setProgress(payload.data); }
            setAuthLoading(false);
        };
        void syncProgress().catch(() => { if (active) { setProgressError('İlerleme bağlantısı kurulamadı.'); setAuthLoading(false); } });
        const { data: listener } = client.auth.onAuthStateChange(() => { void syncProgress(); });
        return () => { active = false; listener.subscription.unsubscribe(); };
    }, []);

    return <section id="education" className="education-section ds-education">
        <header className="ds-page-heading ds-route-heading">
            <span className="ds-eyebrow">TRADE ENGINE / BİST AKADEMİSİ</span>
            <h1><GraduationCap aria-hidden="true" /> Sıfırdan ileri seviyeye borsa eğitimi</h1>
            <p>Emir ve seans yapısından bilançoya, fiyat davranışından risk yönetimine uzanan uygulamalı dersler.</p>
        </header>
        <div className="ds-route-grid ds-education-grid">
            <div className="ds-education-main">
                <div className="education-layout">
                    <nav className="education-nav" aria-label="Akademi bölümleri">{chapters.map((chapter) => { const chapterCompleted = chapter.lessons.filter((lesson) => completed.has(lesson.id)).length; return <button key={chapter.id} className={activeChapterId === chapter.id ? 'active' : ''} onClick={() => setActiveChapterId(chapter.id)}><BookOpen size={15} /><span>{chapter.title}</span><small>{chapterCompleted}/{chapter.lessons.length}</small></button>; })}</nav>
                    <div className="academy-lesson-area ds-panel">
                        <div className="section-heading"><div><span className="ds-eyebrow">BÖLÜM {chapters.indexOf(activeChapter) + 1}</span><h2>{activeChapter.title}</h2></div><span className="ds-badge ds-badge-amber"><BookOpen size={13} /> {activeChapter.lessons.length} ders</span></div>
                        <div className="lesson-grid">{activeChapter.lessons.map((lesson) => { const isCompleted = completed.has(lesson.id); return <Link className={isCompleted ? 'lesson-card completed' : 'lesson-card'} href={`/education/${lesson.id}`} key={lesson.id}><div className="lesson-top"><span className="ds-badge ds-badge-amber">{lesson.level} · {lesson.duration}</span>{isCompleted ? <span className="ds-badge ds-badge-emerald"><CheckCircle2 size={13} /> Tamamlandı</span> : <Circle size={17} className="lesson-pending" />}</div><h3>{lesson.title}</h3><p>{lesson.summary}</p><div className="lesson-meta"><span><Clock3 size={12} /> {lesson.duration}</span><span>{isCompleted ? 'Tekrar aç' : 'Dersi aç'}</span></div></Link>; })}</div>
                    </div>
                </div>
            </div>
            <aside className="ds-route-aside ds-education-aside">
                <div className="academy-progress panel ds-panel"><div className="progress-heading"><div><span className="ds-eyebrow">KİŞİSEL İLERLEME</span><strong>{authLoading ? 'Oturum doğrulanıyor...' : signedIn ? `${progress.completedCount} / ${progress.totalCount} ders tamamlandı` : 'İlerlemeni hesabında sakla'}</strong></div><span className="ds-badge ds-badge-emerald">{authLoading ? <Activity size={13} /> : signedIn ? `%${progress.percentage}` : <Link href="/auth?next=/education">Giriş yap</Link>}</span></div><div className="progress-track"><div className="progress-fill" style={{ width: `${progress.percentage}%` }} /></div>{progressError && <small className="progress-error">{progressError}</small>}{!authLoading && !signedIn && <small className="progress-note"><LockKeyhole size={12} /> Dersler açık; tamamlanma işaretleri için giriş gerekli.</small>}</div>
                <section className="ds-panel ds-aside-card"><h2><ShieldCheck size={18} /> Öğrenme planı</h2><div className="ds-stat-row"><span>Toplam içerik</span><strong>{lessons.length} ders</strong></div><div className="ds-stat-row"><span>Seçili bölüm</span><strong>{activeChapter.title}</strong></div><p>Dersleri sırayla takip et ve her kavramı kendi araştırma sürecinde tekrar gözden geçir.</p><span className="ds-badge ds-badge-amber"><BookOpen size={13} /> Eğitim amaçlı içerik</span></section>
            </aside>
        </div>
    </section>;
}
