'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, Info, OctagonAlert, X } from 'lucide-react';

type Announcement = { id: string; title: string; message: string; severity: 'info' | 'warning' | 'critical' };
export default function SystemAnnouncementBanner() {
    const [items, setItems] = useState<Announcement[]>([]);
    const [dismissed, setDismissed] = useState<string[]>([]);
    useEffect(() => {
        let active = true;
        const load = async () => {
            const response = await fetch('/api/announcements', { cache: 'no-store' });
            if (!response.ok) throw new Error('Duyurular yüklenemedi.');
            const payload = await response.json() as { data?: Announcement[] };
            if (active) setItems(payload.data ?? []);
        };
        void load().catch((error: unknown) => console.error('Announcement banner request failed.', error));
        const interval = window.setInterval(() => { void load().catch((error: unknown) => console.error('Announcement refresh failed.', error)); }, 60000);
        return () => { active = false; window.clearInterval(interval); };
    }, []);
    const visible = items.filter((item) => !dismissed.includes(item.id));
    if (!visible.length) return null;
    return <div className="relative z-40 space-y-2 bg-slate-950 px-3 pt-2 sm:px-5">
        {visible.map((item) => {
            const style = item.severity === 'critical'
                ? 'border-rose-500/25 bg-rose-500/10 text-rose-200'
                : item.severity === 'warning'
                    ? 'border-amber-500/25 bg-amber-500/10 text-amber-100'
                    : 'border-sky-500/25 bg-sky-500/10 text-sky-100';
            const Icon = item.severity === 'critical' ? OctagonAlert : item.severity === 'warning' ? AlertTriangle : Info;
            return <div key={item.id} className={`mx-auto flex max-w-[1600px] items-start gap-3 rounded-xl border px-4 py-3 ${style}`}>
                <Icon className="mt-0.5 h-4 w-4 shrink-0" /><div className="min-w-0 flex-1"><strong className="block text-xs">{item.title}</strong><p className="mt-0.5 break-words text-xs opacity-90">{item.message}</p></div>
                <button type="button" aria-label="Duyuruyu kapat" onClick={() => setDismissed((current) => [...current, item.id])} className="rounded p-1 opacity-70 hover:opacity-100"><X className="h-4 w-4" /></button>
            </div>;
        })}
    </div>;
}
