import SocialProfileWorkspace from '@/components/SocialProfileWorkspace';

export default async function SocialProfilePage({ params }: { params: Promise<{ username: string }> }) {
    const { username } = await params;
    return <SocialProfileWorkspace username={username} />;
}
