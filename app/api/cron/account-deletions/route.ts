import { NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase-admin';

export async function GET(request: Request) {
    const secret = process.env.CRON_SECRET;
    if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
        return NextResponse.json({ error: 'Yetkisiz.' }, { status: 401 });
    }
    const admin = getSupabaseAdminClient();
    if (!admin) return NextResponse.json({ error: 'Supabase admin bağlantısı yapılandırılmamış.' }, { status: 503 });

    const now = new Date().toISOString();
    const { data: dueForReactivation, error: reactivationLookupError } = await admin.from('account_freeze_requests')
        .select('user_id, unfreeze_at, delete_after')
        .lte('unfreeze_at', now)
        .gt('delete_after', now)
        .is('reactivated_at', null)
        .limit(100);
    if (reactivationLookupError) {
        console.error('Accounts due for reactivation could not be loaded.', reactivationLookupError);
        return NextResponse.json({ error: 'Otomatik hesap yeniden etkinleştirme kayıtları yüklenemedi.' }, { status: 500 });
    }

    let reactivated = 0;
    const reactivationFailures: string[] = [];
    for (const item of dueForReactivation ?? []) {
        const { error } = await admin.auth.admin.updateUserById(item.user_id, { ban_duration: 'none' });
        if (error) {
            console.error('Account could not be automatically reactivated.', { userId: item.user_id, error });
            reactivationFailures.push(item.user_id);
        } else {
            const { error: markError } = await admin.from('account_freeze_requests')
                .update({ reactivated_at: now }).eq('user_id', item.user_id).is('reactivated_at', null);
            if (markError) {
                console.error('Automatic account reactivation could not be recorded.', { userId: item.user_id, error: markError });
                reactivationFailures.push(item.user_id);
                continue;
            }
            const { error: activityError } = await admin.from('user_activity_logs').insert({
                user_id: item.user_id,
                event_type: 'account_reactivated',
                description: 'Hesap, dondurma süresi sona erdiği için otomatik olarak yeniden etkinleştirildi.',
                metadata: { unfreeze_at: item.unfreeze_at, delete_after: item.delete_after },
            });
            if (activityError) {
                console.error('Automatic account reactivation activity could not be recorded.', { userId: item.user_id, error: activityError });
                const { error: retryError } = await admin.from('account_freeze_requests')
                    .update({ reactivated_at: null }).eq('user_id', item.user_id).eq('reactivated_at', now);
                if (retryError) console.error('Automatic account reactivation log retry could not be prepared.', { userId: item.user_id, error: retryError });
                reactivationFailures.push(item.user_id);
                continue;
            }
            reactivated += 1;
        }
    }

    const { data: pending, error: lookupError } = await admin.from('account_freeze_requests')
        .select('user_id, requested_at')
        .lte('delete_after', now)
        .order('delete_after', { ascending: true })
        .limit(100);
    if (lookupError) {
        console.error('Expired account freeze requests could not be loaded.', lookupError);
        return NextResponse.json({ error: 'Bekleyen hesap silme istekleri yüklenemedi.' }, { status: 500 });
    }

    let deleted = 0;
    let canceled = 0;
    const failures: string[] = [...reactivationFailures];
    for (const item of pending ?? []) {
        const { data, error: authError } = await admin.auth.admin.getUserById(item.user_id);
        if (authError || !data.user) {
            console.error('Expired account lookup failed.', { userId: item.user_id, error: authError });
            failures.push(item.user_id);
            continue;
        }
        const currentLastSignIn = data.user.last_sign_in_at;
        const signedInSinceRequest = Boolean(currentLastSignIn)
            && new Date(currentLastSignIn!) > new Date(item.requested_at);
        if (signedInSinceRequest) {
            const { error: clearError } = await admin.from('account_freeze_requests').delete().eq('user_id', item.user_id);
            if (clearError) {
                console.error('Returned user freeze request could not be cleared.', { userId: item.user_id, error: clearError });
                failures.push(item.user_id);
                continue;
            }
            canceled += 1;
            continue;
        }
        const { error: deleteError } = await admin.auth.admin.deleteUser(item.user_id);
        if (deleteError) {
            console.error('Expired inactive account could not be deleted.', { userId: item.user_id, error: deleteError });
            failures.push(item.user_id);
            continue;
        }
        deleted += 1;
    }
    if (failures.length) return NextResponse.json({ error: 'Bazı hesap işlemleri tamamlanamadı.', reactivated, deleted, canceled, failures }, { status: 500 });
    return NextResponse.json({ success: true, reactivated, deleted, canceled });
}
