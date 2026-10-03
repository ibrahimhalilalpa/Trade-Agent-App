'use client';

import {
    Activity, ArrowDownRight, ArrowUpRight, BookOpen, BriefcaseBusiness, ChevronDown,
    LayoutDashboard, Menu, MessageCircle, Search, UsersRound, X,
} from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import AuthStatus from '@/components/AuthStatus';
import NotificationCenter from '@/components/NotificationCenter';
import { ThemeToggle } from '@/components/AppProviders';

type NavItem = { label: string; description: string; href: string; icon: typeof Activity; keywords?: string };
type SearchResult = NavItem & { kind: 'page' | 'stock' };

const MARKET_LINKS: NavItem[] = [
    { href: '/market', label: 'BİST Hisseleri & Piyasalar', description: 'Piyasa özeti ve hisse performansları', icon: LayoutDashboard, keywords: 'borsa bist hisse fiyat' },
    { href: '/lists', label: 'Çalışma Listelerim', description: 'İzleme listelerin ve araştırma notların', icon: BookOpen, keywords: 'listeler watchlist' },
    { href: '/trade-agent', label: 'Trade Agent AI Analizleri', description: 'Yapay zekâ destekli hisse araştırması', icon: Activity, keywords: 'agent yapay zeka analiz' },
];
const COMMUNITY_LINKS: NavItem[] = [
    { href: '/forum', label: 'BİST Forum', description: 'Yatırım topluluğundaki tartışmalar', icon: MessageCircle, keywords: 'topluluk forum' },
    { href: '/leaderboard', label: 'Liderlik Tablosu', description: 'Topluluk performans sıralaması', icon: ArrowUpRight, keywords: 'liderlik sıralama' },
    { href: '/education', label: 'BİST Akademi', description: 'Piyasa ve yatırım eğitimleri', icon: BookOpen, keywords: 'akademi eğitim dersler' },
    { href: '/support', label: 'Yardım & Destek', description: 'Sorular, öneriler ve destek talepleri', icon: MessageCircle, keywords: 'yardım destek soru' },
];
const ALL_LINKS = [...MARKET_LINKS, ...COMMUNITY_LINKS];

function formatTickerNumber(value: number) {
    return value.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

type TickerQuote = { symbol: string; label: string; price: number; changePercent: number; currency: string };
type TickerTick = 'up' | 'down';

export default function AppNav() {
    const pathname = usePathname();
    const router = useRouter();
    const [menuOpen, setMenuOpen] = useState(false);
    const [openDropdown, setOpenDropdown] = useState<'market' | 'community' | null>(null);
    const [paletteOpen, setPaletteOpen] = useState(false);
    const [paletteQuery, setPaletteQuery] = useState('');
    const [stockResults, setStockResults] = useState<Array<{ symbol: string; name: string }>>([]);
    const [stockResultQuery, setStockResultQuery] = useState('');
    const [searchError, setSearchError] = useState('');
    const [activeResult, setActiveResult] = useState(0);
    const [tickerQuotes, setTickerQuotes] = useState<TickerQuote[]>([]);
    const [tickerTicks, setTickerTicks] = useState<Record<string, TickerTick>>({});
    const paletteInput = useRef<HTMLInputElement>(null);
    const previousTickerQuotes = useRef<Map<string, number>>(new Map());
    const tickerTickTimeout = useRef<number | null>(null);

    const openPalette = useCallback(() => {
        setPaletteOpen(true);
        setOpenDropdown(null);
        setMenuOpen(false);
    }, []);
    const closePalette = useCallback(() => {
        setPaletteOpen(false);
        setPaletteQuery('');
        setSearchError('');
    }, []);

    useEffect(() => {
        const onShortcut = (event: KeyboardEvent) => {
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
                event.preventDefault();
                openPalette();
            }
            if (event.key === 'Escape') {
                closePalette();
                setOpenDropdown(null);
                setMenuOpen(false);
            }
        };
        window.addEventListener('keydown', onShortcut);
        return () => window.removeEventListener('keydown', onShortcut);
    }, [closePalette, openPalette]);

    useEffect(() => {
        if (!paletteOpen) return;
        const timer = window.setTimeout(() => paletteInput.current?.focus(), 0);
        return () => window.clearTimeout(timer);
    }, [paletteOpen]);

    useEffect(() => {
        if (!paletteOpen || paletteQuery.trim().length < 2) {
            return;
        }
        const query = paletteQuery.trim();
        const controller = new AbortController();
        const timer = window.setTimeout(() => {
            setSearchError('');
            void fetch(`/api/market/symbols?q=${encodeURIComponent(query)}`, {
                cache: 'no-store',
                signal: controller.signal,
            }).then(async (response) => {
                const payload = await response.json() as { data?: Array<{ symbol: string; name: string }>; error?: string };
                if (!response.ok) throw new Error(payload.error ?? 'Hisse araması yapılamadı.');
                setStockResults(payload.data ?? []);
                setStockResultQuery(query);
                setSearchError('');
            }).catch((cause: unknown) => {
                if (cause instanceof DOMException && cause.name === 'AbortError') return;
                setSearchError(cause instanceof Error ? cause.message : 'Hisse araması yapılamadı.');
            });
        }, 220);
        return () => {
            window.clearTimeout(timer);
            controller.abort();
        };
    }, [paletteOpen, paletteQuery]);

    useEffect(() => {
        let active = true;
        const loadTicker = async () => {
            try {
                const response = await fetch('/api/market/ticker', { cache: 'no-store' });
                const payload = await response.json() as { data?: TickerQuote[]; error?: string };
                if (!response.ok) throw new Error(payload.error ?? 'Piyasa şeridi yüklenemedi.');
                if (!active) return;
                const quotes = (payload.data ?? []).filter((quote) => quote.price > 0);
                const nextTicks: Record<string, TickerTick> = {};
                for (const quote of quotes) {
                    const previousPrice = previousTickerQuotes.current.get(quote.symbol);
                    if (previousPrice !== undefined && quote.price !== previousPrice) {
                        nextTicks[quote.symbol] = quote.price > previousPrice ? 'up' : 'down';
                    }
                }
                previousTickerQuotes.current = new Map(quotes.map((quote) => [quote.symbol, quote.price]));
                setTickerQuotes(quotes);
                setTickerTicks(nextTicks);
                if (tickerTickTimeout.current !== null) window.clearTimeout(tickerTickTimeout.current);
                if (Object.keys(nextTicks).length) {
                    tickerTickTimeout.current = window.setTimeout(() => {
                        if (active) setTickerTicks({});
                        tickerTickTimeout.current = null;
                    }, 1_400);
                }
            } catch (cause) {
                if (!active) return;
                console.error('Live market header data could not be loaded.', cause);
            }
        };
        void loadTicker();
        const interval = window.setInterval(() => void loadTicker(), 15_000);
        return () => {
            active = false;
            window.clearInterval(interval);
            if (tickerTickTimeout.current !== null) window.clearTimeout(tickerTickTimeout.current);
        };
    }, []);

    useEffect(() => {
        const closeMenus = (event: MouseEvent) => {
            if (!(event.target instanceof Element) || !event.target.closest('.app-nav-menu-group')) setOpenDropdown(null);
        };
        document.addEventListener('mousedown', closeMenus);
        return () => document.removeEventListener('mousedown', closeMenus);
    }, []);

    const pageResults = useMemo(() => {
        const query = paletteQuery.trim().toLocaleLowerCase('tr-TR');
        if (!query) return ALL_LINKS.slice(0, 5).map((item) => ({ ...item, kind: 'page' as const }));
        return ALL_LINKS.filter((item) => `${item.label} ${item.description} ${item.keywords ?? ''}`.toLocaleLowerCase('tr-TR').includes(query))
            .map((item) => ({ ...item, kind: 'page' as const }));
    }, [paletteQuery]);
    const searchResults: SearchResult[] = useMemo(() => [
        ...(stockResultQuery === paletteQuery.trim() && paletteQuery.trim().length >= 2 ? stockResults : []).map((stock) => ({
            label: stock.symbol,
            description: stock.name,
            href: `/market?search=${encodeURIComponent(stock.symbol)}`,
            icon: Activity,
            kind: 'stock' as const,
        })),
        ...pageResults,
    ], [pageResults, paletteQuery, stockResultQuery, stockResults]);

    const selectResult = (result: SearchResult) => {
        setPaletteOpen(false);
        setPaletteQuery('');
        setMenuOpen(false);
        setOpenDropdown(null);
        router.push(result.href);
        if (result.kind === 'stock' && pathname === '/market') {
            window.dispatchEvent(new CustomEvent('trade-agent:market-search', { detail: { symbol: result.label } }));
        }
    };
    const selectActiveResult = () => {
        const result = searchResults[activeResult];
        if (result) selectResult(result);
    };
    const onPaletteKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            setActiveResult((current) => Math.min(current + 1, searchResults.length - 1));
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setActiveResult((current) => Math.max(0, current - 1));
        } else if (event.key === 'Enter') {
            event.preventDefault();
            selectActiveResult();
        }
    };

    const activeMarket = pathname === '/market' || pathname === '/lists' || pathname === '/trade-agent';
    const activeCommunity = COMMUNITY_LINKS.some(({ href }) => pathname === href || pathname.startsWith(`${href}/`));
    const toggleDropdown = (menu: 'market' | 'community') => {
        setOpenDropdown((current) => current === menu ? null : menu);
    };

    const tickerItems = tickerQuotes.map((quote) => {
        const positive = quote.changePercent >= 0;
        const ChangeIcon = positive ? ArrowUpRight : ArrowDownRight;
        const tick = tickerTicks[quote.symbol];
        const TickIcon = tick === 'up' ? ArrowUpRight : ArrowDownRight;
        return <span key={quote.symbol} className={`nav-ticker-pill${positive ? ' positive' : ' negative'}${tick ? ` tick-${tick}` : ''}`} title={`${quote.label} · ${quote.symbol}`}>
            <strong>{quote.label}</strong><span>{formatTickerNumber(quote.price)} {quote.currency}</span>{tick && <span className="nav-ticker-tick" aria-label={tick === 'up' ? 'Fiyat yükseldi' : 'Fiyat düştü'}><TickIcon size={11} /></span>}
            <span className="nav-ticker-change"><ChangeIcon size={11} />%{Math.abs(quote.changePercent).toFixed(2)}</span>
        </span>;
    });

    return <>
        <section className="nav-ticker-strip" aria-label="Küresel piyasa verileri" title="Veriler yaklaşık 15 saniyede bir yenilenir; fiyat hareketleri kısa süreyle vurgulanır.">
            <span className="nav-ticker-status"><i />PİYASA AKIŞI</span>
            <div className="nav-ticker-viewport">
                {tickerItems.length ? <div className="nav-ticker-track">
                    <div className="nav-ticker-items">{tickerItems}</div>
                    <div className="nav-ticker-items" aria-hidden="true">{tickerItems}</div>
                </div> : <span className="nav-ticker-unavailable">Piyasa verileri yükleniyor</span>}
            </div>
        </section>
        <header className={`app-nav${menuOpen ? ' menu-open' : ''}`}>
            <Link href="/" className="app-nav-brand" aria-label="Trade Agent ana sayfa" onClick={() => setMenuOpen(false)}>
                <Image src="/brand/wordmark-dark.png" alt="" width={148} height={32} priority className="brand-wordmark brand-wordmark-dark" />
                <Image src="/brand/wordmark-light.png" alt="" width={148} height={32} className="brand-wordmark brand-wordmark-light" />
            </Link>

            <button type="button" className="nav-search-wrap" aria-label="Hisse veya sayfa ara" onClick={openPalette}>
                <Search size={16} aria-hidden="true" />
                <span>Hisse veya sayfa ara</span>
            </button>

            <button className="mobile-menu-toggle" type="button" aria-label={menuOpen ? 'Menüyü kapat' : 'Menüyü aç'} aria-expanded={menuOpen} aria-controls="primary-navigation" onClick={() => { setMenuOpen((open) => !open); setOpenDropdown(null); }}>
                {menuOpen ? <X size={18} /> : <Menu size={18} />}
            </button>

            {menuOpen && <button className="mobile-nav-backdrop" type="button" aria-label="Menüyü kapat" onClick={() => setMenuOpen(false)} />}
            <nav id="primary-navigation" className="nav-menu-area" aria-label="Ana gezinme" style={menuOpen ? { opacity: 1, transform: 'translateX(0)', transition: 'none' } : undefined}>
                <div className="mobile-nav-heading">
                    <div><span className="ds-eyebrow">TRADE DESK / MENÜ</span><strong>Çalışma alanları</strong></div>
                    <button className="mobile-nav-close" type="button" aria-label="Menüyü kapat" onClick={() => setMenuOpen(false)}><X size={18} /></button>
                </div>
                <div className="app-nav-menu-group nav-market-menu-group">
                    <button type="button" className={`nav-menu-trigger${activeMarket ? ' active' : ''}`} aria-expanded={openDropdown === 'market'} onClick={() => toggleDropdown('market')}>
                        <span className="nav-menu-trigger-label"><LayoutDashboard size={16} /> Piyasa</span>
                        <ChevronDown size={14} className={openDropdown === 'market' ? 'is-open' : ''} />
                    </button>
                    {openDropdown === 'market' && <div className="nav-mega-dropdown">
                        <span className="nav-mega-eyebrow">PİYASA ARAÇLARI</span>
                        {MARKET_LINKS.map((item) => <NavMenuLink key={item.href} item={item} pathname={pathname} onNavigate={() => { setMenuOpen(false); setOpenDropdown(null); }} />)}
                    </div>}
                </div>
                <div className="app-nav-menu-group">
                    <button type="button" className={`nav-menu-trigger${activeCommunity ? ' active' : ''}`} aria-expanded={openDropdown === 'community'} onClick={() => toggleDropdown('community')}>
                        <span className="nav-menu-trigger-label"><UsersRound size={16} /> Topluluk</span>
                        <ChevronDown size={14} className={openDropdown === 'community' ? 'is-open' : ''} />
                    </button>
                    {openDropdown === 'community' && <div className="nav-mega-dropdown">
                        <span className="nav-mega-eyebrow">TOPLULUK VE ÖĞRENME</span>
                        {COMMUNITY_LINKS.map((item) => <NavMenuLink key={item.href} item={item} pathname={pathname} onNavigate={() => { setMenuOpen(false); setOpenDropdown(null); }} />)}
                    </div>}
                </div>
                <Link href="/portfolio" className={`nav-portfolio-link${pathname === '/portfolio' ? ' active' : ''}`} aria-current={pathname === '/portfolio' ? 'page' : undefined} onClick={() => { setMenuOpen(false); setOpenDropdown(null); }}>
                    <BriefcaseBusiness size={15} /> Portföyüm
                </Link>
                <div className="app-nav-actions">
                    <ThemeToggle />
                    <NotificationCenter />
                    <AuthStatus />
                </div>
            </nav>
        </header>

        {paletteOpen && typeof document !== 'undefined' && createPortal(<div className="command-palette-backdrop" role="presentation" onClick={(event) => { if (event.target === event.currentTarget) closePalette(); }}>
            <section className="command-palette" role="dialog" aria-modal="true" aria-labelledby="command-palette-title">
                <div className="command-palette-search">
                    <Search size={19} aria-hidden="true" />
                    <input
                        ref={paletteInput}
                        id="command-palette-title"
                        type="search"
                        value={paletteQuery}
                        onChange={(event) => { setPaletteQuery(event.target.value); setActiveResult(0); }}
                        onKeyDown={onPaletteKeyDown}
                        placeholder="Hisse, şirket veya sayfa ara..."
                        autoComplete="off"
                    />
                    <button type="button" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); closePalette(); }} aria-label="Aramayı kapat" title="Aramayı kapat"><X size={17} /></button>
                </div>
                <div className="command-palette-results" role="listbox" aria-label="Arama sonuçları">
                    {searchResults.map((result, index) => {
                        const Icon = result.icon;
                        return <button type="button" role="option" aria-selected={activeResult === index} key={`${result.kind}-${result.href}`} className={`command-palette-result${activeResult === index ? ' active' : ''}`} onMouseEnter={() => setActiveResult(index)} onClick={() => selectResult(result)}>
                            <span className="command-result-icon"><Icon size={16} /></span>
                            <span className="command-result-copy"><strong>{result.label}</strong><small>{result.description}</small></span>
                            <span className="command-result-kind">{result.kind === 'stock' ? 'HİSSE' : 'SAYFA'}</span>
                        </button>;
                    })}
                    {!searchResults.length && !searchError && <p className="command-palette-empty">{paletteQuery.length < 2 ? 'Aramak için en az 2 karakter yazın.' : 'Eşleşen hisse veya sayfa bulunamadı.'}</p>}
                    {searchError && <p className="command-palette-error">{searchError}</p>}
                </div>
                <footer className="command-palette-footer"><span><kbd>↑</kbd><kbd>↓</kbd> gezin</span><span><kbd>Enter</kbd> aç</span><span><kbd>Esc</kbd> kapat</span></footer>
            </section>
        </div>, document.body)}
    </>;
}

function NavMenuLink({ item, pathname, onNavigate }: { item: NavItem; pathname: string; onNavigate: () => void }) {
    const Icon = item.icon;
    const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
    return <Link href={item.href} className={`nav-mega-link${active ? ' active' : ''}`} aria-current={active ? 'page' : undefined} onClick={onNavigate}>
        <span className="nav-mega-icon"><Icon size={17} /></span>
        <span className="nav-mega-copy"><strong>{item.label}</strong><small>{item.description}</small></span>
    </Link>;
}
