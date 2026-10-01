import Image from 'next/image';
import manAvatar from '@/assets/avatar/man.png';
import womenAvatar from '@/assets/avatar/women.png';
import noneAvatar from '@/assets/avatar/none.jpg';

type ForumAvatarProps = {
    avatarUrl?: string | null;
    gender?: string | null;
    username?: string;
    size: number;
    className?: string;
};

export default function ForumAvatar({ avatarUrl, gender, username = '', size, className = '' }: ForumAvatarProps) {
    const source = avatarUrl || (gender === 'male' ? manAvatar : gender === 'female' ? womenAvatar : noneAvatar);
    return <Image
        src={source}
        alt={`${username ? `${username} profil görseli` : 'Profil görseli'}`}
        width={size}
        height={size}
        unoptimized={typeof source === 'string'}
        className={className}
    />;
}
