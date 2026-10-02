import { randomUUID } from 'node:crypto';
import { apiError, apiSuccess, databaseError, readJson, requireForumUser } from '@/lib/forum';
import { getSupabaseAdminClient } from '@/lib/supabase-admin';
import { signSupportAttachments } from '@/lib/support-attachments';

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const IMAGE_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };

async function validImage(file: File) {
    const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    if (file.type === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    if (file.type === 'image/png') return bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50
        && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a
        && bytes[6] === 0x1a && bytes[7] === 0x0a;
    if (file.type === 'image/webp') return String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF'
        && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
    return file.type === 'image/gif' && ['GIF87a', 'GIF89a'].includes(String.fromCharCode(...bytes.slice(0, 6)));
}

export async function GET() {
    const auth = await requireForumUser();
    if (auth.response) return auth.response;
    const [profile, appeal] = await Promise.all([
        auth.client.from('user_profiles').select('is_banned, forum_ban_until').eq('user_id', auth.user.id).maybeSingle(),
        auth.client.from('forum_moderation_appeals')
            .select('id, subject, details, status, admin_note, attachment_url, created_at, decided_at')
            .eq('user_id', auth.user.id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    ]);
    if (profile.error) return databaseError(profile.error, 'Forum erişim durumunuz yüklenemedi.');
    if (appeal.error) return databaseError(appeal.error, 'İtiraz durumunuz yüklenemedi. community-moderation-appeals-migration.sql dosyasının çalıştırıldığını doğrulayın.');
    let signedAppeal = appeal.data;
    if (signedAppeal?.attachment_url && !signedAppeal.attachment_url.includes('://')) {
        const admin = getSupabaseAdminClient();
        if (!admin) return apiError('İtiraz ekleri güvenli biçimde yüklenemedi.', 503, 'UPLOAD_UNAVAILABLE');
        try {
            [signedAppeal] = await signSupportAttachments(admin, [signedAppeal]);
        } catch (error) {
            console.error('Forum appeal attachment link could not be signed.', error);
            return apiError('İtiraz eki güvenli biçimde yüklenemedi.', 500, 'ATTACHMENT_SIGNING_FAILED');
        }
    }
    const banned = Boolean(profile.data?.is_banned
        || (profile.data?.forum_ban_until && new Date(profile.data.forum_ban_until).getTime() > Date.now()));
    return apiSuccess({ banned, ban_until: profile.data?.forum_ban_until ?? null, appeal: signedAppeal ?? null });
}

export async function POST(request: Request) {
    const auth = await requireForumUser();
    if (auth.response) return auth.response;
    let subject = '';
    let details = '';
    let file: File | null = null;
    if (request.headers.get('content-type')?.includes('multipart/form-data')) {
        try {
            const form = await request.formData();
            subject = typeof form.get('subject') === 'string' ? String(form.get('subject')).trim() : '';
            details = typeof form.get('details') === 'string' ? String(form.get('details')).trim() : '';
            const upload = form.get('file');
            if (upload instanceof File && upload.size > 0) file = upload;
        } catch {
            return apiError('İtiraz formu okunamadı.', 400, 'INVALID_FORM');
        }
    } else {
        const body = await readJson(request);
        subject = typeof body?.subject === 'string' ? body.subject.trim() : 'Topluluk kısıtlamasına itiraz';
        details = typeof body?.details === 'string' ? body.details.trim() : '';
    }
    if (subject.length < 3 || subject.length > 120 || details.length < 20 || details.length > 1000) {
        return apiError('İtiraz açıklaması 20-1000 karakter arasında olmalıdır.', 400, 'INVALID_APPEAL');
    }
    if (file && (!IMAGE_TYPES[file.type] || file.size > MAX_FILE_SIZE || !await validImage(file))) return apiError('Yalnızca geçerli JPEG, PNG, WebP veya GIF görseli yüklenebilir (en fazla 5 MB).', 415, 'INVALID_IMAGE');
    const { data: profile, error: profileError } = await auth.client.from('user_profiles')
        .select('is_banned, forum_ban_until').eq('user_id', auth.user.id).maybeSingle();
    if (profileError) return databaseError(profileError, 'Forum erişim durumunuz doğrulanamadı.');
    const banned = Boolean(profile?.is_banned
        || (profile?.forum_ban_until && new Date(profile.forum_ban_until).getTime() > Date.now()));
    if (!banned) return apiError('Aktif bir forum yasağınız bulunmadığı için itiraz gönderemezsiniz.', 409, 'NO_ACTIVE_BAN');
    const storageAdmin = getSupabaseAdminClient();
    let attachmentUrl: string | null = null;
    let attachmentPath: string | null = null;
    if (file) {
        if (!storageAdmin) {
            return apiError('Görsel yüklemek için sunucu dosya yükleme ayarı yapılandırılmalıdır.', 503, 'UPLOAD_UNAVAILABLE');
        }
        const path = `support/${auth.user.id}/${randomUUID()}.${IMAGE_TYPES[file.type]}`;
        const { error: uploadError } = await storageAdmin.storage.from('support-attachments').upload(path, file, {
            contentType: file.type, cacheControl: '3600', upsert: false,
        });
        if (uploadError) {
            return databaseError(uploadError, 'İtiraz görseli yüklenemedi.');
        }
        attachmentPath = path;
        attachmentUrl = path;
    }
    const { data, error } = await auth.client.from('forum_moderation_appeals')
        .insert({
            user_id: auth.user.id,
            subject,
            details,
            attachment_url: attachmentUrl,
            restriction_was_banned: Boolean(profile?.is_banned),
            restriction_ban_until: profile?.forum_ban_until ?? null,
        })
        .select('id, subject, details, status, attachment_url, created_at').single();
    if (error?.code === '23505') {
        if (attachmentPath) await storageAdmin?.storage.from('support-attachments').remove([attachmentPath]);
        return apiError('İncelemede olan bir itirazınız zaten var.', 409, 'APPEAL_ALREADY_OPEN');
    }
    if (error) {
        if (attachmentPath) await storageAdmin?.storage.from('support-attachments').remove([attachmentPath]);
        return databaseError(error, 'İtiraz gönderilemedi.');
    }
    const { error: activityError } = await auth.client.from('user_activity_logs').insert({
        user_id: auth.user.id,
        event_type: 'forum_appeal_submitted',
        description: `Forum kısıtlamasına itiraz gönderildi: ${subject}`,
        metadata: { appeal_id: data.id, subject },
    });
    if (activityError) {
        console.error('Forum appeal submission could not be added to global audit.', activityError);
        return apiError('İtirazınız kaydedildi ancak global hareket kaydı oluşturulamadı.', 500, 'AUDIT_LOG_FAILED');
    }
    try {
        if (data.attachment_url) {
            if (!storageAdmin) return apiError('İtirazınız kaydedildi ancak eki güvenli biçimde yüklenemedi.', 503, 'UPLOAD_UNAVAILABLE');
            const [signedData] = await signSupportAttachments(storageAdmin, [data]);
            return apiSuccess(signedData, 201);
        }
        return apiSuccess(data, 201);
    } catch (signingError) {
        console.error('New forum appeal attachment link could not be signed.', signingError);
        return apiError('İtirazınız kaydedildi ancak eki güvenli biçimde yüklenemedi.', 500, 'ATTACHMENT_SIGNING_FAILED');
    }
}
