'use client';

import { Activity, BriefcaseBusiness, Menu, MessageCircle, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import AuthStatus from '@/components/AuthStatus';
import NotificationCenter from '@/components/NotificationCenter';
import { getSupabaseBrowserClient } from '@/lib/supabase-browser';
import { ThemeToggle } from '@/components/AppProviders';

const LINKS = [
    { href: '/', label: 'Anasayfa' },
    { href: '/trade-agent', label: 'Trade Agent' },
    { href: '/market', label: 'Piyasa' },
    { href: '/lists', label: 'Listeler' },
    { href: '/portfolio', label: 'Portföyüm' },
    { href: '/leaderboard', label: 'Liderlik' },
    { href: '/education', label: 'Akademi' },
    { href: '/forum', label: 'Topluluk' },
    { href: '/support', label: 'Yardım' },
];

export default function AppNav() {
    const pathname = usePathname();
    const [menuOpen, setMenuOpen] = useState(false);
    const [isAdmin, setIsAdmin] = useState(false);
    useEffect(() => {
        let active = true;
        const updateRole = () => {
            void fetch('/api/profile/role', { cache: 'no-store' })
                .then((response) => response.json() as Promise<{ role?: string }>)
                .then((payload) => { if (active) setIsAdmin(payload.role === 'admin' || payload.role === 'super_admin'); })
                .catch(() => { if (active) setIsAdmin(false); });
        };
        updateRole();
        const client = getSupabaseBrowserClient();
        const { data: { subscription } } = client?.auth.onAuthStateChange(updateRole) ?? { data: { subscription: null } };
        return () => {
            active = false;
            subscription?.unsubscribe();
        };
    }, []);
    const links = isAdmin ? [...LINKS, { href: '/admin', label: 'Yönetim' }] : LINKS;
    return <header className={`app-nav${menuOpen ? ' menu-open' : ''}`}>
        <Link href="/" className="app-nav-brand" onClick={() => setMenuOpen(false)}><span className="brand-mark"><Activity size={18} /></span><span><b>Trade Agent</b><small>BİST araştırma terminali</small></span></Link>
        {menuOpen && <button className="mobile-nav-backdrop" type="button" aria-label="Menüyü kapat" onClick={() => setMenuOpen(false)} />}
        <nav id="primary-navigation" aria-label="Ana gezinme">
            <div className="mobile-nav-heading"><div><span className="ds-eyebrow">TRADE DESK / MENÜ</span><strong>Çalışma alanları</strong></div><button className="mobile-nav-close" type="button" aria-label="Menüyü kapat" onClick={() => setMenuOpen(false)}><X size={18} /></button></div>
            {links.map(({ href, label }) => { const active = href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`); const portfolio = href === '/portfolio'; return <Link key={href} href={href} className={`${active ? 'active ' : ''}${portfolio ? 'portfolio-nav-link' : ''}`} aria-current={active ? 'page' : undefined} onClick={() => setMenuOpen(false)}>{portfolio && <BriefcaseBusiness size={15} aria-hidden="true" />}{href === '/forum' && <MessageCircle size={15} aria-hidden="true" />}<span>{label}</span><span className="nav-link-arrow">↗</span></Link>; })}
            <div className="app-nav-inline-controls"><ThemeToggle /><NotificationCenter /></div>
            <div className="mobile-nav-footer"><AuthStatus onNavigate={() => setMenuOpen(false)} /></div>
        </nav>
        <div className="app-nav-actions">
            <button className="mobile-menu-toggle" type="button" aria-label={menuOpen ? 'Menüyü kapat' : 'Menüyü aç'} aria-expanded={menuOpen} aria-controls="primary-navigation" onClick={() => setMenuOpen((open) => !open)}>{menuOpen ? <X size={19} /> : <Menu size={19} />}</button>
        </div>
    </header>;
}
