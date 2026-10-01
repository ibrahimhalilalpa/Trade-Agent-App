'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, MessageCircle, Plus, ThumbsUp } from 'lucide-react';

type ForumTopic = { id: string; title: string; content: string; related_symbol: string | null; helpful_count: number; comments_count: number; created_at: string };

export default function StockForumPanel({ symbol }: { symbol: string }) {
    const [topics, setTopics] = useState<ForumTopic[]>([]);
    const [error, setError] = useState('');
    useEffect(() => {
        let active = true;
        void fetch(`/api/forum/topics?symbol=${encodeURIComponent(symbol)}&sort=popular&limit=4`, { cache: 'no-store' })
            .then(async (response) => {
                const payload = await response.json() as { data?: { topics: ForumTopic[] }; error?: string };
                if (!response.ok || !payload.data) throw new Error(payload.error ?? 'Hisse tartışmaları yüklenemedi.');
                if (active) setTopics(payload.data.topics ?? []);
            })
            .catch((cause) => {
                if (active) setError(cause instanceof Error ? cause.message : 'Hisse tartışmaları yüklenemedi.');
            });
        return () => { active = false; };
    }, [symbol]);

    return <section className="stock-forum-panel">
        <div className="stock-section-heading"><div><span className="eyebrow">TOPLULUK / {symbol}</span><h3>Hisse tartışmaları</h3></div><Link href={`/forum?symbol=${encodeURIComponent(symbol)}`}>Tümünü gör <ArrowUpRight size={14} /></Link></div>
        <div className="stock-forum-list">
            {error ? <p className="stock-data-note">{error}</p> : topics.length ? topics.map((topic) => <article key={topic.id}>
                <div className="min-w-0"><Link href={`/forum/${topic.id}`} className="stock-forum-title">{topic.title}</Link><p>{topic.content.length > 140 ? `${topic.content.slice(0, 140)}…` : topic.content}</p></div>
                <span><ThumbsUp size={12} />{topic.helpful_count}</span><span><MessageCircle size={12} />{topic.comments_count}</span>
            </article>) : <p className="stock-data-note">Bu hisse için henüz tartışma yok.</p>}
        </div>
        <Link href={`/forum?symbol=${encodeURIComponent(symbol)}&create=1`} className="stock-forum-create"><Plus size={14} />Bu hisse hakkında konu aç</Link>
    </section>;
}
