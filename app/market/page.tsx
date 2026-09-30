'use client';

import MarketOverview from '@/components/MarketOverview';
import MarketMovers from '@/components/MarketMovers';
import StockDetailModal from '@/components/StockDetailModal';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Activity, ChartNoAxesCombined, Clock3, ShieldCheck } from 'lucide-react';

const SYMBOLS = ['THYAO', 'GARAN', 'EREGL', 'ASELS', 'KCHOL', 'SASA', 'SISE', 'TUPRS', 'AKBNK', 'BIMAS', 'YKBNK', 'MANAS'];

export default function MarketPage() {
    const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
    const router = useRouter();
    useEffect(() => {
        const timer = window.setTimeout(() => {
            const symbol = new URLSearchParams(window.location.search).get('symbol')?.trim().toUpperCase();
            if (symbol && /^[A-Z0-9]{3,6}$/.test(symbol)) setSelectedSymbol(symbol);
        }, 0);
        return () => window.clearTimeout(timer);
    }, []);
    return <main className="app-shell ds-shell"><div className="app-container ds-container">
        <header className="ds-page-heading ds-route-heading">
            <span className="ds-eyebrow">TRADE ENGINE / BİST RESEARCH</span>
            <h1><ChartNoAxesCombined aria-hidden="true" /> BİST piyasa ekranı</h1>
            <div className="ds-intro-copy">Fiyatı, dönemsel değişimleri, işlem hacmini, piyasa değerini ve şirket özetini karşılaştır. Satıra tıklayarak hisse detaylarını aç.</div>
        </header>
        <div className="ds-route-grid ds-market-grid">
            <div className="ds-route-main"><MarketOverview symbols={SYMBOLS} selectedSymbol={selectedSymbol ?? ''} onSelect={setSelectedSymbol} /></div>
            <aside className="ds-route-aside">
                <section className="ds-panel ds-aside-card"><div className="ds-card-heading"><h2><Activity size={18} /> Piyasa durumu</h2><span className="ds-badge ds-badge-emerald"><span className="ds-status-dot" /> İzleme açık</span></div>
                    <p>Hisse tablosundan bir satır seçerek detay görünümünü açabilir, araştırma alanına geçebilirsin.</p>
                    <div className="ds-stat-row"><span>Seçili hisse</span><strong>{selectedSymbol || 'Henüz seçilmedi'}</strong></div>
                    <div className="ds-stat-row"><span>Takip evreni</span><strong>{SYMBOLS.length} BİST hissesi</strong></div>
                </section>
                <section className="ds-panel ds-aside-card"><h2><Clock3 size={18} /> Araştırma ipucu</h2><p>Günlük değişimin yanında haftalık ve aylık görünümü de karşılaştır. Fiyat ve hacim verilerinin sağlayıcı gecikmesine tabi olabileceğini unutma.</p>
                    <div className="ds-guidance"><ShieldCheck size={15} /><span>Tek bir göstergeyi alım-satım sinyali olarak değerlendirme.</span></div>
                </section>
            </aside>
        </div>
        <MarketMovers onSelect={setSelectedSymbol} />
        <StockDetailModal symbol={selectedSymbol} onClose={() => setSelectedSymbol(null)} onAnalyze={(symbol) => router.push(`/trade-agent?symbol=${symbol}`)} />
    </div></main>;
}
