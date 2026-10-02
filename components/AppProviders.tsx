'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Moon, Sun, TriangleAlert } from 'lucide-react';
import { ToastContainer } from 'react-toastify';
import { getSupabaseBrowserClient } from '@/lib/supabase-browser';
import { toast } from 'react-toastify';

type Theme = 'dark' | 'light';
const SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const SESSION_ACTIVITY_KEY_PREFIX = 'trade-agent:last-activity:';
type ConfirmOptions = { title: string; message: string; confirmLabel?: string; danger?: boolean };
type PromptOptions = { title: string; message: string; label: string; defaultValue?: string; placeholder?: string; confirmLabel?: string };
type DialogState =
    | { kind: 'confirm'; options: ConfirmOptions; resolve: (value: boolean) => void }
    | { kind: 'prompt'; options: PromptOptions; resolve: (value: string | null) => void }
    | null;
type AppContextValue = {
    theme: Theme;
    toggleTheme: () => void;
    confirmDialog: (options: ConfirmOptions) => Promise<boolean>;
    promptDialog: (options: PromptOptions) => Promise<string | null>;
};

const AppContext = createContext<AppContextValue | null>(null);
const THEME_CHANGE_EVENT = 'trade-agent-theme-change';

function getThemeSnapshot(): Theme {
    return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

function subscribeToTheme(onChange: () => void) {
    window.addEventListener(THEME_CHANGE_EVENT, onChange);
    window.addEventListener('storage', onChange);
    return () => {
        window.removeEventListener(THEME_CHANGE_EVENT, onChange);
        window.removeEventListener('storage', onChange);
    };
}

export function useAppPreferences() {
    const context = useContext(AppContext);
    if (!context) throw new Error('useAppPreferences must be used within AppProviders.');
    return context;
}

export default function AppProviders({ children }: { children: ReactNode }) {
    const router = useRouter();
    const theme = useSyncExternalStore<Theme>(subscribeToTheme, getThemeSnapshot, () => 'dark');
    const [dialog, setDialog] = useState<DialogState>(null);
    const [promptValue, setPromptValue] = useState('');
    const currentUserId = useRef<string | null>(null);
    const themeRequestId = useRef(0);

    useEffect(() => {
        const currentUrl = new URL(window.location.href);
        if (currentUrl.searchParams.get('accountReactivated') !== '1') return;
        toast.success('Hesabınız yeniden aktifleşti. Yeniden hoş geldiniz!');
        currentUrl.searchParams.delete('accountReactivated');
        window.history.replaceState(window.history.state, '', `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`);
    }, []);

    useEffect(() => {
        const storedTheme = window.localStorage.getItem('trade-agent-theme');
        const initialTheme: Theme = storedTheme === 'light' ? 'light' : 'dark';
        document.documentElement.dataset.theme = initialTheme;
        document.documentElement.style.colorScheme = initialTheme;
        window.dispatchEvent(new Event(THEME_CHANGE_EVENT));

        const client = getSupabaseBrowserClient();
        if (!client) return;
        let sessionUserId: string | null = null;
        let logoutInProgress = false;
        let logoutAttemptedUserId: string | null = null;
        let lastActivityWrite = 0;
        let volatileLastActivity: number | null = null;
        let storageWarningShown = false;
        const getActivityKey = (userId: string) => `${SESSION_ACTIVITY_KEY_PREFIX}${userId}`;
        const readLastActivity = (userId: string) => {
            try {
                const value = window.localStorage.getItem(getActivityKey(userId));
                if (value === null) return volatileLastActivity;
                const timestamp = Number(value);
                if (Number.isFinite(timestamp) && timestamp > 0) return timestamp;
                console.error('Stored session activity timestamp is invalid.');
                window.localStorage.removeItem(getActivityKey(userId));
                return volatileLastActivity;
            } catch (cause) {
                console.error('Session activity could not be read from browser storage.', cause);
                if (!storageWarningShown) {
                    storageWarningShown = true;
                    toast.warning('Oturum zaman aşımı tarayıcı depolama izni olmadan yalnızca bu sekmede izlenebilir.');
                }
                return volatileLastActivity;
            }
        };
        const writeLastActivity = (userId: string, timestamp: number) => {
            volatileLastActivity = timestamp;
            try {
                window.localStorage.setItem(getActivityKey(userId), String(timestamp));
            } catch (cause) {
                console.error('Session activity could not be saved to browser storage.', cause);
                if (!storageWarningShown) {
                    storageWarningShown = true;
                    toast.warning('Oturum zaman aşımı tarayıcı depolama izni olmadan yalnızca bu sekmede izlenebilir.');
                }
            }
        };
        const expireSession = async (userId: string) => {
            if (logoutInProgress || logoutAttemptedUserId === userId || sessionUserId !== userId) return;
            logoutInProgress = true;
            logoutAttemptedUserId = userId;
            try {
                void fetch('/api/profile/activity', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ eventType: 'logout' }),
                }).then((response) => {
                    if (!response.ok) console.error('Automatic logout activity could not be recorded.', response.status);
                }).catch((cause: unknown) => console.error('Automatic logout activity could not be recorded.', cause));
                const { error } = await client.auth.signOut({ scope: 'local' });
                if (error) throw error;
                try {
                    window.localStorage.removeItem(getActivityKey(userId));
                } catch (cause) {
                    console.error('Expired session activity marker could not be removed.', cause);
                }
                router.replace('/auth?reason=inactive');
            } catch (cause) {
                logoutInProgress = false;
                console.error('Inactive session could not be signed out.', cause);
                toast.error('Oturum hareketsizlik nedeniyle kapatılamadı. Lütfen manuel olarak çıkış yapın.');
            }
        };
        const recordActivity = (force = false) => {
            const userId = sessionUserId;
            if (!userId || logoutInProgress || document.visibilityState !== 'visible') return;
            const now = Date.now();
            const lastActivity = readLastActivity(userId);
            if (lastActivity !== null && now - lastActivity >= SESSION_IDLE_TIMEOUT_MS) {
                void expireSession(userId);
                return;
            }
            if (!force && now - lastActivityWrite < 60_000) return;
            writeLastActivity(userId, now);
            lastActivityWrite = now;
        };
        const initializeSessionActivity = (userId: string, signedIn: boolean) => {
            if (sessionUserId !== userId) {
                sessionUserId = userId;
                lastActivityWrite = 0;
                volatileLastActivity = null;
                logoutAttemptedUserId = null;
            }
            if (signedIn) {
                logoutAttemptedUserId = null;
                const now = Date.now();
                writeLastActivity(userId, now);
                lastActivityWrite = now;
                return;
            }
            recordActivity(true);
        };
        const clearSessionActivity = () => {
            if (sessionUserId) {
                try {
                    window.localStorage.removeItem(getActivityKey(sessionUserId));
                } catch (cause) {
                    console.error('Session activity marker could not be cleared.', cause);
                }
            }
            volatileLastActivity = null;
            sessionUserId = null;
            lastActivityWrite = 0;
            logoutInProgress = false;
            logoutAttemptedUserId = null;
        };
        const onActivity = () => recordActivity();
        const onVisibilityChange = () => {
            if (document.visibilityState === 'visible') recordActivity(true);
        };
        const activityEvents: Array<keyof DocumentEventMap> = ['pointerdown', 'pointermove', 'keydown', 'touchstart', 'scroll', 'click'];
        activityEvents.forEach((eventName) => document.addEventListener(eventName, onActivity, { passive: true }));
        document.addEventListener('visibilitychange', onVisibilityChange);
        const idleCheck = window.setInterval(() => {
            const userId = sessionUserId;
            if (!userId || logoutInProgress) return;
            const lastActivity = readLastActivity(userId);
            if (lastActivity !== null && Date.now() - lastActivity >= SESSION_IDLE_TIMEOUT_MS) {
                void expireSession(userId);
            }
        }, 30_000);
        const loadAccountTheme = async (userId: string | null) => {
            const requestId = ++themeRequestId.current;
            currentUserId.current = userId;
            if (!userId) return;
            try {
                const response = await fetch('/api/profile/theme', { cache: 'no-store' });
                const payload = await response.json() as { data?: { theme: Theme }; error?: string };
                if (requestId !== themeRequestId.current) return;
                if (!response.ok || !payload.data) {
                    throw new Error(payload.error ?? 'Hesap teması yüklenemedi.');
                }
                const next = payload.data.theme;
                document.documentElement.dataset.theme = next;
                document.documentElement.style.colorScheme = next;
                window.localStorage.setItem('trade-agent-theme', next);
                window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
            } catch (cause) {
                console.error('Account theme preference could not be loaded.', cause);
                toast.warning('Hesap teması yüklenemedi; bu cihazdaki son tema kullanılmaya devam ediyor.');
            }
        };
        void client.auth.getSession().then(({ data, error }) => {
            if (error) {
                console.error('Current account lookup for theme preference failed.', error);
                return;
            }
            if (data.session) initializeSessionActivity(data.session.user.id, false);
            void loadAccountTheme(data.session?.user.id ?? null);
        });
        const { data: { subscription } } = client.auth.onAuthStateChange((event, session) => {
            if (session) initializeSessionActivity(session.user.id, event === 'SIGNED_IN');
            else clearSessionActivity();
            void loadAccountTheme(session?.user.id ?? null);
        });
        return () => {
            themeRequestId.current += 1;
            window.clearInterval(idleCheck);
            activityEvents.forEach((eventName) => document.removeEventListener(eventName, onActivity));
            document.removeEventListener('visibilitychange', onVisibilityChange);
            subscription.unsubscribe();
        };
    }, [router]);

    const toggleTheme = useCallback(() => {
        const next: Theme = getThemeSnapshot() === 'dark' ? 'light' : 'dark';
        document.documentElement.dataset.theme = next;
        document.documentElement.style.colorScheme = next;
        window.localStorage.setItem('trade-agent-theme', next);
        window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
        if (currentUserId.current) {
            void fetch('/api/profile/theme', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ theme: next }),
            }).then(async (response) => {
                const payload = await response.json() as { error?: string };
                if (!response.ok) throw new Error(payload.error ?? 'Tema tercihi kaydedilemedi.');
            }).catch((cause: unknown) => {
                console.error('Account theme preference could not be saved.', cause);
                toast.error('Tema bu cihazda uygulandı ancak hesaba kaydedilemedi. Supabase tema migration dosyasını kontrol edin.');
            });
        }
    }, []);

    const confirmDialog = useCallback((options: ConfirmOptions) => new Promise<boolean>((resolve) => {
        setDialog({ kind: 'confirm', options, resolve });
    }), []);

    const promptDialog = useCallback((options: PromptOptions) => new Promise<string | null>((resolve) => {
        setPromptValue(options.defaultValue ?? '');
        setDialog({ kind: 'prompt', options, resolve });
    }), []);

    const closeDialog = (result: boolean | string | null) => {
        if (!dialog) return;
        if (dialog.kind === 'confirm' && typeof result === 'boolean') dialog.resolve(result);
        if (dialog.kind === 'prompt' && (typeof result === 'string' || result === null)) dialog.resolve(result);
        setDialog(null);
    };

    const contextValue = useMemo(() => ({ theme, toggleTheme, confirmDialog, promptDialog }), [theme, toggleTheme, confirmDialog, promptDialog]);

    return <AppContext.Provider value={contextValue}>
        {children}
        <ToastContainer position="bottom-right" autoClose={4500} newestOnTop closeOnClick pauseOnFocusLoss draggable theme={theme} toastStyle={{ zIndex: 10000 }} />
        {dialog && <div className="app-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeDialog(dialog.kind === 'confirm' ? false : null); }}>
            <section className="app-dialog" role="dialog" aria-modal="true" aria-labelledby="app-dialog-title" onKeyDown={(event) => {
                if (event.key === 'Escape') closeDialog(dialog.kind === 'confirm' ? false : null);
                if (event.key === 'Enter' && dialog.kind === 'prompt') closeDialog(promptValue);
            }}>
                <div className="app-dialog-heading">
                    <span className="app-dialog-icon"><TriangleAlert className="h-5 w-5" /></span>
                    <div><h2 id="app-dialog-title">{dialog.options.title}</h2><p>{dialog.options.message}</p></div>
                </div>
                {dialog.kind === 'prompt' && <label className="app-dialog-field">
                    <span>{dialog.options.label}</span>
                    <input autoFocus value={promptValue} placeholder={dialog.options.placeholder} onChange={(event) => setPromptValue(event.target.value)} />
                </label>}
                <div className="app-dialog-actions">
                    <button type="button" className="app-dialog-cancel" onClick={() => closeDialog(dialog.kind === 'confirm' ? false : null)}>Vazgeç</button>
                    <button type="button" autoFocus={dialog.kind === 'confirm'} className={`app-dialog-confirm ${dialog.kind === 'confirm' && dialog.options.danger ? 'danger' : ''}`} onClick={() => closeDialog(dialog.kind === 'confirm' ? true : promptValue)}>
                        {dialog.options.confirmLabel ?? (dialog.kind === 'confirm' ? 'Onayla' : 'Kaydet')}
                    </button>
                </div>
            </section>
        </div>}
    </AppContext.Provider>;
}

export function ThemeToggle() {
    const { theme, toggleTheme } = useAppPreferences();
    const nextTheme = theme === 'dark' ? 'light' : 'dark';
    return <button type="button" className="app-theme-toggle" onClick={toggleTheme} aria-pressed={theme === 'light'} aria-label={`Temayı ${nextTheme === 'light' ? 'aydınlık' : 'karanlık'} yap`} title={`Tema: ${theme === 'light' ? 'Aydınlık' : 'Karanlık'}`}>
        {theme === 'dark' ? <Sun size={17} aria-hidden="true" /> : <Moon size={17} aria-hidden="true" />}
        <span className="sr-only">Tema: {theme === 'light' ? 'Aydınlık' : 'Karanlık'}</span>
    </button>;
}
