export default function Loading() {
    return <main className="bist-global-loader" role="status" aria-live="polite" aria-label="BİST verileri senkronize ediliyor">
        <div className="bist-loader-content">
            <svg className="bist-loader-chart" viewBox="0 0 260 120" role="img" aria-label="Yükselen BİST grafik çizgisi">
                <defs>
                    <linearGradient id="bist-loader-line" x1="0" y1="1" x2="1" y2="0">
                        <stop offset="0%" stopColor="#059669" />
                        <stop offset="100%" stopColor="#6ee7b7" />
                    </linearGradient>
                    <filter id="bist-loader-glow" x="-40%" y="-40%" width="180%" height="180%">
                        <feGaussianBlur stdDeviation="4" result="blur" />
                        <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
                    </filter>
                </defs>
                <path className="bist-loader-grid" d="M8 24H252M8 60H252M8 96H252M34 8V112M96 8V112M158 8V112M220 8V112" />
                <path className="bist-loader-area" d="M12 96L45 80L76 86L108 56L140 64L174 34L204 43L246 12V112H12Z" />
                <path className="bist-loader-line" d="M12 96L45 80L76 86L108 56L140 64L174 34L204 43L246 12" filter="url(#bist-loader-glow)" />
                <circle className="bist-loader-point" cx="246" cy="12" r="4" />
            </svg>
            <p className="bist-loader-caption"><span className="bist-loader-live"><i /> LIVE</span> BİST Verileri Senkronize Ediliyor...</p>
        </div>
    </main>;
}