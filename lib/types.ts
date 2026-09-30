export type AnalysisMethod =
    | 'SUPPORT_RESISTANCE'
    | 'FIBONACCI'
    | 'TREND'
    | 'MOVING_AVERAGES'
    | 'RSI_MACD'
    | 'BOLLINGER_BANDS'
    | 'VOLUME_BREAKOUT';

export type AgentAction = 'AL' | 'SAT' | 'TUT';
export type Timeframe = '1m' | '5m' | '15m' | '30m' | '1h' | '3h' | '6h' | '1d' | '1wk' | '1mo' | '1y' | '5y';

export interface Candle {
    time: string | number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
}

export interface Indicators {
    rsi: number;
    macd: number;
    macdSignal: number;
    macdHistogram: number;
    sma20: number;
    sma50: number;
    sma200: number;
}

export interface MarketData {
    symbol: string;
    price: number;
    changePercent: number;
    currency: 'TRY';
    candles: Candle[];
    indicators: Indicators;
    history: HistoricalStats;
    news: MarketNews[];
    updatedAt: string;
    fetchedAt: string;
    source: 'yahoo-finance' | 'fallback';
}

export interface HistoricalStats {
    return1M: number;
    return3M: number;
    return1Y: number;
    high52W: number;
    low52W: number;
    volatility: number;
    trend: 'YUKARI' | 'ASAGI' | 'YATAY';
}

export interface MarketQuote {
    symbol: string;
    name: string;
    price: number;
    changePercent: number;
    change1D?: number | null;
    change1W?: number | null;
    change1M?: number | null;
    change1m?: number | null;
    change5m?: number | null;
    change15m?: number | null;
    change1h?: number | null;
    change4h?: number | null;
    volume: number;
    tradedValue?: number | null;
    marketCap: number;
    exchange: string;
    updatedAt: string;
    source: 'tradingview' | 'fallback';
}

export interface CompanyProfile {
    symbol: string;
    companyName: string;
    exchange: string;
    sector: string;
    industry: string;
    country: string;
    foundedYear: number | null;
    employees: number | null;
    website: string | null;
    summary: string;
    price: number;
    changePercent: number;
    open: number | null;
    previousClose: number | null;
    dayLow: number | null;
    dayHigh: number | null;
    estimatedFloor: number | null;
    estimatedCeiling: number | null;
    marketCap: number;
    trailingPe: number | null;
    dividendYield: number | null;
    priceToBook?: number | null;
    bookValue?: number | null;
    totalStockholderEquity?: number | null;
    averageVolume?: number | null;
    ebitda?: number | null;
    netIncome?: number | null;
    netProfitMargin?: number | null;
    grossProfitMargin?: number | null;
    operatingCashFlow?: number | null;
    freeCashFlow?: number | null;
    cashRatio?: number | null;
    currentRatio?: number | null;
    quickRatio?: number | null;
    exportRatio?: number | null;
    cashConversionCycle?: number | null;
    financialsAvailable?: boolean;
    high52W: number | null;
    low52W: number | null;
    updatedAt: string;
}

export interface MarketNews {
    title: string;
    publisher: string;
    url: string;
    publishedAt: string;
}

export interface DrawingLine {
    title: string;
    price: number;
    color: string;
    style?: 0 | 1 | 2 | 3;
}

export interface PriceForecast {
    horizon: string;
    low: number;
    expected: number;
    high: number;
    confidence: number;
}

export interface AgentAnalysis {
    agentName: string;
    action: AgentAction;
    targetPrice: number;
    stopLoss: number;
    confidence: number;
    reasoning: string;
    drawings: DrawingLine[];
    buyRange: [number, number];
    sellRange: [number, number];
    support: number;
    resistance: number;
    horizon: string;
    riskNotes: string[];
    scenarios: { bullish: string; neutral: string; bearish: string };
    priceForecasts: PriceForecast[];
}

export interface AnalysisResponse {
    symbol: string;
    price: number;
    drawings: DrawingLine[];
    analyses: AgentAnalysis[];
}

export interface PortfolioPosition {
    symbol: string;
    quantity: number;
    averagePrice: number;
    currentPrice: number;
    pnl: number;
}

export interface PortfolioTrade {
    id: string;
    symbol: string;
    side: 'buy' | 'sell' | 'cash_adjustment';
    quantity: number;
    price: number;
    cashDelta: number;
    realizedPnl: number;
    commissionAmount: number;
    slippageAmount: number;
    createdAt: string;
}

export interface BistTradingStatus {
    isOpen: boolean;
    date: string;
    localTime: string;
    openTime: string | null;
    closeTime: string | null;
    message: string | null;
}

export interface PortfolioOrder {
    id: string;
    symbol: string;
    side: 'buy' | 'sell';
    orderType: 'limit' | 'take_profit' | 'stop_loss' | 'chain';
    quantity: number;
    triggerPrice: number | null;
    takeProfitPrice: number | null;
    stopLossPrice: number | null;
    expiresAt: string | null;
    error?: string | null;
    status: 'pending' | 'filled' | 'cancelled' | 'failed' | 'expired';
    createdAt: string;
}

export interface PortfolioOrderEvent {
    id: string;
    symbol: string;
    side: 'buy' | 'sell';
    orderType: 'limit' | 'take_profit' | 'stop_loss' | 'chain';
    quantity: number;
    eventType: 'created' | 'updated' | 'filled' | 'cancelled' | 'failed' | 'expired';
    price: number | null;
    error?: string | null;
    createdAt: string;
}

export interface PriceAlert {
    id: string;
    symbol: string;
    direction: 'above' | 'below';
    targetPrice: number;
    status: 'active' | 'triggered' | 'cancelled' | 'expired';
    triggeredPrice: number | null;
    createdAt: string;
    triggeredAt: string | null;
    lastTriggeredAt: string | null;
    expiresAt: string | null;
    repeatIntervalMinutes: number;
}

export interface PriceAlertEvent {
    id: string;
    alertId: string;
    symbol: string;
    direction: 'above' | 'below';
    eventType: 'created' | 'price_changed' | 'triggered' | 'cancelled' | 'expired';
    targetPrice: number;
    marketPrice: number | null;
    createdAt: string;
}

export interface PortfolioSnapshot {
    totalValue: number;
    cashBalance: number;
    createdAt: string;
}

export interface PortfolioState {
    balance: number;
    availableBalance?: number;
    reservedCash?: number;
    marketStatus: BistTradingStatus;
    positions: PortfolioPosition[];
    realizedPnl?: number;
    periodPnl?: number | null;
    trades?: PortfolioTrade[];
    orders?: PortfolioOrder[];
    orderEvents?: PortfolioOrderEvent[];
    priceAlertEvents?: PriceAlertEvent[];
    snapshots?: PortfolioSnapshot[];
    source: 'supabase' | 'local';
}
