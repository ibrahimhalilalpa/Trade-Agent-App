import ForumTopicWorkspace from '@/components/ForumTopicWorkspace';

export default async function ForumTopicPage({ params }: { params: Promise<{ topicId: string }> }) {
    const { topicId } = await params;
    return <ForumTopicWorkspace topicId={topicId} />;
}
