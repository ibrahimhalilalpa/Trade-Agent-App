'use client';

import ResearchLists from '@/components/ResearchLists';
import { useRouter } from 'next/navigation';
import { ArrowRight, BookOpen, Heart, ListChecks, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import StockDetailModal from '@/components/StockDetailModal';
import { useState } from 'react';

export default function ListsPage() {
    const router = useRouter();
    const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
    return <main className="app-shell ds-shell"><div className="app-container ds-container">
        <header className="ds-page-heading ds-route-heading">
            <span className="ds-eyebrow">TRADE ENGINE / KİŞİSEL ARAŞTIRMA</span>
            <h1><ListChecks aria-hidden="true" /> Çalışma listelerin</h1>
            <p>Hisselerini kendi listelerinde düzenle; fiyatı ve günlük, haftalık, aylık değişimleri takip edip analize geç.</p>
        </header>
        <div className="ds-route-grid ds-list-grid">
            <div className="ds-route-main"><ResearchLists selectedSymbol={selectedSymbol ?? 'THYAO'} onSelect={setSelectedSymbol} /></div>
            <aside className="ds-route-aside">
                <section className="ds-panel ds-aside-card"><div className="ds-card-heading"><h2><Heart size={18} /> Liste akışı</h2><span className="ds-badge ds-badge-emerald">Kişisel alan</span></div>
                    <ol className="ds-step-list"><li><span>01</span><div><strong>Bir liste oluştur</strong><small>Takip ettiğin hisseleri araştırma amacına göre grupla.</small></div></li><li><span>02</span><div><strong>Hisseleri ekle</strong><small>Fiyat ve dönemsel performansı aynı yerde görüntüle.</small></div></li><li><span>03</span><div><strong>Analize geç</strong><small>Bir hisseyi seçerek şirket araştırmasını aç.</small></div></li></ol>
                </section>
                <section className="ds-panel ds-aside-card"><h2><BookOpen size={18} /> Mikro rehberlik</h2><p>Listeler izleme ve karşılaştırma içindir; alım-satım önerisi oluşturmaz.</p><Link className="ds-aside-link" href="/education">Risk yönetimi derslerine git <ArrowRight size={14} /></Link><div className="ds-guidance"><ShieldCheck size={15} /><span>Fiyatlar sağlayıcı gecikmesine tabi olabilir.</span></div></section>
            </aside>
        </div>
    </div><StockDetailModal symbol={selectedSymbol} onClose={() => setSelectedSymbol(null)} onAnalyze={(symbol) => router.push(`/trade-agent?symbol=${symbol}`)} /></main>;
}
