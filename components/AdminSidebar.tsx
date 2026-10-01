'use client';

import { Activity, BellRing, BookOpen, Boxes, CircleDollarSign, LayoutDashboard, Menu, MessageSquare, ScrollText, Settings2, Shield, Users, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';

const ITEMS = [
    { href: '/admin', label: 'Genel Bakış', icon: LayoutDashboard },
    { href: '/admin/users', label: 'Kullanıcı Yönetimi', icon: Users },
    { href: '/admin/portfolios', label: 'Portföyler & Pozisyonlar', icon: Boxes },
    { href: '/admin/orders', label: 'Emirler & Alarmlar', icon: ScrollText },
    { href: '/admin/balances', label: 'Bakiye İşlemleri', icon: CircleDollarSign, superAdminOnly: true },
    { href: '/admin/academy', label: 'Akademi İçerikleri', icon: BookOpen },
    { href: '/admin/community', label: 'Topluluk & Forum', icon: MessageSquare },
    { href: '/admin/system', label: 'Sistem & Ayarlar', icon: Settings2 },
];

export default function AdminSidebar({ role }: { role: string }) {
    const pathname = usePathname();
    const [open, setOpen] = useState(false);
    const nav = <nav aria-label="Yönetim navigasyonu" className="space-y-1">
        <p className="px-3 pb-2 pt-4 text-[10px] font-bold tracking-[.18em] text-slate-500">WORKSPACE</p>
        {ITEMS.filter((item) => !item.superAdminOnly || role === 'super_admin').map(({ href, label, icon: Icon }) => {
            const active = pathname === href || (href !== '/admin' && pathname.startsWith(`${href}/`));
            return <Link key={href} href={href} onClick={() => setOpen(false)}
                className={`flex items-center gap-3 rounded-xl border px-3 py-3 text-sm font-semibold transition ${active ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300' : 'border-transparent text-slate-400 hover:border-slate-800 hover:bg-slate-900 hover:text-slate-100'}`}>
                <Icon className="h-4 w-4 shrink-0" /><span>{label}</span>
            </Link>;
        })}
    </nav>;
    return <>
        <div className="sticky top-0 z-40 flex items-center justify-between border-b border-slate-800 bg-slate-950/95 px-4 py-3 backdrop-blur lg:hidden">
            <div className="flex items-center gap-2 text-sm font-bold"><Shield className="h-4 w-4 text-emerald-400" />ADMIN CONTROL CENTER</div>
            <button type="button" aria-expanded={open} aria-label={open ? 'Menüyü kapat' : 'Menüyü aç'} onClick={() => setOpen(!open)} className="rounded-lg border border-slate-700 bg-slate-900 p-2 text-slate-200">{open ? <X size={18} /> : <Menu size={18} />}</button>
        </div>
        <aside className="hidden w-72 shrink-0 border-r border-slate-800 bg-slate-950 p-4 lg:block">
            <div className="flex items-center gap-3 border-b border-slate-800 px-3 pb-5 pt-2"><span className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-2 text-emerald-400"><Activity size={18} /></span><div><strong className="block text-sm text-white">Control Center</strong><span className="text-[10px] uppercase tracking-widest text-slate-500">BIST Operations</span></div></div>
            {nav}
            <div className="mt-8 rounded-xl border border-slate-800 bg-slate-900/70 p-3"><div className="flex items-center gap-2 text-xs font-bold text-slate-200"><BellRing className="h-4 w-4 text-emerald-400" />Yetkili oturum</div><span className="mt-2 inline-block rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-semibold text-emerald-300">{role.replace('_', ' ')}</span></div>
        </aside>
        {open && <div className="fixed inset-0 z-50 bg-slate-950 lg:hidden"><div className="flex items-center justify-between border-b border-slate-800 p-4"><strong className="text-sm">Admin Control Center</strong><button onClick={() => setOpen(false)} aria-label="Menüyü kapat" className="rounded-lg border border-slate-700 p-2"><X size={18} /></button></div><div className="p-4">{nav}</div></div>}
    </>;
}
