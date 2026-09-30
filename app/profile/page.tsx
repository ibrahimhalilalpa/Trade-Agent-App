import ProfileWorkspace from '@/components/ProfileWorkspace';

export default async function ProfilePage({
    searchParams,
}: {
    searchParams: Promise<{ recovery?: string }>;
}) {
    const { recovery } = await searchParams;
    return <ProfileWorkspace recoveryMode={recovery === '1'} />;
}
