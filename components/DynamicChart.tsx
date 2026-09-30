'use client';

import { useEffect, useRef } from 'react';
import { CandlestickSeries, ColorType, createChart, HistogramSeries, LineSeries, LineStyle, type IChartApi, type Time } from 'lightweight-charts';
import type { Candle, DrawingLine, Indicators, Timeframe } from '@/lib/types';
import { useAppPreferences } from '@/components/AppProviders';

export interface ChartPriceAlert {
    id: string;
    price: number;
    direction: 'above' | 'below';
}

interface DynamicChartProps {
    symbol: string;
    timeframe?: Timeframe;
    candles: Candle[];
    drawings?: DrawingLine[];
    indicators: Indicators;
    fetchedAt?: string;
    priceAlerts?: ChartPriceAlert[];
    currentPrice?: number;
    onAlertPriceChange?: (id: string, price: number) => Promise<boolean>;
}

export default function DynamicChart({
    symbol, timeframe = '1d', candles, drawings = [], indicators, fetchedAt, priceAlerts = [],
    currentPrice, onAlertPriceChange,
}: DynamicChartProps) {
    const { theme } = useAppPreferences();
    const containerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);

    useEffect(() => {
        const container = containerRef.current;
        if (!container || !candles.length) return;
        const referencePrice = currentPrice ?? candles[candles.length - 1]?.close ?? 0;
        const originalPosition = container.style.position;
        if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
        const chartColors = theme === 'light'
            ? { background: '#ffffff', text: '#475569', grid: '#e2e8f0', border: '#cbd5e1' }
            : { background: '#0f172a', text: '#94a3b8', grid: '#1e293b', border: '#2b3b40' };

        const chart = createChart(container, {
            layout: { background: { type: ColorType.Solid, color: chartColors.background }, textColor: chartColors.text },
            grid: { vertLines: { color: chartColors.grid }, horzLines: { color: chartColors.grid } },
            width: container.clientWidth,
            height: container.clientHeight || 420,
            rightPriceScale: { borderColor: chartColors.border },
            timeScale: { borderColor: chartColors.border, rightOffset: 8 },
        });
        chartRef.current = chart;

        const candleSeries = chart.addSeries(CandlestickSeries, {
            upColor: '#10b981', downColor: '#f43f5e', borderVisible: false,
            wickUpColor: '#10b981', wickDownColor: '#f43f5e',
        });
        const chartCandles = candles.map((candle) => ({ ...candle, time: candle.time as Time }));
        candleSeries.setData(chartCandles);
        const volumeSeries = chart.addSeries(HistogramSeries, {
            priceScaleId: 'volume',
            priceFormat: { type: 'volume' },
            lastValueVisible: false,
            priceLineVisible: false,
            base: 0,
        });
        volumeSeries.setData(candles.map((candle) => ({
            time: candle.time as Time,
            value: candle.volume,
            color: candle.close >= candle.open ? 'rgba(16, 185, 129, .48)' : 'rgba(244, 63, 94, .48)',
        })));
        chart.priceScale('volume').applyOptions({
            scaleMargins: { top: 0.82, bottom: 0 },
            visible: false,
        });
        const alertHandles = new Map<string, HTMLButtonElement>();
        const alertPrices = new Map(priceAlerts.map((alert) => [alert.id, alert.price]));
        const alertLayer = document.createElement('div');
        alertLayer.className = 'chart-price-alert-layer';
        alertLayer.setAttribute('aria-hidden', 'false');
        container.append(alertLayer);
        priceAlerts.forEach((alert) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = `chart-price-alert-handle ${alert.direction}`;
            button.dataset.alertId = alert.id;
            button.setAttribute('aria-label', `${alert.direction === 'above' ? 'Yükselme' : 'Düşme'} alarmını grafikte taşı`);
            button.setAttribute('aria-roledescription', 'sürüklenebilir fiyat alarmı');
            const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            icon.setAttribute('viewBox', '0 0 24 24');
            icon.setAttribute('width', '11');
            icon.setAttribute('height', '11');
            icon.setAttribute('fill', 'none');
            icon.setAttribute('stroke', 'currentColor');
            icon.setAttribute('stroke-width', '2');
            icon.setAttribute('stroke-linecap', 'round');
            icon.setAttribute('stroke-linejoin', 'round');
            const bell = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            bell.setAttribute('d', 'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9m-8 13h4');
            icon.append(bell);
            button.append(icon);
            alertLayer.append(button);
            alertHandles.set(alert.id, button);
        });
        const positionAlertHandles = () => {
            alertHandles.forEach((button, id) => {
                const coordinate = candleSeries.priceToCoordinate(alertPrices.get(id) ?? 0);
                if (coordinate === null) {
                    button.hidden = true;
                    return;
                }
                button.hidden = false;
                button.style.top = `${Number(coordinate)}px`;
            });
        };
        positionAlertHandles();

        const addPriceLine = (title: string, price: number, color: string, style: LineStyle = LineStyle.Dashed) => {
            const series = chart.addSeries(LineSeries, { color, lineWidth: 2, lineStyle: style, title });
            series.setData(candles.map((candle) => ({ time: candle.time as Time, value: price })));
        };

        drawings.forEach((line) => addPriceLine(line.title, line.price, line.color, line.style ?? LineStyle.Dashed));
        if (!drawings.length) {
            if (indicators.sma20) addPriceLine('SMA 20', indicators.sma20, '#f4c95d', LineStyle.Solid);
            if (indicators.sma50) addPriceLine('SMA 50', indicators.sma50, '#70a7ff', LineStyle.Solid);
            if (indicators.sma200) addPriceLine('SMA 200', indicators.sma200, '#d58cff', LineStyle.Solid);
        }
        chart.timeScale().fitContent();

        const resizeObserver = new ResizeObserver(() => {
            chart.applyOptions({
                width: container.clientWidth,
                height: container.clientHeight || 420,
            });
            positionAlertHandles();
        });
        resizeObserver.observe(container);
        chart.timeScale().subscribeVisibleLogicalRangeChange(positionAlertHandles);
        chart.subscribeCrosshairMove(positionAlertHandles);

        let draggingAlertId: string | null = null;
        let draggedPrice: number | null = null;
        const onPointerDown = (event: PointerEvent) => {
            if (!onAlertPriceChange || (event.pointerType === 'mouse' && event.button !== 0)) return;
            const target = event.target instanceof Element
                ? event.target.closest<HTMLButtonElement>('[data-alert-id]')
                : null;
            if (!target) return;
            draggingAlertId = target.dataset.alertId ?? null;
            if (!draggingAlertId) return;
            draggedPrice = alertPrices.get(draggingAlertId) ?? null;
            event.preventDefault();
            event.stopPropagation();
            target.setPointerCapture(event.pointerId);
        };
        const onPointerMove = (event: PointerEvent) => {
            if (!draggingAlertId) return;
            const bounds = container.getBoundingClientRect();
            const price = candleSeries.coordinateToPrice(event.clientY - bounds.top);
            if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) return;
            draggedPrice = price;
            alertPrices.set(draggingAlertId, price);
            const draggedHandle = alertHandles.get(draggingAlertId);
            draggedHandle?.classList.toggle('above', price > referencePrice);
            draggedHandle?.classList.toggle('below', price < referencePrice);
            positionAlertHandles();
            event.preventDefault();
            event.stopPropagation();
        };
        const onPointerUp = (event: PointerEvent) => {
            if (!draggingAlertId) return;
            const id = draggingAlertId;
            const price = draggedPrice;
            draggingAlertId = null;
            draggedPrice = null;
            if (price !== null && onAlertPriceChange) {
                void onAlertPriceChange(id, price).then((saved) => {
                    if (saved) return;
                    alertPrices.set(id, priceAlerts.find((alert) => alert.id === id)?.price ?? 0);
                    const handle = alertHandles.get(id);
                    const originalDirection = priceAlerts.find((alert) => alert.id === id)?.direction;
                    if (originalDirection) {
                        handle?.classList.toggle('above', originalDirection === 'above');
                        handle?.classList.toggle('below', originalDirection === 'below');
                    }
                    positionAlertHandles();
                });
            }
            event.preventDefault();
            event.stopPropagation();
        };
        const onPointerCancel = () => {
            if (!draggingAlertId) return;
            const id = draggingAlertId;
            const originalAlert = priceAlerts.find((alert) => alert.id === id);
            alertPrices.set(id, originalAlert?.price ?? 0);
            const handle = alertHandles.get(id);
            if (originalAlert) {
                handle?.classList.toggle('above', originalAlert.direction === 'above');
                handle?.classList.toggle('below', originalAlert.direction === 'below');
            }
            draggingAlertId = null;
            draggedPrice = null;
            positionAlertHandles();
        };
        container.addEventListener('pointerdown', onPointerDown, true);
        container.addEventListener('pointermove', onPointerMove, true);
        container.addEventListener('pointerup', onPointerUp, true);
        container.addEventListener('pointercancel', onPointerCancel, true);
        return () => {
            resizeObserver.disconnect();
            chart.timeScale().unsubscribeVisibleLogicalRangeChange(positionAlertHandles);
            chart.unsubscribeCrosshairMove(positionAlertHandles);
            container.removeEventListener('pointerdown', onPointerDown, true);
            container.removeEventListener('pointermove', onPointerMove, true);
            container.removeEventListener('pointerup', onPointerUp, true);
            container.removeEventListener('pointercancel', onPointerCancel, true);
            alertLayer.remove();
            chart.remove();
            container.style.position = originalPosition;
            chartRef.current = null;
        };
    }, [candles, currentPrice, drawings, indicators, onAlertPriceChange, priceAlerts, theme]);

    return (
        <section className="panel chart-panel">
            <div className="panel-heading">
                <div><span className="eyebrow">FİYAT HAREKETİ · {timeframe}</span><h2>{symbol} / BIST</h2></div>
                <span className="chart-state">{drawings.length ? `${drawings.length} AI seviyesi` : 'Hareketli ortalamalar'} · Veri çekildi {fetchedAt ? new Date(fetchedAt).toLocaleString('tr-TR') : 'bekleniyor'}</span>
            </div>
            <div ref={containerRef} className="chart-canvas" />
        </section>
    );
}
