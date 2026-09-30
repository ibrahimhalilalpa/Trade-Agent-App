import Link from 'next/link';
import type { ReactNode } from 'react';

export default function StockSymbolLink({ symbol, children }: { symbol: string; children?: ReactNode }) {
    if (!symbol || !/^[A-Z0-9]{3,6}$/.test(symbol)) return <>{children ?? symbol ?? '—'}</>;
    return <Link href={`/market?symbol=${encodeURIComponent(symbol)}`} className="font-semibold text-inherit transition hover:text-emerald-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60">
        {children ?? symbol}
    </Link>;
}
