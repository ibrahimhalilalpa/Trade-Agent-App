import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabase-server';
import { getSupabaseAdminClient } from '@/lib/supabase-admin';
import { signSupportAttachments } from '@/lib/support-attachments';

const REQUEST_TYPES = ['question', 'suggestion', 'feedback'] as const;
type RequestType = typeof REQUEST_TYPES[number];
const MAX_FILE_SIZE = 5 * 1024 * 1024;
const IMAGE_TYPES: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
};

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
    const supabase = await getSupabaseServerClient();
    if (!supabase) return NextResponse.json({ error: 'Supabase bağlantısı yapılandırılmamış.' }, { status: 503 });
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: 'Yardım merkezini kullanmak için giriş yapın.' }, { status: 401 });

    const [requests, accountAppeals, forumAppeals] = await Promise.all([
        supabase.from('user_support_requests')
            .select('id, request_type, subject, details, status, admin_reply, attachment_url, created_at, updated_at, answered_at')
            .eq('user_id', user.id).order('created_at', { ascending: false }).limit(100),
        supabase.from('account_moderation_appeals')
            .select('id, subject, reason_title, restriction_explanation, restriction_ends_at, details, status, admin_note, attachment_url, created_at, decided_at')
            .eq('user_id', user.id).order('created_at', { ascending: false }).limit(50),
        supabase.from('forum_moderation_appeals')
            .select('id, subject, details, status, admin_note, attachment_url, created_at, decided_at')
            .eq('user_id', user.id).order('created_at', { ascending: false }).limit(50),
    ]);
    const failed = requests.error ?? accountAppeals.error ?? forumAppeals.error;
    if (failed) {
        console.error('Support request history could not be loaded.', failed);
        return NextResponse.json({ error: 'Yardım ve itiraz geçmişi yüklenemedi. İlgili migration dosyalarının uygulandığını kontrol edin.' }, { status: 500 });
    }
    const { data: remainingQuota, error: quotaError } = await supabase.rpc('get_user_support_daily_quota', { p_user_id: user.id });
    if (quotaError) {
        console.error('Daily support quota could not be loaded.', quotaError);
        return NextResponse.json({ error: 'Günlük talep hakkı yüklenemedi. user-support-center-migration.sql dosyasının uygulandığını kontrol edin.' }, { status: 500 });
    }
    const requestIds = (requests.data ?? []).map((item) => item.id);
    const { data: requestEvents, error: eventError } = requestIds.length
        ? await supabase.from('user_support_request_events')
            .select('id, request_id, actor_role, event_type, previous_status, status, message, created_at')
            .in('request_id', requestIds).order('created_at', { ascending: false })
        : { data: [], error: null };
    if (eventError) {
        console.error('Support request activity could not be loaded.', eventError);
        return NextResponse.json({ error: 'Talep hareketleri yüklenemedi. user-support-activity-migration.sql dosyasının uygulandığını kontrol edin.' }, { status: 500 });
    }
    try {
        const attachmentAdmin = getSupabaseAdminClient();
        const hasPrivateAttachments = [...(requests.data ?? []), ...(accountAppeals.data ?? []), ...(forumAppeals.data ?? [])]
            .some((item) => Boolean(item.attachment_url && !item.attachment_url.includes('://')));
        if (!attachmentAdmin && hasPrivateAttachments) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required to sign private support attachments.');
        const signingClient = attachmentAdmin ?? supabase;
        const [signedRequests, signedAccountAppeals, signedForumAppeals] = await Promise.all([
            signSupportAttachments(signingClient, requests.data ?? []),
            signSupportAttachments(signingClient, accountAppeals.data ?? []),
            signSupportAttachments(signingClient, forumAppeals.data ?? []),
        ]);
        return NextResponse.json({
            requests: signedRequests.map((item) => ({
                ...item,
                events: (requestEvents ?? []).filter((event) => event.request_id === item.id),
            })),
            accountAppeals: signedAccountAppeals,
            forumAppeals: signedForumAppeals,
            remainingQuota,
        });
    } catch (error) {
        console.error('Support attachment links could not be signed.', error);
        return NextResponse.json({ error: 'Yardım merkezi ekleri güvenli biçimde yüklenemedi.' }, { status: 500 });
    }
}

export async function POST(request: Request) {
    const supabase = await getSupabaseServerClient();
    if (!supabase) return NextResponse.json({ error: 'Supabase bağlantısı yapılandırılmamış.' }, { status: 503 });
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: 'Talep göndermek için giriş yapın.' }, { status: 401 });

    let requestType: unknown;
    let subject = '';
    let details = '';
    let file: File | null = null;
    try {
        const form = await request.formData();
        requestType = form.get('requestType');
        subject = typeof form.get('subject') === 'string' ? String(form.get('subject')).trim() : '';
        details = typeof form.get('details') === 'string' ? String(form.get('details')).trim() : '';
        const upload = form.get('file');
        if (upload instanceof File && upload.size > 0) file = upload;
    } catch {
        return NextResponse.json({ error: 'Talep formu okunamadı.' }, { status: 400 });
    }
    if (typeof requestType !== 'string' || !REQUEST_TYPES.includes(requestType as RequestType)) {
        return NextResponse.json({ error: 'Talep kategorisi geçersiz.' }, { status: 400 });
    }
    if (subject.length < 3 || subject.length > 120 || details.length < 20 || details.length > 2000) {
        return NextResponse.json({ error: 'Başlık 3-120, açıklama 20-2000 karakter arasında olmalıdır.' }, { status: 400 });
    }
    if (file && (!IMAGE_TYPES[file.type] || file.size > MAX_FILE_SIZE || !await validImage(file))) {
        return NextResponse.json({ error: 'Yalnızca geçerli JPEG, PNG, WebP veya GIF görseli yüklenebilir (en fazla 5 MB).' }, { status: 415 });
    }
    const { data: quota, error: quotaError } = await supabase.rpc('consume_user_support_daily_quota', { p_user_id: user.id }).single<{ allowed: boolean; remaining: number }>();
    if (quotaError) {
        console.error('Daily support quota could not be consumed.', quotaError);
        return NextResponse.json({ error: 'Günlük talep hakkı doğrulanamadı. user-support-center-migration.sql dosyasının uygulandığını kontrol edin.' }, { status: 500 });
    }
    if (!quota.allowed) return NextResponse.json({ error: 'Bugünkü talep hakkınız doldu. Yönetici talebinizi değerlendirdiğinde bir hak yenilenir.', remainingQuota: quota.remaining }, { status: 429 });

    let attachmentUrl: string | null = null;
    let attachmentPath: string | null = null;
    if (file) {
        const attachmentAdmin = getSupabaseAdminClient();
        if (!attachmentAdmin) {
            await supabase.rpc('release_user_support_daily_quota', { p_user_id: user.id });
            return NextResponse.json({ error: 'Görsel yüklemek için sunucu dosya yükleme ayarı yapılandırılmalıdır.' }, { status: 503 });
        }
        const path = `support/${user.id}/${randomUUID()}.${IMAGE_TYPES[file.type]}`;
        const { error: uploadError } = await attachmentAdmin.storage.from('support-attachments').upload(path, file, {
            contentType: file.type,
            cacheControl: '3600',
            upsert: false,
        });
        if (uploadError) {
            await supabase.rpc('release_user_support_daily_quota', { p_user_id: user.id });
            console.error('Support attachment upload failed.', uploadError);
            return NextResponse.json({ error: 'Görsel yüklenemedi. İsteğiniz gönderilmedi.' }, { status: 500 });
        }
        attachmentPath = path;
        attachmentUrl = path;
    }
    const { data, error } = await supabase.from('user_support_requests').insert({
        user_id: user.id,
        request_type: requestType,
        subject,
        details,
        attachment_url: attachmentUrl,
    }).select('id, request_type, subject, details, status, admin_reply, attachment_url, created_at, updated_at, answered_at').single();
    if (error) {
        if (attachmentPath) await getSupabaseAdminClient()?.storage.from('support-attachments').remove([attachmentPath]);
        await supabase.rpc('release_user_support_daily_quota', { p_user_id: user.id });
        console.error('Support request submission failed.', error);
        return NextResponse.json({ error: 'Talebiniz kaydedilemedi. Lütfen tekrar deneyin.' }, { status: 500 });
    }
    const { error: eventError } = await supabase.from('user_support_request_events').insert({
        request_id: data.id,
        user_id: user.id,
        actor_id: user.id,
        actor_role: 'user',
        event_type: 'created',
        previous_status: null,
        status: 'pending',
    });
    if (eventError) {
        console.error('Support request creation could not be added to the activity ledger.', eventError);
        return NextResponse.json({ error: 'Talebiniz kaydedildi ancak hareket geçmişi oluşturulamadı. user-support-activity-migration.sql dosyasının uygulandığını kontrol edin.' }, { status: 500 });
    }
    const { error: activityError } = await supabase.from('user_activity_logs').insert({
        user_id: user.id,
        event_type: 'support_request_created',
        description: `Yardım talebiniz oluşturuldu: ${subject}`,
        metadata: { request_id: data.id, request_type: requestType, subject },
    });
    if (activityError) {
        console.error('Support request creation could not be added to user activity.', activityError);
        return NextResponse.json({ error: 'Talebiniz kaydedildi ancak kullanıcı hareket kaydı oluşturulamadı.' }, { status: 500 });
    }
    const { data: remainingQuota } = await supabase.rpc('get_user_support_daily_quota', { p_user_id: user.id });
    try {
        if (data.attachment_url) {
            const attachmentAdmin = getSupabaseAdminClient();
            if (!attachmentAdmin) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required to sign the private attachment.');
            const [signedRequest] = await signSupportAttachments(attachmentAdmin, [data]);
            return NextResponse.json({ request: signedRequest, remainingQuota }, { status: 201 });
        }
        return NextResponse.json({ request: data, remainingQuota }, { status: 201 });
    } catch (error) {
        console.error('New support attachment link could not be signed.', error);
        return NextResponse.json({ error: 'Talebiniz kaydedildi ancak eki güvenli biçimde yüklenemedi.' }, { status: 500 });
    }
}
