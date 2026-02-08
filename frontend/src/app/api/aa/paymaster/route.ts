import { NextRequest, NextResponse } from 'next/server';
import { getPimlicoRpcUrl, isAAEnabled } from '@/lib/aa/config';

const REQUEST_TIMEOUT_MS = 12_000;
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT_PER_IP = 180;

const requestHistory = new Map<string, number[]>();

function getClientIp(request: NextRequest): string {
    const forwarded = request.headers.get('x-forwarded-for');
    if (forwarded) return forwarded.split(',')[0]?.trim() || 'unknown';
    return request.headers.get('x-real-ip')?.trim() || 'unknown';
}

function isRateLimited(ip: string): boolean {
    const now = Date.now();
    const cutoff = now - RATE_WINDOW_MS;

    const entries = requestHistory.get(ip) ?? [];
    const fresh = entries.filter((timestamp) => timestamp >= cutoff);

    if (fresh.length >= RATE_LIMIT_PER_IP) {
        requestHistory.set(ip, fresh);
        return true;
    }

    fresh.push(now);
    requestHistory.set(ip, fresh);
    return false;
}

export function GET() {
    return NextResponse.json({ error: 'Method not allowed' }, { status: 405 });
}

export async function POST(request: NextRequest) {
    if (!isAAEnabled()) {
        return NextResponse.json({ error: 'AA paymaster proxy disabled by configuration' }, { status: 503 });
    }

    const pimlicoUrl = getPimlicoRpcUrl();
    if (!pimlicoUrl) {
        return NextResponse.json({ error: 'PIMLICO_RPC_URL is not configured on server' }, { status: 500 });
    }

    const clientIp = getClientIp(request);
    if (isRateLimited(clientIp)) {
        return NextResponse.json({ error: 'Rate limit exceeded. Please retry shortly.' }, { status: 429 });
    }

    let payload: string;
    try {
        payload = await request.text();
    } catch {
        return NextResponse.json({ error: 'Failed to read request body' }, { status: 400 });
    }

    if (!payload || !payload.trim()) {
        return NextResponse.json({ error: 'JSON-RPC body is required' }, { status: 400 });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
        const upstream = await fetch(pimlicoUrl, {
            method: 'POST',
            headers: {
                'content-type': request.headers.get('content-type') || 'application/json',
            },
            body: payload,
            signal: controller.signal,
        });

        const text = await upstream.text();
        return new NextResponse(text, {
            status: upstream.status,
            headers: {
                'content-type': upstream.headers.get('content-type') || 'application/json',
            },
        });
    } catch (error) {
        const isAbort = error instanceof DOMException && error.name === 'AbortError';
        const message = isAbort
            ? `Paymaster upstream timeout after ${Math.floor(REQUEST_TIMEOUT_MS / 1000)}s`
            : (error instanceof Error ? error.message : 'Failed to reach Pimlico upstream');

        return NextResponse.json({ error: message }, { status: 504 });
    } finally {
        clearTimeout(timeout);
    }
}
