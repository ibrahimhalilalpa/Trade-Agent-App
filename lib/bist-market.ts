export function getBistPriceStep(price: number): number {
    if (price < 20) return 0.01;
    if (price < 50) return 0.02;
    if (price < 100) return 0.05;
    if (price < 250) return 0.1;
    if (price < 500) return 0.25;
    if (price < 1000) return 0.5;
    return 1;
}

export function isValidBistPriceTick(price: number): boolean {
    if (!Number.isFinite(price) || price <= 0) return false;
    const step = getBistPriceStep(price);
    const units = price / step;
    return Math.abs(units - Math.round(units)) < 1e-7;
}

export function describeBistPriceStep(price: number): string {
    return getBistPriceStep(price).toLocaleString('tr-TR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });
}
