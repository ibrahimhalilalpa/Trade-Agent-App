'use client';

import { useCallback, useEffect, useState, type DragEvent } from 'react';
import { ChevronDown, ChevronRight, GripVertical, Heart, ListPlus, Pencil, Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import type { MarketQuote } from '@/lib/types';
import { useAppPreferences } from '@/components/AppProviders';
import { showError } from '@/lib/ui-alerts';

type ResearchList = { id: string; name: string; symbols: string[]; isFavorites: boolean };
type SavedState = { favorites: string[]; favoritesId: string; collections: ResearchList[] };
type ListsPayload = { data?: ResearchList[]; error?: string };
type DragItem = { type: 'list'; id: string } | { type: 'symbol'; listId: string; symbol: string };
interface ResearchListsProps { selectedSymbol: string; onSelect: (symbol: string) => void; }

function mapState(lists: ResearchList[]): SavedState {
    const favorites = lists.find((list) => list.isFavorites);
    return { favorites: favorites?.symbols ?? [], favoritesId: favorites?.id ?? '', collections: lists.filter((list) => !list.isFavorites) };
}

function percentLabel(value: number | null | undefined): string {
    if (typeof value !== 'number') return '--';
    return `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function percentBadgeClass(value: number | null | undefined): string {
    return typeof value !== 'number' || value === 0 ? 'ds-badge-neutral' : value > 0 ? 'ds-badge-emerald' : 'ds-badge-rose';
}

export default function ResearchLists({ selectedSymbol, onSelect }: ResearchListsProps) {
    const { confirmDialog } = useAppPreferences();
    const [state, setState] = useState<SavedState>({ favorites: [], favoritesId: '', collections: [] });
    const [symbol, setSymbol] = useState('');
    const [newListName, setNewListName] = useState('');
    const [targetId, setTargetId] = useState('');
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editingName, setEditingName] = useState('');
    const [collapsedListIds, setCollapsedListIds] = useState<string[]>([]);
    const [dragItem, setDragItem] = useState<DragItem | null>(null);
    const [dragOverId, setDragOverId] = useState<string | null>(null);
    const [quotes, setQuotes] = useState<Record<string, MarketQuote>>({});
    const [loading, setLoading] = useState(true);
    const [authRequired, setAuthRequired] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        if (error) showError(error);
    }, [error]);

    const loadLists = useCallback(async () => {
        try {
            const response = await fetch('/api/lists', { cache: 'no-store' });
            const payload = await response.json() as ListsPayload;
            if (response.status === 401) { setAuthRequired(true); return; }
            if (!response.ok || !payload.data) throw new Error(payload.error ?? 'Listeler yüklenemedi.');
            setAuthRequired(false);
            setState(mapState(payload.data));
            setTargetId((current) => current || payload.data?.find((list) => !list.isFavorites)?.id || '');
        } catch (cause) { setError(cause instanceof Error ? cause.message : 'Listeler yüklenemedi.'); }
        finally { setLoading(false); }
    }, []);

    useEffect(() => { queueMicrotask(() => void loadLists()); }, [loadLists]);
    useEffect(() => {
        let active = true;
        const loadQuotes = async () => {
            try {
                const response = await fetch('/api/market?limit=all', { cache: 'no-store' });
                const payload = await response.json() as { data?: MarketQuote[] };
                if (active) setQuotes(Object.fromEntries((payload.data ?? []).map((quote) => [quote.symbol, quote])));
            } catch { /* Quotes are supplemental; saved symbols remain available. */ }
        };
        void loadQuotes();
        const interval = window.setInterval(() => void loadQuotes(), 30_000);
        return () => { active = false; window.clearInterval(interval); };
    }, []);

    const mutate = async (body: Record<string, string | string[]>) => {
        setError('');
        const response = await fetch('/api/lists', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const payload = await response.json() as ListsPayload;
        if (response.status === 401) { setAuthRequired(true); return false; }
        if (!response.ok) { setError(payload.error ?? 'Liste güncellenemedi.'); return false; }
        if (payload.data) {
            setState(mapState(payload.data));
            setTargetId((current) => current || payload.data?.find((list) => !list.isFavorites)?.id || '');
        }
        return true;
    };

    const availableSymbols = Object.keys(quotes).sort();
    const matchingSymbols = availableSymbols.filter((item) => !symbol || item.startsWith(symbol)).slice(0, 12);
    const addToList = async (listId: string, value = symbol) => {
        const next = value.trim().toUpperCase();
        if (!/^[A-Z0-9]{3,6}$/.test(next)) return;
        if (!listId) { setError('Önce bir çalışma listesi oluşturun veya seçin.'); return; }
        if (!quotes[next]) {
            try {
                const response = await fetch(`/api/market?symbol=${encodeURIComponent(next)}`, { cache: 'no-store' });
                const payload = await response.json() as { data?: MarketQuote[] };
                const quote = payload.data?.[0];
                if (quote) setQuotes((current) => ({ ...current, [quote.symbol]: quote }));
            } catch { /* A symbol can still be saved when quote data is unavailable. */ }
        }
        if (await mutate({ action: 'add', id: listId, symbol: next })) setSymbol('');
    };

    const createList = async () => {
        const name = newListName.trim();
        if (name && await mutate({ action: 'create', name })) setNewListName('');
    };
    const deleteList = async (listId: string) => {
        if (await confirmDialog({ title: 'Liste silinsin mi?', message: 'Bu liste ve içindeki hisseler silinecek.', confirmLabel: 'Listeyi sil', danger: true })) {
            await mutate({ action: 'delete', id: listId });
        }
    };
    const saveName = async (listId: string) => {
        const name = editingName.trim();
        if (name && await mutate({ action: 'rename', id: listId, name })) setEditingId(null);
    };
    const removeFromList = (listId: string, value: string) => void mutate({ action: 'remove', id: listId, symbol: value });
    const toggleList = (listId: string) => {
        setCollapsedListIds((current) => current.includes(listId) ? current.filter((id) => id !== listId) : [...current, listId]);
    };
    const moveList = async (targetId: string) => {
        if (dragItem?.type !== 'list' || dragItem.id === targetId) return;
        const order = state.collections.map((list) => list.id);
        const from = order.indexOf(dragItem.id);
        const to = order.indexOf(targetId);
        if (from < 0 || to < 0) return;
        order.splice(to, 0, ...order.splice(from, 1));
        await mutate({ action: 'reorder_lists', order });
        setDragItem(null);
        setDragOverId(null);
    };
    const moveSymbol = async (targetListId: string, targetSymbol: string) => {
        if (dragItem?.type !== 'symbol' || dragItem.listId !== targetListId || dragItem.symbol === targetSymbol) return;
        const list = targetListId === state.favoritesId
            ? { id: state.favoritesId, symbols: state.favorites }
            : state.collections.find((item) => item.id === targetListId);
        if (!list) return;
        const order = [...list.symbols];
        const from = order.indexOf(dragItem.symbol);
        const to = order.indexOf(targetSymbol);
        if (from < 0 || to < 0) return;
        order.splice(to, 0, ...order.splice(from, 1));
        await mutate({ action: 'reorder_symbols', id: targetListId, order });
        setDragItem(null);
        setDragOverId(null);
    };
    const handleDragStart = (event: DragEvent, item: DragItem) => {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', JSON.stringify(item));
        setDragItem(item);
    };
    const handleDragEnd = () => {
        setDragItem(null);
        setDragOverId(null);
    };
    const renderSavedStock = (item: string, listId: string) => {
        const quote = quotes[item];
        const dragId = `symbol:${listId}:${item}`;
        return <div className={`saved-item${dragOverId === dragId ? ' drag-over' : ''}`} key={item} onDragOver={(event) => { if (dragItem?.type === 'symbol' && dragItem.listId === listId) { event.preventDefault(); setDragOverId(dragId); } }} onDragLeave={() => setDragOverId((current) => current === dragId ? null : current)} onDrop={(event) => { event.preventDefault(); void moveSymbol(listId, item); }}>
            <button type="button" className="saved-item-drag" draggable onDragStart={(event) => handleDragStart(event, { type: 'symbol', listId, symbol: item })} onDragEnd={handleDragEnd} aria-label={`${item} hissesini sürükleyerek sırala`} title="Sürükleyerek sırala"><GripVertical size={15} /></button>
            <button type="button" className="saved-stock-button" onClick={() => onSelect(item)}>
                <span className="saved-item-top"><strong>{item}</strong><small>{quote ? `${quote.price.toFixed(2)} ₺` : 'Fiyat bekleniyor'}</small></span>
                <span className="saved-returns">
                    <small>Gün<b className={`ds-badge ${percentBadgeClass(quote?.change1D ?? quote?.changePercent)}`}>{percentLabel(quote?.change1D ?? quote?.changePercent)}</b></small>
                    <small>Hafta<b className={`ds-badge ${percentBadgeClass(quote?.change1W)}`}>{percentLabel(quote?.change1W)}</b></small>
                    <small>Ay<b className={`ds-badge ${percentBadgeClass(quote?.change1M)}`}>{percentLabel(quote?.change1M)}</b></small>
                </span>
            </button>
            <button type="button" className="remove-button" title="Listeden çıkar" aria-label={`${item} hissesini listeden çıkar`} onClick={() => removeFromList(listId, item)}><Trash2 size={13} /></button>
        </div>;
    };

    if (authRequired) return <section id="lists" className="panel ds-panel lists-panel auth-required"><div><span className="ds-eyebrow">KİŞİSEL ARAŞTIRMA</span><h2>Listelerin sana özel.</h2><p>Hisselerini kaydetmek ve cihazların arasında eşitlemek için giriş yapmalısın.</p><Link className="primary-button ds-primary-button compact" href="/auth?next=/lists">Giriş yap veya kayıt ol</Link></div></section>;
    if (loading) return <section id="lists" className="panel ds-panel lists-panel"><span className="ds-badge ds-badge-amber">Kişisel listelerin yükleniyor...</span></section>;
    if (error && !state.collections.length) return <section id="lists" className="panel ds-panel lists-panel auth-required"><div><span className="ds-eyebrow">VERİTABANI KURULUMU</span><h2>Listeler henüz hazır değil.</h2><p>{error}</p><p>Supabase SQL Editor’da <strong>supabase/schema.sql</strong> dosyasını çalıştırıp sayfayı yenile.</p></div></section>;

    return <section id="lists" className="panel ds-panel lists-panel">
        <div className="section-heading"><div><span className="ds-eyebrow">KİŞİSEL ARAŞTIRMA</span><h2>Favoriler ve çalışma listeleri</h2></div></div>
        <div className="list-input"><input value={symbol} onChange={(event) => setSymbol(event.target.value.toUpperCase())} onKeyDown={(event) => { if (event.key === 'Enter') void addToList(targetId); }} placeholder="Hisse kodu ara..." aria-label="Çalışma listesine hisse ekle" /><select value={targetId} onChange={(event) => setTargetId(event.target.value)} disabled={!state.collections.length}><option value="" disabled>Liste seçin</option>{state.collections.map((list) => <option key={list.id} value={list.id}>{list.name}</option>)}</select><button className="primary-button ds-primary-button compact" onClick={() => void addToList(targetId)} disabled={!state.collections.length}><Plus size={15} /> Ekle</button></div>
        {symbol && <div className="symbol-suggestions" role="listbox">{matchingSymbols.map((item) => <button type="button" key={item} onClick={() => setSymbol(item)}>{item}<span>{quotes[item]?.price.toFixed(2)} ₺</span></button>)}{!matchingSymbols.length && <span className="muted">Bu kodla eşleşen hisse bulunamadı.</span>}</div>}
        <div className="new-list-row"><input value={newListName} onChange={(event) => setNewListName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void createList(); }} placeholder="Yeni liste adı..." aria-label="Yeni liste adı" /><button className="secondary-button ds-secondary-button" onClick={() => void createList()}><ListPlus size={14} /> Yeni liste oluştur</button></div>
        <div className="favorites-row">
            <div className="saved-list favorite-list">
                <div className="saved-list-head"><strong><Heart size={14} /> Favoriler</strong><span className="ds-badge ds-badge-rose">{state.favorites.length} hisse</span></div>
                <div className="saved-list-items">{state.favorites.length ? state.favorites.map((item) => renderSavedStock(item, state.favoritesId)) : <span className="muted">Favori hissen yok.</span>}</div>
            </div>
            <div className="saved-list favorite-list">
                <div className="saved-list-head"><strong><ListPlus size={14} /> Hızlı ekle</strong><span className="ds-badge ds-badge-amber">Aktif: {selectedSymbol}</span></div>
                <div className="quick-adds">{state.collections.map((list) => <button type="button" key={list.id} onClick={() => void addToList(list.id, selectedSymbol)}><ListPlus size={13} /> {list.name}</button>)}</div>
            </div>
        </div>
        <div className="saved-lists-grid">{state.collections.map((list) => {
            const isCollapsed = collapsedListIds.includes(list.id);
            const stockCount = list.symbols.length;
            const listDragId = `list:${list.id}`;
            return <div className={`saved-list${dragOverId === listDragId ? ' drag-over' : ''}`} key={list.id} onDragOver={(event) => { if (dragItem?.type === 'list') { event.preventDefault(); setDragOverId(listDragId); } }} onDragLeave={() => setDragOverId((current) => current === listDragId ? null : current)} onDrop={(event) => { event.preventDefault(); void moveList(list.id); }}>
                <div className={`saved-list-head${editingId === list.id ? ' editing' : ''}`}>
                    <button type="button" className="list-drag-handle" draggable onDragStart={(event) => handleDragStart(event, { type: 'list', id: list.id })} onDragEnd={handleDragEnd} aria-label={`${list.name} listesini sürükleyerek sırala`} title="Listeyi sürükleyerek sırala"><GripVertical size={15} /></button>
                    <div className="saved-list-title">
                        {editingId === list.id
                            ? <input className="inline-name" aria-label={`${list.name} listesinin yeni adı`} value={editingName} onChange={(event) => setEditingName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void saveName(list.id); }} autoFocus />
                            : <strong>{list.name}</strong>}
                        <span className="ds-badge ds-badge-emerald">{stockCount} hisse</span>
                    </div>
                    <div className="list-actions">
                        <button type="button" className="list-collapse" title={isCollapsed ? 'Listeyi genişlet' : 'Listeyi daralt'} aria-label={`${list.name} listesini ${isCollapsed ? 'genişlet' : 'daralt'}`} aria-expanded={!isCollapsed} onClick={() => toggleList(list.id)}>{isCollapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}</button>
                        {editingId === list.id
                            ? <button type="button" title="Kaydet" aria-label="Liste adını kaydet" onClick={() => void saveName(list.id)}>Kaydet</button>
                            : <button type="button" title="Liste adını düzenle" aria-label="Liste adını düzenle" onClick={() => { setEditingId(list.id); setEditingName(list.name); }}><Pencil size={13} /></button>}
                        <button type="button" title="Listeyi sil" aria-label={`${list.name} listesini sil`} onClick={() => void deleteList(list.id)}><Trash2 size={13} /></button>
                    </div>
                </div>
                {!isCollapsed && <div className="saved-list-items">
                    {stockCount ? list.symbols.map((item) => renderSavedStock(item, list.id)) : <span className="ds-badge ds-badge-amber">Henüz hisse eklenmedi.</span>}
                </div>}
            </div>;
        })}</div>
    </section>;
}
