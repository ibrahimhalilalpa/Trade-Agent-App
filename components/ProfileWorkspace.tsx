'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { getSupabaseBrowserClient } from '@/lib/supabase-browser';
import { getAuthRedirectUrl } from '@/lib/app-url';
import { translateAuthError } from '@/lib/auth-errors';
import { User, ShieldCheck, Activity, KeyRound, CheckCircle2, AlertCircle, Award, Eye, EyeOff, Trash2, Snowflake, ChevronDown } from 'lucide-react';
import { toast } from 'react-toastify';
import WalletBalanceCard from '@/components/WalletBalanceCard';
import SocialProfileSettings from '@/components/SocialProfileSettings';

type ProfileData = {
    email: string;
    accountCreatedAt: string;
    lastSignInAt: string | null;
    emailVerifiedAt: string | null;
    profile: { full_name: string; username: string; display_name: string; bio: string; leaderboard_visible: boolean; leaderboard_gain_visible: boolean; updated_at: string | null };
    role: string;
    rank: { xp: number; rank: string; nextRankXp: number; rankProgress: number; completedLessons: number; activeDays: number; pnlPercent: number };
    leaderboardRank: number | null;
    activity: Array<{ id: string; event_type: string; description: string; created_at: string }>;
};
type AccountFreezeRequest = {
    requested_at: string;
    unfreeze_at: string;
    delete_after: string;
};

interface ProfileWorkspaceProps {
    recoveryMode?: boolean;
}

const EVENT_LABELS: Record<string, string> = {
    login: 'Giriş',
    logout: 'Çıkış',
    profile_updated: 'Bilgi güncellendi',
    password_changed: 'Parola güncellendi',
    password_failed: 'Hatalı parola denemesi',
    password_reset_requested: 'Parola sıfırlama istendi',
    account_freeze_requested: 'Hesap dondurma planlandı',
    account_reactivated: 'Hesap yeniden etkinleştirildi',
    account_deletion_requested: 'Hesap silme istendi',
    admin_account_status: 'Hesap erişim yönetimi',
};
const ROLE_LABELS: Record<string, string> = {
    user: 'Standart yatırımcı',
    pro_trader: 'Pro Trader',
    analyst: 'Analist',
    admin: 'Admin',
    super_admin: 'Super Admin',
};

function dateLabel(value: string | null): string {
    if (!value) return 'Henüz yok';
    return new Date(value).toLocaleString('tr-TR', { dateStyle: 'medium', timeStyle: 'short' });
}

export default function ProfileWorkspace({ recoveryMode = false }: ProfileWorkspaceProps) {
    const [data, setData] = useState<ProfileData | null>(null);
    const [fullName, setFullName] = useState('');
    const [username, setUsername] = useState('');
    const [bio, setBio] = useState('');
    const [leaderboardVisible, setLeaderboardVisible] = useState(true);
    const [leaderboardGainVisible, setLeaderboardGainVisible] = useState(true);
    const [visibilitySaving, setVisibilitySaving] = useState(false);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');

    // Parola State'leri
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [passwordSaving, setPasswordSaving] = useState(false);
    const [passwordResetBusy, setPasswordResetBusy] = useState(false);
    const [passwordMessage, setPasswordMessage] = useState('');
    const [passwordError, setPasswordError] = useState('');
    const [freezeRequest, setFreezeRequest] = useState<AccountFreezeRequest | null>(null);
    const [freezeDays, setFreezeDays] = useState(7);
    const [accountPassword, setAccountPassword] = useState('');
    const [deleteConfirmation, setDeleteConfirmation] = useState('');
    const [accountActionBusy, setAccountActionBusy] = useState(false);
    const [accountActionError, setAccountActionError] = useState('');
    const [accountControlsOpen, setAccountControlsOpen] = useState(false);

    const refreshActivity = useCallback(async () => {
        try {
            const response = await fetch('/api/profile', { cache: 'no-store' });
            const payload = await response.json() as { data?: ProfileData; error?: string };
            if (!response.ok || !payload.data) throw new Error(payload.error ?? 'Hareketler yenilenemedi.');
            const activity = payload.data.activity;
            setData((previous) => previous ? { ...previous, activity } : previous);
        } catch (cause) {
            console.error('Profile activity could not be refreshed after community profile update.', cause);
            toast.warning('Profil değişiklikleri kaydedildi ancak Son Hareketler yenilenemedi. Sayfayı yenileyerek tekrar deneyin.');
        }
    }, []);

    useEffect(() => {
        let active = true;
        void fetch('/api/profile', { cache: 'no-store' })
            .then(async (response) => {
                const payload = (await response.json()) as { data?: ProfileData; error?: string };
                if (!active) return;
                if (!response.ok || !payload.data) {
                    setError(payload.error ?? 'Profil yüklenemedi.');
                    return;
                }
                setData(payload.data);
                setFullName(payload.data.profile.full_name || '');
                setUsername(payload.data.profile.username || payload.data.profile.display_name || '');
                setBio(payload.data.profile.bio || '');
                setLeaderboardVisible(payload.data.profile.leaderboard_visible);
                setLeaderboardGainVisible(payload.data.profile.leaderboard_gain_visible);
                const accountResponse = await fetch('/api/profile/account', { cache: 'no-store' });
                const accountPayload = await accountResponse.json() as { data?: AccountFreezeRequest | null; error?: string };
                if (!accountResponse.ok) {
                    setAccountActionError(accountPayload.error ?? 'Hesap durumu yüklenemedi.');
                } else {
                    setFreezeRequest(accountPayload.data ?? null);
                }
            })
            .catch(() => {
                if (active) setError('Profil servisine ulaşılamadı.');
            })
            .finally(() => {
                if (active) setLoading(false);
            });
        return () => {
            active = false;
        };
    }, []);

    useEffect(() => {
        if (message) toast.success(message);
    }, [message]);

    useEffect(() => {
        if (error && data) toast.error(error);
    }, [error, data]);

    useEffect(() => {
        if (passwordMessage) toast.success(passwordMessage);
    }, [passwordMessage]);

    useEffect(() => {
        if (passwordError) toast.error(passwordError);
    }, [passwordError]);

    const save = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setSaving(true);
        setMessage('');
        setError('');
        try {
            const response = await fetch('/api/profile', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ fullName, username, bio, leaderboardVisible, leaderboardGainVisible }),
            });
            const payload = (await response.json()) as { data?: ProfileData['profile']; error?: string };
            if (!response.ok || !payload.data) {
                setError(payload.error ?? 'Profil kaydedilemedi.');
                return;
            }
            const refreshed = (await fetch('/api/profile', { cache: 'no-store' }).then((res) => res.json())) as { data?: ProfileData };
            if (refreshed.data) setData(refreshed.data);
            setLeaderboardVisible(refreshed.data?.profile.leaderboard_visible ?? leaderboardVisible);
            setLeaderboardGainVisible(refreshed.data?.profile.leaderboard_gain_visible ?? leaderboardGainVisible);
            setMessage('Profil bilgilerin başarıyla güncellendi.');
        } catch {
            setError('Profil kaydedilemedi.');
        } finally {
            setSaving(false);
        }
    };

    const saveLeaderboardVisibility = async (visible: boolean) => {
        setVisibilitySaving(true);
        setError('');
        setMessage('');
        try {
            const response = await fetch('/api/profile', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ leaderboardVisible: visible }),
            });
            const payload = await response.json() as { data?: ProfileData['profile']; error?: string; warning?: string };
            if (!response.ok || !payload.data) throw new Error(payload.error ?? 'Görünürlük ayarı kaydedilemedi.');
            const updatedProfile = payload.data;
            setLeaderboardVisible(updatedProfile.leaderboard_visible);
            setData((previous) => previous ? { ...previous, profile: { ...previous.profile, ...updatedProfile } } : previous);
            if (payload.warning) toast.warning(`Ayar kaydedildi, hareket günlüğüne yazılamadı. ${payload.warning}`);
            else toast.success('Liderlik tablosu görünürlüğü güncellendi.');
        } catch (cause) {
            toast.error(`Görünürlük ayarı kaydedilemedi. ${cause instanceof Error ? cause.message : 'Lütfen tekrar deneyin.'}`);
        } finally {
            setVisibilitySaving(false);
        }
    };

    const saveLeaderboardGainVisibility = async (visible: boolean) => {
        setVisibilitySaving(true);
        setError('');
        setMessage('');
        try {
            const response = await fetch('/api/profile', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ leaderboardGainVisible: visible }),
            });
            const payload = await response.json() as { data?: ProfileData['profile']; error?: string; warning?: string };
            if (!response.ok || !payload.data) throw new Error(payload.error ?? 'Kazanç görünürlüğü kaydedilemedi.');
            const updatedProfile = payload.data;
            setLeaderboardGainVisible(updatedProfile.leaderboard_gain_visible);
            setData((previous) => previous ? { ...previous, profile: { ...previous.profile, ...updatedProfile } } : previous);
            if (payload.warning) toast.warning(`Ayar kaydedildi, hareket günlüğüne yazılamadı. ${payload.warning}`);
            else toast.success('Kazanç tutarı paylaşım tercihi güncellendi.');
        } catch (cause) {
            toast.error(`Kazanç görünürlüğü kaydedilemedi. ${cause instanceof Error ? cause.message : 'Lütfen tekrar deneyin.'}`);
        } finally {
            setVisibilitySaving(false);
        }
    };

    const changePassword = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setPasswordSaving(true);
        setPasswordMessage('');
        setPasswordError('');

        if (!data?.email) {
            setPasswordError('Hesap e-postası doğrulanamadı.');
            setPasswordSaving(false);
            return;
        }
        if (newPassword.length < 8 || !/[A-Za-z]/.test(newPassword) || !/\d/.test(newPassword)) {
            setPasswordError('Yeni parola en az 8 karakter, bir harf ve bir rakam içermelidir.');
            setPasswordSaving(false);
            return;
        }
        if (newPassword !== confirmPassword) {
            setPasswordError('Yeni parola ve parola tekrarı eşleşmiyor.');
            setPasswordSaving(false);
            return;
        }

        const client = getSupabaseBrowserClient();
        if (!client) {
            setPasswordError('Supabase bağlantısı yapılandırılmamış.');
            setPasswordSaving(false);
            return;
        }

        try {
            if (!recoveryMode) {
                const verification = await client.auth.signInWithPassword({ email: data.email, password: currentPassword });
                if (verification.error) {
                    const activityResponse = await fetch('/api/profile/activity', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ eventType: 'password_failed' }),
                    });
                    if (!activityResponse.ok) console.error('Failed password attempt could not be recorded.', activityResponse.status);
                    setPasswordError('Mevcut parola hatalı.');
                    return;
                }
            }
            const update = await client.auth.updateUser({ password: newPassword });
            if (update.error) {
                setPasswordError(translateAuthError(update.error, 'Parola güncellenemedi. Lütfen tekrar deneyin.'));
                return;
            }
            await fetch('/api/profile/activity', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ eventType: 'password_changed' }),
            });
            setCurrentPassword('');
            setNewPassword('');
            setConfirmPassword('');
            setPasswordMessage('Parolanız başarıyla değiştirildi.');
            if (recoveryMode) window.history.replaceState({}, '', '/profile');
            const refreshed = (await fetch('/api/profile', { cache: 'no-store' }).then((res) => res.json())) as { data?: ProfileData };
            if (refreshed.data) setData(refreshed.data);
        } catch {
            setPasswordError('Parola güncellenemedi. Lütfen tekrar deneyin.');
        } finally {
            setPasswordSaving(false);
        }
    };

    const requestPasswordReset = async () => {
        if (!data?.email || passwordResetBusy) return;
        const client = getSupabaseBrowserClient();
        if (!client) {
            setPasswordError('Supabase bağlantısı yapılandırılmamış.');
            return;
        }
        setPasswordResetBusy(true);
        setPasswordMessage('');
        setPasswordError('');
        try {
            const { error: resetError } = await client.auth.resetPasswordForEmail(data.email, {
                redirectTo: `${getAuthRedirectUrl('/auth/callback')}?next=${encodeURIComponent('/profile?recovery=1')}`,
            });
            if (resetError) throw resetError;
            const activityResponse = await fetch('/api/profile/activity', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ eventType: 'password_reset_requested' }),
            });
            if (!activityResponse.ok) {
                setPasswordError('Sıfırlama e-postası gönderildi ancak hesap hareketi kaydedilemedi.');
                return;
            }
            setPasswordMessage('Parola sıfırlama bağlantısı e-posta adresinize gönderildi.');
        } catch (cause) {
            setPasswordError(translateAuthError(cause instanceof Error ? cause.message : undefined, 'Parola sıfırlama bağlantısı gönderilemedi.'));
        } finally {
            setPasswordResetBusy(false);
        }
    };

    const submitAccountAction = async (action: 'freeze' | 'delete') => {
        setAccountActionBusy(true);
        setAccountActionError('');
        try {
            const response = await fetch('/api/profile/account', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action,
                    days: freezeDays,
                    password: accountPassword,
                    confirmation: deleteConfirmation,
                }),
            });
            const payload = await response.json() as { error?: string; data?: AccountFreezeRequest | null };
            if (!response.ok) throw new Error(payload.error ?? 'Hesap işlemi tamamlanamadı.');
            if (action === 'delete') {
                setAccountPassword('');
                setDeleteConfirmation('');
                toast.success('Hesap silme doğrulama e-postası gönderildi. Hesabınız e-postadaki bağlantıyı açana kadar silinmez.');
                return;
            }
            setFreezeRequest(payload.data ?? null);
            setAccountPassword('');
            const client = getSupabaseBrowserClient();
            if (client) await client.auth.signOut({ scope: 'local' });
            window.location.replace('/auth?accountFrozen=1');
        } catch (cause) {
            setAccountActionError(cause instanceof Error ? cause.message : 'Hesap işlemi tamamlanamadı.');
        } finally {
            setAccountActionBusy(false);
        }
    };

    const cancelFreezeRequest = async () => {
        setAccountActionBusy(true);
        setAccountActionError('');
        try {
            const response = await fetch('/api/profile/account', { method: 'DELETE' });
            const payload = await response.json() as { error?: string };
            if (!response.ok) throw new Error(payload.error ?? 'Dondurma isteği iptal edilemedi.');
            setFreezeRequest(null);
            toast.success('Hesabınız yeniden etkinleştirildi; kalıcı silme isteği iptal edildi.');
        } catch (cause) {
            setAccountActionError(cause instanceof Error ? cause.message : 'Dondurma isteği iptal edilemedi.');
        } finally {
            setAccountActionBusy(false);
        }
    };

    const isMinLength = newPassword.length >= 8;
    const hasLetter = /[A-Za-z]/.test(newPassword);
    const hasNumber = /\d/.test(newPassword);
    const isMatch = newPassword && newPassword === confirmPassword;
    const rankPanel = <section className="profile-rank-panel space-y-4 rounded-2xl border border-emerald-500/20 bg-slate-900 p-6 shadow-xl">
        <div className="flex items-start justify-between gap-3">
            <div><span className="text-[10px] font-bold tracking-widest text-emerald-400">TRADER RANK</span><h2 className="mt-1 flex items-center gap-2 text-xl font-extrabold text-white"><Award className="h-5 w-5 text-amber-300" />{data?.rank.rank}</h2></div>
            <span className="rounded-full border border-slate-700 bg-slate-800 px-3 py-1 text-xs font-semibold text-slate-200">{data ? ROLE_LABELS[data.role] ?? data.role : ''}</span>
        </div>
        {data && <>
            <div className="flex justify-between text-xs"><span className="font-semibold text-slate-200">{data.rank.xp.toLocaleString('tr-TR')} XP</span><span className="text-slate-500">{data.rank.rank === 'Piyasa Yapıcı' ? 'En üst seviye' : `Sonraki seviye: ${data.rank.nextRankXp.toLocaleString('tr-TR')} XP`}</span></div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-800"><div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${Math.min(100, Math.max(0, data.rank.rankProgress))}%` }} /></div>
            <div className="grid grid-cols-2 gap-2 text-center text-[10px] sm:grid-cols-4">
                <div className="rounded-lg bg-slate-950/70 p-2"><strong className="block text-white">{data.rank.completedLessons}</strong><span className="text-slate-500">Tamamlanan ders</span></div>
                <div className="rounded-lg bg-slate-950/70 p-2"><strong className="block text-white">{data.rank.activeDays}</strong><span className="text-slate-500">Aktif gün</span></div>
                <div className="rounded-lg bg-slate-950/70 p-2"><strong className={data.rank.pnlPercent >= 0 ? 'block text-emerald-300' : 'block text-rose-300'}>{data.rank.pnlPercent.toFixed(2)}%</strong><span className="text-slate-500">Getiri</span></div>
                <div className="rounded-lg bg-slate-950/70 p-2"><strong className="block text-white">{leaderboardVisible ? (data.leaderboardRank ? `#${data.leaderboardRank}` : '—') : 'Gizli'}</strong><span className="text-slate-500">Liderlik sırası</span></div>
            </div>
            <div className="space-y-3 border-t border-slate-800 pt-4">
                <div><h3 className="text-xs font-bold text-white">İzinler ve görünürlük</h3><p className="mt-1 text-[10px] text-slate-500">Liderlik paylaşım tercihlerini ve topluluk profilinin görünürlüğünü yönet.</p></div>
                <div className="flex items-center justify-between gap-4 rounded-xl border border-slate-800 bg-slate-950/40 p-4">
                    <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                            {leaderboardVisible ? <Eye className="h-4 w-4 text-emerald-400" /> : <EyeOff className="h-4 w-4 text-slate-500" />}
                            <p className="text-xs font-semibold text-slate-200">Liderlik tablosunda görün</p>
                            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${leaderboardVisible ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300' : 'border-slate-700 bg-slate-800 text-slate-400'}`}>{leaderboardVisible ? 'Açık' : 'Kapalı'}</span>
                        </div>
                        <p className="mt-1.5 text-[11px] leading-4 text-slate-500">Getiri yüzdesi ve trader rütben gösterilir. Bakiye ve e-posta paylaşılmaz.</p>
                    </div>
                    <button type="button" role="switch" aria-checked={leaderboardVisible} aria-label="Liderlik tablosunda görünürlük" disabled={visibilitySaving} onClick={() => void saveLeaderboardVisibility(!leaderboardVisible)}
                        className={`relative h-6 w-11 shrink-0 rounded-full transition disabled:cursor-not-allowed disabled:opacity-50 ${leaderboardVisible ? 'bg-emerald-600' : 'bg-slate-700'}`}>
                        <span className={`absolute top-1 h-4 w-4 rounded-full bg-white transition-all ${leaderboardVisible ? 'left-6' : 'left-1'}`} />
                    </button>
                </div>
                <div className={`flex items-center justify-between gap-4 rounded-xl border border-slate-800 bg-slate-950/40 p-4 transition-opacity ${leaderboardVisible ? '' : 'opacity-70'}`}>
                    <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                            <p className="text-xs font-semibold text-slate-200">Dönem kazanç tutarını TL olarak paylaş</p>
                            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${leaderboardGainVisible ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300' : 'border-slate-700 bg-slate-800 text-slate-400'}`}>{leaderboardGainVisible ? 'Açık' : 'Kapalı'}</span>
                        </div>
                        <p className="mt-1.5 text-[11px] leading-4 text-slate-500">Ayrı ve isteğe bağlı izindir. Liderlik görünürlüğün kapalıyken kazanç tutarı gösterilmez.</p>
                    </div>
                    <button type="button" role="switch" aria-checked={leaderboardGainVisible} aria-label="Dönem kazanç tutarını liderlik tablosunda göster" disabled={visibilitySaving || !leaderboardVisible} onClick={() => void saveLeaderboardGainVisibility(!leaderboardGainVisible)}
                        className={`relative h-6 w-11 shrink-0 rounded-full transition disabled:cursor-not-allowed disabled:opacity-50 ${leaderboardGainVisible ? 'bg-emerald-600' : 'bg-slate-700'}`}>
                        <span className={`absolute top-1 h-4 w-4 rounded-full bg-white transition-all ${leaderboardGainVisible ? 'left-6' : 'left-1'}`} />
                    </button>
                </div>
            </div>
            <div className="border-t border-slate-800 pt-4"><SocialProfileSettings onSaved={refreshActivity} /></div>
        </>}
    </section>;

    return (
        <main className="min-h-screen bg-slate-950 text-slate-100 p-4 md:p-8">
            <div className="max-w-7xl mx-auto space-y-8">

                {/* HEADER */}
                <header className="border-b border-slate-800 pb-6">
                    <span className="text-xs font-bold tracking-widest text-emerald-400 uppercase block mb-1">
                        HESAP MERKEZİ
                    </span>
                    <h1 className="text-3xl font-extrabold text-white flex items-center gap-3">
                        <User className="w-8 h-8 text-emerald-400" />
                        Profil ve Hesap Güvenliği
                    </h1>
                    <p className="text-slate-400 text-sm mt-1">
                        Kişisel bilgilerinizi güncelleyin, şifrenizi yenileyin ve hesap hareketlerinizi takip edin.
                    </p>
                </header>

                {loading && (
                    <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center text-slate-400 animate-pulse">
                        Hesap bilgileri yükleniyor...
                    </div>
                )}

                {error && !data && (
                    <div className="bg-rose-500/10 border border-rose-500/30 text-rose-400 p-4 rounded-xl flex items-center gap-2">
                        <AlertCircle className="w-5 h-5" />
                        <span>{error}</span>
                    </div>
                )}

                {data && (
                    <div className="profile-workspace-grid">
                        <div className="profile-workspace-column">

                            {/* PROFİL FORM */}
                            <section className="profile-personal-panel bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-6">
                                <div className="flex justify-between items-center border-b border-slate-800 pb-4">
                                    <div>
                                        <span className="text-xs font-semibold text-slate-400 block">KİŞİSEL BİLGİLER</span>
                                        <h2 className="text-lg font-bold text-white">Profil Detayları</h2>
                                    </div>
                                    <span className={`px-3 py-1 rounded-full text-xs font-semibold ${data.emailVerifiedAt ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                                        }`}>
                                        {data.emailVerifiedAt ? 'Doğrulanmış Hesap' : 'E-posta Doğrulaması Bekliyor'}
                                    </span>
                                </div>

                                <form onSubmit={save} className="space-y-4">
                                    <div>
                                        <label className="text-xs font-medium text-slate-400 block mb-1">E-posta Adresi</label>
                                        <input
                                            type="email"
                                            value={data.email}
                                            readOnly
                                            className="w-full bg-slate-800/50 border border-slate-700/60 rounded-lg px-3.5 py-2.5 text-slate-400 text-sm cursor-not-allowed focus:outline-none"
                                        />
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div>
                                            <label className="text-xs font-medium text-slate-300 block mb-1">Ad Soyad</label>
                                            <input
                                                value={fullName}
                                                onChange={(e) => setFullName(e.target.value)}
                                                maxLength={120}
                                                placeholder="Adınız ve Soyadınız"
                                                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3.5 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                                            />
                                        </div>
                                        <div>
                                            <label className="text-xs font-medium text-slate-300 block mb-1">Kullanıcı adı</label>
                                            <input
                                                value={username}
                                                onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                                                minLength={3}
                                                maxLength={24}
                                                pattern="[a-z][a-z0-9_]{2,23}"
                                                required
                                                autoComplete="username"
                                                placeholder="ornek_kullanici"
                                                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3.5 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                                            />
                                            <p className="mt-1 text-xs text-slate-500">3–24 karakter; küçük harf, rakam ve alt çizgi. İlk karakter harf olmalı ve kullanıcı adı benzersizdir.</p>
                                        </div>
                                    </div>

                                    <div>
                                        <div className="flex justify-between items-center mb-1">
                                            <label className="text-xs font-medium text-slate-300">Kısa Biyografi</label>
                                            <span className="text-xs text-slate-500">{bio.length}/280</span>
                                        </div>
                                        <textarea
                                            value={bio}
                                            onChange={(e) => setBio(e.target.value)}
                                            maxLength={280}
                                            rows={3}
                                            placeholder="Araştırma yaklaşımınız veya BİST stratejiniz..."
                                            className="w-full bg-slate-800 border border-slate-700 rounded-lg p-3 text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50 resize-none"
                                        />
                                    </div>

                                    <div className="profile-save-row flex justify-between items-center pt-2">
                                        <div className="profile-save-feedback">
                                        </div>
                                        <button
                                            type="submit"
                                            disabled={saving}
                                            className="profile-save-button bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-bold px-5 py-2.5 rounded-lg transition cursor-pointer shadow-lg shadow-emerald-900/20"
                                        >
                                            {saving ? 'Kaydediliyor...' : 'Profil Değişikliklerini Kaydet'}
                                        </button>
                                    </div>
                                </form>
                            </section>

                            {/* YENİLENMİŞ PAROLA VE GÜVENLİK ALANI */}
                            <section className="profile-security-panel bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-6">
                                <div className="flex items-center gap-3 border-b border-slate-800 pb-4">
                                    <div className="p-2 bg-emerald-500/10 rounded-lg text-emerald-400">
                                        <KeyRound className="w-5 h-5" />
                                    </div>
                                    <div>
                                        <h2 className="text-lg font-bold text-white">Parola & Güvenlik</h2>
                                        <p className="text-xs text-slate-400">Hesap güvenliğiniz için şifrenizi düzenli aralıklarla değiştirin.</p>
                                    </div>
                                </div>
                                <form onSubmit={changePassword} className="space-y-5">
                                    {!recoveryMode && <div>
                                        <label className="text-xs font-medium text-slate-300 block mb-1.5">Mevcut Parola</label>
                                        <input
                                            type="password"
                                            value={currentPassword}
                                            onChange={(e) => setCurrentPassword(e.target.value)}
                                            autoComplete="current-password"
                                            placeholder="••••••••"
                                            required
                                            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3.5 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                                        />
                                    </div>}

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div>
                                            <label className="text-xs font-medium text-slate-300 block mb-1.5">Yeni Parola</label>
                                            <input
                                                type="password"
                                                value={newPassword}
                                                onChange={(e) => setNewPassword(e.target.value)}
                                                autoComplete="new-password"
                                                minLength={8}
                                                placeholder="••••••••"
                                                required
                                                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3.5 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                                            />
                                        </div>
                                        <div>
                                            <label className="text-xs font-medium text-slate-300 block mb-1.5">Yeni Parola Tekrarı</label>
                                            <input
                                                type="password"
                                                value={confirmPassword}
                                                onChange={(e) => setConfirmPassword(e.target.value)}
                                                autoComplete="new-password"
                                                minLength={8}
                                                placeholder="••••••••"
                                                required
                                                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3.5 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                                            />
                                        </div>
                                    </div>

                                    {/* DİNAMİK PAROLA REHBERİ ROZETLERİ */}
                                    <div className="bg-slate-950/60 p-3.5 rounded-xl border border-slate-800/80 grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px]">
                                        <div className={`flex items-center gap-1.5 ${isMinLength ? 'text-emerald-400' : 'text-slate-500'}`}>
                                            <CheckCircle2 className="w-3.5 h-3.5" /> En az 8 Karakter
                                        </div>
                                        <div className={`flex items-center gap-1.5 ${hasLetter ? 'text-emerald-400' : 'text-slate-500'}`}>
                                            <CheckCircle2 className="w-3.5 h-3.5" /> En az 1 Harf
                                        </div>
                                        <div className={`flex items-center gap-1.5 ${hasNumber ? 'text-emerald-400' : 'text-slate-500'}`}>
                                            <CheckCircle2 className="w-3.5 h-3.5" /> En az 1 Rakam
                                        </div>
                                        <div className={`flex items-center gap-1.5 ${isMatch ? 'text-emerald-400' : 'text-slate-500'}`}>
                                            <CheckCircle2 className="w-3.5 h-3.5" /> Parolalar Eşleşiyor
                                        </div>
                                    </div>

                                    <div className="flex justify-between items-center pt-2">
                                        <button
                                            type="submit"
                                            disabled={passwordSaving}
                                            className="ml-auto bg-slate-800 hover:bg-slate-700 text-slate-100 text-xs font-bold px-5 py-2.5 rounded-lg border border-slate-700 transition cursor-pointer"
                                        >
                                            {passwordSaving ? 'Doğrulanıyor...' : 'Parolayı Güncelle'}
                                        </button>
                                    </div>
                                </form>
                                {!recoveryMode && <button
                                    type="button"
                                    onClick={() => void requestPasswordReset()}
                                    disabled={passwordResetBusy}
                                    className="text-xs font-semibold text-emerald-400 underline underline-offset-4 disabled:opacity-50"
                                >
                                    {passwordResetBusy ? 'Bağlantı gönderiliyor...' : 'Parolamı unuttum · sıfırlama bağlantısı gönder'}
                                </button>}
                            </section>

                            {rankPanel}

                        </div>

                        <div className="profile-workspace-column">
                            {/* HESAP ÖZET KARTI */}
                            <section className="profile-account-panel bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
                                <div className="flex items-center gap-2 text-slate-300 font-bold border-b border-slate-800 pb-3 text-sm">
                                    <ShieldCheck className="w-4 h-4 text-emerald-400" />
                                    Hesap Durumu & Bilgileri
                                </div>
                                <div className="space-y-3 text-xs">
                                    <div className="flex justify-between py-1 border-b border-slate-800/50">
                                        <span className="text-slate-400">Kayıt Tarihi</span>
                                        <span className="font-mono text-slate-200">{dateLabel(data.accountCreatedAt)}</span>
                                    </div>
                                    <div className="flex justify-between py-1 border-b border-slate-800/50">
                                        <span className="text-slate-400">Son Giriş</span>
                                        <span className="font-mono text-slate-200">{dateLabel(data.lastSignInAt)}</span>
                                    </div>
                                    <div className="flex justify-between py-1 border-b border-slate-800/50">
                                        <span className="text-slate-400">Son Profil Güncellemesi</span>
                                        <span className="font-mono text-slate-200">{dateLabel(data.profile.updated_at)}</span>
                                    </div>
                                </div>
                            </section>

                            <section className="space-y-5 rounded-2xl border border-rose-500/20 bg-slate-900 p-6 shadow-xl">
                                <button
                                    type="button"
                                    aria-expanded={accountControlsOpen}
                                    onClick={() => setAccountControlsOpen((open) => !open)}
                                    className="flex w-full items-center justify-between gap-3 text-left"
                                >
                                    <span className="flex items-center gap-2 text-sm font-bold text-slate-200">
                                        <ShieldCheck className="h-4 w-4 text-rose-400" />
                                        Hesap dondurma ve silme
                                        {accountActionError && <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-300">İşlem gerekli</span>}
                                    </span>
                                    <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${accountControlsOpen ? 'rotate-180' : ''}`} />
                                </button>
                                {accountControlsOpen && <div className="space-y-5 border-t border-slate-800 pt-4">
                                {freezeRequest ? (
                                    <div className="space-y-3 rounded-xl border border-amber-500/20 bg-amber-500/10 p-4 text-xs leading-5 text-amber-100">
                                        <p>Hesabınızın dondurması {dateLabel(freezeRequest.unfreeze_at)} tarihinde sona erecek. Bu tarihten sonra giriş yaparsanız 30 günlük kalıcı silme planı iptal edilir.</p>
                                        <p>Bu tarihe kadar giriş yapmazsanız hesabınız {dateLabel(freezeRequest.delete_after)} tarihinde veya sonraki günlük otomatik kontrolde kalıcı olarak silinir.</p>
                                        <button type="button" onClick={() => void cancelFreezeRequest()} disabled={accountActionBusy} className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-4 py-2 font-bold text-amber-100 transition hover:bg-amber-400/20 disabled:opacity-50">
                                            {accountActionBusy ? 'İşleniyor…' : 'Dondurma ve silme planını iptal et'}
                                        </button>
                                    </div>
                                ) : (
                                    <>
                                        <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-4 text-xs leading-5 text-amber-100">
                                            Seçtiğiniz süre hesabınızı dondurma isteğini iptal edip geri dönmek için tanır. Bu süre içinde parolanızla giriş yaptığınız anda hesap yeniden etkinleşir ve silme planı iptal edilir. Süre bitince hesap otomatik olarak yeniden etkinleşir. İlk talepten itibaren 30 gün içinde hiç giriş yapmazsanız hesabınız ve ilişkili veriler kalıcı olarak silinir; bu işlem geri alınamaz.
                                        </div>
                                        <div className="grid gap-3 sm:grid-cols-2">
                                            <label className="text-xs font-semibold text-slate-300">Dondurma süresi
                                                <select value={freezeDays} onChange={(event) => setFreezeDays(Number(event.target.value))} className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 text-sm text-white">
                                                    <option value={1}>1 gün</option>
                                                    <option value={7}>7 gün</option>
                                                    <option value={14}>14 gün</option>
                                                    <option value={30}>30 gün</option>
                                                </select>
                                            </label>
                                            <label className="text-xs font-semibold text-slate-300">İşlemi onaylamak için mevcut parolanız
                                                <input type="password" value={accountPassword} onChange={(event) => setAccountPassword(event.target.value)} autoComplete="current-password" className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 text-sm text-white" />
                                            </label>
                                        </div>
                                        <button type="button" onClick={() => void submitAccountAction('freeze')} disabled={accountActionBusy || !accountPassword} className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2.5 text-xs font-bold text-white transition hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-50">
                                            <Snowflake className="h-4 w-4" />{accountActionBusy ? 'İşleniyor…' : 'Hesabımı geçici olarak dondur'}
                                        </button>
                                    </>
                                )}
                                {!freezeRequest && <div className="space-y-3 border-t border-slate-800 pt-4">
                                    <h3 className="flex items-center gap-2 text-sm font-bold text-rose-300"><Trash2 className="h-4 w-4" /> Hesabı kalıcı olarak sil</h3>
                                    <p className="text-xs leading-5 text-slate-400">Mevcut parolanız ve e-posta doğrulaması gerekir. Doğrulama bağlantısı açılana kadar hesabınız silinmez. Doğrulama tamamlanınca hesabınız ve ilişkili veriler kalıcı olarak silinir; bu işlem geri alınamaz. Parolanızı girip onay alanına “SİL” yazın.</p>
                                    <div className="grid gap-3 sm:grid-cols-2">
                                        <label className="text-xs font-semibold text-slate-300">Mevcut parola
                                            <input type="password" value={accountPassword} onChange={(event) => setAccountPassword(event.target.value)} autoComplete="current-password" className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 text-sm text-white" />
                                        </label>
                                        <label className="text-xs font-semibold text-slate-300">Onay metni
                                            <input value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)} autoComplete="off" placeholder="SİL" className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 text-sm text-white" />
                                        </label>
                                    </div>
                                    <button type="button" onClick={() => void submitAccountAction('delete')} disabled={accountActionBusy || !accountPassword || deleteConfirmation !== 'SİL'} className="inline-flex items-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-2.5 text-xs font-bold text-rose-200 transition hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-50">
                                        <Trash2 className="h-4 w-4" />{accountActionBusy ? 'İşleniyor…' : 'Hesabımı kalıcı olarak sil'}
                                    </button>
                                </div>}
                                {accountActionError && <p role="alert" className="rounded-lg border border-rose-500/20 bg-rose-500/10 p-3 text-xs leading-5 text-rose-200">{accountActionError}</p>}
                                </div>}
                            </section>

                            <WalletBalanceCard className="profile-wallet-panel" />
                            {/* ETKİNLİK AKIŞI */}
                            <section className="profile-activity-panel bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
                                <div className="flex justify-between items-center border-b border-slate-800 pb-3">
                                    <div className="flex items-center gap-2 text-slate-300 font-bold text-sm">
                                        <Activity className="w-4 h-4 text-emerald-400" />
                                        Son Hareketler
                                    </div>
                                    <span className="text-[10px] text-slate-500 font-mono">Son 30 Kayıt</span>
                                </div>

                                {data.activity.length ? (
                                    <div className="space-y-3 max-h-80 overflow-y-auto pr-1 custom-scrollbar">
                                        {data.activity.map((item) => (
                                            <div key={item.id} className="bg-slate-950/60 border border-slate-800/60 p-3 rounded-xl flex justify-between items-start text-xs">
                                                <div>
                                                    <p className="font-medium text-slate-200">{item.description}</p>
                                                    <span className="text-[10px] text-emerald-400 font-semibold">
                                                        {EVENT_LABELS[item.event_type] ?? 'Hesap Hareketi'}
                                                    </span>
                                                </div>
                                                <time className="text-[10px] text-slate-500 font-mono">
                                                    {dateLabel(item.created_at)}
                                                </time>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <p className="text-xs text-slate-500 text-center py-4">
                                        Henüz kaydedilmiş hesap hareketi bulunmuyor.
                                    </p>
                                )}
                            </section>

                        </div>
                    </div>
                )}

            </div>
        </main>
    );
}