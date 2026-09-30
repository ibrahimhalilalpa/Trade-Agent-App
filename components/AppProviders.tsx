'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Moon, Sun, TriangleAlert } from 'lucide-react';
import { ToastContainer } from 'react-toastify';
import { getSupabaseBrowserClient } from '@/lib/supabase-browser';
import { toast } from 'react-toastify';

type Theme = 'dark' | 'light';
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
    const theme = useSyncExternalStore<Theme>(subscribeToTheme, getThemeSnapshot, () => 'dark');
    const [dialog, setDialog] = useState<DialogState>(null);
    const [promptValue, setPromptValue] = useState('');
    const currentUserId = useRef<string | null>(null);
    const themeRequestId = useRef(0);

    useEffect(() => {
        const storedTheme = window.localStorage.getItem('trade-agent-theme');
        const initialTheme: Theme = storedTheme === 'light' ? 'light' : 'dark';
        document.documentElement.dataset.theme = initialTheme;
        document.documentElement.style.colorScheme = initialTheme;
        window.dispatchEvent(new Event(THEME_CHANGE_EVENT));

        const client = getSupabaseBrowserClient();
        if (!client) return;
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
            void loadAccountTheme(data.session?.user.id ?? null);
        });
        const { data: { subscription } } = client.auth.onAuthStateChange((_event, session) => {
            void loadAccountTheme(session?.user.id ?? null);
        });
        return () => {
            themeRequestId.current += 1;
            subscription.unsubscribe();
        };
    }, []);

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
