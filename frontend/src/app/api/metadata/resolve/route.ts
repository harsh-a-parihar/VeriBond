import { NextResponse } from 'next/server';

type EndpointRow = { type?: string; value?: string };

function decodeDataJsonUri(uri: string): unknown {
    const prefix = 'data:application/json;base64,';
    if (!uri.startsWith(prefix)) return null;
    const base64 = uri.slice(prefix.length);
    const json = Buffer.from(base64, 'base64').toString('utf8');
    return JSON.parse(json);
}

function normalizeIpfsHash(uri: string): string {
    return uri.replace(/^ipfs:\/\//i, '').replace(/^ipfs\//i, '').replace(/^\/+/, '');
}

function toCandidateUrls(uri: string): string[] {
    if (uri.startsWith('data:application/json;base64,')) return [uri];
    if (uri.startsWith('ipfs://')) {
        const hash = normalizeIpfsHash(uri);
        return [
            `https://gateway.pinata.cloud/ipfs/${hash}`,
            `https://ipfs.io/ipfs/${hash}`,
            `https://dweb.link/ipfs/${hash}`,
            `https://cloudflare-ipfs.com/ipfs/${hash}`,
        ];
    }

    try {
        const parsed = new URL(uri);
        if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
            return [parsed.toString()];
        }
    } catch {
        // ignored
    }

    return [];
}

async function fetchJson(url: string): Promise<unknown> {
    if (url.startsWith('data:application/json;base64,')) {
        return decodeDataJsonUri(url);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
        const res = await fetch(url, {
            method: 'GET',
            headers: {
                Accept: 'application/json,text/plain;q=0.9,*/*;q=0.8',
                'User-Agent': 'VeriBond-MetadataResolver/1.0',
            },
            signal: controller.signal,
            cache: 'no-store',
        });
        if (!res.ok) {
            throw new Error(`metadata fetch failed (${res.status})`);
        }
        return await res.json();
    } finally {
        clearTimeout(timeout);
    }
}

function normalizeEndpoints(input: unknown): EndpointRow[] {
    if (!Array.isArray(input)) return [];
    const out: EndpointRow[] = [];

    for (const row of input) {
        if (!row || typeof row !== 'object') continue;
        const candidate = row as Record<string, unknown>;
        const type = typeof candidate.type === 'string' ? candidate.type.trim().toUpperCase() : '';
        const valueRaw = candidate.value ?? candidate.url ?? candidate.endpoint ?? candidate.uri;
        const value = typeof valueRaw === 'string' ? valueRaw.trim() : '';
        if (!value) continue;
        out.push({ type: type || 'A2A', value });
    }

    return out;
}

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const uri = searchParams.get('uri')?.trim() ?? '';
        if (!uri) {
            return NextResponse.json({ error: 'uri is required' }, { status: 400 });
        }

        const candidates = toCandidateUrls(uri);
        if (candidates.length === 0) {
            return NextResponse.json({ error: 'unsupported metadata uri' }, { status: 400 });
        }

        let lastError: string | null = null;
        for (const candidate of candidates) {
            try {
                const metadata = await fetchJson(candidate);
                if (!metadata || typeof metadata !== 'object') {
                    throw new Error('metadata payload is not an object');
                }
                const normalized = metadata as Record<string, unknown>;
                const endpoints = normalizeEndpoints(normalized.endpoints);
                return NextResponse.json({
                    metadata: {
                        ...normalized,
                        endpoints,
                    },
                    source: candidate,
                });
            } catch (error) {
                lastError = error instanceof Error ? error.message : 'metadata fetch failed';
            }
        }

        return NextResponse.json({ error: lastError ?? 'metadata fetch failed' }, { status: 502 });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'failed to resolve metadata';
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
