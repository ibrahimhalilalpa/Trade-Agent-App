import { NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabase-server';
import { getSupabaseAdminClient } from '@/lib/supabase-admin';

export const PRIVILEGED_ROLES = ['admin', 'super_admin'] as const;

export function isPrivilegedRole(role: string | null | undefined): role is (typeof PRIVILEGED_ROLES)[number] {
    return role === 'admin' || role === 'super_admin';
}

export async function requireAdmin() {
    const supabase = await getSupabaseServerClient();
    if (!supabase) {
        return { response: NextResponse.json({ error: 'Supabase bağlantısı yapılandırılmamış.' }, { status: 503 }) };
    }
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) {
        return { response: NextResponse.json({ error: 'Bu işlem için giriş yapmalısınız.' }, { status: 401 }) };
    }
    const serviceClient = getSupabaseAdminClient();
    const admin = serviceClient ?? supabase;
    const { data: roleData, error: roleError } = await admin
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id)
        .maybeSingle();
    if (roleError) {
        console.error('Admin role lookup failed.', roleError);
        return { response: NextResponse.json({ error: 'Yönetici yetkisi doğrulanamadı.' }, { status: 500 }) };
    }
    const role = roleData?.role;
    if (!isPrivilegedRole(role)) {
        return { response: NextResponse.json({ error: 'Bu alana erişim yetkiniz yok.' }, { status: 403 }) };
    }
    return { admin, serviceClient, sessionClient: supabase, user, role };
}
