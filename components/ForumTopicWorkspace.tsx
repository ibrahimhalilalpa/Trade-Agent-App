'use client';

import { FormEvent, useCallback, useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Clock3, CornerDownRight, Eye, ImagePlus, LockKeyhole, MessageCircle, Pin, Send, ThumbsDown, ThumbsUp, Trash2, Users } from 'lucide-react';
import { useAppPreferences } from '@/components/AppProviders';
import { getSupabaseBrowserClient } from '@/lib/supabase-browser';
import { cleanText, hasProfanity } from '@/lib/profanityFilter';
import ForumAvatar from '@/components/ForumAvatar';
import ForumReportControl from '@/components/ForumReportControl';
import MentionTextarea from '@/components/MentionTextarea';
import defaultTopicCoverImage from '@/assets/avatar/forum-kart-default-1.jpg';

type Author = { user_id: string; username: string; display_name: string; avatar_url: string | null; gender: string | null; xp_points: number | null; rank_title: string | null };
type Comment = { id: string; topic_id: string; parent_comment_id: string | null; user_id: string; content: string; attachment_url: string | null; helpful_count: number; unhelpful_count: number; created_at: string; updated_at: string; author?: Author | null; current_user_vote?: string | null };
type Topic = { id: string; user_id: string; title: string; content: string; category: string; related_symbol: string | null; cover_image_url: string | null; images: string[]; tags: string[]; visibility: 'public' | 'followers'; is_pinned: boolean; is_closed: boolean; helpful_count: number; unhelpful_count: number; views_count: number; created_at: string; updated_at: string; author?: Author | null; current_user_vote?: string | null };
type TopicPayload = { data?: { topic: Topic; comments: Comment[]; currentUserId?: string | null }; error?: string };
const dateLabel = (value: string) => new Date(value).toLocaleString('tr-TR', { dateStyle: 'medium', timeStyle: 'short' });
const editOpen = (value: string) => Date.now() - Date.parse(value) < 60 * 60 * 1000;
const LEGAL_DISCLAIMER = 'Yasal Uyarı: Burada yer alan yatırım bilgi, yorum ve tavsiyeleri yatırım danışmanlığı kapsamında değildir. Yer alan görüşler kişisel analizlere dayanmaktadır.';
const withoutLegalDisclaimer = (content: string) => content.endsWith(LEGAL_DISCLAIMER)
    ? content.slice(0, -LEGAL_DISCLAIMER.length).replace(/\n\n$/, '')
    : content;
const inputClass = 'w-full rounded-xl border border-slate-700 bg-slate-800/80 px-3.5 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50';

export default function ForumTopicWorkspace({ topicId }: { topicId: string }) {
    const router = useRouter();
    const { confirmDialog } = useAppPreferences();
    const [topic, setTopic] = useState<Topic | null>(null);
    const [comments, setComments] = useState<Comment[]>([]);
    const [currentUserId, setCurrentUserId] = useState<string | null>(null);
    const [commentText, setCommentText] = useState('');
    const [replyTargetId, setReplyTargetId] = useState<string | null>(null);
    const [replyText, setReplyText] = useState('');
    const [replyBusy, setReplyBusy] = useState(false);
    const [attachment, setAttachment] = useState<File | null>(null);
    const [editing, setEditing] = useState(false);
    const [editTitle, setEditTitle] = useState('');
    const [editContent, setEditContent] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const load = useCallback(async () => {
        try {
            const response = await fetch(`/api/forum/topics/${encodeURIComponent(topicId)}`, { cache: 'no-store' });
            const payload = await response.json() as TopicPayload;
            if (!response.ok || !payload.data) throw new Error(payload.error ?? 'Konu yüklenemedi.');
            setTopic(payload.data.topic);
            setComments(payload.data.comments ?? []);
            setCurrentUserId(payload.data.currentUserId ?? null);
            setEditTitle(payload.data.topic.title);
            setEditContent(withoutLegalDisclaimer(payload.data.topic.content));
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'Konu yüklenemedi.');
        }
    }, [topicId]);

    useEffect(() => {
        const timer = window.setTimeout(() => { void load(); }, 0);
        return () => window.clearTimeout(timer);
    }, [load]);

    const sendComment = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!topic || !commentText.trim()) return;
        if (hasProfanity(commentText)) {
            setError('Yorumunuz topluluk kurallarına uygun olmayan ifadeler içeriyor.');
            return;
        }
        setBusy(true);
        setError('');
        try {
            let attachmentUrl: string | null = null;
            if (attachment) {
                const client = getSupabaseBrowserClient();
                const { data: { user }, error: userError } = client ? await client.auth.getUser() : { data: { user: null }, error: new Error('Supabase bağlantısı yapılandırılmamış.') };
                if (userError || !client || !user) throw new Error('Görsel yüklemek için giriş yapın.');
                const path = `${user.id}/comments/${crypto.randomUUID()}.${attachment.name.split('.').pop()?.toLowerCase() || 'jpg'}`;
                const { error: uploadError } = await client.storage.from('community-media').upload(path, attachment, { contentType: attachment.type });
                if (uploadError) throw new Error(`Yorum görseli yüklenemedi: ${uploadError.message}`);
                attachmentUrl = client.storage.from('community-media').getPublicUrl(path).data.publicUrl;
            }
            const response = await fetch(`/api/forum/topics/${encodeURIComponent(topic.id)}/comments`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content: cleanText(commentText.trim()), attachment_url: attachmentUrl }),
            });
            const payload = await response.json() as { error?: string };
            if (!response.ok) throw new Error(payload.error ?? 'Yorum gönderilemedi.');
            setCommentText('');
            setAttachment(null);
            await load();
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'Yorum gönderilemedi.');
        } finally {
            setBusy(false);
        }
    };

    const sendReply = async (event: FormEvent<HTMLFormElement>, parentCommentId: string) => {
        event.preventDefault();
        if (!topic || !replyText.trim()) return;
        if (hasProfanity(replyText)) {
            setError('Yanıtınız topluluk kurallarına uygun olmayan ifadeler içeriyor.');
            return;
        }
        setReplyBusy(true);
        setError('');
        try {
            const response = await fetch(`/api/forum/topics/${encodeURIComponent(topic.id)}/comments`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    content: cleanText(replyText.trim()),
                    parent_comment_id: parentCommentId,
                }),
            });
            const payload = await response.json() as { error?: string };
            if (!response.ok) throw new Error(payload.error ?? 'Yanıt gönderilemedi.');
            setReplyText('');
            setReplyTargetId(null);
            await load();
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'Yanıt gönderilemedi.');
        } finally {
            setReplyBusy(false);
        }
    };

    const vote = async (topicIdValue: string | null, commentId: string | null, choice: 'helpful' | 'unhelpful', current: string | null | undefined) => {
        if (!currentUserId) {
            router.push(`/auth?next=${encodeURIComponent(window.location.pathname)}`);
            return;
        }
        setError('');
        try {
            const response = await fetch('/api/forum/votes', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ...(topicIdValue ? { topic_id: topicIdValue } : {}),
                    ...(commentId ? { comment_id: commentId } : {}),
                    vote: current === choice ? null : choice,
                }),
            });
            const payload = await response.json() as { error?: string };
            if (!response.ok) throw new Error(payload.error ?? 'Oy kaydedilemedi.');
            await load();
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'Oy kaydedilemedi.');
        }
    };

    const updateTopic = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setError('');
        if (hasProfanity(editTitle) || hasProfanity(editContent)) {
            setError('Başlık veya içerik topluluk kurallarına uygun olmayan ifadeler içeriyor.');
            return;
        }
        setBusy(true);
        try {
            const response = await fetch(`/api/forum/topics/${encodeURIComponent(topicId)}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: cleanText(editTitle.trim()), content: cleanText(editContent.trim()) }),
            });
            const payload = await response.json() as { error?: string };
            if (!response.ok) throw new Error(payload.error ?? 'Konu güncellenemedi.');
            setEditing(false);
            await load();
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'Konu güncellenemedi.');
        } finally {
            setBusy(false);
        }
    };

    const deleteTopic = async () => {
        const confirmed = await confirmDialog({ title: 'Konu silinsin mi?', message: 'Bu konu ve yorumları kalıcı olarak silinecek.', confirmLabel: 'Konuyu sil', danger: true });
        if (!confirmed) return;
        const response = await fetch(`/api/forum/topics/${encodeURIComponent(topicId)}`, { method: 'DELETE' });
        const payload = await response.json() as { error?: string };
        if (!response.ok) setError(payload.error ?? 'Konu silinemedi.');
        else router.push('/forum');
    };

    const deleteComment = async (commentId: string) => {
        const confirmed = await confirmDialog({ title: 'Yorum silinsin mi?', message: 'Yorum ve altındaki yanıtlar kalıcı olarak silinecek.', confirmLabel: 'Yorumu sil', danger: true });
        if (!confirmed) return;
        const response = await fetch(`/api/forum/comments/${encodeURIComponent(commentId)}`, { method: 'DELETE' });
        const payload = await response.json() as { error?: string };
        if (!response.ok) setError(payload.error ?? 'Yorum silinemedi.');
        else await load();
    };

    const editComment = async (comment: Comment) => {
        const replacement = window.prompt('Yorumu düzenle', comment.content);
        if (replacement === null || !replacement.trim()) return;
        if (hasProfanity(replacement)) {
            setError('Yorum topluluk kurallarına uygun olmayan ifadeler içeriyor.');
            return;
        }
        const response = await fetch(`/api/forum/comments/${encodeURIComponent(comment.id)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: cleanText(replacement.trim()) }),
        });
        const payload = await response.json() as { error?: string };
        if (!response.ok) setError(payload.error ?? 'Yorum düzenlenemedi.');
        else await load();
    };

    const commentsByParent = new Map<string, Comment[]>();
    for (const comment of comments) {
        const parentKey = comment.parent_comment_id ?? '';
        const siblings = commentsByParent.get(parentKey) ?? [];
        siblings.push(comment);
        commentsByParent.set(parentKey, siblings);
    }
    const renderComments = (parentId: string | null, depth = 0): ReactNode => {
        const children = commentsByParent.get(parentId ?? '') ?? [];
        return children.map((comment) => <div key={comment.id} className={`space-y-2 ${depth ? 'border-l border-slate-800 pl-2 sm:pl-3' : ''}`}>
            <article className="min-w-0 rounded-xl border border-slate-800 bg-slate-950/50 p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                    <Link href={comment.author?.username ? `/profile/${encodeURIComponent(comment.author.username)}` : '#'} className="flex items-center gap-2">
                        <ForumAvatar avatarUrl={comment.author?.avatar_url} gender={comment.author?.gender} username={comment.author?.username} size={32} className="h-8 w-8 rounded-full object-cover" />
                        <span><strong className="block text-xs text-slate-200">{comment.author?.username ?? 'Trader'}</strong><span className="flex items-center gap-1 text-[10px] text-slate-500">{comment.author?.rank_title ?? 'Trader'} <Clock3 size={10} /> {dateLabel(comment.created_at)}</span></span>
                    </Link>
                    {currentUserId === comment.user_id && <span className="flex gap-2">{editOpen(comment.created_at) && <button onClick={() => void editComment(comment)} className="text-[10px] font-semibold text-slate-400 hover:text-emerald-300">Düzenle</button>}<button onClick={() => void deleteComment(comment.id)} className="text-[10px] font-semibold text-rose-300">Sil</button></span>}
                </div>
                <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-slate-300">{comment.content}</p>
                {comment.attachment_url && <a href={comment.attachment_url} target="_blank" rel="noreferrer"><Image src={comment.attachment_url} alt="Yorum eki" width={900} height={650} unoptimized className="mt-2 max-h-80 max-w-full rounded-xl border border-slate-800 object-contain" /></a>}
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <button type="button" aria-label={`Faydalı, ${comment.helpful_count} oy`} title="Faydalı" onClick={() => void vote(null, comment.id, 'helpful', comment.current_user_vote)} className={`inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[10px] transition ${comment.current_user_vote === 'helpful' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-slate-800 text-slate-400 hover:text-slate-200'}`}><ThumbsUp size={11} />{comment.helpful_count}</button>
                    <button type="button" aria-label={`Faydasız, ${comment.unhelpful_count} oy`} title="Faydasız" onClick={() => void vote(null, comment.id, 'unhelpful', comment.current_user_vote)} className={`inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[10px] transition ${comment.current_user_vote === 'unhelpful' ? 'border-rose-500/30 bg-rose-500/10 text-rose-300' : 'border-slate-800 text-slate-400 hover:text-slate-200'}`}><ThumbsDown size={11} />{comment.unhelpful_count}</button>
                    {topic && !topic.is_closed && currentUserId && <button type="button" aria-label="Yanıtla" title="Yanıtla" onClick={() => { setReplyTargetId((current) => current === comment.id ? null : comment.id); setReplyText(''); }} className="inline-flex h-7 items-center gap-1 rounded-md border border-slate-800 px-2 text-[10px] font-semibold text-slate-400 transition hover:border-emerald-500/30 hover:text-emerald-300"><CornerDownRight size={11} />Yanıtla</button>}
                    {currentUserId && currentUserId !== comment.user_id && <ForumReportControl targetType="comment" targetId={comment.id} compact />}
                </div>
                {replyTargetId === comment.id && <form onSubmit={(event) => void sendReply(event, comment.id)} className="mt-2 space-y-2 rounded-lg border border-slate-800 bg-slate-900/70 p-2.5">
                    <MentionTextarea required maxLength={6000} rows={2} value={replyText} onChange={setReplyText} placeholder={`${comment.author?.username ?? 'Kullanıcı'} kullanıcısına yanıt yaz...`} className={`${inputClass} resize-y`} autoFocus />
                    <div className="flex justify-end gap-2"><button type="button" onClick={() => setReplyTargetId(null)} className="rounded-lg border border-slate-700 px-3 py-2 text-[10px] font-semibold text-slate-300">Vazgeç</button><button disabled={replyBusy} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-[10px] font-bold text-white disabled:opacity-50"><Send size={12} />{replyBusy ? 'Gönderiliyor…' : 'Yanıtı gönder'}</button></div>
                </form>}
            </article>
            {renderComments(comment.id, depth + 1)}
        </div>);
    };

    if (!topic) return <main className="min-h-screen bg-slate-950 px-4 py-10 text-slate-300"><div className="mx-auto max-w-4xl rounded-2xl border border-slate-800 bg-slate-900 p-6">{error || 'Konu yükleniyor…'}</div></main>;
    const isAuthor = topic.user_id === currentUserId;
    const canEdit = isAuthor && editOpen(topic.created_at);
    return <main className="min-h-screen bg-slate-950 px-4 py-8 text-slate-100 md:px-8">
        <div className="mx-auto max-w-4xl space-y-5">
            <Link href="/forum" className="inline-flex items-center gap-2 text-xs font-semibold text-slate-400 hover:text-emerald-300"><ArrowLeft size={14} />Topluluğa dön</Link>
            {error && <p role="alert" className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-xs text-rose-300">{error}</p>}
            <article className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 shadow-xl">
                <div className="relative h-56 w-full overflow-hidden bg-slate-800 sm:h-72 md:h-80">
                    <Image src={topic.cover_image_url || defaultTopicCoverImage} alt="" fill unoptimized className="object-cover" sizes="(max-width: 768px) 100vw, 896px" priority />
                </div>
                <div className="space-y-5 p-5 md:p-7">
                    <div className="flex flex-wrap items-center gap-2">
                        {topic.is_pinned && <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-300"><Pin size={12} />Sabit</span>}
                        <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-300">{topic.category.replaceAll('_', ' ')}</span>
                        {topic.related_symbol && <Link href={`/forum?symbol=${topic.related_symbol}`} className="rounded-full border border-slate-700 bg-slate-800 px-3 py-1 text-xs font-semibold text-slate-200">{topic.related_symbol}</Link>}
                        {topic.is_closed && <span className="rounded-full border border-rose-500/20 bg-rose-500/10 px-3 py-1 text-xs font-semibold text-rose-300">Konu kilitli</span>}
                        <span className="inline-flex items-center gap-1 rounded-full border border-slate-700 bg-slate-800 px-3 py-1 text-xs font-semibold text-slate-300">{topic.visibility === 'followers' ? <Users size={12} /> : <LockKeyhole size={12} />}{topic.visibility === 'followers' ? 'Takipçilere açık' : 'Herkese açık'}</span>
                        {topic.tags?.map((tag) => <span key={tag} className="rounded-full border border-slate-700 bg-slate-800 px-3 py-1 text-xs font-semibold text-slate-300">#{tag}</span>)}
                    </div>
                    {editing ? <form onSubmit={(event) => void updateTopic(event)} className="space-y-3"><input required minLength={3} maxLength={180} value={editTitle} onChange={(event) => setEditTitle(event.target.value)} className={inputClass} /><MentionTextarea required maxLength={13800} rows={8} value={editContent} onChange={setEditContent} className={inputClass} /><p className="text-[10px] text-slate-500">Yasal uyarı kaydedilirken içeriğin sonuna otomatik eklenir. @ ile kullanıcı etiketle.</p><div className="flex gap-2"><button disabled={busy} className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white">Değişiklikleri kaydet</button><button type="button" onClick={() => setEditing(false)} className="rounded-lg border border-slate-700 px-4 py-2 text-xs font-bold text-slate-300">İptal</button></div></form> : <><h1 className="text-2xl font-extrabold text-white md:text-3xl">{topic.title}</h1><p className="whitespace-pre-wrap text-sm leading-7 text-slate-300">{topic.content}</p></>}
                    {!!topic.images?.length && <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{topic.images.map((imageUrl, index) => <a key={imageUrl} href={imageUrl} target="_blank" rel="noreferrer"><Image src={imageUrl} alt={`Gönderi görseli ${index + 1}`} width={900} height={650} unoptimized className="max-h-96 w-full rounded-xl border border-slate-800 object-contain" /></a>)}</div>}
                    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 pt-4">
                        <Link href={topic.author?.username ? `/profile/${encodeURIComponent(topic.author.username)}` : '#'} className="flex items-center gap-3">
                            <ForumAvatar avatarUrl={topic.author?.avatar_url} gender={topic.author?.gender} username={topic.author?.username} size={40} className="h-10 w-10 rounded-full border border-slate-700 object-cover" />
                            <span><strong className="block text-sm text-white">{topic.author?.username ?? 'Trader'}</strong><span className="text-xs text-slate-500">{topic.author?.rank_title ?? 'Trader'}{topic.author?.xp_points !== null && topic.author?.xp_points !== undefined ? ` · ${Number(topic.author.xp_points).toLocaleString('tr-TR')} XP` : ''}</span></span>
                        </Link>
                        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500"><span>{dateLabel(topic.created_at)}</span><span title="Giriş yapmış kullanıcı başına günde bir görüntüleme" className="inline-flex items-center gap-1"><Eye size={13} />{topic.views_count}</span><span className="inline-flex items-center gap-1"><MessageCircle size={13} />{comments.length}</span>{canEdit && <button onClick={() => setEditing(true)} className="rounded-lg border border-slate-700 px-3 py-2 font-semibold text-slate-200 hover:bg-slate-800">Düzenle</button>}{isAuthor && <button onClick={() => void deleteTopic()} className="inline-flex items-center gap-1 rounded-lg border border-rose-500/20 px-3 py-2 font-semibold text-rose-300 hover:bg-rose-500/10"><Trash2 size={13} />Sil</button>}</div>
                    </div>
                    <div className="flex gap-1.5">
                        <button type="button" aria-label={`Faydalı, ${topic.helpful_count} oy`} title="Faydalı" onClick={() => void vote(topic.id, null, 'helpful', topic.current_user_vote)} className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-semibold transition ${topic.current_user_vote === 'helpful' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-slate-700 bg-slate-800 text-slate-300 hover:text-white'}`}><ThumbsUp size={13} />{topic.helpful_count}</button>
                        <button type="button" aria-label={`Faydasız, ${topic.unhelpful_count} oy`} title="Faydasız" onClick={() => void vote(topic.id, null, 'unhelpful', topic.current_user_vote)} className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-semibold transition ${topic.current_user_vote === 'unhelpful' ? 'border-rose-500/30 bg-rose-500/10 text-rose-300' : 'border-slate-700 bg-slate-800 text-slate-300 hover:text-white'}`}><ThumbsDown size={13} />{topic.unhelpful_count}</button>
                        {currentUserId && currentUserId !== topic.user_id && <ForumReportControl targetType="topic" targetId={topic.id} compact />}
                    </div>
                </div>
            </article>

            <section className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-xl md:p-6">
                <div className="flex items-center justify-between gap-3 border-b border-slate-800 pb-3"><h2 className="flex items-center gap-2 text-lg font-bold text-white"><MessageCircle className="h-5 w-5 text-emerald-400" />Yorumlar</h2><span className="rounded-full bg-slate-800 px-3 py-1 text-xs text-slate-300">{comments.length}</span></div>
                {!topic.is_closed ? currentUserId ? <form onSubmit={(event) => void sendComment(event)} className="space-y-3 rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                    <MentionTextarea required maxLength={6000} rows={3} value={commentText} onChange={setCommentText} placeholder="Saygılı ve yapıcı bir yorum yaz..." className={`${inputClass} resize-y`} />
                    <div className="flex flex-wrap items-center justify-between gap-2"><label className="inline-flex cursor-pointer items-center gap-2 text-xs font-semibold text-slate-400 hover:text-emerald-300"><ImagePlus size={15} />{attachment?.name ?? 'Görsel ekle'}<input type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="sr-only" onChange={(event) => {
                        const file = event.target.files?.[0] ?? null;
                        if (file && (file.size > 5 * 1024 * 1024 || !['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type))) {
                            setError('Yalnızca JPG, PNG, WebP veya GIF biçiminde, en fazla 5 MB görsel yükleyebilirsiniz.');
                            setAttachment(null);
                        } else setAttachment(file);
                    }} /></label><button disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-50"><Send size={14} />{busy ? 'Gönderiliyor…' : 'Yorumu gönder'}</button></div>
                </form> : <Link href={`/auth?next=${encodeURIComponent(`/forum/${topicId}`)}`} className="block rounded-xl border border-amber-500/20 bg-amber-500/10 p-4 text-xs font-semibold text-amber-200">Yorum yazmak ve oy vermek için giriş yapın.</Link> : <p className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-xs text-rose-300">Bu konu yorumlara kapatıldı.</p>}
                {comments.length === 0 && <p className="py-4 text-center text-xs text-slate-500">Henüz yorum yok.</p>}
                <div className="space-y-3">{renderComments(null)}</div>
            </section>
        </div>
    </main>;
}
