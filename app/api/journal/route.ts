import { NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabase-server';

const SETUP_MESSAGE = 'Araştırma günlüğü veritabanı kurulumu eksik. Supabase SQL Editor’da supabase/research-journal-migration.sql dosyasını çalıştırın.';
const REVIEW_STATUSES = ['pending', 'matched', 'partially_matched', 'not_matched'] as const;
type ReviewStatus = typeof REVIEW_STATUSES[number];
type JournalBody = {
    id?: unknown;
    symbol?: unknown;
    reason?: unknown;
    scenario?: unknown;
    reviewStatus?: unknown;
    reviewNote?: unknown;
};
type JournalRow = {
    id: string;
    symbol: string;
    reason: string;
    scenario: string;
    review_status: ReviewStatus;
    review_note: string;
    reviewed_at: string | null;
    created_at: string;
    updated_at: string;
};

async function getContext() {
    const supabase = await getSupabaseServerClient();
    if (!supabase) return { supabase: null, user: null };
    const { data: { user } } = await supabase.auth.getUser();
    return { supabase, user };
}

function isSetupError(error: { code?: string } | null): boolean {
    return error?.code === '42P01' || error?.code === 'PGRST205' || error?.code === 'PGRST204';
}

function isEntryId(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function errorResponse(error: { code?: string } | null, fallback: string) {
    return NextResponse.json(
        { error: isSetupError(error) ? SETUP_MESSAGE : fallback },
        { status: isSetupError(error) ? 503 : 500 },
    );
}

function mapEntry(row: JournalRow) {
    return {
        id: row.id,
        symbol: row.symbol,
        reason: row.reason,
        scenario: row.scenario,
        reviewStatus: row.review_status,
        reviewNote: row.review_note,
        reviewedAt: row.reviewed_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

async function readBody(request: Request): Promise<JournalBody | null> {
    try {
        const body: unknown = await request.json();
        return body !== null && typeof body === 'object' && !Array.isArray(body) ? body as JournalBody : null;
    } catch {
        return null;
    }
}

export async function GET() {
    const { supabase, user } = await getContext();
    if (!supabase) return NextResponse.json({ error: 'Supabase bağlantısı yapılandırılmamış.' }, { status: 503 });
    if (!user) return NextResponse.json({ error: 'Araştırma günlüğü için giriş yapmalısınız.' }, { status: 401 });

    const { data, error } = await supabase.from('research_journal_entries')
        .select('id, symbol, reason, scenario, review_status, review_note, reviewed_at, created_at, updated_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(200);
    if (error) return errorResponse(error, 'Araştırma günlüğü yüklenemedi.');
    return NextResponse.json({ data: (data ?? []).map((row) => mapEntry(row as JournalRow)) });
}

export async function POST(request: Request) {
    const { supabase, user } = await getContext();
    if (!supabase) return NextResponse.json({ error: 'Supabase bağlantısı yapılandırılmamış.' }, { status: 503 });
    if (!user) return NextResponse.json({ error: 'Araştırma günlüğüne kayıt eklemek için giriş yapmalısınız.' }, { status: 401 });

    const body = await readBody(request);
    if (!body) return NextResponse.json({ error: 'İstek gövdesi geçerli JSON olmalıdır.' }, { status: 400 });
    const symbol = typeof body.symbol === 'string' ? body.symbol.trim().toUpperCase() : '';
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    const scenario = typeof body.scenario === 'string' ? body.scenario.trim() : '';
    if (!/^[A-Z0-9]{3,6}$/.test(symbol)) return NextResponse.json({ error: 'Geçerli bir hisse kodu girin.' }, { status: 400 });
    if (!reason || reason.length > 2000) return NextResponse.json({ error: 'Takip gerekçesi 1-2000 karakter olmalıdır.' }, { status: 400 });
    if (!scenario || scenario.length > 2000) return NextResponse.json({ error: 'Senaryo 1-2000 karakter olmalıdır.' }, { status: 400 });

    const { data, error } = await supabase.from('research_journal_entries').insert({
        user_id: user.id, symbol, reason, scenario,
    }).select('id, symbol, reason, scenario, review_status, review_note, reviewed_at, created_at, updated_at').single();
    if (error) return errorResponse(error, 'Araştırma günlüğü kaydedilemedi.');
    return NextResponse.json({ data: mapEntry(data as JournalRow) }, { status: 201 });
}

export async function PATCH(request: Request) {
    const { supabase, user } = await getContext();
    if (!supabase) return NextResponse.json({ error: 'Supabase bağlantısı yapılandırılmamış.' }, { status: 503 });
    if (!user) return NextResponse.json({ error: 'Araştırma günlüğünü güncellemek için giriş yapmalısınız.' }, { status: 401 });

    const body = await readBody(request);
    const id = typeof body?.id === 'string' ? body.id : '';
    if (!body || !isEntryId(id)) return NextResponse.json({ error: 'Güncellenecek kayıt bulunamadı.' }, { status: 400 });

    const updates: Record<string, string | null> = { updated_at: new Date().toISOString() };
    if (body.symbol !== undefined) {
        const symbol = typeof body.symbol === 'string' ? body.symbol.trim().toUpperCase() : '';
        if (!/^[A-Z0-9]{3,6}$/.test(symbol)) return NextResponse.json({ error: 'Geçerli bir hisse kodu girin.' }, { status: 400 });
        updates.symbol = symbol;
    }
    if (body.reason !== undefined) {
        const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
        if (!reason || reason.length > 2000) return NextResponse.json({ error: 'Takip gerekçesi 1-2000 karakter olmalıdır.' }, { status: 400 });
        updates.reason = reason;
    }
    if (body.scenario !== undefined) {
        const scenario = typeof body.scenario === 'string' ? body.scenario.trim() : '';
        if (!scenario || scenario.length > 2000) return NextResponse.json({ error: 'Senaryo 1-2000 karakter olmalıdır.' }, { status: 400 });
        updates.scenario = scenario;
    }
    if (body.reviewStatus !== undefined || body.reviewNote !== undefined) {
        const reviewStatus = body.reviewStatus;
        const reviewNote = typeof body.reviewNote === 'string' ? body.reviewNote.trim() : '';
        if (typeof reviewStatus !== 'string' || !REVIEW_STATUSES.includes(reviewStatus as ReviewStatus)) {
            return NextResponse.json({ error: 'Geçerli bir sonuç değerlendirmesi seçin.' }, { status: 400 });
        }
        if (reviewNote.length > 2000 || (reviewStatus !== 'pending' && !reviewNote)) {
            return NextResponse.json({ error: 'Gerçekleşen sonuç 1-2000 karakter olmalıdır.' }, { status: 400 });
        }
        updates.review_status = reviewStatus;
        updates.review_note = reviewStatus === 'pending' ? '' : reviewNote;
        updates.reviewed_at = reviewStatus === 'pending' ? null : new Date().toISOString();
    }
    if (Object.keys(updates).length === 1) return NextResponse.json({ error: 'Güncellenecek bir alan gerekli.' }, { status: 400 });

    const { data, error } = await supabase.from('research_journal_entries').update(updates)
        .eq('id', id).eq('user_id', user.id)
        .select('id, symbol, reason, scenario, review_status, review_note, reviewed_at, created_at, updated_at')
        .maybeSingle();
    if (error) return errorResponse(error, 'Araştırma günlüğü güncellenemedi.');
    if (!data) return NextResponse.json({ error: 'Kayıt bulunamadı.' }, { status: 404 });
    return NextResponse.json({ data: mapEntry(data as JournalRow) });
}

export async function DELETE(request: Request) {
    const { supabase, user } = await getContext();
    if (!supabase) return NextResponse.json({ error: 'Supabase bağlantısı yapılandırılmamış.' }, { status: 503 });
    if (!user) return NextResponse.json({ error: 'Araştırma günlüğünden kayıt silmek için giriş yapmalısınız.' }, { status: 401 });

    const body = await readBody(request);
    const id = typeof body?.id === 'string' ? body.id : '';
    if (!isEntryId(id)) return NextResponse.json({ error: 'Silinecek kayıt bulunamadı.' }, { status: 400 });
    const { data, error } = await supabase.from('research_journal_entries').delete()
        .eq('id', id).eq('user_id', user.id).select('id').maybeSingle();
    if (error) return errorResponse(error, 'Araştırma günlüğü kaydı silinemedi.');
    if (!data) return NextResponse.json({ error: 'Kayıt bulunamadı.' }, { status: 404 });
    return NextResponse.json({ success: true });
}
