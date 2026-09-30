const PRIVATE_PREFERENCE_FIELDS = ['leaderboard_visible', 'leaderboard_gain_visible'] as const;

export function isPrivatePreferenceAudit(metadata: unknown): boolean {
    if (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata)) return false;
    return PRIVATE_PREFERENCE_FIELDS.some((field) => Object.hasOwn(metadata, field));
}
