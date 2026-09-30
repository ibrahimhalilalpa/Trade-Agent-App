'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { LoaderCircle, ShieldAlert } from 'lucide-react';
import { getSupabaseBrowserClient } from '@/lib/supabase-browser';
import { safeInternalPath } from '@/lib/app-url';
import { translateAuthError } from '@/lib/auth-errors';
import { showError } from '@/lib/ui-alerts';

export default function AuthCallbackPage() {
    const [error, setError] = useState('');

    useEffect(() => {
        if (error) showError(error);
    }, [error]);

    useEffect(() => {
        let active = true;

        const completeAuthentication = async () => {
            const client = getSupabaseBrowserClient();
            if (!client) {
                setError('Supabase bağlantısı yapılandırılmamış.');
                return;
            }

            const currentUrl = new URL(window.location.href);
            const query = currentUrl.searchParams;
            const hash = new URLSearchParams(currentUrl.hash.slice(1));
            const callbackError = query.get('error_description')
                ?? query.get('error')
                ?? hash.get('error_description')
                ?? hash.get('error');
            if (callbackError) {
                setError(translateAuthError(decodeURIComponent(callbackError.replace(/\+/g, ' ')), 'Doğrulama bağlantısı geçersiz veya süresi dolmuş. Yeni bir bağlantı isteyin.'));
                return;
            }

            let authError: Error | null = null;
            const code = query.get('code');
            const tokenHash = query.get('token_hash');
            const type = query.get('type');

            if (code) {
                const result = await client.auth.exchangeCodeForSession(code);
                authError = result.error;
            } else if (tokenHash && (type === 'invite' || type === 'recovery' || type === 'signup' || type === 'email')) {
                const result = await client.auth.verifyOtp({
                    token_hash: tokenHash,
                    type,
                });
                authError = result.error;
            } else if (hash.get('access_token') && hash.get('refresh_token')) {
                const result = await client.auth.setSession({
                    access_token: hash.get('access_token')!,
                    refresh_token: hash.get('refresh_token')!,
                });
                authError = result.error;
            }

            if (authError) {
                setError(translateAuthError(authError, 'Oturum doğrulanamadı. Yeni bir bağlantı isteyin.'));
                return;
            }

            const { data, error: sessionError } = await client.auth.getSession();
            if (sessionError || !data.session) {
                setError(translateAuthError(sessionError?.message, 'Bağlantı geçersiz veya süresi dolmuş. Yeni bir bağlantı isteyin.'));
                return;
            }

            const requestedPath = safeInternalPath(query.get('next'), '/lists', window.location.origin);
            const isRecovery = type === 'recovery' || requestedPath.includes('recovery=1');
            const destination = isRecovery
                ? '/profile?recovery=1'
                : requestedPath === '/lists' && type === 'invite'
                    ? '/profile'
                    : requestedPath;
            window.location.replace(destination);
        };

        void completeAuthentication().catch((cause: unknown) => {
            if (active) setError(translateAuthError(cause instanceof Error ? cause.message : undefined, 'Oturum doğrulanamadı. Lütfen yeni bir bağlantı isteyin.'));
        });

        return () => { active = false; };
    }, []);

    return (
        <main className="auth-shell ds-shell ds-auth-shell">
            <section className="auth-card ds-panel ds-auth-card text-center">
                {error ? (
                    <>
                        <div className="ds-auth-mark mx-auto text-rose-400"><ShieldAlert size={21} /></div>
                        <h1 className="mt-5 text-xl font-bold text-white">Bağlantı doğrulanamadı</h1>
                        <p className="mt-3 text-sm text-slate-400">{error}</p>
                        <Link href="/auth" className="primary-button ds-primary-button mt-6 inline-flex">Giriş sayfasına dön</Link>
                    </>
                ) : (
                    <>
                        <div className="ds-auth-mark mx-auto"><LoaderCircle size={21} className="animate-spin" /></div>
                        <h1 className="mt-5 text-xl font-bold text-white">Hesabınız doğrulanıyor</h1>
                        <p className="mt-3 text-sm text-slate-400">Güvenli oturumunuz hazırlanıyor. Lütfen bu sayfayı kapatmayın.</p>
                    </>
                )}
            </section>
        </main>
    );
}
