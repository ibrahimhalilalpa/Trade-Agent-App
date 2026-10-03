'use client';

import { ChevronDown, LogIn, LogOut, Shield, UserRound } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import type { User } from '@supabase/supabase-js';
import { getSupabaseBrowserClient } from '@/lib/supabase-browser';
import { translateAuthError } from '@/lib/auth-errors';
import { showError } from '@/lib/ui-alerts';

const LOGIN_AUDIT_STORAGE_PREFIX = 'trade-agent:login-audit:';
type AccountProfile = { display_name: string | null; full_name: string | null; username: string | null; avatar_url: string | null };

function removeAuditMarker(key: string, expectedValue: string) {
    try {
        if (window.localStorage.getItem(key) === expectedValue) window.localStorage.removeItem(key);
    } catch (cause) {
        console.error('Login activity deduplication marker could not be removed.', cause);
    }
}

export default function AuthStatus() {
    const configured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
    const router = useRouter();
    const menuRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const menuPanelRef = useRef<HTMLDivElement>(null);
    const [user, setUser] = useState<User | null>(null);
    const [profileState, setProfileState] = useState<{ userId: string; profile: AccountProfile | null } | null>(null);
    const [isAdmin, setIsAdmin] = useState(false);
    const [loading, setLoading] = useState(configured);
    const [signingOut, setSigningOut] = useState(false);
    const [menuOpen, setMenuOpen] = useState(false);
    const [menuPosition, setMenuPosition] = useState({ top: 12, left: 12 });

    useEffect(() => {
        const client = getSupabaseBrowserClient();
        if (!client) return;
        let active = true;
        const updateRole = () => {
            void fetch('/api/profile/role', { cache: 'no-store' })
                .then(async (response) => {
                    if (!response.ok) throw new Error(`Role lookup failed: ${response.status}`);
                    return await response.json() as { role?: string };
                })
                .then((payload) => { if (active) setIsAdmin(payload.role === 'admin' || payload.role === 'super_admin'); })
                .catch((cause: unknown) => {
                    if (active) setIsAdmin(false);
                    console.error('Navigation role could not be verified.', cause);
                });
        };
        void client.auth.getUser().then(({ data }) => { if (active) { setUser(data.user); setLoading(false); } })
            .catch((cause: unknown) => { if (active) setLoading(false); console.error('Navigation user could not be loaded.', cause); });
        const { data: listener } = client.auth.onAuthStateChange((event, session) => {
            setUser(session?.user ?? null);
            setMenuOpen(false);
            if (session?.user) updateRole();
            else setIsAdmin(false);
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
                    console.error('Login activity deduplication markers could not be cleared.', cause);
                }
            }
        });
        return () => {
            active = false;
            listener.subscription.unsubscribe();
        };
    }, []);

    const userId = user?.id;
    useEffect(() => {
        if (!userId) {
            return;
        }
        let active = true;
        void fetch('/api/profile', { cache: 'no-store' })
            .then(async (response) => {
                if (!response.ok) throw new Error(`Profile lookup failed: ${response.status}`);
                return await response.json() as { data?: { profile?: AccountProfile } };
            })
            .then((payload) => { if (active) setProfileState({ userId, profile: payload.data?.profile ?? null }); })
            .catch((cause: unknown) => {
                if (active) setProfileState({ userId, profile: null });
                console.error('Navigation profile could not be loaded.', cause);
            });
        return () => { active = false; };
    }, [userId]);

    useEffect(() => {
        if (!menuOpen) return;
        const closeMenu = (event: MouseEvent | KeyboardEvent) => {
            if (event instanceof KeyboardEvent && event.key === 'Escape') setMenuOpen(false);
            if (event instanceof MouseEvent
                && !menuRef.current?.contains(event.target as Node)
                && !menuPanelRef.current?.contains(event.target as Node)) setMenuOpen(false);
        };
        document.addEventListener('mousedown', closeMenu);
        document.addEventListener('keydown', closeMenu);
        return () => {
            document.removeEventListener('mousedown', closeMenu);
            document.removeEventListener('keydown', closeMenu);
        };
    }, [menuOpen]);

    useEffect(() => {
        if (!menuOpen) return;
        const updateMenuPosition = () => {
            const rect = triggerRef.current?.getBoundingClientRect();
            if (!rect) return;
            const width = Math.min(280, window.innerWidth - 24);
            const left = Math.min(window.innerWidth - width - 12, Math.max(12, rect.right - width));
            const top = Math.min(Math.max(12, window.innerHeight - 220), Math.max(12, rect.bottom + 8));
            setMenuPosition({ top, left });
        };
        window.addEventListener('resize', updateMenuPosition);
        return () => window.removeEventListener('resize', updateMenuPosition);
    }, [menuOpen]);

    if (!configured) return null;
    if (loading) return <span className="auth-nav-link">Oturum doğrulanıyor...</span>;
    if (!user) return <Link className="auth-nav-link" href="/auth"><LogIn size={15} /> Giriş yap</Link>;

    const email = user.email ?? '';
    const accountProfile = profileState?.userId === user.id ? profileState.profile : null;
    const displayName = [
        accountProfile?.display_name,
        accountProfile?.username,
        accountProfile?.full_name,
        user.user_metadata?.display_name,
        user.user_metadata?.username,
        user.user_metadata?.full_name,
        user.user_metadata?.name,
    ].find((value): value is string => (
        typeof value === 'string'
        && value.trim().length > 0
        && value.trim().toLocaleLowerCase() !== email.toLocaleLowerCase()
    ))?.trim() ?? email.split('@')[0] ?? 'Hesabım';
    const avatarUrl = [
        accountProfile?.avatar_url,
        user.user_metadata?.avatar_url,
        user.user_metadata?.picture,
        user.user_metadata?.profile_image_url,
    ].find((value): value is string => typeof value === 'string' && /^https?:\/\//i.test(value));
    const initials = displayName.trim().slice(0, 1).toLocaleUpperCase('tr-TR') || 'U';
    const signOut = async () => {
        const client = getSupabaseBrowserClient();
        if (!client) {
            showError('Oturum bağlantısı kurulamadı.');
            return;
        }
        setSigningOut(true);
        try {
            try {
                const activity = await fetch('/api/profile/activity', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ eventType: 'logout' }),
                });
                if (!activity.ok) console.error('Logout activity could not be recorded.', activity.status);
            } catch (cause: unknown) {
                console.error('Logout activity could not be recorded.', cause);
            }
            const result = await client.auth.signOut();
            if (result.error) throw result.error;
            setUser(null);
            setMenuOpen(false);
            router.replace('/');
            router.refresh();
        } catch (cause) {
            showError(translateAuthError(cause instanceof Error ? cause.message : undefined, 'Oturum kapatılamadı.'));
        } finally {
            setSigningOut(false);
        }
    };

    return <div className="auth-status-menu" ref={menuRef}>
        <button ref={triggerRef} type="button" className="auth-profile-trigger" aria-expanded={menuOpen} aria-haspopup="menu" onClick={() => {
            const rect = triggerRef.current?.getBoundingClientRect();
            if (rect) {
                const width = Math.min(280, window.innerWidth - 24);
                const left = Math.min(window.innerWidth - width - 12, Math.max(12, rect.right - width));
                const top = Math.min(Math.max(12, window.innerHeight - 220), Math.max(12, rect.bottom + 8));
                setMenuPosition({ top, left });
            }
            setMenuOpen((open) => !open);
        }}>
            <span className={`auth-profile-avatar${avatarUrl ? ' has-image' : ''}`} aria-hidden="true">
                {avatarUrl ? <Image src={avatarUrl} alt="" width={29} height={29} unoptimized referrerPolicy="no-referrer" /> : initials}
            </span>
            <span className="auth-profile-label">Hesabım</span>
            <ChevronDown size={14} className={menuOpen ? 'auth-profile-chevron is-open' : 'auth-profile-chevron'} />
        </button>
        {menuOpen && typeof document !== 'undefined' && createPortal(<div ref={menuPanelRef} className="auth-profile-menu auth-profile-menu-portal" role="menu" style={{ top: menuPosition.top, left: menuPosition.left }}>
            <div className="auth-profile-menu-heading"><strong>{displayName}</strong>{email && <span>{email}</span>}</div>
            <Link role="menuitem" href="/profile" onClick={() => setMenuOpen(false)}><UserRound size={15} /> Profilim &amp; Ayarlar</Link>
            {isAdmin && <Link role="menuitem" href="/admin" onClick={() => setMenuOpen(false)}><Shield size={15} /> Yönetim Paneli</Link>}
            <button type="button" role="menuitem" className="auth-profile-signout" onClick={() => void signOut()} disabled={signingOut}><LogOut size={15} /> {signingOut ? 'Çıkış yapılıyor…' : 'Çıkış Yap'}</button>
        </div>, document.body)}
    </div>;
}
