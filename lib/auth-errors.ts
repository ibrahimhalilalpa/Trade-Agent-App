type AuthErrorLike = { code?: string; message?: string };

export function translateAuthError(error: AuthErrorLike | string | null | undefined, fallback = 'İşlem tamamlanamadı. Lütfen tekrar deneyin.'): string {
    const code = typeof error === 'string' ? '' : error?.code?.toLowerCase() ?? '';
    const message = (typeof error === 'string' ? error : error?.message ?? '').toLowerCase();
    const detail = `${code} ${message}`;

    if (/invalid login credentials|invalid_credentials|invalid email or password|email or password is incorrect/.test(detail)) {
        return 'E-posta adresi veya parola hatalı.';
    }
    if (/email_not_confirmed|email not confirmed/.test(detail)) return 'E-posta adresinizi doğruladıktan sonra giriş yapabilirsiniz.';
    if (/user_banned|user is banned|user account is banned|banned_until/.test(detail)) {
        return 'Bu hesap önceki dondurma uygulamasından kalan bir giriş engeline sahip. Supabase SQL Editor’da supabase/account-freeze-login-fix-migration.sql dosyasını çalıştırıp tekrar giriş yapın.';
    }
    if (/user already registered|user_already_exists|already been registered/.test(detail)) return 'Bu e-posta adresiyle bir hesap zaten kayıtlı.';
    if (/user not found|user_not_found/.test(detail)) return 'Bu e-posta adresiyle eşleşen bir hesap bulunamadı.';
    if (/error sending confirmation email|failed to send.*(?:confirmation|verification) email|smtp|email delivery/.test(detail)) {
        return 'Kayıt işlemi doğrulama e-postası gönderilirken başarısız oldu. Supabase Dashboard > Authentication > SMTP Settings bölümündeki etkin SMTP sağlayıcısının bilgilerini kontrol edin. İptal edilmiş veya geçersiz bir SMTP parolası kullanılıyorsa gönderim başarısız olur.';
    }
    if (/database error saving new user|database error creating user|error creating user|trigger.*(?:failed|error)/.test(detail)) {
        return 'Kayıt işlemi veritabanında tamamlanamadı. Supabase Dashboard > Logs bölümündeki Auth ve Postgres kayıtlarını kontrol edin; kullanıcı oluşturma trigger’ı veya gerekli migration’lar hata veriyor olabilir.';
    }
    if (/over_email_send_rate_limit|email rate limit exceeded|too many requests|rate limit/.test(detail)) {
        return 'Çok fazla deneme yapıldı. Lütfen biraz bekleyip yeniden deneyin.';
    }
    if (/password should be at least|weak_password|password is too short/.test(detail)) return 'Parola yeterince güçlü değil. En az 8 karakter kullanın.';
    if (/expired|otp_expired|token has expired/.test(detail)) return 'Bağlantının süresi dolmuş. Yeni bir parola yenileme bağlantısı isteyin.';
    if (/invalid otp|otp_disabled|token is invalid|invalid token/.test(detail)) return 'Bağlantı geçersiz veya daha önce kullanılmış. Yeni bir bağlantı isteyin.';
    if (/email_address_invalid|invalid email/.test(detail)) return 'Geçerli bir e-posta adresi girin.';
    return fallback;
}