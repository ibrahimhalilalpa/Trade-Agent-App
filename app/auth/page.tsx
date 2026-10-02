'use client';

import { FormEvent, useEffect, useState } from 'react';
import { ArrowRight, ImagePlus, LockKeyhole, LogIn, ShieldCheck, UserPlus, X } from 'lucide-react';
import { getSupabaseBrowserClient } from '@/lib/supabase-browser';
import { getAuthRedirectUrl, safeInternalPath } from '@/lib/app-url';
import { translateAuthError } from '@/lib/auth-errors';
import { showError, showSuccess, showWarning } from '@/lib/ui-alerts';

type Mode = 'login' | 'signup';
type RestrictionInfo = {
    type: 'suspension' | 'closure';
    reason: string;
    explanation: string;
    startsAt: string;
    endsAt: string | null;
};
type AppealInfo = { id: string; subject: string; details: string; status: 'pending' | 'approved' | 'rejected' | 'superseded'; admin_note: string | null; attachment_url?: string | null; created_at: string };
type RestrictionResponse = {
    success?: boolean;
    restricted?: boolean;
    restriction?: RestrictionInfo;
    appeal?: AppealInfo | null;
    canAppeal?: boolean;
    nextAppealAt?: string | null;
    remainingAppeals?: number | null;
    appealCount?: number;
    appealsInCurrentCycle?: number;
    appealCycleReset?: boolean;
    error?: string;
};
const TERMS_VERSION = '2026-10-02';
const SIGNUP_REQUEST_MESSAGE = 'Doğrulama e-postası gönderildi. Gelen kutunuzu ve spam klasörünü kontrol edin.';
const TERMS_ITEMS = [
    {
        title: 'Yatırım içerikleri ve risk uyarısı',
        text: 'Platformda paylaşılan forum konuları, grafikler, hisse analizleri ve yorumlar kullanıcıların kişisel görüşleridir; yatırım danışmanlığı veya yatırım tavsiyesi değildir. Yatırım kararlarının sorumluluğu kullanıcıya aittir. İçerikler doğruluk, güncellik veya getiri garantisi taşımaz.',
    },
    {
        title: 'Topluluk ve içerik kuralları',
        text: 'Küfür, hakaret, nefret söylemi, taciz, rencide edici veya hukuka aykırı içerik ile ahlaka aykırı profil/kapak görselleri yasaktır. İçerikler otomatik filtrelerden ve gerektiğinde moderasyon incelemesinden geçirilebilir.',
    },
    {
        title: 'Piyasa manipülasyonu ve reklam',
        text: 'Borsa İstanbul hisseleri hakkında yanıltıcı veya manipülatif içerik, koordineli alım-satım yönlendirmesi, izinsiz/telif hakkı ihlali içeren materyal ve harici Telegram/VIP grup reklamları paylaşılamaz.',
    },
    {
        title: 'Moderasyon ve kayıtlar',
        text: 'Kuralların ihlali içeriğin kaldırılmasına ve hesabın geçici ya da süresiz kısıtlanmasına yol açabilir. Yürürlükteki mevzuatın gerektirdiği erişim ve işlem kayıtları, geçerli saklama süreleri ve gizlilik yükümlülükleri çerçevesinde işlenebilir. Bu metin, ayrıca sunulması gereken KVKK aydınlatma yükümlülüklerinin yerine geçtiği veya hukuki sorumlulukları ortadan kaldırdığı şeklinde yorumlanmamalıdır.',
    },
];

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
    const [confirmPassword, setConfirmPassword] = useState('');
    const [acceptedTerms, setAcceptedTerms] = useState<boolean[]>(() => TERMS_ITEMS.map(() => false));
    const [termsStepChecked, setTermsStepChecked] = useState(false);
    const [termsOpen, setTermsOpen] = useState(false);
    const [termsIndex, setTermsIndex] = useState(0);
    const [busy, setBusy] = useState(false);
    const [signupEmailSent, setSignupEmailSent] = useState(false);
    const [restrictionInfo, setRestrictionInfo] = useState<RestrictionResponse | null>(null);
    const [appealDetails, setAppealDetails] = useState('');
    const [appealSubject, setAppealSubject] = useState('Hesap kısıtlamasına itiraz');
    const [appealFile, setAppealFile] = useState<File | null>(null);
    const [appealBusy, setAppealBusy] = useState(false);
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');
    const termsAccepted = acceptedTerms.length > 0 && acceptedTerms.every(Boolean);
    const passwordStrength = password.length === 0
        ? null
        : password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)
            ? { label: 'Zayıf', color: 'text-rose-300', width: 'w-1/3', hint: 'En az 8 karakter; en az bir harf ve rakam ekleyin.' }
            : password.length >= 12 && /[A-Z]/.test(password) && /[a-z]/.test(password) && /\d/.test(password) && /[^A-Za-z0-9]/.test(password)
                ? { label: 'Güçlü', color: 'text-emerald-300', width: 'w-full', hint: 'Güçlü bir parola. Başka hesaplarda tekrar kullanmayın.' }
                : { label: 'Orta', color: 'text-amber-300', width: 'w-2/3', hint: 'Daha güçlü olması için uzatın; büyük/küçük harf ve özel karakter ekleyin.' };
    const passwordsMatch = confirmPassword.length > 0 && password === confirmPassword;

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
        if (new URLSearchParams(window.location.search).get('accountDeleted') === '1') {
            showSuccess('Hesabınız e-posta doğrulamasından sonra kalıcı olarak silindi.');
        }
    }, []);

    useEffect(() => {
        if (new URLSearchParams(window.location.search).get('reason') === 'inactive') {
            showWarning('30 dakika hareketsizlik nedeniyle güvenliğiniz için oturumunuz kapatıldı.');
        }
    }, []);

    useEffect(() => {
        if (!termsOpen) return;
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setTermsOpen(false);
        };
        window.addEventListener('keydown', closeOnEscape);
        return () => window.removeEventListener('keydown', closeOnEscape);
    }, [termsOpen]);

    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setBusy(true); setError(''); setMessage('');
        setSignupEmailSent(false);
        const client = getSupabaseBrowserClient();
        if (!client) { setError('Supabase bağlantısı yapılandırılmamış.'); setBusy(false); return; }
        if (!/^\S+@\S+\.\S+$/.test(email)) { setError('Geçerli bir e-posta adresi yazın.'); setBusy(false); return; }
        if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) { setError('Şifre en az 8 karakter, bir harf ve bir rakam içermeli.'); setBusy(false); return; }
        if (mode === 'signup' && password !== confirmPassword) {
            setError('Şifre alanları eşleşmiyor.');
            setBusy(false);
            return;
        }
        if (mode === 'signup' && !termsAccepted) {
            setError('Kayıt olmak için şartların tüm maddelerini sırayla kabul etmelisiniz.');
            setBusy(false);
            return;
        }
        try {
            const result = mode === 'login'
                ? await client.auth.signInWithPassword({ email, password })
                : await client.auth.signUp({
                    email,
                    password,
                    options: {
                        emailRedirectTo: `${getAuthRedirectUrl('/auth/callback')}?next=${encodeURIComponent('/profile')}`,
                        data: { terms_accepted: true, terms_version: TERMS_VERSION },
                    },
                });
            if (result.error) {
                const authMessage = translateAuthError(result.error);
                if (mode === 'login') {
                    try {
                        const restrictionResponse = await fetch('/api/account-restrictions', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ action: 'lookup', email }),
                        });
                        const restrictionPayload = await restrictionResponse.json() as RestrictionResponse;
                        if (restrictionResponse.ok && restrictionPayload.restricted) {
                            setRestrictionInfo(restrictionPayload);
                            setError('');
                        } else {
                            setError(restrictionPayload.error && !restrictionResponse.ok ? restrictionPayload.error : authMessage);
                        }
                    } catch (cause) {
                        console.error('Account restriction details could not be checked after login failure.', cause);
                        setError(authMessage);
                    }
                } else if (authMessage === 'Bu e-posta adresiyle bir hesap zaten kayıtlı.') {
                    setMessage('İstek alındı. E-posta adresi bu ekranda doğrulanamaz; gelen kutunuzu kontrol edin veya giriş yapmayı deneyin.');
                } else {
                    setError(authMessage);
                }
            } else if (mode === 'signup' && !result.data.session) {
                setMessage(SIGNUP_REQUEST_MESSAGE);
                setSignupEmailSent(true);
            } else if (result.data.session) {
                setRestrictionInfo(null);
                let accountReactivated = false;
                if (mode === 'login') {
                    try {
                        const reactivation = await fetch('/api/profile/account', { method: 'DELETE' });
                        if (!reactivation.ok) {
                            console.error('Account freeze could not be canceled after successful login.', reactivation.status);
                        } else {
                            const payload = await reactivation.json() as { reactivated?: boolean };
                            accountReactivated = payload.reactivated === true;
                        }
                    } catch (cause) {
                        console.error('Account freeze cancellation request failed after successful login.', cause);
                    }
                }
                const destination = new URL(nextPath, window.location.origin);
                if (accountReactivated) destination.searchParams.set('accountReactivated', '1');
                window.location.replace(`${destination.pathname}${destination.search}${destination.hash}`);
            } else {
                setError('Oturum açılamadı. Lütfen tekrar deneyin.');
            }
        } catch (cause) {
            setError(translateAuthError(cause instanceof Error ? cause.message : undefined, 'Giriş işlemi tamamlanamadı. Lütfen tekrar deneyin.'));
        } finally {
            setBusy(false);
        }
    };

    const submitAccountAppeal = async () => {
        if (appealBusy || !restrictionInfo?.restricted) return;
        if (appealDetails.trim().length < 20 || appealDetails.trim().length > 1000) {
            setError('İtiraz açıklaması 20-1000 karakter arasında olmalıdır.');
            return;
        }
        setAppealBusy(true);
        setError('');
        try {
            const form = new FormData();
            form.set('action', 'appeal');
            form.set('email', email);
            form.set('subject', appealSubject);
            form.set('details', appealDetails);
            if (appealFile) form.set('file', appealFile);
            const response = await fetch('/api/account-restrictions', {
                method: 'POST',
                body: form,
            });
            const payload = await response.json() as RestrictionResponse;
            if (!response.ok) throw new Error(payload.error ?? 'İtiraz gönderilemedi.');
            setRestrictionInfo({
                ...restrictionInfo,
                appeal: payload.appeal ?? null,
                canAppeal: false,
                nextAppealAt: payload.nextAppealAt ?? null,
                remainingAppeals: payload.remainingAppeals ?? 0,
                appealCount: payload.appealCount ?? (restrictionInfo.appealCount ?? 0) + 1,
                appealsInCurrentCycle: payload.appealsInCurrentCycle ?? (restrictionInfo.appealsInCurrentCycle ?? 0) + 1,
                appealCycleReset: false,
            });
            setAppealDetails('');
            setAppealFile(null);
            setAppealSubject('Hesap kısıtlamasına itiraz');
            setMessage('İtirazınız alındı. Sonuç için 1-7 gün içinde bu ekrandan tekrar kontrol edin.');
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'İtiraz gönderilemedi.');
        } finally {
            setAppealBusy(false);
        }
    };

    return <>
        <main className="auth-shell ds-shell ds-auth-shell">
            <section className="auth-card ds-panel ds-auth-card">
                <div className="ds-auth-mark"><LockKeyhole size={21} /></div>
                <div className="auth-heading">
                    <span className="ds-eyebrow">TRADE ENGINE / HESAP GÜVENLİĞİ</span>
                    <h1>{mode === 'login' ? 'Araştırma alanına giriş yap.' : 'Kişisel araştırma alanını oluştur.'}</h1>
                    <p>Listelerin, favorilerin ve sanal portföyün hesabına özel olarak saklanır.</p>
                </div>
                <div className="auth-tabs">
                    <button type="button" className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}><LogIn size={15} /> Giriş yap</button>
                    <button type="button" className={mode === 'signup' ? 'active' : ''} onClick={() => setMode('signup')}><UserPlus size={15} /> Kayıt ol</button>
                </div>
                <form className="auth-form" onSubmit={submit}>
                    <label>E-posta<input type="email" value={email} onChange={(event) => { setEmail(event.target.value); setRestrictionInfo(null); }} autoComplete="email" required /></label>
                    <div className={`auth-password-grid ${mode === 'signup' && password.length > 0 ? 'has-confirmation' : ''}`}>
                        <label className="auth-password-field">Şifre
                            <input
                                type="password"
                                value={password}
                                onChange={(event) => setPassword(event.target.value)}
                                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                                required
                            />
                            {mode === 'signup' && passwordStrength && <span className="mt-2 block normal-case">
                                <span className="flex items-center justify-between text-[10px]">
                                    <span className="text-slate-400">Güvenlik düzeyi</span>
                                    <strong className={passwordStrength.color}>{passwordStrength.label}</strong>
                                </span>
                                <span className="mt-1 block h-1 overflow-hidden rounded-full bg-slate-700">
                                    <span className={`block h-full rounded-full transition-all ${passwordStrength.width} ${passwordStrength.label === 'Güçlü' ? 'bg-emerald-500' : passwordStrength.label === 'Orta' ? 'bg-amber-500' : 'bg-rose-500'}`} />
                                </span>
                                <span className="mt-1 block text-[10px] font-normal leading-4 text-slate-400">{passwordStrength.hint}</span>
                            </span>}
                        </label>
                        {mode === 'signup' && password.length > 0 && <label className="auth-password-field auth-confirm-field">Şifre tekrar
                            <input
                                type="password"
                                value={confirmPassword}
                                onChange={(event) => setConfirmPassword(event.target.value)}
                                autoComplete="new-password"
                                required
                            />
                            {confirmPassword.length > 0 && <span className={`mt-2 block text-[10px] font-normal normal-case ${passwordsMatch ? 'text-emerald-300' : 'text-rose-300'}`}>
                                {passwordsMatch ? 'Şifreler eşleşiyor.' : 'Şifreler eşleşmiyor.'}
                            </span>}
                        </label>}
                    </div>
                    {mode === 'login' && restrictionInfo?.restricted && restrictionInfo.restriction && <section className="space-y-3 rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-left">
                        <div><p className="text-sm font-bold text-rose-200">{restrictionInfo.restriction.type === 'closure' ? 'Hesabınız yönetici kararıyla kapatıldı.' : `Hesabınız ${new Date(restrictionInfo.restriction.endsAt ?? '').toLocaleString('tr-TR')} tarihine kadar donduruldu.`}</p>
                            <p className="mt-2 text-xs font-semibold text-slate-200">Neden: {restrictionInfo.restriction.reason}</p>
                            <p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-slate-300">{restrictionInfo.restriction.explanation}</p>
                        </div>
                        {restrictionInfo.appeal && <div className="rounded-lg border border-slate-700 bg-slate-900/70 p-3 text-xs">
                                <p className={restrictionInfo.appeal.status === 'approved' ? 'font-bold text-emerald-300' : restrictionInfo.appeal.status === 'pending' ? 'font-bold text-amber-300' : 'font-bold text-rose-300'}>Son itiraz: {restrictionInfo.appeal.status === 'approved' ? 'Kabul edildi' : restrictionInfo.appeal.status === 'pending' ? 'İncelemede' : restrictionInfo.appeal.status === 'superseded' ? 'Süresi doldu' : 'Reddedildi'}</p>
                                <p className="mt-1 font-semibold text-slate-200">{restrictionInfo.appeal.subject}</p>
                                <p className="mt-1 text-slate-400">Gönderildi: {new Date(restrictionInfo.appeal.created_at).toLocaleString('tr-TR')}</p>
                                {restrictionInfo.appeal.admin_note && <p className="mt-1 whitespace-pre-wrap text-slate-300"><strong className="text-slate-200">Yönetici mesajı:</strong> {restrictionInfo.appeal.admin_note}</p>}
                                {restrictionInfo.appeal.attachment_url && <a href={restrictionInfo.appeal.attachment_url} target="_blank" rel="noreferrer" className="mt-2 inline-block text-emerald-300 underline">Ekli görseli görüntüle</a>}
                            </div>}
                        {restrictionInfo.appeal && ['pending', 'reviewing'].includes(restrictionInfo.appeal.status)
                                ? <p className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-xs leading-5 text-amber-200">İtirazınız incelemede. Sonuç için 1-7 gün içinde tekrar kontrol edin. İnceleme tamamlanana kadar yeni itiraz gönderemezsiniz; sonuç kararına göre yeniden başvuru hakkınız ve tarihi belirlenecektir.</p>
                                : !restrictionInfo.canAppeal && restrictionInfo.appeal?.status === 'rejected' && restrictionInfo.nextAppealAt
                                    ? <p className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-xs leading-5 text-amber-200">İkinci itirazınız reddedildi. Yeni bir itiraz döneminin başlaması için <strong>{new Date(restrictionInfo.nextAppealAt).toLocaleString('tr-TR')}</strong> tarihine kadar beklemeniz gerekiyor. Bu tarihten sonra haklarınız yeniden sıfırlanır.</p>
                                    : restrictionInfo.appealCycleReset
                                        ? <p className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3 text-xs leading-5 text-emerald-200">7 günlük bekleme süresi tamamlandı. Yeni itiraz döneminiz başladı; yeniden başvurabilirsiniz.</p>
                                        : restrictionInfo.appeal?.status === 'rejected' && restrictionInfo.canAppeal && restrictionInfo.appealsInCurrentCycle === 1
                                            ? <p className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-xs leading-5 text-amber-200">İlk itirazınız reddedildi. Bu kısıtlama için tanımlanan ikinci ve son itiraz hakkınızı şimdi kullanabilirsiniz.</p>
                                            : restrictionInfo.remainingAppeals === 0
                                                ? <p className="rounded-lg border border-rose-500/20 bg-rose-500/10 p-3 text-xs leading-5 text-rose-200">Bu itiraz dönemindeki haklarınızı kullandınız.</p>
                                                : null}
                        {restrictionInfo.canAppeal
                            ? <div className="space-y-2">
                                    <p className="text-[11px] leading-5 text-slate-300">{restrictionInfo.appealCycleReset ? 'Yeni itiraz döneminde bir itiraz hakkınız var.' : restrictionInfo.appeal?.status === 'rejected' ? `Kalan itiraz hakkınız: ${restrictionInfo.remainingAppeals ?? 1}.` : restrictionInfo.appeal ? 'Önceki itirazınızın sonucu dikkate alınarak hakkınız belirlenir.' : 'İlk itiraz hakkınızı kullanabilirsiniz. İlk itiraz reddedilirse bir ek hak tanımlanır.'} İnceleme genellikle 1-7 gün sürer.</p>
                                <label className="block text-[11px] font-semibold text-slate-300">Konu
                                    <input required minLength={3} maxLength={120} value={appealSubject} onChange={(event) => setAppealSubject(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-xs text-white" />
                                    <span className="mt-1 block text-right text-[10px] text-slate-500">{appealSubject.length}/120</span>
                                </label>
                                <label className="block text-[11px] font-semibold text-slate-300">İtiraz açıklaması
                                    <textarea required minLength={20} maxLength={1000} rows={4} value={appealDetails} onChange={(event) => setAppealDetails(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-xs text-white" placeholder="Karara neden itiraz ettiğinizi açıklayın (20-1000 karakter)." />
                                    <span className="mt-1 block text-right text-[10px] text-slate-500">{appealDetails.length}/1000</span>
                                </label>
                                <label className="block text-[11px] font-semibold text-slate-300"><span className="mb-1 flex items-center gap-1.5"><ImagePlus size={13} />İsteğe bağlı görsel (en fazla 5 MB)</span><input type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={(event) => setAppealFile(event.target.files?.[0] ?? null)} className="block w-full text-[10px] text-slate-400 file:mr-2 file:rounded-lg file:border file:border-slate-700 file:bg-slate-800 file:px-2.5 file:py-1.5 file:text-[10px] file:font-bold file:text-slate-200" /></label>
                                {appealFile && <p className="truncate text-[10px] text-slate-400">{appealFile.name}</p>}
                                <button type="button" onClick={() => void submitAccountAppeal()} disabled={appealBusy} className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-xs font-bold text-amber-200 disabled:opacity-50">{appealBusy ? 'Gönderiliyor...' : 'Hesap kararına itiraz et'}</button>
                            </div>
                            : null}
                    </section>}
                    {mode === 'signup' && <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-700 bg-slate-800/70 p-3 text-xs">
                        <p className={termsAccepted ? 'text-emerald-300' : 'text-slate-300'}>
                            {termsAccepted ? `${TERMS_ITEMS.length}/${TERMS_ITEMS.length} madde kabul edildi` : 'Kayıt için şart maddelerini sırayla inceleyip kabul et.'}
                        </p>
                        <button
                            type="button"
                            onClick={() => {
                                const firstUnaccepted = acceptedTerms.findIndex((accepted) => !accepted);
                                setTermsIndex(firstUnaccepted === -1 ? 0 : firstUnaccepted);
                                setTermsStepChecked(false);
                                setTermsOpen(true);
                            }}
                            className="shrink-0 font-semibold text-emerald-300 underline decoration-emerald-500/40 underline-offset-2 hover:text-emerald-200"
                        >
                            {termsAccepted ? 'Şartları görüntüle' : 'Şartları incele'}
                        </button>
                    </div>}
                    <button
                        className="primary-button ds-primary-button auth-submit disabled:cursor-not-allowed disabled:opacity-50"
                        disabled={busy || (mode === 'signup' && !termsAccepted)}
                    >
                        {busy ? 'İşleniyor...' : mode === 'login' ? 'Giriş yap' : 'Hesap oluştur'}<ArrowRight size={15} />
                    </button>
                </form>
                {message && <div role="status" aria-live="polite" className="mt-4 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-xs leading-5 text-emerald-200">
                    {message}
                    {signupEmailSent && <button
                        type="button"
                        onClick={() => {
                            setMode('login');
                            setMessage('');
                            setSignupEmailSent(false);
                            setPassword('');
                            setConfirmPassword('');
                            setAcceptedTerms(TERMS_ITEMS.map(() => false));
                        }}
                        className="mt-3 block rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white transition hover:bg-emerald-500"
                    >
                        Tamam
                    </button>}
                </div>}
                <span className="auth-note"><ShieldCheck size={14} /> E-posta doğrulaması hesabını korur ve Supabase Auth tarafından yönetilir.</span>
            </section>
        </main>
        {termsOpen && <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/80 p-3 backdrop-blur-sm sm:p-6"
            onClick={() => setTermsOpen(false)}
        >
            <section
                role="dialog"
                aria-modal="true"
                aria-labelledby="terms-dialog-title"
                className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl"
                onClick={(event) => event.stopPropagation()}
            >
                <header className="flex items-start justify-between gap-4 border-b border-slate-800 p-5 sm:p-6">
                    <div>
                        <span className="text-[10px] font-bold tracking-[.16em] text-emerald-400">TRADE ENGINE / TOPLULUK</span>
                        <h2 id="terms-dialog-title" className="mt-1 text-xl font-extrabold text-white">Kullanım Şartları ve Topluluk Kuralları</h2>
                        <p className="mt-1 text-xs text-slate-400">Her maddeyi sırayla okuyup ayrı ayrı onaylamalısın.</p>
                    </div>
                    <button type="button" onClick={() => setTermsOpen(false)} aria-label="Şartları kapat" className="rounded-lg border border-slate-700 bg-slate-800 p-2 text-slate-300 hover:text-white"><X size={16} /></button>
                </header>
                <div className="overflow-y-auto p-5 text-sm leading-6 text-slate-300 sm:p-6">
                    <div className="mb-5 flex items-center justify-between text-xs font-semibold text-slate-400">
                        <span>Madde {termsIndex + 1} / {TERMS_ITEMS.length}</span>
                        <span>{acceptedTerms.filter(Boolean).length} / {TERMS_ITEMS.length} kabul edildi</span>
                    </div>
                    <div className="mb-6 h-1.5 overflow-hidden rounded-full bg-slate-800">
                        <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${((termsIndex + 1) / TERMS_ITEMS.length) * 100}%` }} />
                    </div>
                    <section className="min-h-44 rounded-xl border border-slate-700 bg-slate-950/60 p-4 sm:p-5">
                        <h3 className="font-bold text-white">{termsIndex + 1}. {TERMS_ITEMS[termsIndex].title}</h3>
                        <p className="mt-2">{TERMS_ITEMS[termsIndex].text}</p>
                    </section>
                    <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-xl border border-slate-700 bg-slate-800/70 p-4 text-xs leading-5 text-slate-200">
                        <input
                            type="checkbox"
                            checked={acceptedTerms[termsIndex] || termsStepChecked}
                            disabled={acceptedTerms[termsIndex]}
                            onChange={(event) => setTermsStepChecked(event.target.checked)}
                            className="mt-1 h-4 w-4 shrink-0 accent-emerald-500"
                        />
                        <span>Bu maddeyi okudum ve kabul ediyorum.</span>
                    </label>
                </div>
                <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 p-4 sm:px-6">
                    <button
                        type="button"
                        disabled={termsIndex === 0}
                        onClick={() => { setTermsIndex((index) => Math.max(0, index - 1)); setTermsStepChecked(false); }}
                        className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-2.5 text-xs font-bold text-slate-200 transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                        Önceki madde
                    </button>
                    <button
                        type="button"
                        disabled={!acceptedTerms[termsIndex] && !termsStepChecked}
                        onClick={() => {
                            const nextAccepted = acceptedTerms.map((accepted, index) => index === termsIndex ? true : accepted);
                            setAcceptedTerms(nextAccepted);
                            setTermsStepChecked(false);
                            if (termsIndex === TERMS_ITEMS.length - 1) {
                                setTermsOpen(false);
                            } else {
                                setTermsIndex((index) => index + 1);
                            }
                        }}
                        className="rounded-lg bg-emerald-600 px-5 py-2.5 text-xs font-bold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                        {termsIndex === TERMS_ITEMS.length - 1 ? 'Tüm şartları kabul et' : 'Kabul et ve devam et'}
                    </button>
                </footer>
            </section>
        </div>}
    </>;
}
