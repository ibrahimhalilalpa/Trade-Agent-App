import PublicTraderProfile from '@/components/PublicTraderProfile';

const PERIODS = ['day', 'week', 'month', 'all'] as const;
type Period = (typeof PERIODS)[number];

export default async function PublicTraderPage({
    params,
    searchParams,
}: {
    params: Promise<{ userId: string }>;
    searchParams: Promise<{ period?: string }>;
}) {
    const [{ userId }, { period }] = await Promise.all([params, searchParams]);
    const selectedPeriod = PERIODS.includes(period as Period) ? period as Period : 'all';
    return <PublicTraderProfile userId={userId} period={selectedPeriod} />;
}
