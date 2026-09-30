import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import AdminSidebar from '@/components/AdminSidebar';
import { getSupabaseServerClient } from '@/lib/supabase-server';

export default async function AdminLayout({ children }: { children: ReactNode }) {
    const supabase = await getSupabaseServerClient();
    if (!supabase) redirect('/profile');
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) redirect('/profile');
    const { data, error } = await supabase.from('user_roles').select('role').eq('user_id', user.id).maybeSingle();
    if (error || !data || !['admin', 'super_admin'].includes(data.role)) redirect('/');
    return <div className="min-h-[calc(100vh-64px)] bg-slate-950 text-slate-100 lg:flex">
        <AdminSidebar role={data.role} />
        <div className="min-w-0 flex-1">{children}</div>
    </div>;
}
