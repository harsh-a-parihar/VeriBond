const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

function hasCredentials(url: URL): boolean {
    return !!url.username || !!url.password;
}

function isValidPort(url: URL): boolean {
    if (!url.port) return true;
    const parsed = Number(url.port);
    return Number.isInteger(parsed) && parsed > 0 && parsed <= 65535;
}

function isLocalHttpAllowed(url: URL): boolean {
    if (process.env.NODE_ENV === 'production') return false;
    return LOCAL_HOSTS.has(url.hostname.toLowerCase());
}

export function isAllowedChatEndpointUrl(value: string): boolean {
    try {
        const parsed = new URL(value.trim());
        if (hasCredentials(parsed)) return false;
        if (!isValidPort(parsed)) return false;

        if (parsed.protocol === 'https:') return true;
        if (parsed.protocol === 'http:' && isLocalHttpAllowed(parsed)) return true;
        return false;
    } catch {
        return false;
    }
}

/**
 * Check if a string is a valid ENS name for use as a chat endpoint.
 * Examples: myagent.eth, subdomain.myagent.eth
 */
export function isValidENSEndpoint(endpoint: string): boolean {
    if (!endpoint || typeof endpoint !== 'string') return false;
    const trimmed = endpoint.trim().toLowerCase();
    // Must end with .eth and have valid label characters
    return /^[a-z0-9][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)*\.eth$/i.test(trimmed);
}
