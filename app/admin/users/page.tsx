import { redirect } from 'next/navigation';
import AdminWorkspace from '@/components/AdminWorkspace';
import { getSupabaseServerClient } from '@/lib/supabase-server';

export default async function AdminUsersPage() {
    const supabase = await getSupabaseServerClient();
    if (!supabase) redirect('/profile');
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) redirect('/profile');
    const { data } = await supabase.from('user_roles').select('role').eq('user_id', user.id).maybeSingle();
    if (!data || !['admin', 'super_admin'].includes(data.role)) redirect('/');
    return <AdminWorkspace actorRole={data.role} />;
}
