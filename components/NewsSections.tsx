import { ExternalLink } from 'lucide-react';
import type { MarketNews } from '@/lib/types';

interface NewsSectionsProps { symbol: string; news: MarketNews[]; }

function NewsList({ items, empty }: { items: MarketNews[]; empty: string }) {
    return <div className="news-list">{items.length ? items.map((item) => <a className="news-item" href={item.url} target="_blank" rel="noreferrer" key={`${item.title}-${item.publishedAt}`}><div><strong>{item.title}</strong><span>{item.publisher} · {new Date(item.publishedAt).toLocaleString('tr-TR')}</span></div><ExternalLink size={14} /></a>) : <span className="muted">{empty}</span>}</div>;
}

export default function NewsSections({ symbol, news }: NewsSectionsProps) {
    const kapNews = news.filter((item) => item.publisher.toLocaleLowerCase('tr-TR').includes('kap') || item.url.includes('kap.org.tr'));
    const generalNews = news.filter((item) => !kapNews.includes(item));
    return <section className="news-sections"><article className="panel research-panel"><div className="section-heading"><div><span className="eyebrow">KAP / ŞİRKET GELİŞMELERİ</span><h2>{symbol} KAP ve gelişmeler</h2></div><a className="muted" href="https://www.kap.org.tr/tr/bildirim-sorgu" target="_blank" rel="noreferrer">KAP’a git ↗</a></div><NewsList items={kapNews} empty="Bu akış için güncel KAP bildirimi bulunamadı." /></article><article className="panel research-panel"><div className="section-heading"><div><span className="eyebrow">HABER AKIŞI</span><h2>{symbol} haberleri</h2></div><span className="muted">Haber sağlayıcıları</span></div><NewsList items={generalNews} empty="Genel haber akışı bulunamadı." /></article></section>;
}
