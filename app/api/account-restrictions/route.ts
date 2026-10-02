import { createHash, randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase-admin';
import { signSupportAttachments } from '@/lib/support-attachments';

type RequestBody = { action?: unknown; email?: unknown; details?: unknown; subject?: unknown };
const MAX_FILE_SIZE = 5 * 1024 * 1024;
const IMAGE_TYPES: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
};
const normalizeEmail = (email: string) => email.trim().toLocaleLowerCase('en-US');
const hashEmail = (email: string) => createHash('sha256').update(normalizeEmail(email)).digest('hex');

function parseBody(value: unknown): RequestBody | null {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as RequestBody : null;
}

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

export async function POST(request: Request) {
    const admin = getSupabaseAdminClient();
    if (!admin) return NextResponse.json({ error: 'Hesap erişim durumu şu anda doğrulanamıyor.' }, { status: 503 });

    let body: RequestBody | null;
    let file: File | null = null;
    try {
        if (request.headers.get('content-type')?.includes('multipart/form-data')) {
            const form = await request.formData();
            body = {
                action: form.get('action'),
                email: form.get('email'),
                subject: form.get('subject'),
                details: form.get('details'),
            };
            const uploaded = form.get('file');
            if (uploaded instanceof File && uploaded.size > 0) file = uploaded;
        } else {
            body = parseBody(await request.json());
        }
    } catch {
        return NextResponse.json({ error: 'İstek içeriği okunamadı.' }, { status: 400 });
    }
    if (body?.action !== 'lookup' && body?.action !== 'appeal') {
        return NextResponse.json({ error: 'İşlem türü geçersiz.' }, { status: 400 });
    }
    const email = typeof body?.email === 'string' ? normalizeEmail(body.email) : '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
        return NextResponse.json({ error: 'Geçerli bir e-posta adresi girin.' }, { status: 400 });
    }

    const { data: restriction, error: restrictionError } = await admin.from('account_moderation_restrictions')
        .select('user_id, restriction_type, reason_title, explanation, starts_at, ends_at')
        .eq('email_hash', hashEmail(email)).eq('is_active', true).maybeSingle();
    if (restrictionError) {
        console.error('Account restriction lookup failed.', restrictionError);
        return NextResponse.json({ error: 'Hesap durumu doğrulanamadı. Hesap moderasyonu migration dosyasının uygulandığını kontrol edin.' }, { status: 500 });
    }
    if (!restriction || (restriction.ends_at && new Date(restriction.ends_at).getTime() <= Date.now())) {
        return NextResponse.json({ success: true, restricted: false });
    }

    const { data: appeals, error: appealError } = await admin.from('account_moderation_appeals')
        .select('id, subject, details, status, admin_note, attachment_url, created_at, decided_at')
        .eq('user_id', restriction.user_id)
        .gte('created_at', restriction.starts_at)
        .order('created_at', { ascending: false });
    if (appealError) {
        console.error('Account appeal lookup failed.', appealError);
        return NextResponse.json({ error: 'İtiraz durumu yüklenemedi.' }, { status: 500 });
    }
    let appeal: NonNullable<typeof appeals>[number] | null = appeals?.[0] ?? null;
    try {
        [appeal] = await signSupportAttachments(admin, appeal ? [appeal] : []);
    } catch (error) {
        console.error('Account appeal attachment link could not be signed.', error);
        return NextResponse.json({ error: 'İtiraz eki güvenli biçimde yüklenemedi.' }, { status: 500 });
    }
    const appealCount = appeals?.length ?? 0;
    const appealInReview = appeal?.status === 'pending' || appeal?.status === 'reviewing';
    let appealsInCurrentCycle = 0;
    let nextAppealAt: string | null = null;
    const now = Date.now();
    for (const currentAppeal of [...(appeals ?? [])].reverse()) {
        if (nextAppealAt) {
            if (new Date(currentAppeal.created_at).getTime() < new Date(nextAppealAt).getTime()) continue;
            appealsInCurrentCycle = 0;
            nextAppealAt = null;
        }
        appealsInCurrentCycle += 1;
        if (currentAppeal.status === 'rejected' && appealsInCurrentCycle >= 2 && currentAppeal.decided_at) {
            nextAppealAt = new Date(new Date(currentAppeal.decided_at).getTime() + 7 * 86400000).toISOString();
        }
    }
    const cooldownActive = nextAppealAt !== null && new Date(nextAppealAt).getTime() > now;
    const appealCycleReset = nextAppealAt !== null && !cooldownActive;
    if (appealCycleReset) {
        appealsInCurrentCycle = 0;
        nextAppealAt = null;
    }
    const remainingAppeals = appealInReview
        ? null
        : cooldownActive
            ? 0
            : appealCycleReset || appealsInCurrentCycle === 0 || (appeal?.status === 'rejected' && appealsInCurrentCycle === 1)
                ? 1
                : 0;
    const canAppeal = !appealInReview && (remainingAppeals ?? 0) > 0;

    if (body?.action === 'appeal') {
        const subject = typeof body.subject === 'string' ? body.subject.trim() : '';
        if (typeof body.details !== 'string' || body.details.trim().length < 20 || body.details.trim().length > 1000) {
            return NextResponse.json({ error: 'İtiraz açıklaması 20-1000 karakter arasında olmalıdır.' }, { status: 400 });
        }
        if (subject.length < 3 || subject.length > 120) return NextResponse.json({ error: 'İtiraz başlığı 3-120 karakter arasında olmalıdır.' }, { status: 400 });
        if (file && (!IMAGE_TYPES[file.type] || file.size > MAX_FILE_SIZE || !await validImage(file))) {
            return NextResponse.json({ error: 'Yalnızca geçerli JPEG, PNG, WebP veya GIF görseli yüklenebilir (en fazla 5 MB).' }, { status: 415 });
        }
        if (appealInReview) {
            return NextResponse.json({
                error: 'İtirazınız yönetici incelemesinde. Sonuçlanana kadar yeni itiraz gönderemezsiniz.',
                appeal,
                canAppeal: false,
                nextAppealAt: null,
                remainingAppeals: null,
            }, { status: 409 });
        }
        if (!canAppeal && nextAppealAt) {
            return NextResponse.json({
                error: `Yeni itirazınızı ${new Date(nextAppealAt).toLocaleString('tr-TR')} tarihinden itibaren gönderebilirsiniz.`,
                appeal,
                nextAppealAt,
                remainingAppeals,
            }, { status: 429 });
        }
        if ((remainingAppeals ?? 0) === 0) {
            return NextResponse.json({
                error: 'Bu itiraz dönemindeki haklarınızı kullandınız.',
                appeal,
                remainingAppeals,
            }, { status: 403 });
        }
        let attachmentUrl: string | null = null;
        let attachmentPath: string | null = null;
        if (file) {
            const path = `support/${restriction.user_id}/${randomUUID()}.${IMAGE_TYPES[file.type]}`;
            const { error: uploadError } = await admin.storage.from('support-attachments').upload(path, file, {
                contentType: file.type,
                cacheControl: '3600',
                upsert: false,
            });
            if (uploadError) {
                console.error('Account appeal image upload failed.', uploadError);
                return NextResponse.json({ error: 'Görsel yüklenemedi. İtirazınız gönderilmedi.' }, { status: 500 });
            }
            attachmentPath = path;
            attachmentUrl = path;
        }
        const { data: created, error: createError } = await admin.from('account_moderation_appeals').insert({
            user_id: restriction.user_id,
            restriction_id: restriction.user_id,
            email,
            restriction_type: restriction.restriction_type,
            reason_title: restriction.reason_title,
            restriction_explanation: restriction.explanation,
            restriction_ends_at: restriction.ends_at,
            subject,
            details: body.details.trim(),
            attachment_url: attachmentUrl,
        }).select('id, subject, details, status, admin_note, attachment_url, created_at, decided_at').single();
        if (createError?.code === '23505') {
            if (attachmentPath) await admin.storage.from('support-attachments').remove([attachmentPath]);
            return NextResponse.json({ error: 'İncelemede olan bir itirazınız zaten var.' }, { status: 409 });
        }
        if (createError) {
            if (attachmentPath) await admin.storage.from('support-attachments').remove([attachmentPath]);
            console.error('Account appeal submission failed.', createError);
            return NextResponse.json({ error: 'İtirazınız kaydedilemedi.' }, { status: 500 });
        }
        const { error: activityError } = await admin.from('user_activity_logs').insert({
            user_id: restriction.user_id,
            event_type: 'account_appeal_submitted',
            description: `Hesap kısıtlamasına itiraz gönderildi: ${subject}`,
            metadata: {
                appeal_id: created.id,
                restriction_type: restriction.restriction_type,
                reason_title: restriction.reason_title,
                subject,
            },
        });
        if (activityError) {
            console.error('Account appeal submission could not be added to global audit.', activityError);
            return NextResponse.json({ error: 'İtirazınız kaydedildi ancak global hareket kaydı oluşturulamadı.' }, { status: 500 });
        }
        let signedCreated = created;
        try {
            [signedCreated] = await signSupportAttachments(admin, [created]);
        } catch (signingError) {
            console.error('Created account appeal attachment link could not be signed.', signingError);
            return NextResponse.json({ error: 'İtirazınız kaydedildi ancak eki güvenli biçimde yüklenemedi.' }, { status: 500 });
        }
        return NextResponse.json({
            success: true,
            restricted: true,
            appeal: signedCreated,
            canAppeal: false,
            nextAppealAt: null,
            remainingAppeals: null,
            appealCount: appealCount + 1,
            appealsInCurrentCycle: appealsInCurrentCycle + 1,
        }, { status: 201 });
    }
    return NextResponse.json({
        success: true,
        restricted: true,
        restriction: {
            type: restriction.restriction_type,
            reason: restriction.reason_title,
            explanation: restriction.explanation,
            startsAt: restriction.starts_at,
            endsAt: restriction.ends_at,
        },
        appeal,
        canAppeal,
        nextAppealAt: cooldownActive ? nextAppealAt : null,
        remainingAppeals,
        appealCount,
        appealsInCurrentCycle,
        appealCycleReset,
    });
}
