'use client';

import { useCallback, useEffect, useRef, useState, startTransition } from 'react';
import { Activity, Bot, Info, LoaderCircle, RefreshCw, Search } from 'lucide-react';
import AIChat from '@/components/AIChat';
import DynamicChart from '@/components/DynamicChart';
import NewsSections from '@/components/NewsSections';
import type { AgentAnalysis, AnalysisMethod, Indicators, MarketData, Timeframe } from '@/lib/types';
import { showError } from '@/lib/ui-alerts';

const BIST_SYMBOLS = ['THYAO', 'GARAN', 'EREGL', 'ASELS', 'KCHOL', 'SASA', 'SISE', 'TUPRS', 'AKBNK', 'BIMAS', 'YKBNK', 'MANAS'];
const METHODS: Array<{ id: AnalysisMethod; label: string; description: string }> = [
    { id: 'SUPPORT_RESISTANCE', label: 'Destek / Direnç', description: 'Geçmiş tepki bölgelerini bulur; girişte desteğe, çıkışta dirence yakınlığı ve kırılım teyidini izler.' },
    { id: 'FIBONACCI', label: 'Fibonacci', description: 'Belirgin hareketin geri çekilme oranlarını ölçer; 0.382, 0.5 ve 0.618 bölgelerini diğer teyitlerle birleştirir.' },
    { id: 'TREND', label: 'Trend Kanalları', description: 'Ana yönü, kanal sınırlarını ve kırılım/retest koşullarını gösterir.' },
    { id: 'MOVING_AVERAGES', label: 'Hareketli Ortalamalar', description: 'SMA20/50/200 rejimini, kesişimleri ve dinamik destek/direnç ilişkisini karşılaştırır.' },
    { id: 'RSI_MACD', label: 'RSI / MACD Momentum', description: 'Aşırı alım-satım bölgelerini, momentum yönünü ve RSI-MACD uyum/uyumsuzluğunu değerlendirir.' },
    { id: 'BOLLINGER_BANDS', label: 'Bollinger Bantları', description: '20 dönemlik volatilite bantlarında sıkışma, banda temas ve ortalamaya dönüş olasılığını inceler.' },
    { id: 'VOLUME_BREAKOUT', label: 'Hacimli Kırılım', description: 'Son 20 mumun tepe/dip seviyelerini güncel hacmi dönem ortalamasıyla karşılaştırarak kırılım teyidi arar.' },
];
const TIMEFRAMES: Array<{ id: Timeframe; label: string; range: string }> = [
    { id: '1m', label: '1 dakika', range: '1d' }, { id: '5m', label: '5 dakika', range: '5d' }, { id: '15m', label: '15 dakika', range: '5d' }, { id: '30m', label: '30 dakika', range: '1mo' }, { id: '1h', label: '1 saat', range: '3mo' }, { id: '1d', label: 'Günlük', range: '1y' }, { id: '1wk', label: 'Haftalık', range: '5y' }, { id: '1mo', label: 'Aylık', range: '10y' }, { id: '1y', label: 'Yıllık', range: 'max' },
];
const EMPTY_INDICATORS: Indicators = { rsi: 0, macd: 0, macdSignal: 0, macdHistogram: 0, sma20: 0, sma50: 0, sma200: 0 };

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 25_000);
    try { const response = await fetch(url, { ...init, signal: controller.signal, cache: 'no-store' }); if (!response.ok) throw new Error('İstek tamamlanamadı. Lütfen yeniden deneyin.'); return await response.json() as T; } finally { window.clearTimeout(timeout); }
}
function formatRange(range: [number, number]): string { return `${range[0].toFixed(2)} - ${range[1].toFixed(2)} TL`; }
function formatForecast(forecast: { low: number; expected: number; high: number }): string { return `${forecast.low.toFixed(2)} - ${forecast.high.toFixed(2)} TL`; }

export default function TradeAgentWorkspace() {
    const [selectedSymbol, setSelectedSymbol] = useState(() => { if (typeof window === 'undefined') return 'THYAO'; const value = new URLSearchParams(window.location.search).get('symbol')?.toUpperCase(); return value && /^[A-Z0-9]{3,6}$/.test(value) ? value : 'THYAO'; });
    const [search, setSearch] = useState('');
    const [availableSymbols, setAvailableSymbols] = useState(BIST_SYMBOLS);
    const [method, setMethod] = useState<AnalysisMethod>('SUPPORT_RESISTANCE');
    const [timeframe, setTimeframe] = useState<Timeframe>('1d');
    const [market, setMarket] = useState<MarketData | null>(null);
    const [analyses, setAnalyses] = useState<AgentAnalysis[]>([]);
    const [loading, setLoading] = useState(true);
    const [analysisLoading, setAnalysisLoading] = useState(false);
    const [error, setError] = useState('');
    useEffect(() => {
        if (error) showError(error);
    }, [error]);
    const requestId = useRef(0);

    const runEngine = useCallback(async (symbol: string, activeMethod: AnalysisMethod, activeTimeframe: Timeframe) => {
        const current = ++requestId.current;
        const frame = TIMEFRAMES.find((item) => item.id === activeTimeframe) ?? TIMEFRAMES[5];
        setLoading(true); setAnalysisLoading(false); setError('');
        try {
            const scraped = await requestJson<{ data: MarketData }>(`/api/scrape?symbol=${encodeURIComponent(symbol)}&range=${frame.range}&interval=${activeTimeframe}`);
            if (current !== requestId.current) return;
            const data = scraped.data;
            startTransition(() => { setMarket(data); setAnalyses([]); });
            setLoading(false); setAnalysisLoading(true);
            try {
                const analyzed = await requestJson<{ data: { analyses: AgentAnalysis[] } }>('/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ symbol, price: data.price, method: activeMethod, timeframe: activeTimeframe, indicators: data.indicators, history: data.history, news: data.news, candles: data.candles }) });
                if (current === requestId.current) setAnalyses(analyzed.data.analyses);
            } catch { if (current === requestId.current) setError('Piyasa verisi geldi; AI raporu şu an kullanılamıyor.'); }
        } catch { if (current === requestId.current) setError('Piyasa verisi alınamadı.'); } finally { if (current === requestId.current) { setLoading(false); setAnalysisLoading(false); } }
    }, []);

    useEffect(() => { const timer = window.setTimeout(() => void runEngine(selectedSymbol, method, timeframe), 0); return () => window.clearTimeout(timer); }, [method, runEngine, selectedSymbol, timeframe]);
    useEffect(() => {
        let active = true;
        fetch('/api/market?limit=all', { cache: 'no-store' }).then((response) => response.json() as Promise<{ data?: Array<{ symbol?: string }> }>).then((payload) => {
            const symbols = (payload.data ?? []).map((item) => item.symbol).filter((item): item is string => typeof item === 'string' && /^[A-Z0-9]{3,6}$/.test(item));
            if (active && symbols.length) setAvailableSymbols([...new Set([...BIST_SYMBOLS, ...symbols])].sort());
        }).catch(() => undefined);
        return () => { active = false; };
    }, []);

    const chooseSymbol = (value: string) => { const symbol = value.trim().toUpperCase(); if (!/^[A-Z0-9]{3,6}$/.test(symbol)) { setError('3-6 karakterli geçerli bir BİST kodu yazın.'); return; } setSelectedSymbol(symbol); setSearch(''); window.setTimeout(() => document.getElementById('trade-agent')?.scrollIntoView({ behavior: 'smooth' }), 0); };
    const customSymbol = /^[A-Z0-9]{3,6}$/.test(search) && !availableSymbols.includes(search) ? search : '';
    const filteredSymbols = availableSymbols.filter((symbol) => !search || symbol.startsWith(search)).slice(0, customSymbol ? 11 : 12);
    const lead = analyses[0];
    const activeMethod = METHODS.find((item) => item.id === method) ?? METHODS[0];

    return <main className="app-shell ds-shell"><div className="app-container ds-container ds-trade-agent">
        <header className="ds-page-heading ds-trade-heading"><span className="ds-eyebrow">TRADE ENGINE / ŞİRKET ARAŞTIRMASI</span><h1><Activity aria-hidden="true" /> BİST araştırma masası</h1><p>Teknik yapı, tarihsel performans, güncel haber/KAP akışı ve AI senaryolarını aynı çalışma alanında incele.</p></header>
        <section className="hero-grid"><div className="hero-copy"><span className="ds-eyebrow">HİSSE ARAŞTIRMASI</span><h2>{selectedSymbol} hissesini<br /><span>her yönüyle oku.</span></h2><p>Şirket görünümünü, seçili dönem performansını ve teknik göstergeleri birlikte değerlendir.</p></div><div className="research-status"><span className="ds-eyebrow">VERİ DURUMU</span><strong>{market?.source === 'yahoo-finance' ? 'Sağlayıcı verisi · gecikmeli olabilir' : 'Yedek veri'}</strong><span>{market ? `Çekildi: ${new Date(market.fetchedAt).toLocaleString('tr-TR')}` : 'Veri alınıyor...'}</span><button className="icon-button status-refresh" title="Veriyi yenile" onClick={() => void runEngine(selectedSymbol, method, timeframe)}><RefreshCw size={15} className={loading ? 'spin' : ''} /></button></div></section>
        <section className="control-grid"><div className="panel symbol-panel"><div className="panel-heading"><div><span className="eyebrow">HİSSE ARA</span><h2>Yeni sembol</h2></div><Search size={18} className="muted" /></div><div className="search-box"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value.toUpperCase())} onKeyDown={(event) => { if (event.key === 'Enter') chooseSymbol(search); }} placeholder="THYAO, EREGL, KRDMD..." aria-label="Hisse kodu ara" /><button className="search-submit" onClick={() => chooseSymbol(search)} title="Hisseyi analiz et"><Search size={15} /></button></div><div className="symbol-list">{filteredSymbols.map((symbol) => <button key={symbol} className={symbol === selectedSymbol ? 'symbol-chip selected' : 'symbol-chip'} onClick={() => chooseSymbol(symbol)}>{symbol}<span>TRY</span></button>)}{customSymbol && <button className="symbol-chip custom" onClick={() => chooseSymbol(customSymbol)}>Analiz et: {customSymbol}<span>Enter</span></button>}</div></div><div className="panel market-panel"><div className="panel-heading"><div><span className="eyebrow">CANLI ÖZET</span><h2>{selectedSymbol}</h2></div><span className="source live">{market?.source === 'yahoo-finance' ? 'CANLI' : 'FALLBACK'}</span></div><div className="quote-row"><div><span className="muted">Son fiyat</span><strong className="quote">{market ? `${market.price.toFixed(2)} ₺` : '--'}</strong></div><div className="change-box"><span className="muted">Değişim dönemi</span><select className="snapshot-select" value={timeframe} onChange={(event) => setTimeframe(event.target.value as Timeframe)}>{TIMEFRAMES.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</select><strong className={market && market.changePercent > 0 ? 'positive' : market && market.changePercent < 0 ? 'negative' : 'neutral'}>{market ? `${market.changePercent > 0 ? '+' : ''}${market.changePercent.toFixed(2)}%` : '--'}</strong></div></div><div className="indicator-row">{[['RSI 14', market?.indicators.rsi], ['MACD', market?.indicators.macdHistogram], ['SMA 20', market?.indicators.sma20], ['SMA 50', market?.indicators.sma50], ['SMA 200', market?.indicators.sma200]].map(([label, value]) => <div key={String(label)}><span className="muted">{label}</span><strong>{typeof value === 'number' ? value.toFixed(2) : '--'}</strong></div>)}</div></div></section>
        <div id="trade-agent" className="trade-agent-anchor" /><div className="timeframe-bar"><span className="eyebrow">GRAFİK ZAMAN DİLİMİ</span><div>{TIMEFRAMES.map((item) => <button key={item.id} className={item.id === timeframe ? 'active' : ''} onClick={() => setTimeframe(item.id)}>{item.label}</button>)}</div></div><div className="method-bar"><div><span className="eyebrow">ANALİZ YÖNTEMİ</span><strong>Yöntem <Info size={14} /></strong></div><div className="method-tabs">{METHODS.map((item) => <button key={item.id} title={item.description} className={item.id === method ? 'active' : ''} onClick={() => setMethod(item.id)}>{item.label}</button>)}</div></div><div className="method-explainer"><Info size={15} /><span><strong>{activeMethod.label}:</strong> {activeMethod.description}</span></div>
        {loading && <div className="loading-line"><LoaderCircle size={16} className="spin" /> Piyasa verisi alınıyor...</div>}{!loading && analysisLoading && <div className="loading-line"><LoaderCircle size={16} className="spin" /> Ajanlar veriyi değerlendiriyor...</div>}
        <DynamicChart symbol={selectedSymbol} timeframe={timeframe} candles={market?.candles ?? []} drawings={lead?.drawings} indicators={market?.indicators ?? EMPTY_INDICATORS} fetchedAt={market?.fetchedAt} />
        <section className="research-grid"><article className="panel research-panel"><div className="section-heading"><div><span className="eyebrow">FİYAT HARİTASI</span><h2>AI seviyeleri</h2></div></div>{lead ? <div className="level-grid"><div><span className="muted">Alım bölgesi</span><strong className="positive">{formatRange(lead.buyRange)}</strong></div><div><span className="muted">Satış bölgesi</span><strong className="gold-text">{formatRange(lead.sellRange)}</strong></div><div><span className="muted">Destek</span><strong>{lead.support.toFixed(2)} ₺</strong></div><div><span className="muted">Direnç</span><strong>{lead.resistance.toFixed(2)} ₺</strong></div></div> : <span className="muted">AI seviyeleri hesaplanıyor.</span>}</article></section>
        <section className="reports-section"><div className="section-heading"><div><span className="eyebrow">AI ARAŞTIRMASI</span><h2>{selectedSymbol} hakkında ayrıntılı değerlendirme</h2></div></div><div className="reports-grid">{analyses.map((analysis) => <article className="agent-card" key={analysis.agentName}><div className="agent-card-head"><div className="agent-icon"><Bot size={18} /></div><div><h3>{analysis.agentName}</h3><span className="muted">Güven %{analysis.confidence} · {analysis.horizon}</span></div><span className={`decision ${analysis.action.toLowerCase()}`}>{analysis.action}</span></div><p>{analysis.reasoning}</p><div className="target-row"><div><span className="muted">Hedef</span><strong>{analysis.targetPrice.toFixed(2)} ₺</strong></div><div><span className="muted">Stop</span><strong className="negative">{analysis.stopLoss.toFixed(2)} ₺</strong></div><div><span className="muted">Risk/ödül</span><strong>1 : {((analysis.targetPrice - (market?.price ?? analysis.stopLoss)) / ((market?.price ?? analysis.stopLoss) - analysis.stopLoss)).toFixed(2)}</strong></div></div><div className="agent-detail-grid"><div><span className="detail-label">ALIM ARALIĞI</span><strong className="positive">{formatRange(analysis.buyRange)}</strong></div><div><span className="detail-label">SATIŞ ARALIĞI</span><strong className="gold-text">{formatRange(analysis.sellRange)}</strong></div></div><div className="forecast-section"><div className="forecast-heading"><div><span className="detail-label">KISA VADELİ FİYAT TAHMİNİ</span><strong>Olası fiyat aralıkları</strong></div><span className="muted">Senaryo, kesinlik içermez</span></div><div className="forecast-grid">{analysis.priceForecasts.map((forecast) => <div className="forecast-item" key={forecast.horizon}><span className="forecast-horizon">{forecast.horizon}</span><strong>{formatForecast(forecast)}</strong><em>Olası değer · {forecast.expected.toFixed(2)} ₺</em><small>Güven %{forecast.confidence}</small></div>)}</div></div><div className="scenario-list"><div><span className="scenario-tag positive">YÜKSELİŞ</span><p>{analysis.scenarios.bullish}</p></div><div><span className="scenario-tag">YATAY</span><p>{analysis.scenarios.neutral}</p></div><div><span className="scenario-tag negative">DÜŞÜŞ</span><p>{analysis.scenarios.bearish}</p></div></div><div className="risk-list"><span className="detail-label">RİSK NOTLARI</span>{analysis.riskNotes.map((risk) => <span key={risk}>• {risk}</span>)}</div></article>)}</div></section>
        {market && <AIChat key={selectedSymbol} symbol={selectedSymbol} price={market.price} indicators={market.indicators} history={market.history} news={market.news} analyses={analyses} />}
        <NewsSections symbol={selectedSymbol} news={market?.news ?? []} />
    </div></main>;
}
