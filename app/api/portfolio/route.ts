import { NextResponse } from 'next/server';
import { describeBistPriceStep, isValidBistPriceTick } from '@/lib/bist-market';
import { getSupabaseServerClient } from '@/lib/supabase-server';
import type { BistTradingStatus, PortfolioOrderEvent, PortfolioOrder, PortfolioPosition, PortfolioSnapshot, PortfolioState, PortfolioTrade, PriceAlertEvent } from '@/lib/types';

const ALLOWED_ORDER_EXPIRY_MINUTES = new Set([0, 60, 1_440, 10_080, 43_200]);
const SCHEMA_SETUP_MESSAGE = 'Portföy veritabanı kurulumu eksik. Supabase SQL Editor’da supabase/portfolio-migration.sql dosyasının tamamını çalıştırın.';
const ORDERS_SETUP_MESSAGE = 'Emir altyapısı kurulumu eksik. Supabase SQL Editor’da supabase/portfolio-orders-migration.sql, supabase/portfolio-order-management-migration.sql, supabase/portfolio-order-reservations-migration.sql ve supabase/portfolio-order-expiry-migration.sql dosyalarını çalıştırın.';
const MARKET_RULES_SETUP_MESSAGE = 'BİST işlem kuralları kurulumu eksik. Supabase SQL Editor’da supabase/virtual-trading-market-rules-migration.sql dosyasını çalıştırın.';
const RESET_SETUP_MESSAGE = 'Portföy sıfırlama kurulumu eksik. Supabase SQL Editor’da güncel supabase/portfolio-orders-migration.sql dosyasını çalıştırın.';

function isPortfolioSetupError(error: { code?: string; message?: string } | null): boolean {
    return error?.code === '42P01' || error?.code === 'PGRST205' || error?.code === 'PGRST202'
        || error?.code === 'PGRST204' || error?.code === '42883' || error?.code === '42703'
        || error?.code === '42P10' || error?.code === '42501'
        || /portfolio_(transactions|snapshots|action|orders?|order_events|realized_pnl|period_pnl|reset|reserved_cash|order_with_expiry)|price_alert_events|expire_portfolio_order|expires_at|bist_trading_calendar|get_bist_trading_status/i.test(error?.message ?? '');
}

function portfolioSetupMessage(error: { message?: string } | null): string {
    if (/portfolio_reset/i.test(error?.message ?? '')) return RESET_SETUP_MESSAGE;
    if (/bist_|commission_amount|slippage_amount|get_bist_trading_status/i.test(error?.message ?? '')) return MARKET_RULES_SETUP_MESSAGE;
    if (/reserved_cash/i.test(error?.message ?? '')) return ORDERS_SETUP_MESSAGE;
    if (/expires_at|order_with_expiry|expire_portfolio_order/i.test(error?.message ?? '')) return ORDERS_SETUP_MESSAGE;
    return /portfolio_(orders?|order_events|realized_pnl|period_pnl)|price_alert_events/i.test(error?.message ?? '') ? ORDERS_SETUP_MESSAGE : SCHEMA_SETUP_MESSAGE;
}

async function getContext() {
    const supabase = await getSupabaseServerClient();
    if (!supabase) return { supabase: null, user: null };
    const { data: { user } } = await supabase.auth.getUser();
    return { supabase, user };
}

async function getLatestPrice(symbol: string): Promise<number | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    try {
        const tradingViewResponse = await fetch('https://scanner.tradingview.com/turkey/scan', {
            method: 'POST',
            signal: controller.signal,
            cache: 'no-store',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({
                symbols: { tickers: [`BIST:${symbol}`] },
                columns: ['close'],
            }),
        });
        if (tradingViewResponse.ok) {
            const payload = await tradingViewResponse.json() as {
                data?: Array<{ s?: string; d?: Array<string | number | null> }>;
            };
            const quote = payload.data?.find((item) => item.s === `BIST:${symbol}`)?.d?.[0];
            if (typeof quote === 'number' && Number.isFinite(quote) && quote > 0) return quote;
        }

        const loadClose = async (range: string, interval: string): Promise<number | null> => {
            const response = await fetch(
                `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}.IS?range=${range}&interval=${interval}`,
                { signal: controller.signal, cache: 'no-store', headers: { Accept: 'application/json' } },
            );
            if (!response.ok) return null;
            const payload = await response.json() as {
                chart?: { result?: Array<{ indicators?: { quote?: Array<{ close?: Array<number | null> }> } }> };
            };
            const closes = payload.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? [];
            return [...closes].reverse().find((value): value is number => typeof value === 'number' && Number.isFinite(value)) ?? null;
        };
        return await loadClose('1d', '1m') ?? await loadClose('5d', '1d');
    } catch {
        return null;
    } finally {
        clearTimeout(timeout);
    }
}

async function getExecutionPrice(symbol: string): Promise<number | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    try {
        const response = await fetch('https://scanner.tradingview.com/turkey/scan', {
            method: 'POST',
            signal: controller.signal,
            cache: 'no-store',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({
                symbols: { tickers: [`BIST:${symbol}`] },
                columns: ['close'],
            }),
        });
        if (!response.ok) return null;
        const payload = await response.json() as {
            data?: Array<{ s?: string; d?: Array<string | number | null> }>;
        };
        const price = payload.data?.find((item) => item.s === `BIST:${symbol}`)?.d?.[0];
        return typeof price === 'number' && Number.isFinite(price) && price > 0 ? price : null;
    } catch {
        return null;
    } finally {
        clearTimeout(timeout);
    }
}

export async function GET(request: Request) {
    const { supabase, user } = await getContext();
    if (!supabase) return NextResponse.json({ error: 'Supabase bağlantısı yapılandırılmamış.' }, { status: 503 });
    if (!user) return NextResponse.json({ error: 'Bu işlem için giriş yapmalısınız.' }, { status: 401 });
    const tradingStatusResult = await supabase.rpc('get_bist_trading_status');
    if (tradingStatusResult.error) {
        console.error('BIST trading status lookup failed.', tradingStatusResult.error);
        return NextResponse.json({
            error: 'BİST seans takvimi kurulu değil. Supabase SQL Editor’da virtual-trading-market-rules-migration.sql dosyasını çalıştırın.',
        }, { status: 503 });
    }
    const marketStatus = tradingStatusResult.data as BistTradingStatus;

    const { error: createPortfolioError } = await supabase.from('user_portfolios')
        .upsert({ user_id: user.id }, { onConflict: 'user_id', ignoreDuplicates: true });
    if (isPortfolioSetupError(createPortfolioError)) return NextResponse.json({ error: SCHEMA_SETUP_MESSAGE }, { status: 503 });
    if (createPortfolioError) return NextResponse.json({ error: 'Portföy oluşturulamadı.' }, { status: 500 });
    const { data: portfolio, error: portfolioError } = await supabase.from('user_portfolios')
        .select('id, balance').eq('user_id', user.id).single();
    if (isPortfolioSetupError(portfolioError)) return NextResponse.json({ error: SCHEMA_SETUP_MESSAGE }, { status: 503 });
    if (portfolioError) return NextResponse.json({ error: 'Portföy yüklenemedi.' }, { status: 500 });

    const { data: positions, error: positionsError } = await supabase.from('user_positions')
        .select('symbol, quantity, average_price, current_price, pnl').eq('portfolio_id', portfolio.id);
    if (isPortfolioSetupError(positionsError)) return NextResponse.json({ error: SCHEMA_SETUP_MESSAGE }, { status: 503 });
    if (positionsError) return NextResponse.json({ error: 'Pozisyonlar yüklenemedi.' }, { status: 500 });
    const staleSymbols: string[] = [];
    const mapped: PortfolioPosition[] = await Promise.all((positions ?? []).map(async (position) => {
        const freshPrice = await getLatestPrice(position.symbol);
        const currentPrice = freshPrice ?? Number(position.current_price);
        if (freshPrice === null) staleSymbols.push(position.symbol);
        else {
            const { error } = await supabase.from('user_positions').update({
                current_price: currentPrice,
                pnl: (currentPrice - Number(position.average_price)) * Number(position.quantity),
            }).eq('portfolio_id', portfolio.id).eq('symbol', position.symbol);
            if (error) console.error('Portfolio position price refresh failed.', error);
        }
        return {
            symbol: position.symbol, quantity: Number(position.quantity), averagePrice: Number(position.average_price),
            currentPrice, pnl: (currentPrice - Number(position.average_price)) * Number(position.quantity),
        };
    }));

    const balance = Number(portfolio.balance);
    const totalValue = balance + mapped.reduce((sum, position) => sum + position.quantity * position.currentPrice, 0);
    const today = new Date().toISOString().slice(0, 10);
    const { error: snapshotWriteError } = await supabase.from('portfolio_snapshots').upsert({
        portfolio_id: portfolio.id,
        snapshot_date: today,
        cash_balance: balance,
        total_value: totalValue,
    }, { onConflict: 'portfolio_id,snapshot_date' });
    if (snapshotWriteError) console.error('Portfolio snapshot refresh failed.', snapshotWriteError);
    const requestedPeriod = new URL(request.url).searchParams.get('pnlPeriod');
    const pnlPeriod = requestedPeriod === 'week' || requestedPeriod === 'month' || requestedPeriod === 'all'
        ? requestedPeriod : 'day';
    const [tradeResult, snapshotResult, orderResult, orderEventsResult, priceAlertEventsResult, realizedResult, periodPnlResult, reservedCashResult] = await Promise.all([
        supabase.from('portfolio_transactions').select('id, symbol, transaction_type, quantity, price, cash_delta, realized_pnl, commission_amount, slippage_amount, created_at')
            .eq('portfolio_id', portfolio.id).order('created_at', { ascending: false }).limit(500),
        supabase.from('portfolio_snapshots').select('snapshot_date, cash_balance, total_value')
            .eq('portfolio_id', portfolio.id).order('snapshot_date', { ascending: true }).limit(2000),
        supabase.from('portfolio_orders').select('id, symbol, side, order_type, quantity, trigger_price, take_profit_price, stop_loss_price, expires_at, status, error, created_at')
            .eq('portfolio_id', portfolio.id).eq('status', 'pending').order('created_at', { ascending: false }).limit(100),
        supabase.from('portfolio_order_events')
            .select('id, symbol, side, order_type, quantity, event_type, price, error, created_at')
            .eq('portfolio_id', portfolio.id).order('created_at', { ascending: false }).limit(200),
        supabase.from('price_alert_events')
            .select('id, alert_id, symbol, direction, event_type, target_price, market_price, created_at')
            .eq('user_id', user.id).order('created_at', { ascending: false }).limit(200),
        supabase.rpc('get_portfolio_realized_pnl', { p_user_id: user.id }),
        supabase.rpc('get_portfolio_period_pnl', {
            p_user_id: user.id, p_current_value: totalValue, p_period: pnlPeriod,
        }),
        supabase.rpc('get_portfolio_reserved_cash', { p_user_id: user.id }),
    ]);
    if (tradeResult.error || snapshotResult.error || orderResult.error || orderEventsResult.error || priceAlertEventsResult.error || realizedResult.error || periodPnlResult.error || reservedCashResult.error) {
        const schemaError = tradeResult.error ?? snapshotResult.error ?? orderResult.error ?? orderEventsResult.error ?? priceAlertEventsResult.error ?? realizedResult.error ?? periodPnlResult.error ?? reservedCashResult.error;
        return NextResponse.json({
            error: isPortfolioSetupError(schemaError) ? portfolioSetupMessage(schemaError) : 'Portföy geçmişi yüklenemedi.',
        }, { status: isPortfolioSetupError(schemaError) ? 503 : 500 });
    }

    const trades: PortfolioTrade[] = (tradeResult.data ?? []).map((trade) => ({
        id: trade.id, symbol: trade.symbol ?? '', side: trade.transaction_type as PortfolioTrade['side'],
        quantity: Number(trade.quantity), price: Number(trade.price), cashDelta: Number(trade.cash_delta),
        realizedPnl: Number(trade.realized_pnl), commissionAmount: Number(trade.commission_amount),
        slippageAmount: Number(trade.slippage_amount), createdAt: trade.created_at,
    }));
    const snapshots: PortfolioSnapshot[] = (snapshotResult.data ?? []).map((snapshot) => ({
        totalValue: Number(snapshot.total_value), cashBalance: Number(snapshot.cash_balance),
        createdAt: snapshot.snapshot_date,
    }));
    const orders: PortfolioOrder[] = (orderResult.data ?? []).map((order) => ({
        id: order.id, symbol: order.symbol, side: order.side as PortfolioOrder['side'],
        orderType: order.order_type as PortfolioOrder['orderType'], quantity: Number(order.quantity),
        triggerPrice: order.trigger_price === null ? null : Number(order.trigger_price),
        takeProfitPrice: order.take_profit_price === null ? null : Number(order.take_profit_price),
        stopLossPrice: order.stop_loss_price === null ? null : Number(order.stop_loss_price),
        expiresAt: order.expires_at,
        error: order.error,
        status: order.status as PortfolioOrder['status'], createdAt: order.created_at,
    }));
    const reservedCash = Number(reservedCashResult.data ?? 0);
    const orderEvents: PortfolioOrderEvent[] = (orderEventsResult.data ?? []).map((event) => ({
        id: event.id, symbol: event.symbol, side: event.side as PortfolioOrderEvent['side'],
        orderType: event.order_type as PortfolioOrderEvent['orderType'], quantity: Number(event.quantity),
        eventType: event.event_type as PortfolioOrderEvent['eventType'],
        price: event.price === null ? null : Number(event.price), error: event.error, createdAt: event.created_at,
    }));
    const priceAlertEvents: PriceAlertEvent[] = (priceAlertEventsResult.data ?? []).map((event) => ({
        id: event.id, alertId: event.alert_id, symbol: event.symbol,
        direction: event.direction as PriceAlertEvent['direction'],
        eventType: event.event_type as PriceAlertEvent['eventType'],
        targetPrice: Number(event.target_price),
        marketPrice: event.market_price === null ? null : Number(event.market_price),
        createdAt: event.created_at,
    }));
    const data: PortfolioState = {
        balance, availableBalance: balance - reservedCash, reservedCash, marketStatus,
        positions: mapped, realizedPnl: Number(realizedResult.data ?? 0),
        periodPnl: periodPnlResult.data === null ? null : Number(periodPnlResult.data),
        trades, orders, orderEvents, priceAlertEvents, snapshots, source: 'supabase',
    };
    return NextResponse.json({ success: true, data, totalValue, staleSymbols });
}

async function processAction(request: Request, action: 'buy' | 'sell') {
    const { supabase, user } = await getContext();
    if (!supabase) return NextResponse.json({ error: 'Supabase bağlantısı yapılandırılmamış.' }, { status: 503 });
    if (!user) return NextResponse.json({ error: 'Bu işlem için giriş yapmalısınız.' }, { status: 401 });
    let body: {
        symbol?: unknown; price?: unknown; quantity?: unknown; orderType?: unknown; expiresInMinutes?: unknown;
        triggerPrice?: unknown; takeProfitPrice?: unknown; stopLossPrice?: unknown;
    };
    try {
        body = await request.json() as typeof body;
    } catch {
        return NextResponse.json({ error: 'İstek gövdesi geçerli JSON olmalıdır.' }, { status: 400 });
    }
    const symbol = typeof body.symbol === 'string' ? body.symbol.trim().toUpperCase() : '';
    const price = typeof body.price === 'number' ? body.price : 0;
    const quantity = typeof body.quantity === 'number' ? body.quantity : 0;
    const orderType = body.orderType ?? 'market';
    const triggerPrice = typeof body.triggerPrice === 'number' ? body.triggerPrice : null;
    const takeProfitPrice = typeof body.takeProfitPrice === 'number' ? body.takeProfitPrice : null;
    const stopLossPrice = typeof body.stopLossPrice === 'number' ? body.stopLossPrice : null;
    if (!/^[A-Z0-9]{3,6}$/.test(symbol) || quantity <= 0 || !Number.isInteger(quantity)) {
        return NextResponse.json({ error: 'Geçerli bir hisse ve pozitif tam sayı adet girin.' }, { status: 400 });
    }
    const { data: tradingStatusData, error: tradingStatusError } = await supabase.rpc('get_bist_trading_status');
    if (tradingStatusError) {
        console.error('BIST trading status validation failed.', tradingStatusError);
        return NextResponse.json({ error: 'BİST seans durumu doğrulanamadı; işlem güvenlik için durduruldu.' }, { status: 503 });
    }
    const tradingStatus = tradingStatusData as BistTradingStatus;

    if ((orderType === 'market' || orderType === 'manual') && !tradingStatus.isOpen) {
        return NextResponse.json({ error: tradingStatus.message ?? 'BİST sürekli işlem seansı kapalı.' }, { status: 400 });
    }

    if (orderType !== 'market' && orderType !== 'manual') {
        if (orderType !== 'limit' && orderType !== 'take_profit' && orderType !== 'stop_loss' && orderType !== 'chain') {
            return NextResponse.json({ error: 'Geçersiz emir tipi.' }, { status: 400 });
        }
        const orderPrices = orderType === 'chain'
            ? [takeProfitPrice, stopLossPrice]
            : [triggerPrice];
        const invalidPrice = orderPrices.find((value) => value !== null && !isValidBistPriceTick(value));
        if (invalidPrice !== undefined && invalidPrice !== null) {
            return NextResponse.json({
                error: `${invalidPrice.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 6 })} TL fiyatı BİST fiyat adımına uygun değil. Bu fiyat aralığında adım ${describeBistPriceStep(invalidPrice)} TL olmalıdır.`,
            }, { status: 400 });
        }
        const expiresInMinutes = body.expiresInMinutes === undefined ? 43_200 : body.expiresInMinutes;
        if (typeof expiresInMinutes !== 'number' || !ALLOWED_ORDER_EXPIRY_MINUTES.has(expiresInMinutes)) {
            return NextResponse.json({ error: 'Emir süresi 1 saat, 1 gün, 7 gün, 30 gün veya süresiz olarak seçilmelidir.' }, { status: 400 });
        }
        const expiresAt = expiresInMinutes === 0
            ? null
            : new Date(Date.now() + expiresInMinutes * 60_000).toISOString();
        if (orderType === 'limit') {
            if (triggerPrice === null || !Number.isFinite(triggerPrice) || triggerPrice <= 0) {
                return NextResponse.json({ error: 'Limit fiyatı sıfırdan büyük olmalıdır.' }, { status: 400 });
            }
            const marketPrice = tradingStatus?.isOpen ? await getExecutionPrice(symbol) : null;
            if (marketPrice !== null && ((action === 'buy' && marketPrice <= triggerPrice)
                || (action === 'sell' && marketPrice >= triggerPrice))) {
                const { error } = await supabase.rpc('execute_immediate_limit_order', {
                    p_user_id: user.id, p_symbol: symbol, p_side: action,
                    p_quantity: quantity, p_trigger_price: triggerPrice, p_market_price: marketPrice,
                });
                if (error) {
                    if (isPortfolioSetupError(error)) {
                        return NextResponse.json({ error: ORDERS_SETUP_MESSAGE }, { status: 503 });
                    }
                    const validationError = /yetersiz|fazla olamaz|yetkisiz portföy|seansı kapalı|fiyat adımına uygun|tam sayı/i.test(error.message);
                    return NextResponse.json({
                        error: validationError ? error.message : 'Limit emri piyasa fiyatından gerçekleştirilemedi.',
                    }, { status: validationError ? 400 : 500 });
                }
                const result = await GET(new Request('http://localhost/api/portfolio'));
                return NextResponse.json({
                    ...await result.json(), orderExecution: 'filled', executionPrice: marketPrice,
                }, { status: result.status });
            }
        }

        const { error } = await supabase.rpc('create_portfolio_order_with_expiry', {
            p_user_id: user.id, p_symbol: symbol, p_side: action, p_order_type: orderType,
            p_quantity: quantity, p_trigger_price: triggerPrice,
            p_take_profit_price: takeProfitPrice, p_stop_loss_price: stopLossPrice,
            p_expires_at: expiresAt,
        });
        if (error) return NextResponse.json({
            error: isPortfolioSetupError(error) ? portfolioSetupMessage(error) : error.message || 'Emir kaydedilemedi.',
        }, { status: isPortfolioSetupError(error) ? 503 : 400 });
        const result = await GET(new Request('http://localhost/api/portfolio'));
        return NextResponse.json({ ...await result.json(), orderExecution: 'pending' }, { status: result.status });
    }

    if (orderType === 'manual' && (!Number.isFinite(price) || price <= 0)) {
        return NextResponse.json({ error: 'Serbest işlem fiyatı sıfırdan büyük olmalıdır.' }, { status: 400 });
    }
    if (orderType === 'manual') {
        const { data: role, error: roleError } = await supabase.from('user_roles')
            .select('role').eq('user_id', user.id).maybeSingle();
        if (roleError) {
            console.error('Manual-price trade role verification failed.', roleError);
            return NextResponse.json({ error: 'Kullanıcı yetkisi doğrulanamadı.' }, { status: 500 });
        }
        if (role?.role !== 'super_admin') {
            return NextResponse.json({ error: 'Serbest fiyatlı işlemler yalnızca super admin tarafından yapılabilir.' }, { status: 403 });
        }
    }
    const marketPrice = orderType === 'manual' ? null : await getExecutionPrice(symbol);
    if (orderType === 'market' && marketPrice === null) {
        return NextResponse.json({ error: 'Güncel piyasa fiyatı alınamadı; piyasa emri gönderilmedi.' }, { status: 503 });
    }
    const executionPrice = orderType === 'manual' ? price : marketPrice ?? price;

    const { error } = await supabase.rpc('process_portfolio_action', {
        p_user_id: user.id, p_action: action, p_symbol: symbol,
        p_quantity: quantity, p_price: executionPrice,
    });
    if (error) {
        if (isPortfolioSetupError(error)) return NextResponse.json({ error: SCHEMA_SETUP_MESSAGE }, { status: 503 });
        const validationError = /yetersiz|fazla olamaz|sıfır veya daha büyük|geçersiz sanal emir|yetkisiz portföy|rezerve edilen|seansı kapalı|fiyat adımına uygun|tam sayı/i.test(error.message);
        return NextResponse.json({
            error: validationError ? error.message : 'Portföy işlemi tamamlanamadı. Lütfen daha sonra tekrar deneyin.',
        }, { status: validationError ? 400 : 500 });
    }

    return GET(new Request('http://localhost/api/portfolio'));
}

export async function POST(request: Request) {
    let body: { side?: unknown; action?: unknown };
    try {
        body = await request.clone().json() as typeof body;
    } catch {
        return NextResponse.json({ error: 'İstek gövdesi geçerli JSON olmalıdır.' }, { status: 400 });
    }
    if (body.action === 'reset') {
        const { supabase, user } = await getContext();
        if (!supabase) return NextResponse.json({ error: 'Supabase bağlantısı yapılandırılmamış.' }, { status: 503 });
        if (!user) return NextResponse.json({ error: 'Bu işlem için giriş yapmalısınız.' }, { status: 401 });
        const { error } = await supabase.rpc('reset_portfolio', { p_user_id: user.id });
        if (error) return NextResponse.json({
            error: isPortfolioSetupError(error) ? portfolioSetupMessage(error) : 'Portföy sıfırlanamadı.',
        }, { status: isPortfolioSetupError(error) ? 503 : 500 });
        return GET(new Request('http://localhost/api/portfolio'));
    }
    if (body.side !== 'buy' && body.side !== 'sell') return NextResponse.json({ error: 'İşlem türü alım veya satım olmalıdır.' }, { status: 400 });
    return processAction(request, body.side);
}

export async function PATCH(request: Request) {
    let body: {
        action?: unknown;
        orderId?: unknown;
        quantity?: unknown;
        triggerPrice?: unknown;
        takeProfitPrice?: unknown;
        stopLossPrice?: unknown;
        expiresInMinutes?: unknown;
    };
    try {
        body = await request.clone().json() as typeof body;
    } catch {
        return NextResponse.json({ error: 'İstek gövdesi geçerli JSON olmalıdır.' }, { status: 400 });
    }
    if (body.action === 'update_order') {
        const { supabase, user } = await getContext();
        if (!supabase) return NextResponse.json({ error: 'Supabase bağlantısı yapılandırılmamış.' }, { status: 503 });
        if (!user) return NextResponse.json({ error: 'Emri güncellemek için giriş yapmalısınız.' }, { status: 401 });
        if (typeof body.orderId !== 'string' || typeof body.quantity !== 'number'
            || !Number.isFinite(body.quantity) || body.quantity <= 0
            || (body.triggerPrice !== null && body.triggerPrice !== undefined
                && (typeof body.triggerPrice !== 'number' || !Number.isFinite(body.triggerPrice) || body.triggerPrice <= 0))
            || (body.takeProfitPrice !== null && body.takeProfitPrice !== undefined
                && (typeof body.takeProfitPrice !== 'number' || !Number.isFinite(body.takeProfitPrice) || body.takeProfitPrice <= 0))
            || (body.stopLossPrice !== null && body.stopLossPrice !== undefined
                && (typeof body.stopLossPrice !== 'number' || !Number.isFinite(body.stopLossPrice) || body.stopLossPrice <= 0))
            || typeof body.expiresInMinutes !== 'number'
            || !ALLOWED_ORDER_EXPIRY_MINUTES.has(body.expiresInMinutes)) {
            return NextResponse.json({ error: 'Geçerli emir adedi ve tetik fiyatlarını girin.' }, { status: 400 });
        }
        const editPrices = [body.triggerPrice, body.takeProfitPrice, body.stopLossPrice]
            .filter((value): value is number => typeof value === 'number');
        const invalidPrice = editPrices.find((value) => !isValidBistPriceTick(value));
        if (invalidPrice !== undefined) {
            return NextResponse.json({
                error: `${invalidPrice.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 6 })} TL fiyatı BİST fiyat adımına uygun değil. Bu fiyat aralığında adım ${describeBistPriceStep(invalidPrice)} TL olmalıdır.`,
            }, { status: 400 });
        }
        const expiresAt = body.expiresInMinutes === 0
            ? null
            : new Date(Date.now() + body.expiresInMinutes * 60_000).toISOString();
        const { data, error } = await supabase.rpc('update_portfolio_order_with_expiry', {
            p_user_id: user.id,
            p_order_id: body.orderId,
            p_quantity: body.quantity,
            p_trigger_price: typeof body.triggerPrice === 'number' ? body.triggerPrice : null,
            p_take_profit_price: typeof body.takeProfitPrice === 'number' ? body.takeProfitPrice : null,
            p_stop_loss_price: typeof body.stopLossPrice === 'number' ? body.stopLossPrice : null,
            p_expires_at: expiresAt,
        });
        if (error) return NextResponse.json({
            error: isPortfolioSetupError(error) ? ORDERS_SETUP_MESSAGE : error.message || 'Emir güncellenemedi.',
        }, { status: isPortfolioSetupError(error) ? 503 : 400 });
        if (data !== true) return NextResponse.json({ error: 'Emir bulunamadı veya artık beklemede değil.' }, { status: 409 });
        return GET(new Request('http://localhost/api/portfolio'));
    }
    return NextResponse.json({ error: 'Sanal bakiye doğrudan değiştirilemez. Ek bakiye talebi gönderin.' }, { status: 400 });
}

export async function DELETE(request: Request) {
    const { supabase, user } = await getContext();
    if (!supabase) return NextResponse.json({ error: 'Supabase bağlantısı yapılandırılmamış.' }, { status: 503 });
    if (!user) return NextResponse.json({ error: 'Bu işlem için giriş yapmalısınız.' }, { status: 401 });
    const { searchParams } = new URL(request.url);
    const orderId = searchParams.get('orderId');
    if (!orderId) return NextResponse.json({ error: 'İptal edilecek emir seçilmedi.' }, { status: 400 });
    const { data, error } = await supabase.rpc('cancel_portfolio_order', { p_user_id: user.id, p_order_id: orderId });
    if (error) return NextResponse.json({
        error: isPortfolioSetupError(error) ? portfolioSetupMessage(error) : 'Emir iptal edilemedi.',
    }, { status: isPortfolioSetupError(error) ? 503 : 400 });
    if (!data) return NextResponse.json({ error: 'Emir bulunamadı veya artık beklemede değil.' }, { status: 409 });
    return GET(new Request('http://localhost/api/portfolio'));
}
