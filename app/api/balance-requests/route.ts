import { NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabase-server';

const AMOUNT_LIMIT = 1_000_000_000;

export async function GET(request: Request) {
    const supabase = await getSupabaseServerClient();
    if (!supabase) return NextResponse.json({ error: 'Supabase bağlantısı yapılandırılmamış.' }, { status: 503 });
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: 'Bu işlem için giriş yapmalısınız.' }, { status: 401 });

    const params = new URL(request.url).searchParams;
    const limit = Number(params.get('limit') ?? 10);
    const offset = Number(params.get('offset') ?? 0);
    const movementOffset = Number(params.get('movementOffset') ?? 0);
    if (!Number.isInteger(limit) || limit < 1 || limit > 50
        || !Number.isInteger(offset) || offset < 0
        || !Number.isInteger(movementOffset) || movementOffset < 0) {
        return NextResponse.json({ error: 'Geçersiz talep geçmişi sayfalaması.' }, { status: 400 });
    }
    const [requestsResult, movementsResult] = await Promise.all([
        supabase.from('virtual_balance_requests')
            .select('id, requested_amount, reason, status, approved_amount, admin_note, created_at, reviewed_at')
            .eq('user_id', user.id).order('created_at', { ascending: false }).range(offset, offset + limit),
        supabase.from('user_activity_logs')
            .select('id, description, metadata, created_at')
            .eq('user_id', user.id).eq('event_type', 'admin_cash_adjustment')
            .order('created_at', { ascending: false }).range(movementOffset, movementOffset + limit),
    ]);
    if (requestsResult.error || movementsResult.error) {
        const error = requestsResult.error ?? movementsResult.error;
        console.error('Virtual balance history failed.', error);
        return NextResponse.json({ error: 'Bakiye işlem geçmişi yüklenemedi. Supabase SQL Editor’da ilgili bakiye migration dosyalarının çalıştırıldığını doğrulayın.' }, { status: 500 });
    }
    const requestRows = requestsResult.data ?? [];
    const movementRows = movementsResult.data ?? [];
    return NextResponse.json({
        success: true,
        data: requestRows.slice(0, limit),
        hasMore: requestRows.length > limit,
        balanceMovements: movementRows.slice(0, limit),
        hasMoreMovements: movementRows.length > limit,
    });
}

export async function POST(request: Request) {
    const supabase = await getSupabaseServerClient();
    if (!supabase) return NextResponse.json({ error: 'Supabase bağlantısı yapılandırılmamış.' }, { status: 503 });
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: 'Bu işlem için giriş yapmalısınız.' }, { status: 401 });

    let body: { amount?: unknown; reason?: unknown };
    try {
        body = await request.json() as typeof body;
    } catch {
        return NextResponse.json({ error: 'İstek gövdesi geçerli JSON olmalıdır.' }, { status: 400 });
    }
    const amount = typeof body.amount === 'number' ? body.amount : Number(body.amount);
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (!Number.isFinite(amount) || amount <= 0 || amount > AMOUNT_LIMIT || Number(amount.toFixed(2)) !== amount) {
        return NextResponse.json({ error: 'Talep tutarı 0,01 ile 1.000.000.000 TL arasında ve en fazla iki ondalık basamaklı olmalıdır.' }, { status: 400 });
    }
    if (reason.length < 5 || reason.length > 500) {
        return NextResponse.json({ error: 'Talep nedeni 5 ile 500 karakter arasında olmalıdır.' }, { status: 400 });
    }

    const { data, error } = await supabase.rpc('create_virtual_balance_request', {
        p_amount: amount,
        p_reason: reason,
    });
    if (error) {
        if (error.code === '23505') {
            return NextResponse.json({ error: 'Zaten değerlendirme bekleyen bir bakiye talebiniz var.' }, { status: 409 });
        }
        console.error('Virtual balance request creation failed.', error);
        return NextResponse.json({ error: 'Bakiye talebi gönderilemedi. Supabase SQL Editor’da supabase/virtual-balance-requests-migration.sql dosyasını çalıştırın.' }, { status: 500 });
    }
    return NextResponse.json({ success: true, data: { id: data } }, { status: 201 });
}
