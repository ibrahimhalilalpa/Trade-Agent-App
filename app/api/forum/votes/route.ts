import {
    apiError, apiSuccess, isUuid, readJson, requireForumUser,
} from '@/lib/forum';

function voteDatabaseError(error: { code?: string; message: string; details?: string; hint?: string }, fallback: string) {
    console.error('Forum vote RPC failed.', error);
    if (error.code === 'PGRST202' || error.code === '42883') {
        return apiError('Oy sistemi veritabanı güncellemesi bekliyor. Supabase’te forum-vote-fix-migration.sql dosyasını çalıştırın.', 503, 'FORUM_VOTE_MIGRATION_REQUIRED');
    }
    if (error.code === '42501') {
        return apiError('Oy sistemi için veritabanı izinleri eksik. Supabase’te forum-vote-fix-migration.sql dosyasını yeniden çalıştırın.', 503, 'FORUM_VOTE_PERMISSION_ERROR');
    }
    if (error.code === '42703') {
        const missingColumn = error.message.match(/column ["']?([a-zA-Z0-9_.]+)["']? does not exist/i)?.[1]
            ?? error.message.match(/field ["']?([a-zA-Z0-9_]+)["']?/i)?.[1];
        const diagnostic = missingColumn ?? error.message.replace(/\s+/g, ' ').slice(0, 180);
        const detail = [error.message, error.details, error.hint]
            .filter(Boolean)
            .join(' ')
            .replace(/\s+/g, ' ')
            .slice(0, 500);
        return apiError(
            `Oy işlemi veritabanı alan hatası (${diagnostic}). Supabase SQL Editor’da forum-engagement-replies-migration.sql sonrasında forum-vote-fix-migration.sql dosyasını çalıştırıp oy denetim fonksiyonunu güncelleyin. Ayrıntı: ${detail}`,
            503,
            'FORUM_VOTE_SCHEMA_REQUIRED',
        );
    }
    return apiError(`${fallback} (veritabanı kodu: ${error.code ?? 'bilinmiyor'}).`, 500, 'FORUM_VOTE_FAILED');
}

function voteTarget(body: Record<string, unknown>) {
    const hasTopic = body.topic_id !== undefined && body.topic_id !== null;
    const hasComment = body.comment_id !== undefined && body.comment_id !== null;
    if (hasTopic === hasComment) return null;
    const targetId = hasTopic ? body.topic_id : body.comment_id;
    if (!isUuid(targetId)) return null;
    return { column: hasTopic ? 'topic_id' : 'comment_id', id: targetId };
}

export async function POST(request: Request) {
    const auth = await requireForumUser();
    if (auth.response) return auth.response;
    const body = await readJson(request);
    if (!body) return apiError('Geçersiz JSON isteği.');
    const target = voteTarget(body);
    if (!target) return apiError('Bir geçerli konu veya yorum kimliği belirtilmelidir.', 400, 'INVALID_TARGET');
    if (body.vote !== null && body.vote !== 'helpful' && body.vote !== 'unhelpful') {
        return apiError('Oy helpful, unhelpful veya null olmalıdır.', 400, 'INVALID_VOTE');
    }
    const { data, error } = await auth.client.rpc('set_forum_vote', {
        p_topic_id: target.column === 'topic_id' ? target.id : null,
        p_comment_id: target.column === 'comment_id' ? target.id : null,
        p_vote: body.vote,
    });
    if (error) return voteDatabaseError(error, body.vote === null ? 'Oy kaldırılamadı.' : 'Oy kaydedilemedi.');
    return apiSuccess(data);
}

export async function DELETE(request: Request) {
    const auth = await requireForumUser();
    if (auth.response) return auth.response;
    const body = await readJson(request);
    if (!body) return apiError('Geçersiz JSON isteği.');
    const target = voteTarget(body);
    if (!target) return apiError('Bir geçerli konu veya yorum kimliği belirtilmelidir.', 400, 'INVALID_TARGET');
    const { data, error } = await auth.client.rpc('set_forum_vote', {
        p_topic_id: target.column === 'topic_id' ? target.id : null,
        p_comment_id: target.column === 'comment_id' ? target.id : null,
        p_vote: null,
    });
    if (error) return voteDatabaseError(error, 'Oy kaldırılamadı.');
    return apiSuccess(data);
}
