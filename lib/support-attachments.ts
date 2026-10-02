import type { SupabaseClient } from '@supabase/supabase-js';

type AttachmentRow = { attachment_url: string | null };

export async function signSupportAttachments<T extends AttachmentRow>(
    client: SupabaseClient,
    rows: T[],
): Promise<T[]> {
    const paths = [...new Set(rows
        .map((row) => row.attachment_url)
        .filter((value): value is string => Boolean(value && !value.includes('://'))))];
    if (!paths.length) return rows;

    const { data, error } = await client.storage.from('support-attachments').createSignedUrls(paths, 300);
    if (error) throw error;
    const signedByPath = new Map((data ?? []).flatMap((item) => item.path && item.signedUrl
        ? [[item.path, item.signedUrl] as const]
        : []));
    return rows.map((row) => row.attachment_url && signedByPath.has(row.attachment_url)
        ? { ...row, attachment_url: signedByPath.get(row.attachment_url)! }
        : row);
}
