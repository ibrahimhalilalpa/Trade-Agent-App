'use client';

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';

export default function MentionTextarea({
    value,
    onChange,
    className,
    placeholder,
    rows = 3,
    maxLength,
    required,
    id,
    autoFocus,
}: {
    value: string;
    onChange: (value: string) => void;
    className: string;
    placeholder?: string;
    rows?: number;
    maxLength?: number;
    required?: boolean;
    id?: string;
    autoFocus?: boolean;
}) {
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const [query, setQuery] = useState('');
    const [suggestions, setSuggestions] = useState<string[]>([]);
    const [activeIndex, setActiveIndex] = useState(0);
    const [searchError, setSearchError] = useState('');

    useEffect(() => {
        if (!query) return;
        const controller = new AbortController();
        const timer = window.setTimeout(() => {
            void fetch(`/api/forum/mentions?q=${encodeURIComponent(query)}`, { signal: controller.signal })
                .then(async (response) => {
                    const payload = await response.json() as { data?: { usernames?: string[] }; error?: string };
                    if (!response.ok) throw new Error(payload.error ?? 'Kullanıcı önerileri yüklenemedi.');
                    setSuggestions(payload.data?.usernames ?? []);
                    setActiveIndex(0);
                    setSearchError('');
                })
                .catch((cause: unknown) => {
                    if (cause instanceof Error && cause.name === 'AbortError') return;
                    setSuggestions([]);
                    setSearchError(cause instanceof Error ? cause.message : 'Kullanıcı önerileri yüklenemedi.');
                });
        }, 180);
        return () => {
            window.clearTimeout(timer);
            controller.abort();
        };
    }, [query]);

    const detectMention = (text: string, cursor: number) => {
        const beforeCursor = text.slice(0, cursor);
        const match = beforeCursor.match(/(?:^|\s)@([\p{L}\p{N}_]{1,24})$/u);
        const nextQuery = match?.[1] ?? '';
        setQuery(nextQuery);
        if (!nextQuery) {
            setSuggestions([]);
            setSearchError('');
        }
    };

    const insertMention = (username: string) => {
        const textarea = textareaRef.current;
        if (!textarea) return;
        const cursor = textarea.selectionStart;
        const before = value.slice(0, cursor);
        const match = before.match(/(?:^|\s)@([\p{L}\p{N}_]{1,24})$/u);
        if (!match || match.index === undefined) return;
        const start = match.index + (match[0].startsWith(' ') ? 1 : 0);
        const replacement = `@${username} `;
        const next = `${value.slice(0, start)}${replacement}${value.slice(cursor)}`;
        onChange(next);
        setQuery('');
        setSuggestions([]);
        requestAnimationFrame(() => {
            textarea.focus();
            textarea.setSelectionRange(start + replacement.length, start + replacement.length);
        });
    };

    const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
        if (!suggestions.length) return;
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            setActiveIndex((current) => (current + 1) % suggestions.length);
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setActiveIndex((current) => (current - 1 + suggestions.length) % suggestions.length);
        } else if (event.key === 'Enter' || event.key === 'Tab') {
            event.preventDefault();
            insertMention(suggestions[activeIndex]);
        } else if (event.key === 'Escape') {
            setQuery('');
            setSuggestions([]);
        }
    };

    return <div className="relative">
        <textarea
            ref={textareaRef}
            id={id}
            value={value}
            onChange={(event) => {
                onChange(event.target.value);
                detectMention(event.target.value, event.target.selectionStart);
            }}
            onClick={(event) => detectMention(value, event.currentTarget.selectionStart)}
            onKeyUp={(event) => detectMention(value, event.currentTarget.selectionStart)}
            onKeyDown={onKeyDown}
            className={className}
            placeholder={placeholder}
            rows={rows}
            maxLength={maxLength}
            required={required}
            autoFocus={autoFocus}
            aria-autocomplete="list"
        />
        {(suggestions.length > 0 || searchError) && <div className="absolute inset-x-0 bottom-full z-30 mb-1 max-h-48 overflow-y-auto rounded-lg border border-slate-700 bg-slate-900 p-1 shadow-xl">
            {suggestions.map((username, index) => <button
                key={username}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => insertMention(username)}
                className={`block w-full rounded-md px-3 py-2 text-left text-xs ${index === activeIndex ? 'bg-emerald-500/10 text-emerald-300' : 'text-slate-300 hover:bg-slate-800'}`}
            >@{username}</button>)}
            {searchError && <p role="status" className="px-3 py-2 text-[10px] text-amber-300">{searchError}</p>}
        </div>}
    </div>;
}
