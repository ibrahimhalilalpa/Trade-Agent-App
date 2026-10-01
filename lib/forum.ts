import { NextResponse } from 'next/server';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { getSupabaseServerClient } from '@/lib/supabase-server';
import { cleanText } from '@/lib/profanityFilter';

export const FORUM_CATEGORIES = [
    'serbest_konu',
    'hisse_analiz',
    'bist30',
    'bist100',
    'bist500',
    'soru_cevap',
    'strateji_egitim',
    'makro_ekonomi',
] as const;

export type ForumCategory = (typeof FORUM_CATEGORIES)[number];
export type ForumVote = 'helpful' | 'unhelpful';

export interface ForumTopicRecord {
    id: string;
    user_id: string;
    [key: string]: unknown;
}

export interface ForumPublicProfile {
    user_id: string;
    username: string;
    display_name: string | null;
    avatar_url: string | null;
    bio: string | null;
    gender: string | null;
    xp_points: number | null;
    rank_title: string | null;
    is_profile_public: boolean;
    followers_count: number | null;
    following_count: number | null;
    is_following: boolean;
    cover_image_url: string | null;
    profile_field_visibility: Record<string, 'public' | 'followers' | 'private'>;
}

export interface ApiError {
    code: string;
    message: string;
}

export function apiSuccess<T>(data: T, status = 200) {
    return NextResponse.json({ success: true, data }, { status });
}

export function apiError(message: string, status = 400, code = 'BAD_REQUEST') {
    return NextResponse.json({ success: false, data: null, error: message, code }, { status });
}

export function databaseError(error: null, fallback?: string): null;
export function databaseError(error: { message: string; code?: string }, fallback?: string): NextResponse;
export function databaseError(error: { message: string; code?: string } | null, fallback = 'Veritabanı işlemi başarısız oldu.'): NextResponse | null {
    if (!error) return null;
    console.error('Forum database operation failed.', error);
    return apiError(fallback, 500, 'DATABASE_ERROR');
}

export function forumCommentDatabaseError(error: { message: string; code?: string }, fallback: string) {
    console.error('Forum comment database operation failed.', error);
    if (error.code === '42703' || error.code === 'PGRST204') {
        return apiError('Yorum yanıtları için veritabanı güncellemesi bekliyor. Supabase’te forum-engagement-replies-migration.sql dosyasını çalıştırın.', 503, 'FORUM_REPLIES_MIGRATION_REQUIRED');
    }
    if (error.code === '23503') {
        return apiError('Yanıtlanacak yorum artık mevcut değil. Yorum listesini yenileyip tekrar deneyin.', 409, 'PARENT_COMMENT_NOT_FOUND');
    }
    return databaseError(error, fallback);
}

export async function getForumClient() {
    const client = await getSupabaseServerClient();
    return client;
}

export async function getOptionalUser(client: SupabaseClient): Promise<User | null> {
    const { data, error } = await client.auth.getUser();
    return error ? null : data.user;
}

export async function requireForumUser(): Promise<
    | { client: SupabaseClient; user: User; response: null }
    | { client: null; user: null; response: NextResponse }
> {
    const client = await getForumClient();
    if (!client) return { client: null, user: null, response: apiError('Supabase bağlantısı yapılandırılmamış.', 503, 'SERVICE_UNAVAILABLE') };
    const { data, error } = await client.auth.getUser();
    if (error || !data.user) return { client: null, user: null, response: apiError('Bu işlem için giriş yapmalısınız.', 401, 'UNAUTHENTICATED') };
    return { client, user: data.user, response: null };
}

export async function readJson(request: Request): Promise<Record<string, unknown> | null> {
    try {
        const body: unknown = await request.json();
        return body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : null;
    } catch {
        return null;
    }
}

export function isUuid(value: unknown): value is string {
    return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function textField(value: unknown, field: string, min: number, max: number, sanitize = false): string | ApiError {
    if (typeof value !== 'string') return { code: 'INVALID_FIELD', message: `${field} bir metin olmalıdır.` };
    const text = (sanitize ? cleanText(value) : value).trim();
    if (text.length < min || text.length > max) {
        return { code: 'INVALID_LENGTH', message: `${field} ${min}-${max} karakter arasında olmalıdır.` };
    }
    return text;
}

export function optionalTextField(
    value: unknown,
    field: string,
    max: number,
    sanitize = false,
): string | null | ApiError {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value !== 'string') return { code: 'INVALID_FIELD', message: `${field} bir metin olmalıdır.` };
    const text = (sanitize ? cleanText(value) : value).trim();
    if (text.length > max) return { code: 'INVALID_LENGTH', message: `${field} en fazla ${max} karakter olabilir.` };
    return text || null;
}

export function isApiError(value: unknown): value is ApiError {
    return Boolean(value && typeof value === 'object' && 'code' in value && 'message' in value);
}

export function apiValidationError(error: ApiError) {
    return apiError(error.message, 400, error.code);
}

export function isCategory(value: unknown): value is ForumCategory {
    return typeof value === 'string' && FORUM_CATEGORIES.includes(value as ForumCategory);
}

export function normalizeSymbol(value: unknown): string | null | ApiError {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value !== 'string') return { code: 'INVALID_SYMBOL', message: 'Hisse sembolü geçersiz.' };
    const symbol = value.trim().toUpperCase();
    if (!/^[A-Z0-9]{3,6}$/.test(symbol)) return { code: 'INVALID_SYMBOL', message: 'Hisse sembolü 3-6 harf veya rakam olmalıdır.' };
    return symbol;
}

export function safeHttpsUrl(value: unknown, field: string): string | null | ApiError {
    const url = optionalTextField(value, field, 2048);
    if (isApiError(url) || url === null) return url;
    try {
        const parsed = new URL(url);
        if (parsed.protocol !== 'https:' || !parsed.hostname) throw new Error('invalid');
        return parsed.toString();
    } catch {
        return { code: 'INVALID_URL', message: `${field} geçerli bir HTTPS adresi olmalıdır.` };
    }
}

export function parseLimit(value: string | null, defaultValue = 20, max = 50) {
    if (!value) return defaultValue;
    const limit = Number(value);
    return Number.isInteger(limit) && limit > 0 ? Math.min(limit, max) : defaultValue;
}

export function parseOffset(value: string | null) {
    if (!value) return 0;
    const offset = Number(value);
    return Number.isInteger(offset) && offset >= 0 ? Math.min(offset, 10000) : 0;
}

export async function publicProfiles(client: SupabaseClient, userIds: string[]) {
    if (!userIds.length) return { data: [], error: null };
    return client.rpc('forum_public_profiles', { p_user_ids: [...new Set(userIds)] });
}

export async function topicVotesById(client: SupabaseClient, topicIds: string[], userId: string | null) {
    if (!userId || !topicIds.length) return { votes: new Map<string, ForumVote>(), error: null };
    const { data, error } = await client.from('topic_votes')
        .select('topic_id, vote').eq('user_id', userId).in('topic_id', [...new Set(topicIds)]);
    return {
        votes: new Map((data ?? []).flatMap((row) =>
            row.topic_id && (row.vote === 'helpful' || row.vote === 'unhelpful')
                ? [[row.topic_id, row.vote] as [string, ForumVote]]
                : [],
        )),
        error,
    };
}

export async function attachTopicDetails(client: SupabaseClient, topics: ForumTopicRecord[], viewerId: string | null) {
    const [profiles, votes] = await Promise.all([
        publicProfiles(client, topics.map((topic) => topic.user_id)),
        topicVotesById(client, topics.map((topic) => topic.id), viewerId),
    ]);
    const profileRows = (profiles.data ?? []) as ForumPublicProfile[];
    return {
        error: profiles.error ?? votes.error,
        topics: topics.map((topic) => ({
            ...topic,
            author: profileRows.find((profile) => profile.user_id === topic.user_id) ?? null,
            current_user_vote: votes.votes.get(topic.id) ?? null,
        })),
    };
}

export async function publicHelpfulTopicIds(client: SupabaseClient, userId: string) {
    const { data, error } = await client.rpc('forum_public_helpful_topics', { p_user_id: userId });
    if (error) return { ids: [] as string[], error };
    const rows: unknown[] = Array.isArray(data) ? data : [];
    const ids = rows.flatMap((row): string[] => {
        const id = typeof row === 'string'
            ? row
            : row && typeof row === 'object'
                ? (row as Record<string, unknown>).topic_id ?? (row as Record<string, unknown>).id
                : null;
        return isUuid(id) ? [id] : [];
    });
    return { ids: [...new Set(ids)].slice(0, 20), error: null };
}
