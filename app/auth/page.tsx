'use client';

import { FormEvent, useEffect, useState } from 'react';
import { ArrowRight, LockKeyhole, LogIn, ShieldCheck, UserPlus } from 'lucide-react';
import { getSupabaseBrowserClient } from '@/lib/supabase-browser';
import { getAuthRedirectUrl, safeInternalPath } from '@/lib/app-url';
import { translateAuthError } from '@/lib/auth-errors';
import { showError, showSuccess, showWarning } from '@/lib/ui-alerts';

type Mode = 'login' | 'signup';

export default function AuthPage() {
    const [nextPath] = useState(() => {
        if (typeof window === 'undefined') return '/lists';
        const requestedPath = new URLSearchParams(window.location.search).get('next');
        if (!requestedPath) return '/lists';
        return safeInternalPath(requestedPath, '/lists', window.location.origin);
    });
    const [mode, setMode] = useState<Mode>('login');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');

    useEffect(() => {
        const client = getSupabaseBrowserClient();
        if (!client) return;
        let active = true;
        void client.auth.getUser().then(({ data, error: authError }) => {
            if (active && !authError && data.user) window.location.replace(nextPath);
        });
        return () => { active = false; };
    }, [nextPath]);

    useEffect(() => {
        if (error) showError(error);
    }, [error]);

    useEffect(() => {
        if (message) showSuccess(message);
    }, [message]);

    useEffect(() => {
        if (new URLSearchParams(window.location.search).get('reason') === 'inactive') {
            showWarning('30 dakika hareketsizlik nedeniyle güvenliğiniz için oturumunuz kapatıldı.');
        }
    }, []);

    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setBusy(true); setError(''); setMessage('');
        const client = getSupabaseBrowserClient();
        if (!client) { setError('Supabase bağlantısı yapılandırılmamış.'); setBusy(false); return; }
        if (!/^\S+@\S+\.\S+$/.test(email)) { setError('Geçerli bir e-posta adresi yazın.'); setBusy(false); return; }
        if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) { setError('Şifre en az 8 karakter, bir harf ve bir rakam içermeli.'); setBusy(false); return; }
        try {
            const result = mode === 'login'
                ? await client.auth.signInWithPassword({ email, password })
                : await client.auth.signUp({ email, password, options: { emailRedirectTo: `${getAuthRedirectUrl('/auth/callback')}?next=${encodeURIComponent(nextPath)}` } });
            if (result.error) {
                setError(translateAuthError(result.error));
            } else if (mode === 'signup' && !result.data.session) {
                setMessage('Kayıt tamamlandı. E-posta adresinizi doğrulamak için gelen kutunuzu kontrol edin.');
            } else if (result.data.session) {
                window.location.replace(nextPath);
            } else {
                setError('Oturum açılamadı. Lütfen tekrar deneyin.');
            }
        } catch (cause) {
            setError(translateAuthError(cause instanceof Error ? cause.message : undefined, 'Giriş işlemi tamamlanamadı. Lütfen tekrar deneyin.'));
        } finally {
            setBusy(false);
        }
    };

    return <main className="auth-shell ds-shell ds-auth-shell"><section className="auth-card ds-panel ds-auth-card"><div className="ds-auth-mark"><LockKeyhole size={21} /></div><div className="auth-heading"><span className="ds-eyebrow">TRADE ENGINE / HESAP GÜVENLİĞİ</span><h1>{mode === 'login' ? 'Araştırma alanına giriş yap.' : 'Kişisel araştırma alanını oluştur.'}</h1><p>Listelerin, favorilerin ve sanal portföyün hesabına özel olarak saklanır.</p></div><div className="auth-tabs"><button type="button" className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}><LogIn size={15} /> Giriş yap</button><button type="button" className={mode === 'signup' ? 'active' : ''} onClick={() => setMode('signup')}><UserPlus size={15} /> Kayıt ol</button></div><form className="auth-form" onSubmit={submit}><label>E-posta<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required /></label><label>Şifre<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required /></label><button className="primary-button ds-primary-button auth-submit" disabled={busy}>{busy ? 'İşleniyor...' : mode === 'login' ? 'Giriş yap' : 'Hesap oluştur'}<ArrowRight size={15} /></button></form><span className="auth-note"><ShieldCheck size={14} /> E-posta doğrulaması hesabını korur ve Supabase Auth tarafından yönetilir.</span></section></main>;
}
