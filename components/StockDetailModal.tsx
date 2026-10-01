'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowUpRight, ExternalLink, Heart, RefreshCw, X } from 'lucide-react';
import DynamicChart from '@/components/DynamicChart';
import StockForumPanel from '@/components/StockForumPanel';
import { describeBistPriceStep, getBistPriceStep, isValidBistPriceTick } from '@/lib/bist-market';
import type { CompanyProfile, MarketData, PortfolioOrder, PortfolioState, PortfolioTrade, PriceAlert, PriceAlertEvent, Timeframe } from '@/lib/types';
import { showError, showInfo, showSuccess } from '@/lib/ui-alerts';

interface StockDetailModalProps {
    symbol: string | null;
    onClose: () => void;
    onAnalyze: (symbol: string) => void;
}

const PERIODS: Array<{ id: Timeframe; label: string }> = [
    { id: '1m', label: '1 dk' }, { id: '5m', label: '5 dk' }, { id: '15m', label: '15 dk' },
    { id: '30m', label: '30 dk' }, { id: '1h', label: '1 saat' }, { id: '3h', label: '3 saat' },
    { id: '6h', label: '6 saat' }, { id: '1d', label: 'Günlük' }, { id: '1wk', label: 'Haftalık' },
    { id: '1mo', label: 'Aylık' }, { id: '1y', label: '1 yıl' }, { id: '5y', label: '5 yıl' },
];
function orderEventLabel(eventType: NonNullable<PortfolioState['orderEvents']>[number]['eventType']): string {
    if (eventType === 'created') return 'OLUŞTU';
    if (eventType === 'updated') return 'GÜNCELLENDİ';
    if (eventType === 'filled') return 'GERÇEKLEŞTİ';
    if (eventType === 'cancelled') return 'İPTAL';
    if (eventType === 'expired') return 'SÜRESİ DOLDU';
    return 'HATA';
}
const EMPTY_INDICATORS = { rsi: 0, macd: 0, macdSignal: 0, macdHistogram: 0, sma20: 0, sma50: 0, sma200: 0 };
type PortfolioOrderType = 'market' | 'manual' | 'limit' | 'take_profit' | 'stop_loss' | 'chain';
const ORDER_EXPIRY_OPTIONS = [
    { minutes: 60, label: '1 saat' },
    { minutes: 1_440, label: '1 gün' },
    { minutes: 10_080, label: '7 gün' },
    { minutes: 43_200, label: '30 gün' },
    { minutes: 0, label: 'Süresiz' },
];

function expiryDuration(expiresAt: string | null): number {
    if (!expiresAt) return 0;
    const remainingMinutes = (Date.parse(expiresAt) - Date.now()) / 60_000;
    return ORDER_EXPIRY_OPTIONS.find((option) => option.minutes > 0 && remainingMinutes <= option.minutes)?.minutes
        ?? 43_200;
}

function large(value: number | null | undefined): string {
    if (value === null || value === undefined || !Number.isFinite(value)) return 'Veri yok';
    if (Math.abs(value) >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)} Mr TL`;
    if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(2)} Mn TL`;
    return `${value.toLocaleString('tr-TR', { maximumFractionDigits: 2 })} TL`;
}

function priceLabel(value: number | null | undefined): string {
    return value === null || value === undefined ? 'Veri yok' : `${value.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} TL`;
}

function ratioLabel(value: number | null | undefined, percent = false): string {
    if (value === null || value === undefined || !Number.isFinite(value)) return 'Veri yok';
    return percent ? `%${(value * 100).toFixed(2)}` : value.toFixed(2);
}

function tradeTime(value: string): string {
    return new Date(value).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' });
}

export default function StockDetailModal({ symbol, onClose, onAnalyze }: StockDetailModalProps) {
    const [profile, setProfile] = useState<CompanyProfile | null>(null);
    const [loading, setLoading] = useState(false);
    const [profileError, setProfileError] = useState('');
    const [timeframe, setTimeframe] = useState<Timeframe>('1d');
    const [market, setMarket] = useState<MarketData | null>(null);
    const [chartLoading, setChartLoading] = useState(false);
    const [chartError, setChartError] = useState('');
    const [chartUpdated, setChartUpdated] = useState('');
    const [chartRefreshToken, setChartRefreshToken] = useState(0);
    const [favoritesId, setFavoritesId] = useState('');
    const [isFavorite, setIsFavorite] = useState(false);
    const [favoriteBusy, setFavoriteBusy] = useState(false);
    const [favoriteError, setFavoriteError] = useState('');
    const [portfolio, setPortfolio] = useState<PortfolioState | null>(null);
    const [portfolioError, setPortfolioError] = useState('');
    const [orderQuantity, setOrderQuantity] = useState('1');
    const [orderPrice, setOrderPrice] = useState('');
    const [orderType, setOrderType] = useState<PortfolioOrderType>('market');
    const [superAdminSymbol, setSuperAdminSymbol] = useState<string | null>(null);
    const [orderExpiryMinutes, setOrderExpiryMinutes] = useState(43_200);
    const [chainTakeProfit, setChainTakeProfit] = useState('');
    const [chainStopLoss, setChainStopLoss] = useState('');
    const [orderBusy, setOrderBusy] = useState(false);
    const [orderMessage, setOrderMessage] = useState('');
    const [editingOrderId, setEditingOrderId] = useState<string | null>(null);
    const [editQuantity, setEditQuantity] = useState('');
    const [editTriggerPrice, setEditTriggerPrice] = useState('');
    const [editTakeProfit, setEditTakeProfit] = useState('');
    const [editStopLoss, setEditStopLoss] = useState('');
    const [editExpiryMinutes, setEditExpiryMinutes] = useState(43_200);
    const [orderActionBusyId, setOrderActionBusyId] = useState<string | null>(null);
    const [priceAlerts, setPriceAlerts] = useState<PriceAlert[]>([]);
    const [priceAlertEvents, setPriceAlertEvents] = useState<PriceAlertEvent[]>([]);
    const [alertDirection, setAlertDirection] = useState<'above' | 'below'>('above');
    const [alertPrice, setAlertPrice] = useState('');
    const [alertExpiryHours, setAlertExpiryHours] = useState<number | null>(24);
    const [alertRepeatInterval, setAlertRepeatInterval] = useState(0);
    const [alertBusy, setAlertBusy] = useState(false);
    const [alertError, setAlertError] = useState('');
    const [alertMessage, setAlertMessage] = useState('');

    useEffect(() => {
        let active = true;
        if (!symbol) return () => { active = false; };
        void fetch('/api/profile/role', { cache: 'no-store' })
            .then(async (response) => {
                if (!response.ok) return false;
                const payload = await response.json() as { role?: string };
                return payload.role === 'super_admin';
            })
            .then((allowed) => {
                if (!active) return;
                setSuperAdminSymbol(allowed ? symbol : null);
                if (!allowed) setOrderType((current) => current === 'manual' ? 'market' : current);
            })
            .catch(() => {
                if (active) setSuperAdminSymbol(null);
            });
        return () => { active = false; };
    }, [symbol]);

    useEffect(() => {
        if (profileError) showError(profileError);
    }, [profileError]);
    useEffect(() => {
        if (chartError) showError(chartError);
    }, [chartError]);
    useEffect(() => {
        if (alertError) showError(alertError);
    }, [alertError]);
    useEffect(() => {
        if (alertMessage) showSuccess(alertMessage);
    }, [alertMessage]);
    useEffect(() => {
        if (orderMessage) showInfo(orderMessage);
    }, [orderMessage]);
    useEffect(() => {
        if (favoriteError) showError(favoriteError);
    }, [favoriteError]);

    useEffect(() => {
        if (!symbol) return;
        let active = true;
        const loadProfile = async () => {
            setLoading(true);
            setProfile(null);
            setProfileError('');
            try {
                const response = await fetch(`/api/company?symbol=${encodeURIComponent(symbol)}`, { cache: 'no-store' });
                const payload = await response.json() as { data?: CompanyProfile; error?: string };
                if (!response.ok || !payload.data) throw new Error(payload.error ?? 'Şirket bilgileri yüklenemedi.');
                if (active) {
                    setProfile(payload.data);
                    setOrderPrice(payload.data.price ? String(payload.data.price) : '');
                }
            } catch (cause) {
                if (active) setProfileError(cause instanceof Error ? cause.message : 'Şirket bilgileri yüklenemedi.');
            } finally {
                if (active) setLoading(false);
            }
        };
        void loadProfile();
        queueMicrotask(() => {
            if (!active) return;
            setMarket(null);
            setTimeframe('1d');
            setPortfolio(null);
            setPortfolioError('');
            setOrderMessage('');
            setEditingOrderId(null);
            setOrderType('market');
            setOrderExpiryMinutes(43_200);
            setChainTakeProfit('');
            setChainStopLoss('');
            setFavoritesId('');
            setIsFavorite(false);
            setFavoriteError('');
            setPriceAlerts([]);
            setPriceAlertEvents([]);
            setAlertError('');
            setAlertMessage('');
        });
        void fetch('/api/lists', { cache: 'no-store' })
            .then(async (response) => {
                const payload = await response.json() as { data?: Array<{ id: string; isFavorites: boolean; symbols: string[] }>; error?: string };
                if (!response.ok) throw new Error(response.status === 401 ? 'Favorilere eklemek için giriş yapın.' : payload.error ?? 'Favoriler yüklenemedi.');
                const favorites = payload.data?.find((list) => list.isFavorites);
                if (active && favorites) {
                    setFavoritesId(favorites.id);
                    setIsFavorite(favorites.symbols.includes(symbol));
                }
            })
            .catch((cause: unknown) => { if (active) setFavoriteError(cause instanceof Error ? cause.message : 'Favoriler yüklenemedi.'); });
        return () => { active = false; };
    }, [symbol]);

    const loadPriceAlerts = useCallback(async () => {
        if (!symbol) return;
        const response = await fetch(`/api/price-alerts?symbol=${encodeURIComponent(symbol)}`, { cache: 'no-store' });
        const payload = await response.json() as {
            data?: { alerts: PriceAlert[]; events: PriceAlertEvent[] };
            error?: string;
        };
        if (!response.ok || !payload.data) throw new Error(payload.error ?? 'Fiyat alarmları yüklenemedi.');
        setPriceAlerts(payload.data.alerts);
        setPriceAlertEvents(payload.data.events);
    }, [symbol]);

    useEffect(() => {
        if (!symbol) return;
        let active = true;
        void Promise.resolve().then(async () => {
            const response = await fetch(`/api/price-alerts?symbol=${encodeURIComponent(symbol)}`, { cache: 'no-store' });
            const payload = await response.json() as {
                data?: { alerts: PriceAlert[]; events: PriceAlertEvent[] };
                error?: string;
            };
            if (!response.ok || !payload.data) throw new Error(payload.error ?? 'Fiyat alarmları yüklenemedi.');
            if (active) {
                setPriceAlerts(payload.data.alerts);
                setPriceAlertEvents(payload.data.events);
            }
        }).catch((cause: unknown) => {
            if (active) setAlertError(cause instanceof Error ? cause.message : 'Fiyat alarmları yüklenemedi.');
        });
        return () => { active = false; };
    }, [symbol]);

    useEffect(() => {
        if (!symbol) return;
        let active = true;
        let inFlight = false;
        const loadChart = async () => {
            if (inFlight) return;
            inFlight = true;
            setChartLoading(true);
            setChartError('');
            try {
                const response = await fetch(`/api/scrape?symbol=${encodeURIComponent(symbol)}&period=${timeframe}`, { cache: 'no-store' });
                const payload = await response.json() as { data?: MarketData; error?: string };
                if (!response.ok || !payload.data) throw new Error(payload.error ?? 'Grafik verisi alınamadı.');
                if (active) {
                    setMarket(payload.data);
                    setChartUpdated(new Date().toISOString());
                }
            } catch (cause) {
                if (active) setChartError(cause instanceof Error ? cause.message : 'Grafik verisi alınamadı.');
            } finally {
                inFlight = false;
                if (active) setChartLoading(false);
            }
        };
        void loadChart();
        const timer = window.setInterval(() => void loadChart(), 60_000);
        return () => { active = false; window.clearInterval(timer); };
    }, [symbol, timeframe, chartRefreshToken]);

    useEffect(() => {
        if (!symbol) return;
        let active = true;
        void fetch('/api/portfolio', { cache: 'no-store' })
            .then(async (response) => {
                const payload = await response.json() as { data?: PortfolioState; error?: string };
                if (!response.ok || !payload.data) throw new Error(payload.error ?? 'Portföy bilgisi yüklenemedi.');
                if (active) setPortfolio(payload.data);
            })
            .catch((cause: unknown) => { if (active) setPortfolioError(cause instanceof Error ? cause.message : 'Portföy bilgisi yüklenemedi.'); });
        return () => { active = false; };
    }, [symbol]);

    useEffect(() => {
        if (!symbol) return;
        const originalOverflow = document.body.style.overflow;
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
        };
        document.body.style.overflow = 'hidden';
        window.addEventListener('keydown', closeOnEscape);
        return () => {
            document.body.style.overflow = originalOverflow;
            window.removeEventListener('keydown', closeOnEscape);
        };
    }, [onClose, symbol]);

    const position = useMemo(() => portfolio?.positions.find((item) => item.symbol === symbol) ?? null, [portfolio, symbol]);
    const positionValue = position ? position.quantity * position.currentPrice : 0;
    const positionCost = position ? position.quantity * position.averagePrice : 0;
    const positionReturnPercent = position && positionCost > 0 ? position.pnl / positionCost * 100 : 0;
    const orderQuantityValue = Number(orderQuantity);
    const orderReferencePrice = orderType === 'chain' ? profile?.price ?? 0 : Number(orderPrice);
    const estimatedOrderAmount = Number.isFinite(orderQuantityValue) && Number.isFinite(orderReferencePrice)
        ? orderQuantityValue * orderReferencePrice : 0;
    const totalPortfolioValue = portfolio
        ? portfolio.balance + portfolio.positions.reduce((sum, item) => sum + item.quantity * item.currentPrice, 0)
        : 0;
    const symbolTrades = useMemo(
        () => (portfolio?.trades ?? []).filter((trade) => trade.symbol === symbol),
        [portfolio, symbol],
    );
    const symbolOrders = useMemo(
        () => (portfolio?.orders ?? []).filter((order) => order.symbol === symbol && order.status === 'pending'),
        [portfolio, symbol],
    );
    const recentSymbolTrades = symbolTrades.slice(0, 5);
    const olderSymbolTrades = symbolTrades.slice(5);
    const symbolOrderEvents = useMemo(
        () => (portfolio?.orderEvents ?? []).filter((event) => event.symbol === symbol),
        [portfolio, symbol],
    );
    const recentSymbolOrderEvents = symbolOrderEvents.slice(0, 5);
    const olderSymbolOrderEvents = symbolOrderEvents.slice(5);

    const beginEditOrder = (order: PortfolioOrder) => {
        setEditingOrderId(order.id);
        setEditQuantity(String(order.quantity));
        setEditTriggerPrice(order.triggerPrice === null ? '' : String(order.triggerPrice));
        setEditTakeProfit(order.takeProfitPrice === null ? '' : String(order.takeProfitPrice));
        setEditStopLoss(order.stopLossPrice === null ? '' : String(order.stopLossPrice));
        setEditExpiryMinutes(expiryDuration(order.expiresAt));
        setOrderMessage('');
    };

    const savePendingOrder = async (order: PortfolioOrder) => {
        if (orderActionBusyId) return;
        const quantity = Number(editQuantity);
        const triggerPrice = Number(editTriggerPrice);
        const takeProfitPrice = Number(editTakeProfit);
        const stopLossPrice = Number(editStopLoss);
        if (!Number.isFinite(quantity) || quantity <= 0
            || (order.orderType !== 'chain' && (!Number.isFinite(triggerPrice) || triggerPrice <= 0))
            || (order.orderType === 'chain'
                && (!Number.isFinite(takeProfitPrice) || !Number.isFinite(stopLossPrice)
                    || stopLossPrice <= 0 || takeProfitPrice <= stopLossPrice))) {
            setOrderMessage('Emir adedini ve fiyatlarını kontrol edin. Zincir emirde kâr-al fiyatı zarar-durdur fiyatından yüksek olmalıdır.');
            return;
        }
        setOrderActionBusyId(order.id);
        setOrderMessage('');
        try {
            const response = await fetch('/api/portfolio', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'update_order',
                    orderId: order.id,
                    quantity,
                    triggerPrice: order.orderType === 'chain' ? null : triggerPrice,
                    takeProfitPrice: order.orderType === 'chain' ? takeProfitPrice : null,
                    stopLossPrice: order.orderType === 'chain' ? stopLossPrice : null,
                    expiresInMinutes: editExpiryMinutes,
                }),
            });
            const payload = await response.json() as { data?: PortfolioState; error?: string };
            if (!response.ok || !payload.data) throw new Error(payload.error ?? 'Emir güncellenemedi.');
            setPortfolio(payload.data);
            setEditingOrderId(null);
            setOrderMessage('Bekleyen emir güncellendi.');
        } catch (cause) {
            setOrderMessage(cause instanceof Error ? cause.message : 'Emir güncellenemedi.');
        } finally {
            setOrderActionBusyId(null);
        }
    };

    const cancelPendingOrder = async (order: PortfolioOrder) => {
        if (orderActionBusyId) return;
        setOrderActionBusyId(order.id);
        setOrderMessage('');
        try {
            const response = await fetch(`/api/portfolio?orderId=${encodeURIComponent(order.id)}`, { method: 'DELETE' });
            const payload = await response.json() as { data?: PortfolioState; error?: string };
            if (!response.ok || !payload.data) throw new Error(payload.error ?? 'Emir iptal edilemedi.');
            setPortfolio(payload.data);
            setEditingOrderId(null);
            setOrderMessage('Bekleyen emir iptal edildi.');
        } catch (cause) {
            setOrderMessage(cause instanceof Error ? cause.message : 'Emir iptal edilemedi.');
        } finally {
            setOrderActionBusyId(null);
        }
    };
    const activePriceAlerts = useMemo(
        () => priceAlerts.filter((alert) => alert.status === 'active'),
        [priceAlerts],
    );
    const chartPriceAlerts = useMemo(
        () => activePriceAlerts.map((alert) => ({
            id: alert.id, price: alert.targetPrice, direction: alert.direction,
        })),
        [activePriceAlerts],
    );

    const saveAlertPrice = useCallback(async (id: string, rawTargetPrice: number): Promise<boolean> => {
        const targetPrice = Number(rawTargetPrice.toFixed(2));
        const currentPrice = market?.price ?? profile?.price ?? 0;
        if (currentPrice > 0 && Math.round(targetPrice * 100) === Math.round(currentPrice * 100)) {
            setAlertError('Alarm fiyatı mevcut piyasa fiyatıyla aynı olamaz.');
            setAlertMessage('');
            return false;
        }
        if (activePriceAlerts.some((alert) => alert.id !== id
            && Math.round(alert.targetPrice * 100) === Math.round(targetPrice * 100))) {
            setAlertError('Bu fiyatta zaten aktif bir alarm var.');
            setAlertMessage('');
            return false;
        }
        const direction = targetPrice > currentPrice ? 'above' : 'below';
        setAlertError('');
        try {
            const response = await fetch('/api/price-alerts', {
                method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id, targetPrice, direction }),
            });
            const payload = await response.json() as { error?: string };
            if (!response.ok) throw new Error(payload.error ?? 'Alarm fiyatı güncellenemedi.');
            await loadPriceAlerts();
            setAlertMessage('Alarm fiyatı güncellendi.');
            return true;
        } catch (cause) {
            setAlertError(cause instanceof Error ? cause.message : 'Alarm fiyatı güncellenemedi.');
            return false;
        }
    }, [activePriceAlerts, loadPriceAlerts, market?.price, profile?.price]);

    const createPriceAlert = async () => {
        if (!symbol || alertBusy) return;
        const targetPrice = Number(alertPrice);
        if (!Number.isFinite(targetPrice) || targetPrice <= 0) {
            setAlertError('Alarm fiyatı sıfırdan büyük olmalıdır.');
            return;
        }
        const roundedTargetPrice = Number(targetPrice.toFixed(2));
        const currentPrice = market?.price ?? profile?.price ?? 0;
        if (currentPrice > 0 && alertDirection === 'above' && roundedTargetPrice <= currentPrice) {
            setAlertError(`“Fiyat yükselirse” alarmında hedef, güncel fiyatın (${priceLabel(currentPrice)}) üzerinde olmalıdır.`);
            setAlertMessage('');
            return;
        }
        if (currentPrice > 0 && alertDirection === 'below' && roundedTargetPrice >= currentPrice) {
            setAlertError(`“Fiyat düşerse” alarmında hedef, güncel fiyatın (${priceLabel(currentPrice)}) altında olmalıdır.`);
            setAlertMessage('');
            return;
        }
        setAlertBusy(true);
        setAlertError('');
        setAlertMessage('');
        try {
            const response = await fetch('/api/price-alerts', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    symbol, direction: alertDirection, targetPrice: roundedTargetPrice,
                    expiresInHours: alertExpiryHours, repeatIntervalMinutes: alertRepeatInterval,
                }),
            });
            const payload = await response.json() as { error?: string };
            if (!response.ok) throw new Error(payload.error ?? 'Fiyat alarmı kurulamadı.');
            await loadPriceAlerts();
            setAlertPrice('');
            setAlertMessage('Fiyat alarmı kuruldu.');
        } catch (cause) {
            setAlertError(cause instanceof Error ? cause.message : 'Fiyat alarmı kurulamadı.');
        } finally {
            setAlertBusy(false);
        }
    };

    const cancelPriceAlert = async (id: string) => {
        setAlertError('');
        try {
            const response = await fetch(`/api/price-alerts?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
            const payload = await response.json() as { error?: string };
            if (!response.ok) throw new Error(payload.error ?? 'Alarm iptal edilemedi.');
            await loadPriceAlerts();
            setAlertMessage('Fiyat alarmı iptal edildi.');
        } catch (cause) {
            setAlertError(cause instanceof Error ? cause.message : 'Alarm iptal edilemedi.');
        }
    };

    const toggleFavorite = async () => {
        if (!favoritesId || !symbol || favoriteBusy) return;
        setFavoriteBusy(true);
        setFavoriteError('');
        try {
            const response = await fetch('/api/lists', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: isFavorite ? 'remove' : 'add', id: favoritesId, symbol }),
            });
            const payload = await response.json() as { data?: Array<{ id: string; isFavorites: boolean; symbols: string[] }>; error?: string };
            if (!response.ok || !payload.data) throw new Error(payload.error ?? 'Favoriler güncellenemedi.');
            const favorites = payload.data.find((list) => list.isFavorites);
            setFavoritesId(favorites?.id ?? '');
            setIsFavorite(favorites?.symbols.includes(symbol) ?? false);
        } catch (cause) {
            setFavoriteError(cause instanceof Error ? cause.message : 'Favoriler güncellenemedi.');
        } finally {
            setFavoriteBusy(false);
        }
    };

    const placeOrder = async (side: 'buy' | 'sell') => {
        if (!symbol || orderBusy) return;
        const quantity = Number(orderQuantity);
        const price = Number(orderPrice);
        const takeProfitPrice = Number(chainTakeProfit);
        const stopLossPrice = Number(chainStopLoss);
        if (!Number.isFinite(quantity) || quantity <= 0) {
            setOrderMessage('Adet sıfırdan büyük geçerli bir sayı olmalıdır.');
            return;
        }
        if (orderType !== 'market' && (!Number.isFinite(price) || price <= 0)) {
            setOrderMessage('Tetik fiyatı sıfırdan büyük geçerli bir sayı olmalıdır.');
            return;
        }
        if (orderType === 'chain' && (!Number.isFinite(takeProfitPrice) || !Number.isFinite(stopLossPrice) || takeProfitPrice <= stopLossPrice || stopLossPrice <= 0)) {
            setOrderMessage('Zincir emirde kâr-al fiyatı zarar-durdur fiyatından yüksek olmalıdır.');
            return;
        }
        const pricesToValidate = orderType === 'chain'
            ? [takeProfitPrice, stopLossPrice]
            : orderType === 'market' || orderType === 'manual' ? [] : [price];
        const invalidPrice = pricesToValidate.find((value) => !isValidBistPriceTick(value));
        if (invalidPrice !== undefined) {
            setOrderMessage(`${priceLabel(invalidPrice)} fiyatı BİST fiyat adımına uygun değil. Bu fiyat aralığında adım ${describeBistPriceStep(invalidPrice)} TL olmalıdır.`);
            return;
        }
        if ((orderType === 'take_profit' || orderType === 'stop_loss' || orderType === 'chain') && side !== 'sell') {
            setOrderMessage('Kâr-al, zarar-durdur ve zincir emirler mevcut pozisyon için satış emridir.');
            return;
        }
        setOrderBusy(true);
        setOrderMessage('');
        try {
            const response = await fetch('/api/portfolio', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    side, symbol, quantity, price, orderType,
                    ...(orderType === 'chain'
                        ? { takeProfitPrice, stopLossPrice }
                        : orderType === 'market' || orderType === 'manual' ? {} : { triggerPrice: price }),
                    ...(orderType === 'market' || orderType === 'manual' ? {} : { expiresInMinutes: orderExpiryMinutes }),
                }),
            });
            const payload = await response.json() as {
                data?: PortfolioState; error?: string; orderExecution?: 'filled' | 'pending'; executionPrice?: number;
            };
            if (!response.ok || !payload.data) throw new Error(payload.error ?? 'Sanal işlem kaydedilemedi.');
            setPortfolio(payload.data);
            setOrderMessage(orderType === 'market' || orderType === 'manual'
                ? `${side === 'buy' ? 'Alış' : 'Satış'} emri ${orderType === 'market' ? 'güncel piyasa' : 'belirttiğiniz serbest'} fiyatından gerçekleşti.`
                : orderType === 'limit' && payload.orderExecution === 'filled'
                    ? `Limit koşulu sağlandığı için emir ${priceLabel(payload.executionPrice)} piyasa fiyatından gerçekleşti.`
                    : `${orderType === 'chain' ? 'Zincir' : orderType === 'limit' ? 'Limit' : orderType === 'take_profit' ? 'Kâr-al' : 'Zarar-durdur'} emri fiyat izlemeye alındı.`);
        } catch (cause) {
            setOrderMessage(cause instanceof Error ? cause.message : 'Sanal işlem kaydedilemedi.');
        } finally {
            setOrderBusy(false);
        }
    };

    if (!symbol) return null;
    if (typeof document === 'undefined') return null;

    const metrics: Array<[string, string]> = profile ? [
        ['Piyasa değeri', large(profile.marketCap > 0 ? profile.marketCap : null)], ['F/K', ratioLabel(profile.trailingPe)],
        ['PD/DD', ratioLabel(profile.priceToBook)], ['Öz sermaye', large(profile.totalStockholderEquity)],
        ['Öz sermaye defter değeri / hisse', priceLabel(profile.bookValue)],
        ['Ortalama hacim', profile.averageVolume == null ? 'Veri yok' : profile.averageVolume.toLocaleString('tr-TR')],
        ['FAVÖK', large(profile.ebitda)], ['Net kâr', large(profile.netIncome)],
        ['Net kâr marjı', ratioLabel(profile.netProfitMargin, true)],
        ['Brüt kâr marjı', ratioLabel(profile.grossProfitMargin, true)],
        ['Öz sermaye kararlılığı', 'Veri yok'],
        ['Faaliyet nakit akışı', large(profile.operatingCashFlow)], ['Serbest nakit akışı', large(profile.freeCashFlow)],
        ['Nakit oranı', ratioLabel(profile.cashRatio)], ['Cari oran', ratioLabel(profile.currentRatio)],
        ['Hızlı oran', ratioLabel(profile.quickRatio)], ['İhracat oranı', ratioLabel(profile.exportRatio, true)],
        ['Nakit dönüşüm süresi', profile.cashConversionCycle == null ? 'Veri yok' : `${profile.cashConversionCycle} gün`],
        ['Ülke', profile.country || 'Veri yok'],
        ['Kuruluş yılı', profile.foundedYear == null ? 'Veri yok' : String(profile.foundedYear)],
        ['Çalışan sayısı', profile.employees == null ? 'Veri yok' : profile.employees.toLocaleString('tr-TR')],
        ['Temettü verimi', profile.dividendYield == null ? 'Veri yok' : `%${(profile.dividendYield * 100).toFixed(2)}`],
    ] : [];

    return createPortal(<div className="modal-backdrop" role="presentation" onClick={onClose}>
        <section className="stock-modal stock-research-modal" role="dialog" aria-modal="true" aria-label={`${symbol} şirket detayları`} onClick={(event) => event.stopPropagation()}>
            <button className="modal-close" title="Kapat" onClick={onClose}><X size={18} /></button>
            {loading && <div className="modal-loading">Şirket profili yükleniyor...</div>}
            {profile && <>
                <div className="modal-header">
                    <div>
                        <span className="eyebrow">ŞİRKET ÖZETİ · {profile.exchange}</span>
                        <h2>{profile.companyName}</h2>
                        <span className="modal-symbol">{profile.symbol} · {profile.sector} · {profile.industry}</span>
                    </div>
                    <div className="modal-price">
                        <strong>{profile.price ? `${profile.price.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} TL` : '--'}</strong>
                        <span className={profile.changePercent >= 0 ? 'positive' : 'negative'}>{profile.changePercent >= 0 ? '+' : ''}{profile.changePercent.toFixed(2)}%</span>
                    </div>
                </div>
                <p className="company-summary">{profile.summary}</p>
                <StockForumPanel symbol={symbol} />

                <section className="stock-chart-section">
                    <div className="stock-section-heading"><div><span className="eyebrow">CANLI GRAFİK</span><h3>Fiyat hareketi</h3></div><span className="stock-chart-status"><i className={market?.source === 'yahoo-finance' ? 'source-live' : ''} />{chartLoading ? 'Güncelleniyor' : market?.source === 'yahoo-finance' ? 'Sağlayıcı verisi' : market ? 'Yedek / sentetik veri' : 'Veri bekleniyor'}</span></div>
                    <div className="stock-period-controls">
                        <label htmlFor="stock-chart-period">Grafik dönemi</label>
                        <select id="stock-chart-period" value={timeframe} onChange={(event) => setTimeframe(event.target.value as Timeframe)}>
                            {PERIODS.map((period) => <option key={period.id} value={period.id}>{period.label}</option>)}
                        </select>
                        <button className="stock-chart-refresh" onClick={() => setChartRefreshToken((token) => token + 1)} title="Grafik verisini yenile"><RefreshCw size={13} /> Yenile</button>
                    </div>
                    {market?.candles.length ? <DynamicChart
                        symbol={symbol} timeframe={timeframe} candles={market.candles} indicators={EMPTY_INDICATORS}
                        fetchedAt={chartUpdated || market.fetchedAt}
                        currentPrice={market.price}
                        priceAlerts={chartPriceAlerts}
                        onAlertPriceChange={saveAlertPrice}
                    /> : <div className="stock-chart-empty">{chartLoading ? 'Grafik verisi yükleniyor…' : 'Bu dönem için grafik verisi bulunamadı.'}</div>}
                    <p className="stock-data-note">Grafik 60 saniyede bir yenilenir. Piyasa verileri gecikmeli olabilir; yedek veri canlı fiyat olarak değerlendirilmemelidir. Son kontrol: {chartUpdated ? new Date(chartUpdated).toLocaleTimeString('tr-TR') : '—'}</p>
                </section>

                <details className="overview-group stock-disclosure stock-alert-section">
                    <summary><span>Grafik alarmları · {symbol}</span><small>{activePriceAlerts.length} aktif · {priceAlertEvents.length} kayıt</small></summary>
                    <div className="stock-alert-content">
                        <p className="stock-data-note">Birden fazla alarm kurabilir, aktif alarm ikonlarını grafikte sürükleyebilirsiniz. Sürükleyince mevcut fiyatın üstü yükseliş, altı düşüş alarmı olur. Alarmlar emirlerden bağımsızdır.</p>
                        <div className="stock-alert-form">
                            <label>Koşul<select value={alertDirection} onChange={(event) => setAlertDirection(event.target.value as 'above' | 'below')}>
                                <option value="above">Fiyat yükselirse</option>
                                <option value="below">Fiyat düşerse</option>
                            </select></label>
                            <label>Hedef fiyat (TL)<input type="number" min="0.01" step="0.01" value={alertPrice} onChange={(event) => setAlertPrice(event.target.value)} placeholder={priceLabel(profile.price)} /></label>
                            <label>Alarm süresi<select value={alertExpiryHours ?? 'never'} onChange={(event) => setAlertExpiryHours(event.target.value === 'never' ? null : Number(event.target.value))}>
                                <option value="1">1 saat</option><option value="24">24 saat</option>
                                <option value="168">7 gün</option><option value="720">30 gün</option><option value="never">Süresiz</option>
                            </select></label>
                            <label>Tekrar bildirimi<select value={alertRepeatInterval} onChange={(event) => setAlertRepeatInterval(Number(event.target.value))}>
                                <option value="0">Tek sefer</option><option value="5">5 dakikada bir</option>
                                <option value="15">15 dakikada bir</option><option value="30">30 dakikada bir</option>
                                <option value="60">Saatte bir</option>
                            </select></label>
                            <button className="primary-button" onClick={() => void createPriceAlert()} disabled={alertBusy}>{alertBusy ? 'Kuruluyor…' : 'Alarm kur'}</button>
                        </div>
                        <div className="stock-alert-list">
                            {activePriceAlerts.length ? activePriceAlerts.map((alert) => <article key={alert.id}>
                                <span className={`stock-alert-badge ${alert.direction}`}>{alert.direction === 'above' ? 'YÜKSELİRSE' : 'DÜŞERSE'}</span>
                                <strong>{priceLabel(alert.targetPrice)}</strong>
                                <small>{alert.repeatIntervalMinutes ? `${alert.repeatIntervalMinutes} dk tekrar` : 'Tek sefer'} · {alert.expiresAt ? `Son: ${tradeTime(alert.expiresAt)}` : 'Süresiz'}</small>
                                <button onClick={() => void cancelPriceAlert(alert.id)}>İptal</button>
                            </article>) : <p className="stock-data-note">Bu hisse için aktif alarm yok.</p>}
                        </div>
                        <details className="stock-alert-history">
                            <summary>Alarm geçmişi <span>{priceAlertEvents.length}</span></summary>
                            {priceAlertEvents.length ? <div className="stock-alert-events">{priceAlertEvents.map((event) => <article key={event.id}>
                                <span>{event.eventType === 'created' ? 'Kuruldu' : event.eventType === 'price_changed' ? 'Fiyat değişti' : event.eventType === 'triggered' ? 'Gerçekleşti' : event.eventType === 'expired' ? 'Süresi doldu' : 'İptal edildi'}</span>
                                <strong>{priceLabel(event.targetPrice)}</strong>
                                <small>{event.marketPrice === null ? '—' : `Piyasa ${priceLabel(event.marketPrice)}`}</small>
                                <time>{tradeTime(event.createdAt)}</time>
                            </article>)}</div> : <p className="stock-data-note">Henüz alarm olayı yok.</p>}
                        </details>
                    </div>
                </details>

                <details className="overview-group stock-disclosure">
                    <summary><span>Seans fiyat özeti</span><small>Seans ve 52 haftalık seviyeler</small></summary>
                    <div className="company-facts">
                        <div><span>Açılış</span><strong>{priceLabel(profile.open)}</strong></div>
                        <div><span>Önceki kapanış</span><strong>{priceLabel(profile.previousClose)}</strong></div>
                        <div><span>Gün içi en düşük</span><strong>{priceLabel(profile.dayLow)}</strong></div>
                        <div><span>Gün içi en yüksek</span><strong>{priceLabel(profile.dayHigh)}</strong></div>
                        <div><span>52 hafta en düşük</span><strong>{priceLabel(profile.low52W)}</strong></div>
                        <div><span>52 hafta en yüksek</span><strong>{priceLabel(profile.high52W)}</strong></div>
                        <div><span>Tahmini taban</span><strong>{priceLabel(profile.estimatedFloor)}</strong></div>
                        <div><span>Tahmini tavan</span><strong>{priceLabel(profile.estimatedCeiling)}</strong></div>
                    </div>
                    <small className="price-limit-note">Tavan/taban, önceki kapanışa göre standart ±%10 ile hesaplanmış tahmindir; resmi seans fiyat bandı değildir.</small>
                </details>

                <details className="overview-group stock-disclosure">
                    <summary><span>Finansal ve şirket istatistikleri</span><small>{metrics.filter(([, value]) => value !== 'Veri yok').length} ölçüm mevcut · tüm ölçümleri görüntüle</small></summary>
                    <div className="company-facts">{metrics.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
                    <small className="price-limit-note">{profile.financialsAvailable
                        ? 'Finansal özet sağlayıcıda eksik olabilir. Investing.com bu uygulamanın sunucu isteklerine 403 döndürüyor; erişim koruması atlanmıyor. Sağlayıcıda bulunmayan değerler tahmin edilmez.'
                        : 'Finansal oran sağlayıcısı şu anda temel veriyi sunmuyor. Investing.com bu uygulamanın sunucu isteklerine 403 döndürüyor; erişim koruması atlanmıyor. Sağlayıcıda bulunmayan değerler tahmin edilmez.'}</small>
                </details>

                <section className="stock-portfolio-section">
                    <div className="stock-section-heading"><div><span className="eyebrow">SANAL PORTFÖY</span><h3>{position ? 'Mevcut pozisyon' : 'Portföye ekle'}</h3></div><a href="/portfolio">Portföyü aç <ArrowUpRight size={14} /></a></div>
                    {position && <div className="company-facts stock-position-facts">
                        <div><span>Adet</span><strong>{position.quantity.toLocaleString('tr-TR')}</strong></div>
                        <div><span>Toplam değer</span><strong>{large(positionValue)}</strong></div>
                        <div><span>Ortalama maliyet</span><strong>{priceLabel(position.averagePrice)}</strong></div>
                        <div><span>Dağılım</span><strong>{totalPortfolioValue ? `%${(positionValue / totalPortfolioValue * 100).toFixed(2)}` : 'Veri yok'}</strong></div>
                        <div><span>Alıştan bu yana kâr / zarar</span><strong className={position.pnl >= 0 ? 'positive' : 'negative'}>{position.pnl > 0 ? '+' : ''}{large(position.pnl)} ({positionReturnPercent > 0 ? '+' : ''}{positionReturnPercent.toFixed(2)}%)</strong></div>
                    </div>}
                    <div className="stock-order-form">
                        <label>Adet (tam sayı)<input type="number" min="1" step="1" value={orderQuantity} onChange={(event) => setOrderQuantity(event.target.value)} /></label>
                        <label>Emir tipi<select value={orderType} onChange={(event) => setOrderType(event.target.value as PortfolioOrderType)}>
                            <option value="market">Piyasa</option>{superAdminSymbol === symbol && <option value="manual">Serbest fiyat (hemen)</option>}<option value="limit">Limit</option>
                            <option value="take_profit">Kâr al</option><option value="stop_loss">Zarar durdur</option><option value="chain">Zincir (OCO)</option>
                        </select></label>
                        {orderType !== 'chain' && <label>{orderType === 'market' ? 'Anlık gösterge fiyatı (TL)' : orderType === 'manual' ? 'İşlem fiyatı (TL)' : orderType === 'limit' ? 'Limit / tetik fiyatı (TL)' : 'Tetik fiyatı (TL)'}<input type="number" min="0" step={getBistPriceStep(Number(orderPrice) || profile.price)} value={orderPrice} onChange={(event) => setOrderPrice(event.target.value)} disabled={orderType === 'market'} /></label>}
                        {orderType === 'chain' && <>
                            <label>Kâr-al fiyatı (TL)<input type="number" min="0" step={getBistPriceStep(Number(chainTakeProfit) || profile.price)} value={chainTakeProfit} onChange={(event) => setChainTakeProfit(event.target.value)} /></label>
                            <label>Zarar-durdur fiyatı (TL)<input type="number" min="0" step={getBistPriceStep(Number(chainStopLoss) || profile.price)} value={chainStopLoss} onChange={(event) => setChainStopLoss(event.target.value)} /></label>
                        </>}
                        {orderType !== 'market' && orderType !== 'manual' && <label>Emir süresi<select value={orderExpiryMinutes} onChange={(event) => setOrderExpiryMinutes(Number(event.target.value))}>
                            {ORDER_EXPIRY_OPTIONS.map((option) => <option key={option.minutes} value={option.minutes}>{option.label}</option>)}
                        </select></label>}
                        <div className="stock-order-estimate">
                            <span>{orderType === 'limit' ? 'Limit gerçekleşirse tahmini tutar' : orderType === 'manual' ? 'İşlem tutarı' : 'Tahmini işlem tutarı'}</span>
                            <strong>{estimatedOrderAmount > 0 ? large(estimatedOrderAmount) : 'Fiyat girin'}</strong>
                            <small>{orderQuantityValue > 0 ? `${orderQuantityValue.toLocaleString('tr-TR')} adet × ${priceLabel(orderReferencePrice)}` : 'Adet ve fiyat seçin'}</small>
                        </div>
                        <div className="stock-order-actions"><button className="primary-button" disabled={orderBusy || !portfolio || orderType === 'take_profit' || orderType === 'stop_loss' || orderType === 'chain'} onClick={() => void placeOrder('buy')}>{orderBusy ? 'İşleniyor…' : orderType === 'market' ? 'Piyasa al' : orderType === 'manual' ? 'Belirttiğim fiyattan al' : 'Limit alış emri'}</button><button className="ds-secondary-button" disabled={orderBusy || !position} onClick={() => void placeOrder('sell')}>{orderBusy ? 'İşleniyor…' : orderType === 'market' ? 'Piyasa sat' : orderType === 'manual' ? 'Belirttiğim fiyattan sat' : orderType === 'limit' ? 'Limit satış emri' : 'Bekleyen satış emri'}</button></div>
                        <small className="stock-order-help">{orderType === 'market'
                            ? 'Piyasa emirleri yalnızca BİST sürekli işlem seansında, sunucunun aldığı güncel fiyatla gerçekleşir.'
                            : orderType === 'manual'
                                ? 'Girilen fiyat piyasa fiyatıyla eşleştirilmez; işlem yine de BİST seans saatlerine ve fiyat adımına uymalıdır.'
                                : 'Bekleyen emirler yaklaşık dakikada bir kontrol edilir. Süresi dolarsa otomatik iptal edilerek emir günlüğüne yazılır.'}</small>
                    </div>
                    {portfolioError && <div className="stock-inline-error" role="alert">{portfolioError}{portfolioError.includes('giriş yapın') && <a href="/auth?next=%2Fportfolio"> Giriş yap</a>}</div>}
                    {portfolio && <p className="stock-data-note">Kullanılabilir nakit: {large(portfolio.availableBalance ?? portfolio.balance)} · Emirlerde rezerve: {large(portfolio.reservedCash ?? 0)} · Portföy toplamı: {large(totalPortfolioValue)}</p>}
                    {!portfolio && !portfolioError && <p className="stock-data-note">Portföy yükleniyor…</p>}
                    {portfolio?.marketStatus && <details className="mt-3 rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-2 text-xs text-slate-500">
                        <summary className="cursor-pointer font-semibold text-slate-400">Seans ve işlem maliyetleri</summary>
                        <p className="mt-2 leading-5">BİST sürekli seansı {portfolio.marketStatus.isOpen ? 'açık' : 'kapalı'} · {portfolio.marketStatus.openTime ?? '—'}–{portfolio.marketStatus.closeTime ?? '—'} Türkiye saati. Komisyon 0,00 TL · kayma 0,00 TL · bu hissenin fiyat adımı {getBistPriceStep(profile.price).toLocaleString('tr-TR')} TL.</p>
                    </details>}
                </section>

                <section className="overview-group stock-trade-history">
                    <h3>Gerçekleşen işlemler · {symbol}</h3>
                    {symbolTrades.length ? <>
                    <div className="stock-trade-list">{recentSymbolTrades.map((trade: PortfolioTrade) => <div key={trade.id}>
                        <span className={`stock-trade-badge ${trade.side === 'buy' ? 'buy' : trade.side === 'sell' ? 'sell' : 'adjustment'}`}>{trade.side === 'buy' ? 'ALIM' : trade.side === 'sell' ? 'SATIM' : 'BAKİYE'}</span>
                        <span>{trade.side === 'cash_adjustment' ? `${large(trade.cashDelta)} bakiye değişimi` : `${trade.quantity.toLocaleString('tr-TR')} adet · ${priceLabel(trade.price)}`}</span>
                        <time>{tradeTime(trade.createdAt)}</time>
                    </div>)}</div>
                    {olderSymbolTrades.length > 0 && <details className="stock-history-disclosure">
                        <summary>Önceki işlemleri göster <small>{olderSymbolTrades.length} kayıt</small></summary>
                        <div className="stock-trade-list">{olderSymbolTrades.map((trade: PortfolioTrade) => <div key={trade.id}>
                            <span className={`stock-trade-badge ${trade.side === 'buy' ? 'buy' : trade.side === 'sell' ? 'sell' : 'adjustment'}`}>{trade.side === 'buy' ? 'ALIM' : trade.side === 'sell' ? 'SATIM' : 'BAKİYE'}</span>
                            <span>{trade.side === 'cash_adjustment' ? `${large(trade.cashDelta)} bakiye değişimi` : `${trade.quantity.toLocaleString('tr-TR')} adet · ${priceLabel(trade.price)}`}</span>
                            <time>{tradeTime(trade.createdAt)}</time>
                        </div>)}</div>
                    </details>}
                    </> : <p className="stock-data-note">Bu hisse için henüz sanal portföy işlemi yok.</p>}
                    <h3 className="stock-order-event-heading">Emir geçmişi</h3>
                    {symbolOrderEvents.length ? <>
                    <div className="stock-trade-list">{recentSymbolOrderEvents.map((event) => <div key={event.id}>
                        <span className={`stock-trade-badge ${event.eventType === 'filled' ? event.side : 'adjustment'}`}>{orderEventLabel(event.eventType)}</span>
                        <span>{event.side === 'buy' ? 'Alış' : 'Satış'} · {event.quantity.toLocaleString('tr-TR')} adet · {event.price === null ? 'Fiyat yok' : priceLabel(event.price)}</span>
                        {event.error && <small className="stock-order-event-error">{event.error}</small>}
                        <time>{tradeTime(event.createdAt)}</time>
                    </div>)}</div>
                    {olderSymbolOrderEvents.length > 0 && <details className="stock-history-disclosure">
                        <summary>Önceki emir kayıtlarını göster <small>{olderSymbolOrderEvents.length} kayıt</small></summary>
                        <div className="stock-trade-list">{olderSymbolOrderEvents.map((event) => <div key={event.id}>
                            <span className={`stock-trade-badge ${event.eventType === 'filled' ? event.side : 'adjustment'}`}>{orderEventLabel(event.eventType)}</span>
                            <span>{event.side === 'buy' ? 'Alış' : 'Satış'} · {event.quantity.toLocaleString('tr-TR')} adet · {event.price === null ? 'Fiyat yok' : priceLabel(event.price)}</span>
                            {event.error && <small className="stock-order-event-error">{event.error}</small>}
                            <time>{tradeTime(event.createdAt)}</time>
                        </div>)}</div>
                    </details>}
                    </> : <p className="stock-data-note">Bu hisse için emir olayı yok.</p>}
                </section>
                <section className="overview-group stock-trade-history">
                    <h3>Bekleyen emirler · {symbol}</h3>
                    {symbolOrders.length ? <div className="stock-pending-orders">{symbolOrders.map((order: PortfolioOrder) => <div key={order.id}>
                        <span>{order.orderType === 'chain' ? 'ZİNCİR (OCO)' : order.orderType === 'limit' ? 'LİMİT' : order.orderType === 'take_profit' ? 'KÂR AL' : 'ZARAR DURDUR'}</span>
                        <span>{order.side === 'buy' ? 'Alış' : 'Satış'} · {order.quantity.toLocaleString('tr-TR')} adet · {order.orderType === 'chain'
                            ? `Kâr al ${priceLabel(order.takeProfitPrice)} / Zarar durdur ${priceLabel(order.stopLossPrice)}`
                            : `Tetik ${priceLabel(order.triggerPrice)}`}{order.expiresAt
                            ? ` · Bitiş ${tradeTime(order.expiresAt)}`
                            : ' · Süresiz'}</span>
                        <div className="stock-pending-order-actions">
                            <button className="stock-pending-order-edit" disabled={orderActionBusyId !== null} onClick={() => beginEditOrder(order)}>Güncelle</button>
                            <button disabled={orderActionBusyId !== null} onClick={() => void cancelPendingOrder(order)}>{orderActionBusyId === order.id ? 'İşleniyor…' : 'İptal'}</button>
                        </div>
                        {order.error && <small className="stock-order-event-error">Bekleme nedeni: {order.error}</small>}
                        {editingOrderId === order.id && <div className="stock-order-editor">
                            <label>Adet (tam sayı)<input type="number" min="1" step="1" value={editQuantity} onChange={(event) => setEditQuantity(event.target.value)} /></label>
                            {order.orderType === 'chain' ? <>
                                <label>Kâr al (TL)<input type="number" min="0" step={getBistPriceStep(Number(editTakeProfit) || profile.price)} value={editTakeProfit} onChange={(event) => setEditTakeProfit(event.target.value)} /></label>
                                <label>Zarar durdur (TL)<input type="number" min="0" step={getBistPriceStep(Number(editStopLoss) || profile.price)} value={editStopLoss} onChange={(event) => setEditStopLoss(event.target.value)} /></label>
                            </> : <label>Tetik fiyatı (TL)<input type="number" min="0" step={getBistPriceStep(Number(editTriggerPrice) || profile.price)} value={editTriggerPrice} onChange={(event) => setEditTriggerPrice(event.target.value)} /></label>}
                            <label>Güncelleyince yeni süre<select value={editExpiryMinutes} onChange={(event) => setEditExpiryMinutes(Number(event.target.value))}>
                                {ORDER_EXPIRY_OPTIONS.map((option) => <option key={option.minutes} value={option.minutes}>{option.label}</option>)}
                            </select></label>
                            <div>
                                <button className="stock-pending-order-edit" disabled={orderActionBusyId !== null} onClick={() => void savePendingOrder(order)}>{orderActionBusyId === order.id ? 'Kaydediliyor…' : 'Kaydet'}</button>
                                <button disabled={orderActionBusyId !== null} onClick={() => setEditingOrderId(null)}>Vazgeç</button>
                            </div>
                        </div>}
                    </div>)}</div> : <p className="stock-data-note">Bu hisse için bekleyen emir yok.</p>}
                </section>

                <div className="modal-actions">
                    <button className={`favorite-button ds-secondary-button${isFavorite ? ' active' : ''}`} onClick={() => void toggleFavorite()} disabled={!favoritesId || favoriteBusy} aria-pressed={isFavorite}><Heart size={15} fill={isFavorite ? 'currentColor' : 'none'} />{favoriteBusy ? 'Güncelleniyor...' : isFavorite ? 'Favorilerden çıkar' : 'Favorilere ekle'}</button>
                    <button className="primary-button" onClick={() => onAnalyze(symbol)}><ArrowUpRight size={16} /> Trade Agent ile analiz et</button>
                    {profile.website && <a href={profile.website} target="_blank" rel="noreferrer"><ExternalLink size={14} /> Şirket sitesi</a>}
                </div>
            </>}
        </section>
    </div>, document.body);
}
