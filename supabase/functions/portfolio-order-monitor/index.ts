import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

type PendingOrder = {
    id: string;
    symbol: string;
    expires_at: string | null;
    error: string | null;
};

type ActiveAlert = {
    id: string;
    symbol: string;
    expires_at: string | null;
};

type TradingViewResponse = {
    data?: Array<{ s?: string; d?: Array<string | number | null> }>;
};

function authorized(request: Request, token: string): boolean {
    const supplied = request.headers.get('authorization') ?? '';
    const expected = `Bearer ${token}`;
    if (supplied.length !== expected.length) return false;
    let difference = 0;
    for (let index = 0; index < supplied.length; index += 1) {
        difference |= supplied.charCodeAt(index) ^ expected.charCodeAt(index);
    }
    return difference === 0;
}

async function latestPrice(symbol: string): Promise<number | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
        const response = await fetch('https://scanner.tradingview.com/turkey/scan', {
            method: 'POST',
            signal: controller.signal,
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({
                symbols: { tickers: [`BIST:${symbol}`] },
                columns: ['close'],
            }),
        });
        if (response.ok) {
            const payload = await response.json() as TradingViewResponse;
            const row = payload.data?.find((item) => item.s === `BIST:${symbol}`);
            const price = row?.d?.[0];
            if (typeof price === 'number' && Number.isFinite(price) && price > 0) return price;
        }
    } catch {
        // Try the secondary quote provider below.
    } finally {
        clearTimeout(timeout);
    }

    const yahooController = new AbortController();
    const yahooTimeout = setTimeout(() => yahooController.abort(), 10_000);
    try {
        const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}.IS`);
        url.searchParams.set('range', '1d');
        url.searchParams.set('interval', '1m');
        const response = await fetch(url, {
            signal: yahooController.signal,
            headers: { Accept: 'application/json' },
        });
        if (!response.ok) return null;
        const payload = await response.json() as {
            chart?: {
                result?: Array<{
                    meta?: { regularMarketPrice?: number };
                    indicators?: { quote?: Array<{ close?: Array<number | null> }> };
                }>
            };
        };
        const result = payload.chart?.result?.[0];
        const marketPrice = result?.meta?.regularMarketPrice;
        if (typeof marketPrice === 'number' && Number.isFinite(marketPrice) && marketPrice > 0) return marketPrice;
        const values = result?.indicators?.quote?.[0]?.close ?? [];
        return [...values].reverse().find((value): value is number =>
            typeof value === 'number' && Number.isFinite(value) && value > 0) ?? null;
    } finally {
        clearTimeout(yahooTimeout);
    }
}

function orderAttemptMessage(reason: string | undefined): string | null {
    if (reason === 'market_closed') return 'BİST seansı kapalı; emir seans açıldığında yeniden değerlendirilecek.';
    if (reason === 'invalid_price_tick') return 'Alınan piyasa fiyatı BİST fiyat adımına uymuyor; geçerli fiyat geldiğinde yeniden denenecek.';
    if (reason === 'price_not_triggered' || reason === 'not_pending' || reason === 'expired') return null;
    return 'Emir şu anda gerçekleşmedi; koşullar uygun olduğunda yeniden değerlendirilecek.';
}

async function saveOrderAttemptMessage(
    supabase: ReturnType<typeof createClient>,
    order: PendingOrder,
    message: string | null,
): Promise<string | null> {
    if (order.error === message) return null;
    const { error } = await supabase.from('portfolio_orders')
        .update({ error: message })
        .eq('id', order.id)
        .eq('status', 'pending');
    if (error) {
        console.error('Pending order attempt reason could not be saved.', { orderId: order.id, error });
        return error.message;
    }
    order.error = message;
    return null;
}

Deno.serve(async (request) => {
    const token = Deno.env.get('PORTFOLIO_MONITOR_TOKEN');
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!token || !supabaseUrl || !serviceRoleKey) {
        return Response.json({ error: 'Monitor secrets are not configured.' }, { status: 500 });
    }
    if (request.method !== 'POST') return Response.json({ error: 'Method not allowed.' }, { status: 405 });
    if (!authorized(request, token)) return Response.json({ error: 'Unauthorized.' }, { status: 401 });

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false },
    });
    const pendingOrders: PendingOrder[] = [];
    const activeAlerts: ActiveAlert[] = [];
    for (let offset = 0; ; offset += 500) {
        const { data, error } = await supabase.from('portfolio_orders')
            .select('id, symbol, expires_at, error').eq('status', 'pending').order('created_at').range(offset, offset + 499);
        if (error) return Response.json({ error: 'Pending portfolio orders could not be loaded.' }, { status: 500 });
        pendingOrders.push(...(data ?? []) as PendingOrder[]);
        if (!data || data.length < 500) break;
    }
    for (let offset = 0; ; offset += 500) {
        const { data, error } = await supabase.from('price_alerts')
            .select('id, symbol, expires_at').eq('status', 'active').order('created_at').range(offset, offset + 499);
        if (error) {
            return Response.json({ error: 'Active price alerts could not be loaded.' }, { status: 500 });
        }
        activeAlerts.push(...(data ?? []) as ActiveAlert[]);
        if (!data || data.length < 500) break;
    }
    if (pendingOrders.length + activeAlerts.length === 0) {
        return Response.json({ checked: 0, results: [], alertsChecked: 0, alertResults: [] });
    }
    const expiredOrderIds = new Set<string>();
    const results: Array<{ id: string; executed: boolean; expired?: boolean; observedPrice?: number; reason?: string; error?: string; persistenceError?: string }> = [];
    for (const order of pendingOrders) {
        if (order.expires_at && Date.parse(order.expires_at) <= Date.now()) {
            expiredOrderIds.add(order.id);
            const { data, error } = await supabase.rpc('expire_portfolio_order', { p_order_id: order.id });
            results.push({
                id: order.id,
                executed: false,
                expired: data === true,
                reason: data === true ? 'expired' : 'not_pending_or_not_expired',
                ...(error ? { error: error.message } : {}),
            });
        }
    }
    const symbols = [...new Set([
        ...pendingOrders.filter(({ id }) => !expiredOrderIds.has(id)).map(({ symbol }) => symbol),
        ...activeAlerts.map(({ symbol }) => symbol),
    ])];
    const prices = new Map<string, number | null>();
    const priceFailures = new Map<string, string>();
    let nextSymbolIndex = 0;
    const workerCount = Math.min(10, symbols.length);
    await Promise.all(Array.from({ length: workerCount }, async () => {
        while (nextSymbolIndex < symbols.length) {
            const symbol = symbols[nextSymbolIndex++];
            try {
                const price = await latestPrice(symbol);
                prices.set(symbol, price);
                if (price === null) priceFailures.set(symbol, 'No current quote was returned by TradingView or Yahoo Finance.');
            } catch (cause) {
                prices.set(symbol, null);
                priceFailures.set(symbol, cause instanceof Error ? cause.message : 'Quote provider request failed.');
            }
        }
    }));

    for (const order of pendingOrders) {
        if (expiredOrderIds.has(order.id)) continue;
        const price = prices.get(order.symbol);
        if (price == null) {
            console.warn('Pending order cannot be evaluated without a current quote.', {
                orderId: order.id,
                providerError: priceFailures.get(order.symbol),
            });
            const reason = 'Güncel piyasa fiyatı alınamadı; fiyat verisi geldiğinde emir yeniden denenecek.';
            const reasonSaveError = await saveOrderAttemptMessage(supabase, order, reason);
            results.push({
                id: order.id,
                executed: false,
                error: reasonSaveError ?? reason,
            });
            continue;
        }
        const { data, error: executionError } = await supabase.rpc('execute_portfolio_order', {
            p_order_id: order.id,
            p_market_price: price,
        });
        if (executionError) {
            console.error('Pending portfolio order execution failed.', { orderId: order.id, error: executionError });
            const reason = orderAttemptMessage(undefined);
            const reasonSaveError = await saveOrderAttemptMessage(supabase, order, reason);
            results.push({
                id: order.id,
                executed: false,
                observedPrice: price,
                error: reasonSaveError ?? reason ?? 'Emir işlenemedi.',
            });
        } else {
            const reason = data?.executed === true
                ? null
                : orderAttemptMessage(typeof data?.reason === 'string' ? data.reason : undefined);
            const reasonSaveError = await saveOrderAttemptMessage(supabase, order, reason);
            results.push({
                id: order.id,
                executed: data?.executed === true,
                observedPrice: price,
                ...(typeof data?.reason === 'string' ? { reason: data.reason } : {}),
                ...(typeof data?.error === 'string' ? { error: data.error } : {}),
                ...(reasonSaveError ? { persistenceError: reasonSaveError } : {}),
            });
        }
    }

    const alertResults: Array<{ id: string; triggered: boolean; error?: string }> = [];
    for (const alert of activeAlerts) {
        if (alert.expires_at && Date.parse(alert.expires_at) <= Date.now()) {
            const { error: expireError } = await supabase.from('price_alerts')
                .update({ status: 'expired', updated_at: new Date().toISOString() })
                .eq('id', alert.id).eq('status', 'active');
            alertResults.push({
                id: alert.id,
                triggered: false,
                ...(expireError ? { error: `Alert expiration failed: ${expireError.message}` } : {}),
            });
            continue;
        }
        const price = prices.get(alert.symbol);
        if (price == null) {
            alertResults.push({ id: alert.id, triggered: false, error: 'Current market price is unavailable.' });
            continue;
        }
        const { data, error: triggerError } = await supabase.rpc('trigger_price_alert', {
            p_alert_id: alert.id,
            p_market_price: price,
        });
        if (triggerError) {
            alertResults.push({ id: alert.id, triggered: false, error: triggerError.message });
        } else if (data === true) {
            alertResults.push({ id: alert.id, triggered: true });
        }
    }

    return Response.json({
        checked: pendingOrders.length,
        results,
        alertsChecked: activeAlerts.length,
        alertResults,
        priceFailures: [...priceFailures.entries()].map(([symbol, error]) => ({ symbol, error })),
    });
});
