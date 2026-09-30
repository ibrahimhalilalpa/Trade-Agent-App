'use client';

import { FormEvent, useState } from 'react';
import { Bot, Send } from 'lucide-react';
import type { AgentAnalysis, HistoricalStats, Indicators, MarketNews } from '@/lib/types';

interface AIChatProps { symbol: string; price: number; indicators: Indicators; history: HistoricalStats; news: MarketNews[]; analyses: AgentAnalysis[]; }
type Message = { role: 'user' | 'assistant'; text: string };

export default function AIChat({ symbol, price, indicators, history, news, analyses }: AIChatProps) {
    const [question, setQuestion] = useState('');
    const [messages, setMessages] = useState<Message[]>([]);
    const [loading, setLoading] = useState(false);
    const ask = async (event: FormEvent) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget as HTMLFormElement);
        const text = String(formData.get('question') ?? question).trim();
        if (!text || loading) return;
        setQuestion(''); setMessages((current) => [...current, { role: 'user', text }]); setLoading(true);
        try {
            const response = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ symbol, price, question: text, indicators, history, news, analyses, messages }) });
            const payload = await response.json() as { answer?: string; error?: string };
            setMessages((current) => [...current, { role: 'assistant', text: payload.answer ?? payload.error ?? 'Yanıt alınamadı.' }]);
        } catch { setMessages((current) => [...current, { role: 'assistant', text: 'Sohbet servisine ulaşılamadı.' }]); } finally { setLoading(false); }
    };
    return <section className="ai-chat panel"><div className="section-heading"><div><span className="eyebrow">AI SOHBETİ</span><h2>{symbol} hakkında AI’a sor</h2></div><Bot size={18} className="positive" /></div><div className="chat-messages">{!messages.length && <p className="muted">Örnek: “Bu seviyede risk/ödül oranı neden zayıf?”, “Son haberler teknik görünümü nasıl değiştiriyor?”</p>}{messages.map((message, index) => <div className={`chat-message ${message.role}`} key={`${message.role}-${index}`}><span>{message.role === 'user' ? 'Sen' : 'AI'}</span><p>{message.text}</p></div>)}{loading && <div className="chat-message assistant"><span>AI</span><p>Veri ve haber bağlamı inceleniyor...</p></div>}</div><form className="chat-form" onSubmit={ask}><textarea name="question" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Aklındaki soruyu yaz..." rows={2} aria-label="AI’a soru sor" /><button className="primary-button" type="submit" disabled={loading || !question.trim()}><Send size={15} /> Sor</button></form></section>;
}
