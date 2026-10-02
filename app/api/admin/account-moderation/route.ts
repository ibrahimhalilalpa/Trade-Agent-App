import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';

const UUID_PATTERN = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

export async function GET() {
    const context = await requireAdmin();
    if (context.response) return context.response;
    if (!context.serviceClient) return NextResponse.json({ error: 'Bu işlem için SUPABASE_SERVICE_ROLE_KEY gereklidir.' }, { status: 503 });
    const { data, error } = await context.serviceClient.from('account_moderation_reasons')
        .select('id, title, explanation, is_active').order('title');
    if (error) {
        console.error('Account moderation reason templates could not be loaded.', error);
        return NextResponse.json({ error: 'Neden şablonları yüklenemedi. account-moderation-migration.sql dosyasını çalıştırın.' }, { status: 500 });
    }
    return NextResponse.json({ success: true, data });
}

export async function POST(request: Request) {
    const context = await requireAdmin();
    if (context.response) return context.response;
    if (!context.serviceClient) return NextResponse.json({ error: 'Bu işlem için SUPABASE_SERVICE_ROLE_KEY gereklidir.' }, { status: 503 });
    let body: { action?: unknown; id?: unknown; title?: unknown; explanation?: unknown; isActive?: unknown };
    try {
        body = await request.json() as typeof body;
    } catch {
        return NextResponse.json({ error: 'Geçersiz JSON içeriği.' }, { status: 400 });
    }
    if (body.action === 'delete') {
        if (typeof body.id !== 'string' || !UUID_PATTERN.test(body.id)) return NextResponse.json({ error: 'Şablon kimliği geçersiz.' }, { status: 400 });
        const { error } = await context.serviceClient.from('account_moderation_reasons')
            .update({ is_active: false, updated_at: new Date().toISOString() }).eq('id', body.id);
        if (error) {
            console.error('Account moderation reason template could not be deactivated.', error);
            return NextResponse.json({ error: 'Neden şablonu devre dışı bırakılamadı.' }, { status: 500 });
        }
        return NextResponse.json({ success: true });
    }

    const title = typeof body.title === 'string' ? body.title.trim() : '';
    const explanation = typeof body.explanation === 'string' ? body.explanation.trim() : '';
    if (title.length < 2 || title.length > 80 || explanation.length < 10 || explanation.length > 1000) {
        return NextResponse.json({ error: 'Neden 2-80, açıklama 10-1000 karakter arasında olmalıdır.' }, { status: 400 });
    }
    if (body.id !== undefined && (typeof body.id !== 'string' || !UUID_PATTERN.test(body.id))) {
        return NextResponse.json({ error: 'Şablon kimliği geçersiz.' }, { status: 400 });
    }
    const values = {
        title,
        explanation,
        is_active: body.isActive !== false,
        updated_at: new Date().toISOString(),
    };
    const result = typeof body.id === 'string'
        ? await context.serviceClient.from('account_moderation_reasons').update(values).eq('id', body.id).select('id, title, explanation, is_active').single()
        : await context.serviceClient.from('account_moderation_reasons').insert({ ...values, created_by: context.user.id }).select('id, title, explanation, is_active').single();
    if (result.error) {
        console.error('Account moderation reason template could not be saved.', result.error);
        return NextResponse.json({ error: 'Neden şablonu kaydedilemedi.' }, { status: 500 });
    }
    return NextResponse.json({ success: true, data: result.data });
}
