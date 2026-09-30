import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';

type RequestRow = {
    id: string;
    user_id: string;
    requested_amount: number;
    reason: string;
    created_at: string;
    status: 'pending' | 'approved' | 'rejected';
    approved_amount: number | null;
    admin_note: string | null;
    reviewed_by: string | null;
    reviewed_at: string | null;
};

type CashAdjustmentRow = {
    id: string;
    portfolio_id: string;
    cash_delta: number;
    balance_after: number;
    created_at: string;
};

type PortfolioOwnerRow = {
    id: string;
    user_id: string;
};

export async function GET() {
    const context = await requireAdmin();
    if (context.response) return context.response;
    if (context.role !== 'super_admin') {
        return NextResponse.json({ error: 'Yalnızca super admin bakiye taleplerini inceleyebilir.' }, { status: 403 });
    }

    const [requests, adjustments, portfolios, profiles, users] = await Promise.all([
        context.admin.from('virtual_balance_requests')
            .select('id, user_id, requested_amount, reason, status, approved_amount, admin_note, reviewed_by, reviewed_at, created_at')
            .order('created_at', { ascending: false }).limit(1000),
        context.admin.from('portfolio_transactions')
            .select('id, portfolio_id, cash_delta, balance_after, created_at')
            .eq('transaction_type', 'cash_adjustment').order('created_at', { ascending: false }).limit(1000),
        context.admin.from('user_portfolios').select('id, user_id'),
        context.admin.from('user_profiles').select('user_id, display_name, full_name'),
        context.admin.rpc('admin_list_users'),
    ]);
    const failure = requests.error ?? adjustments.error ?? portfolios.error ?? profiles.error ?? users.error;
    if (failure) {
        console.error('Super admin balance requests listing failed.', failure);
        return NextResponse.json({ error: 'Bakiye talepleri yüklenemedi. Supabase SQL Editor’da supabase/virtual-balance-requests-migration.sql dosyasını çalıştırın.' }, { status: 500 });
    }

    const profileByUser = new Map((profiles.data ?? []).map((profile) => [
        profile.user_id, profile.display_name || profile.full_name || 'Yatırımcı',
    ]));
    const userById = new Map(((users.data ?? []) as Array<{ id: string; email: string }>).map((user) => [user.id, user.email]));
    const portfolioById = new Map(((portfolios.data ?? []) as PortfolioOwnerRow[]).map((portfolio) => [portfolio.id, portfolio.user_id]));
    const requestRows = (requests.data ?? []) as RequestRow[];
    const requestData = requestRows.map((item) => ({
        id: item.id,
        userId: item.user_id,
        email: userById.get(item.user_id) ?? '',
        displayName: profileByUser.get(item.user_id) ?? 'Yatırımcı',
        requestedAmount: Number(item.requested_amount),
        reason: item.reason,
        status: item.status,
        approvedAmount: item.approved_amount === null ? null : Number(item.approved_amount),
        adminNote: item.admin_note,
        reviewedBy: item.reviewed_by,
        reviewerEmail: item.reviewed_by ? userById.get(item.reviewed_by) ?? '' : '',
        reviewedAt: item.reviewed_at,
        createdAt: item.created_at,
    }));
    const adjustmentData = ((adjustments.data ?? []) as CashAdjustmentRow[]).map((item) => {
        const userId = portfolioById.get(item.portfolio_id) ?? '';
        return {
            id: item.id,
            userId,
            displayName: profileByUser.get(userId) ?? 'Yatırımcı',
            email: userById.get(userId) ?? '',
            amount: Number(item.cash_delta),
            balanceAfter: Number(item.balance_after),
            createdAt: item.created_at,
        };
    });
    return NextResponse.json({ success: true, data: { requests: requestData, adjustments: adjustmentData } });
}

export async function PATCH(request: Request) {
    const context = await requireAdmin();
    if (context.response) return context.response;
    if (context.role !== 'super_admin') {
        return NextResponse.json({ error: 'Yalnızca super admin bakiye taleplerine karar verebilir.' }, { status: 403 });
    }

    let body: { requestId?: unknown; decision?: unknown; approvedAmount?: unknown; note?: unknown };
    try {
        body = await request.json() as typeof body;
    } catch {
        return NextResponse.json({ error: 'İstek gövdesi geçerli JSON olmalıdır.' }, { status: 400 });
    }
    if (typeof body.requestId !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.requestId)
        || (body.decision !== 'approve' && body.decision !== 'reject')) {
        return NextResponse.json({ error: 'Geçerli talep ve karar seçin.' }, { status: 400 });
    }
    const approvedAmount = body.decision === 'approve' ? Number(body.approvedAmount) : null;
    if (body.decision === 'approve' && (!Number.isFinite(approvedAmount) || approvedAmount === null
        || approvedAmount <= 0 || approvedAmount > 1_000_000_000 || Number(approvedAmount.toFixed(2)) !== approvedAmount)) {
        return NextResponse.json({ error: 'Onay tutarı 0,01 ile 1.000.000.000 TL arasında ve en fazla iki ondalık basamaklı olmalıdır.' }, { status: 400 });
    }
    const note = typeof body.note === 'string' ? body.note.trim() : '';
    if (note.length > 180) return NextResponse.json({ error: 'Yönetici notu en fazla 180 karakter olabilir.' }, { status: 400 });

    const { data, error } = await context.sessionClient.rpc('admin_review_virtual_balance_request', {
        p_request_id: body.requestId,
        p_approve: body.decision === 'approve',
        p_approved_amount: approvedAmount,
        p_admin_note: note || null,
    });
    if (error) {
        console.error('Super admin balance request review failed.', error);
        if (/not pending/i.test(error.message)) return NextResponse.json({ error: 'Bu talep daha önce sonuçlandırılmış.' }, { status: 409 });
        return NextResponse.json({ error: 'Bakiye talebi sonuçlandırılamadı. Super admin yetkisini ve supabase/virtual-balance-requests-migration.sql dosyasının çalıştırıldığını kontrol edin.' }, { status: 400 });
    }
    return NextResponse.json({ success: true, data });
}
