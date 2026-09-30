import Link from 'next/link';
import { ArrowLeft, Search } from 'lucide-react';

export default function NotFound() {
    return <main className="bist-not-found">
        <section className="bist-not-found-card">
            <div className="bist-not-found-chart" aria-hidden="true">
                <span className="bist-not-found-watermark">404</span>
                <span className="bist-halt-badge">⚠ TAHTA KAPATILDI / DEVRE KESTİ</span>
                <svg viewBox="0 0 720 230" preserveAspectRatio="none">
                    <defs>
                        <filter id="bist-crash-glow" x="-30%" y="-30%" width="160%" height="160%">
                            <feGaussianBlur stdDeviation="5" result="blur" />
                            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
                        </filter>
                        <linearGradient id="bist-crash-area" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#f43f5e" stopOpacity=".2" />
                            <stop offset="100%" stopColor="#f43f5e" stopOpacity="0" />
                        </linearGradient>
                    </defs>
                    <path className="bist-crash-grid" d="M0 36H720M0 84H720M0 132H720M0 180H720M90 0V230M210 0V230M330 0V230M450 0V230M570 0V230M690 0V230" />
                    <path className="bist-crash-fill" d="M0 26L70 36L145 20L218 45L285 34L344 74L397 66L447 130L495 113L534 183L578 181L630 184L720 184V230H0Z" />
                    <path className="bist-crash-line" d="M0 26L70 36L145 20L218 45L285 34L344 74L397 66L447 130L495 113L534 183L578 181L630 184L720 184" filter="url(#bist-crash-glow)" />
                    <g className="bist-crash-candles">
                        <path d="M570 154V199M558 168H582V190H558Z" />
                        <path d="M616 164V201M604 173H628V192H604Z" />
                        <path d="M662 160V201M650 171H674V193H650Z" />
                    </g>
                    <path className="bist-crash-floor" d="M528 205H704" />
                </svg>
            </div>
            <div className="bist-not-found-copy">
                <span className="bist-not-found-eyebrow">PİYASA DURUMU · SAYFA BULUNAMADI</span>
                <h1>404 - Hisse Tabana Oturdu!</h1>
                <p>Tavan beklerken taban yedik... Aradığınız sayfa sermaye azaltımına gitti veya tamamen likide oldu.</p>
                <div className="bist-not-found-actions">
                    <Link href="/" className="bist-not-found-primary"><ArrowLeft size={16} />Portföye Dön / Ana Sayfa</Link>
                    <Link href="/market" className="bist-not-found-secondary"><Search size={16} />Piyasayı İncele</Link>
                </div>
            </div>
        </section>
    </main>;
}