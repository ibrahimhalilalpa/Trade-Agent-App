import type { SupabaseClient } from '@supabase/supabase-js';

export type UserActivityType =
    | 'login'
    | 'logout'
    | 'profile_updated'
    | 'password_changed'
    | 'password_failed'
    | 'password_reset_requested';

export async function logUserActivity(
    supabase: SupabaseClient,
    userId: string,
    eventType: UserActivityType,
    description: string,
    metadata: Record<string, string | number | boolean> = {},
) {
    await supabase.from('user_activity_logs').insert({ user_id: userId, event_type: eventType, description, metadata });
}