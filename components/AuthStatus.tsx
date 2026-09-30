'use client';

import { LogIn, LogOut, UserRound } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { User } from '@supabase/supabase-js';
import { getSupabaseBrowserClient } from '@/lib/supabase-browser';
import { translateAuthError } from '@/lib/auth-errors';
import { showError } from '@/lib/ui-alerts';

const LOGIN_AUDIT_STORAGE_PREFIX = 'trade-agent:login-audit:';

function removeAuditMarker(key: string, expectedValue: string) {
    try {
        if (window.localStorage.getItem(key) === expectedValue) window.localStorage.removeItem(key);
    } catch (cause) {
        console.error('Login activity deduplication marker could not be removed.', cause);
    }
}

export default function AuthStatus({ onNavigate }: { onNavigate?: () => void }) {
    const configured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
    const router = useRouter();
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(configured);
    const [signingOut, setSigningOut] = useState(false);

    useEffect(() => {
        const client = getSupabaseBrowserClient();
        if (!client) return;
        void client.auth.getUser().then(({ data }) => { setUser(data.user); setLoading(false); }).catch(() => setLoading(false));
        const { data: listener } = client.auth.onAuthStateChange((event, session) => {
            setUser(session?.user ?? null);
            if (event === 'SIGNED_IN' && session?.user) {
                const storageKey = `${LOGIN_AUDIT_STORAGE_PREFIX}${session.user.id}`;
                const sessionMarker = String(session.expires_at ?? '');
                let shouldRecord = true;
                try {
                    if (window.localStorage.getItem(storageKey) === sessionMarker) shouldRecord = false;
                    else window.localStorage.setItem(storageKey, sessionMarker);
                } catch (cause) {
                    console.error('Login activity deduplication storage is unavailable.', cause);
                }
                if (shouldRecord) {
                    void fetch('/api/profile/activity', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ eventType: 'login' }),
                    }).then((response) => {
                        if (!response.ok) {
                            removeAuditMarker(storageKey, sessionMarker);
                            console.error('Login activity could not be recorded.', response.status);
                        }
                    }).catch((cause: unknown) => {
                        removeAuditMarker(storageKey, sessionMarker);
                        console.error('Login activity could not be recorded.', cause);
                    });
                }
            } else if (event === 'SIGNED_OUT') {
                try {
                    for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
                        const key = window.localStorage.key(index);
                        if (key?.startsWith(LOGIN_AUDIT_STORAGE_PREFIX)) window.localStorage.removeItem(key);
                    }
                } catch (cause) {
                    console.error('Login activity deduplication storage could not be cleared.', cause);
                }
            }
        });
        return () => listener.subscription.unsubscribe();
    }, []);

    if (!configured) return null;
    if (loading) return <span className="auth-nav-link">Oturum doğrulanıyor...</span>;
    if (!user) return <Link className="auth-nav-link" href="/auth" onClick={onNavigate}><LogIn size={14} /> Giriş</Link>;
    const signOut = async () => {
        const client = getSupabaseBrowserClient();
        if (!client) {
            showError('Oturum bağlantısı kurulamadı.');
            return;
        }

        setSigningOut(true);
        try {
            void fetch('/api/profile/activity', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ eventType: 'logout' }) })
                .then((activity) => { if (!activity.ok) console.error('Logout activity could not be recorded.', activity.status); })
                .catch((cause: unknown) => console.error('Logout activity could not be recorded.', cause));
            const result = await client.auth.signOut();
            if (result.error) throw result.error;
            setUser(null);
            router.replace('/');
            router.refresh();
        } catch (cause) {
            showError(translateAuthError(cause instanceof Error ? cause.message : undefined, 'Oturum kapatılamadı.'));
        } finally {
            setSigningOut(false);
        }
    };
    return <div className="auth-status"><Link href="/profile" title={user.email ?? undefined} onClick={onNavigate}><UserRound size={14} /> Hesabım</Link><button title="Oturumu kapat" aria-label="Oturumu kapat" onClick={() => void signOut()} disabled={signingOut}>{signingOut ? 'Çıkılıyor…' : <><LogOut size={14} /><span>Çıkış Yap</span></>}</button></div>;
}