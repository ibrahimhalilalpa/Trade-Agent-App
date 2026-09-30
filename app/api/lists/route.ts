import { NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabase-server';

type ListAction = 'create' | 'rename' | 'delete' | 'add' | 'remove' | 'reorder_lists' | 'reorder_symbols';
type ListBody = { action?: unknown; id?: unknown; name?: unknown; symbol?: unknown; order?: unknown };
const SCHEMA_ERROR = 'Liste tabloları henüz kurulmamış. Supabase SQL Editor’da supabase/schema.sql dosyasını çalıştırın.';

function isSchemaError(error: { code?: string; message?: string } | null): boolean {
    return error?.code === '42P01' || error?.code === 'PGRST205' || error?.code === 'PGRST202'
        || error?.message?.includes('watchlists') === true;
}

async function authenticatedClient() {
    const supabase = await getSupabaseServerClient();
    if (!supabase) return { supabase: null, user: null };
    const { data: { user } } = await supabase.auth.getUser();
    return { supabase, user };
}

async function ensureDefaultLists(supabase: NonNullable<Awaited<ReturnType<typeof authenticatedClient>>['supabase']>, userId: string) {
    return supabase.from('watchlists').upsert([
        { user_id: userId, name: 'Favoriler', is_favorites: true },
        { user_id: userId, name: 'Alacaklarım', is_favorites: false },
        { user_id: userId, name: 'Aldıklarım', is_favorites: false },
        { user_id: userId, name: 'Almayı düşündüklerim', is_favorites: false },
    ], { onConflict: 'user_id,name', ignoreDuplicates: true });
}

export async function GET() {
    const { supabase, user } = await authenticatedClient();
    if (!supabase) return NextResponse.json({ error: 'Supabase bağlantısı yapılandırılmamış.' }, { status: 503 });
    if (!user) return NextResponse.json({ error: 'Bu işlem için giriş yapmalısınız.' }, { status: 401 });
    const defaults = await ensureDefaultLists(supabase, user.id);
    if (defaults.error) return NextResponse.json({ error: isSchemaError(defaults.error) ? SCHEMA_ERROR : 'Varsayılan listeler hazırlanamadı.' }, { status: 500 });
    const { data, error } = await supabase.from('watchlists').select('id, name, is_favorites, sort_order, watchlist_symbols(symbol, sort_order)').order('is_favorites', { ascending: false }).order('sort_order').order('created_at').order('sort_order', { referencedTable: 'watchlist_symbols' }).order('created_at', { referencedTable: 'watchlist_symbols' });
    if (error) return NextResponse.json({ error: isSchemaError(error) ? SCHEMA_ERROR : 'Listeler yüklenemedi.' }, { status: 500 });
    return NextResponse.json({ success: true, data: (data ?? []).map((list) => ({ id: list.id, name: list.name, isFavorites: list.is_favorites, symbols: (list.watchlist_symbols as Array<{ symbol: string }> ?? []).map((item) => item.symbol) })) });
}

export async function POST(request: Request) {
    const { supabase, user } = await authenticatedClient();
    if (!supabase) return NextResponse.json({ error: 'Supabase bağlantısı yapılandırılmamış.' }, { status: 503 });
    if (!user) return NextResponse.json({ error: 'Bu işlem için giriş yapmalısınız.' }, { status: 401 });
    const body = await request.json() as ListBody;
    const action = body.action as ListAction;
    const id = typeof body.id === 'string' ? body.id : '';
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const symbol = typeof body.symbol === 'string' ? body.symbol.trim().toUpperCase() : '';
    const order = Array.isArray(body.order) && body.order.every((item) => typeof item === 'string') ? body.order as string[] : null;

    if (action === 'create') {
        if (!name || name.length > 80) return NextResponse.json({ error: 'Liste adı 1-80 karakter olmalı.' }, { status: 400 });
        const { data: lastList, error: orderError } = await supabase.from('watchlists').select('sort_order').eq('user_id', user.id).eq('is_favorites', false).order('sort_order', { ascending: false }).limit(1).maybeSingle();
        if (orderError) return NextResponse.json({ error: isSchemaError(orderError) ? SCHEMA_ERROR : 'Liste sırası alınamadı.' }, { status: 500 });
        const { error } = await supabase.from('watchlists').insert({ user_id: user.id, name, sort_order: (lastList?.sort_order ?? -1) + 1 });
        if (error?.code === '23505') return NextResponse.json({ error: 'Bu isimde bir listeniz zaten var.' }, { status: 409 });
        if (error) return NextResponse.json({ error: isSchemaError(error) ? SCHEMA_ERROR : 'Liste oluşturulamadı.' }, { status: 500 });
    } else if (action === 'rename') {
        if (!id || !name || name.length > 80) return NextResponse.json({ error: 'Geçerli bir liste adı gerekli.' }, { status: 400 });
        const { error } = await supabase.from('watchlists').update({ name }).eq('id', id).eq('is_favorites', false);
        if (error) return NextResponse.json({ error: isSchemaError(error) ? SCHEMA_ERROR : 'Liste adı güncellenemedi.' }, { status: 500 });
    } else if (action === 'delete') {
        if (!id) return NextResponse.json({ error: 'Geçerli bir liste gerekli.' }, { status: 400 });
        const { error } = await supabase.from('watchlists').delete().eq('id', id).eq('is_favorites', false);
        if (error) return NextResponse.json({ error: isSchemaError(error) ? SCHEMA_ERROR : 'Liste silinemedi.' }, { status: 500 });
    } else if (action === 'add') {
        if (!id || !/^[A-Z0-9]{3,6}$/.test(symbol)) return NextResponse.json({ error: 'Geçerli bir liste ve hisse kodu gerekli.' }, { status: 400 });
        const { data: lastSymbol, error: orderError } = await supabase.from('watchlist_symbols').select('sort_order').eq('watchlist_id', id).order('sort_order', { ascending: false }).limit(1).maybeSingle();
        if (orderError) return NextResponse.json({ error: isSchemaError(orderError) ? SCHEMA_ERROR : 'Hisse sırası alınamadı.' }, { status: 500 });
        const { error } = await supabase.from('watchlist_symbols').insert({ watchlist_id: id, symbol, sort_order: (lastSymbol?.sort_order ?? -1) + 1 });
        if (error && error.code !== '23505') return NextResponse.json({ error: isSchemaError(error) ? SCHEMA_ERROR : 'Hisse listeye eklenemedi.' }, { status: 500 });
    } else if (action === 'remove') {
        if (!id || !/^[A-Z0-9]{3,6}$/.test(symbol)) return NextResponse.json({ error: 'Geçerli bir liste ve hisse kodu gerekli.' }, { status: 400 });
        const { error } = await supabase.from('watchlist_symbols').delete().eq('watchlist_id', id).eq('symbol', symbol);
        if (error) return NextResponse.json({ error: isSchemaError(error) ? SCHEMA_ERROR : 'Hisse listeden çıkarılamadı.' }, { status: 500 });
    } else if (action === 'reorder_lists') {
        if (!order || new Set(order).size !== order.length) return NextResponse.json({ error: 'Liste sıralaması geçersiz.' }, { status: 400 });
        const { data: lists, error } = await supabase.from('watchlists').select('id').eq('user_id', user.id).eq('is_favorites', false);
        if (error) return NextResponse.json({ error: isSchemaError(error) ? SCHEMA_ERROR : 'Listeler sıralanamadı.' }, { status: 500 });
        const ownedIds = (lists ?? []).map((list) => list.id);
        if (order.length !== ownedIds.length || order.some((item) => !ownedIds.includes(item))) return NextResponse.json({ error: 'Liste sıralaması hesabınızdaki listelerle eşleşmiyor.' }, { status: 400 });
        for (const [position, listId] of order.entries()) {
            const { error: updateError } = await supabase.from('watchlists').update({ sort_order: position }).eq('id', listId).eq('user_id', user.id).eq('is_favorites', false);
            if (updateError) return NextResponse.json({ error: isSchemaError(updateError) ? SCHEMA_ERROR : 'Liste sıralaması kaydedilemedi.' }, { status: 500 });
        }
    } else if (action === 'reorder_symbols') {
        if (!id || !order || new Set(order).size !== order.length || order.some((item) => !/^[A-Z0-9]{3,6}$/.test(item))) return NextResponse.json({ error: 'Hisse sıralaması geçersiz.' }, { status: 400 });
        const { data: list, error: listError } = await supabase.from('watchlists').select('id, watchlist_symbols(symbol)').eq('id', id).eq('user_id', user.id).maybeSingle();
        if (listError) return NextResponse.json({ error: isSchemaError(listError) ? SCHEMA_ERROR : 'Hisse listesi doğrulanamadı.' }, { status: 500 });
        if (!list) return NextResponse.json({ error: 'Liste bulunamadı.' }, { status: 404 });
        const existingSymbols = (list.watchlist_symbols as Array<{ symbol: string }> ?? []).map((item) => item.symbol);
        if (order.length !== existingSymbols.length || order.some((item) => !existingSymbols.includes(item))) return NextResponse.json({ error: 'Hisse sıralaması listedeki hisselerle eşleşmiyor.' }, { status: 400 });
        for (const [position, item] of order.entries()) {
            const { error: updateError } = await supabase.from('watchlist_symbols').update({ sort_order: position }).eq('watchlist_id', id).eq('symbol', item);
            if (updateError) return NextResponse.json({ error: isSchemaError(updateError) ? SCHEMA_ERROR : 'Hisse sıralaması kaydedilemedi.' }, { status: 500 });
        }
    } else return NextResponse.json({ error: 'Geçersiz liste işlemi.' }, { status: 400 });

    if (action === 'reorder_lists' || action === 'reorder_symbols') return GET();
    return GET();
}