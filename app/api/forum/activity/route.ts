import {
    apiSuccess, attachTopicDetails, databaseError, ForumTopicRecord, publicProfiles, requireForumUser,
} from '@/lib/forum';

export async function GET() {
    const auth = await requireForumUser();
    if (auth.response) return auth.response;
    const userId = auth.user.id;
    const [votesResult, followerRows, followingRows, commentRows] = await Promise.all([
        auth.client.from('topic_votes').select('topic_id, comment_id, vote, created_at').eq('user_id', userId),
        auth.client.from('user_follows').select('follower_id, created_at').eq('followed_id', userId).order('created_at', { ascending: false }).limit(500),
        auth.client.from('user_follows').select('followed_id, created_at').eq('follower_id', userId).order('created_at', { ascending: false }).limit(500),
        auth.client.from('forum_comments').select('id, topic_id, content, created_at, helpful_count, unhelpful_count').eq('user_id', userId).order('created_at', { ascending: false }).limit(1000),
    ]);
    const firstError = votesResult.error ?? followerRows.error ?? followingRows.error ?? commentRows.error;
    if (firstError) return databaseError(firstError, 'Topluluk etkinlikleriniz yüklenemedi.');

    const votes = votesResult.data ?? [];
    const topicVoteRows = votes.filter((vote) => vote.topic_id);
    const commentVoteRows = votes.filter((vote) => vote.comment_id);
    const topicIds = [...new Set(topicVoteRows.map((vote) => vote.topic_id as string))];
    const commentIds = [...new Set(commentVoteRows.map((vote) => vote.comment_id as string))];
    const [votedTopicsResult, votedCommentsResult] = await Promise.all([
        topicIds.length
            ? auth.client.from('forum_topics')
                .select('id, user_id, title, content, category, related_symbol, cover_image_url, images, tags, visibility, is_pinned, is_closed, helpful_count, unhelpful_count, views_count, created_at, updated_at')
                .in('id', topicIds)
            : { data: [], error: null },
        commentIds.length
            ? auth.client.from('forum_comments')
                .select('id, topic_id, content, created_at, helpful_count, unhelpful_count')
                .in('id', commentIds)
            : { data: [], error: null },
    ]);
    if (votedTopicsResult.error) return databaseError(votedTopicsResult.error, 'Oy verdiğiniz konular yüklenemedi.');
    if (votedCommentsResult.error) return databaseError(votedCommentsResult.error, 'Oy verdiğiniz yorumlar yüklenemedi.');
    const attachedTopics = await attachTopicDetails(auth.client, (votedTopicsResult.data ?? []) as ForumTopicRecord[], userId);
    if (attachedTopics.error) return databaseError(attachedTopics.error, 'Oy verdiğiniz konu yazarları yüklenemedi.');
    const profileIds = [
        ...(followerRows.data ?? []).map((row) => row.follower_id),
        ...(followingRows.data ?? []).map((row) => row.followed_id),
    ];
    const profilesResult = await publicProfiles(auth.client, profileIds);
    if (profilesResult.error) return databaseError(profilesResult.error, 'Takipçi profilleri yüklenemedi.');
    const profileById = new Map((profilesResult.data ?? []).map((profile: { user_id: string }) => [profile.user_id, profile]));
    const topicById = new Map(attachedTopics.topics.map((topic) => [topic.id, topic]));
    const commentById = new Map((votedCommentsResult.data ?? []).map((comment) => [comment.id, comment]));

    return apiSuccess({
        votes: votes.map((vote) => ({
            ...vote,
            topic: vote.topic_id ? topicById.get(vote.topic_id) ?? null : null,
            comment: vote.comment_id ? commentById.get(vote.comment_id) ?? null : null,
        })),
        comments: commentRows.data ?? [],
        followers: (followerRows.data ?? []).flatMap((row) => {
            const profile = profileById.get(row.follower_id);
            return profile ? [{ ...profile, created_at: row.created_at }] : [];
        }),
        following: (followingRows.data ?? []).flatMap((row) => {
            const profile = profileById.get(row.followed_id);
            return profile ? [{ ...profile, created_at: row.created_at }] : [];
        }),
    });
}
