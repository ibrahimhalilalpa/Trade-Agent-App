import { redirect } from 'next/navigation';
import BalanceRequestsPanel from '@/components/BalanceRequestsPanel';
import { getSupabaseServerClient } from '@/lib/supabase-server';

export default async function AdminBalancesPage() {
    const supabase = await getSupabaseServerClient();
    if (!supabase) redirect('/profile');
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) redirect('/profile');
    const { data } = await supabase.from('user_roles').select('role').eq('user_id', user.id).maybeSingle();
    if (data?.role !== 'super_admin') redirect('/admin');
    return <BalanceRequestsPanel />;
}
