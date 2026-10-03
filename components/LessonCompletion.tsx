'use client';

import { CheckCircle2, LockKeyhole } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { getSupabaseBrowserClient } from '@/lib/supabase-browser';
import { showError, showSuccess } from '@/lib/ui-alerts';

type Progress = { completedLessonIds: string[]; completedCount: number; totalCount: number; percentage: number };

export default function LessonCompletion({ lessonId }: { lessonId: string }) {
    const [progress, setProgress] = useState<Progress | null>(null);
    const [signedIn, setSignedIn] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [authLoading, setAuthLoading] = useState(Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY));
    const completed = progress?.completedLessonIds.includes(lessonId) ?? false;

    useEffect(() => {
        if (error) showError(error);
    }, [error]);

    useEffect(() => {
        let active = true;
        const client = getSupabaseBrowserClient();
        if (!client) return () => { active = false; };
        const syncProgress = async () => {
            const { data: { user } } = await client.auth.getUser();
            if (!active) return;
            setSignedIn(Boolean(user));
            if (!user) { setProgress(null); setAuthLoading(false); return; }
            const response = await fetch('/api/academy/progress', { cache: 'no-store' });
            const payload = await response.json() as { data?: Progress };
            if (active && response.ok && payload.data) setProgress(payload.data);
            if (active) setAuthLoading(false);
        };
        void syncProgress().catch(() => { if (active) { setError('Oturum veya ilerleme doğrulanamadı.'); setAuthLoading(false); } });
        const { data: listener } = client.auth.onAuthStateChange(() => { void syncProgress(); });
        return () => { active = false; listener.subscription.unsubscribe(); };
    }, [lessonId]);

    const toggle = async () => {
        setBusy(true); setError('');
        try {
            const response = await fetch('/api/academy/progress', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lessonId, completed: !completed }) });
            const payload = await response.json() as { data?: Progress; error?: string };
            if (response.status === 401) { setSignedIn(false); return; }
            if (!response.ok || !payload.data) { setError(payload.error ?? 'İlerleme kaydedilemedi.'); return; }
            setSignedIn(true); setProgress(payload.data);
            showSuccess(completed ? 'Ders tamamlandı olarak işaretlendi.' : 'Ders tamamlanma işareti kaldırıldı.');
        } catch { setError('İlerleme kaydedilemedi.'); }
        finally { setBusy(false); }
    };

    if (authLoading) return <div className="lesson-completion locked"><div><span className="eyebrow">OTURUM KONTROLÜ</span><strong>İlerlemen doğrulanıyor...</strong></div></div>;
    if (!signedIn) return <div className="lesson-completion locked"><div><span className="eyebrow">İLERLEMENİ SAKLA</span><strong>Bu dersi tamamlandı olarak işaretlemek için giriş yap.</strong></div><Link className="secondary-button" href={`/auth?next=/education/${lessonId}`}><LockKeyhole size={14} /> Giriş yap</Link></div>;
    return <div className={completed ? 'lesson-completion done' : 'lesson-completion'}><div><span className="eyebrow">DERS İLERLEMESİ</span><strong>{completed ? 'Bu ders tamamlandı.' : 'Bu dersi bitirdin mi?'}</strong><small>{progress?.completedCount} / {progress?.totalCount} ders · %{progress?.percentage}</small></div>{completed ? <span className="lesson-completion-status"><CheckCircle2 size={15} /> Tamamlandı</span> : <button className="primary-button compact" onClick={() => void toggle()} disabled={busy}>{busy ? 'Kaydediliyor...' : 'Bu dersi tamamladım'}</button>}</div>;
}