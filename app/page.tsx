import Link from 'next/link';
import { Activity, ArrowRight, BookOpen, ChartNoAxesCombined, ListChecks, Search, ShieldCheck, Sparkles } from 'lucide-react';
import TermTooltip from '@/components/TermTooltip';

const modules = [
    { href: '/market', label: 'Piyasa', eyebrow: '01 / PİYASA', icon: ChartNoAxesCombined, title: 'Önce piyasayı tara', text: 'Hisseleri fiyat, hacim ve günlük, haftalık, aylık performansla karşılaştır.' },
    { href: '/trade-agent', label: 'Trade Agent', eyebrow: '02 / ARAŞTIRMA', icon: Search, title: 'Sonra hisseyi araştır', text: 'Grafik, şirket bilgileri, haber akışı ve farklı AI senaryolarını birlikte incele.' },
    { href: '/lists', label: 'Listeler', eyebrow: '03 / TAKİP', icon: ListChecks, title: 'Takibini kişiselleştir', text: 'Favorilerini ve çalışma listelerini hesabına kaydet, fiyat görünümünü eşitle.' },
    { href: '/education', label: 'Akademi', eyebrow: '04 / ÖĞRENME', icon: BookOpen, title: 'Bilgini sistemli geliştir', text: 'BİST temellerinden finansal tablolara, risk ve işlem disiplinine uzanan dersler.' },
];

export default function Home() {
    return <main className="portal-shell ds-shell"><div className="portal-container ds-container">
        <div className="ds-market-backdrop" aria-hidden="true">
            <svg viewBox="0 0 1000 360" preserveAspectRatio="none">
                <path className="ds-market-trend" d="M0 278 L112 250 L196 265 L290 205 L382 222 L474 158 L568 176 L660 116 L744 139 L832 72 L908 96 L1000 34" />
                <path className="ds-market-trend-secondary" d="M0 318 L120 302 L218 313 L320 274 L418 285 L520 244 L616 259 L714 221 L806 236 L904 196 L1000 207" />
                <g className="ds-market-bars">
                    <path d="M76 232v55m-8-39h16v23H68zM188 242v48m-8-33h16v18h-16zM300 185v59m-8-40h16v25h-16zM412 194v48m-8-34h16v20h-16zM524 137v62m-8-43h16v26h-16zM636 98v57m-8-38h16v24h-16zM748 116v50m-8-35h16v20h-16zM860 54v64m-8-47h16v28h-16zM950 42v54m-8-36h16v22h-16z" />
                </g>
            </svg>
            <span className="ds-market-backdrop-label">BIST 100 <b>+1,24%</b><i>● LIVE</i></span>
        </div>
        <section className="ds-home-grid">
            <div className="ds-home-primary">
                <header className="ds-page-heading ds-home-heading">
                    <span className="ds-eyebrow">TRADE ENGINE / BİST RESEARCH</span>
                    <h1><Activity aria-hidden="true" /> Piyasayı anla.<br /><span>Kararını temellendir.</span></h1>
                    <p>Trade Agent; Borsa İstanbul hisselerini izlemek, şirket ve fiyat verilerini birlikte incelemek, kişisel takip listeleri oluşturmak ve analiz becerilerini geliştirmek için tasarlanmış bir araştırma terminalidir.</p>
                    <div className="ds-actions">
                        <Link className="ds-primary-button" href="/market">Piyasayı incele <ArrowRight size={15} /></Link>
                        <Link className="ds-secondary-button" href="/education">Akademiyi keşfet</Link>
                    </div>
                    <small className="ds-disclaimer"><ShieldCheck size={14} /> Araştırma ve eğitim desteği sunar; emir iletmez ve yatırım tavsiyesi vermez.</small>
                </header>
                <section className="ds-panel ds-purpose-card">
                    <span className="ds-eyebrow">NE İÇİN KULLANILIR?</span>
                    <h2>Araştırmayı parçalara ayır, aynı bağlamda birleştir.</h2>
                    <p>Fiyat hareketi tek başına yeterli değildir. Piyasa koşulunu, şirket verilerini, açıklamaları ve risk planını birlikte değerlendirmek gerekir. Platform bu akışı tek yerde düzenler; kararın ve riskin sorumluluğu kullanıcıda kalır.</p>
                    <div className="ds-guidance"><Sparkles size={16} /><span>Önerilen sıra: piyasayı tara, şirketi araştır, risk planını yaz ve düzenli takip et.</span></div>
                </section>
            </div>
            <aside className="ds-panel ds-home-overview">
                <div className="ds-card-heading"><span className="ds-eyebrow">PLATFORMUN KAPSAMI</span><span className="ds-badge ds-badge-emerald"><Activity size={13} /> 4 çalışma alanı</span></div>
                {modules.map(({ eyebrow, label, icon: Icon, text }) => <div className="ds-overview-item" key={eyebrow}>
                    <span className="ds-overview-icon"><Icon size={17} /></span>
                    <div><strong>{label}</strong><small>{text}</small></div>
                </div>)}
                <div className="ds-guidance ds-home-note"><ShieldCheck size={15} /><span>Fiyatlar gecikmeli olabilir. AI çıktıları tahmindir; yatırım tavsiyesi değildir.</span></div>
            </aside>
        </section>
        <section className="ds-home-modules">
            <div className="ds-section-heading"><div><span className="ds-eyebrow">ÇALIŞMA ALANLARI</span><h2>Araştırma akışına başla</h2></div><span className="ds-badge ds-badge-amber">Tarama → araştırma → takip → öğrenme</span></div>
            <div className="ds-module-grid">{modules.map(({ href, label, eyebrow, icon: Icon, title, text }) => <Link className="ds-panel ds-module-card" href={href} key={href}>
                <span className="ds-module-meta">{eyebrow}</span><span className="ds-module-icon"><Icon size={20} /></span><h3>{label}</h3><strong>{title}</strong><p>{text}</p><span className="ds-module-link">Modüle git <ArrowRight size={15} /></span>
            </Link>)}</div>
        </section>
        <footer className="ds-home-footer"><span>Trade Agent · Borsa İstanbul araştırma terminali</span><div><TermTooltip term="BİST" definition="Borsa İstanbul’un kısaltmasıdır. Türkiye’de pay piyasası işlemlerinin yürütüldüğü borsadır." /> Veriler sağlayıcıya bağlı olarak gecikebilir.</div></footer>
    </div></main>;
}
