const DEFAULT_APP_URL = 'http://localhost:3000';

function validatedOrigin(value: string): string {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol)
        || parsed.username
        || parsed.password
        || parsed.hostname === '0.0.0.0'
        || parsed.hostname === '::'
        || parsed.hostname === '*') {
        throw new Error('NEXT_PUBLIC_APP_URL must be a reachable http(s) application origin, not a bind address.');
    }
    return parsed.origin;
}

export function getAppOrigin(request?: Request): string {
    const configured = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL;
    if (configured) return validatedOrigin(configured);

    if (typeof window !== 'undefined') {
        if (window.location.hostname !== '0.0.0.0' && window.location.hostname !== '::') {
            return window.location.origin;
        }
        return DEFAULT_APP_URL;
    }

    if (request) {
        const requestUrl = new URL(request.url);
        if (requestUrl.hostname !== '0.0.0.0' && requestUrl.hostname !== '::') {
            return requestUrl.origin;
        }
    }

    return DEFAULT_APP_URL;
}

export function getAuthRedirectUrl(path: string, request?: Request): string {
    if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\')) {
        throw new Error('Authentication redirect path must be an application-relative path.');
    }
    return new URL(path, getAppOrigin(request)).toString();
}

export function safeInternalPath(path: string | null, fallback = '/lists', origin?: string): string {
    if (!path || !path.startsWith('/') || path.startsWith('//') || path.includes('\\')) return fallback;
    try {
        const base = origin ?? (typeof window !== 'undefined' ? window.location.origin : DEFAULT_APP_URL);
        const target = new URL(path, base);
        return target.origin === new URL(base).origin
            ? `${target.pathname}${target.search}${target.hash}`
            : fallback;
    } catch {
        return fallback;
    }
}
