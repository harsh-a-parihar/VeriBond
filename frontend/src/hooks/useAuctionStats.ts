'use client';

import { useEffect, useState } from 'react';

interface AuctionStatsState {
    launched: number;
    isLoading: boolean;
    error: string | null;
}

export function useAuctionStats(): AuctionStatsState {
    const [launched, setLaunched] = useState(0);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;

        const run = async () => {
            try {
                setIsLoading(true);
                const res = await fetch('/api/auctions/stats', { cache: 'no-store' });
                if (!res.ok) throw new Error(`Request failed (${res.status})`);
                const data = await res.json();
                if (cancelled) return;
                setLaunched(Number(data?.launched ?? 0));
                setError(null);
            } catch (err) {
                if (cancelled) return;
                setError(err instanceof Error ? err.message : 'Unknown error');
                setLaunched(0);
            } finally {
                if (!cancelled) setIsLoading(false);
            }
        };

        run();
        return () => {
            cancelled = true;
        };
    }, []);

    return { launched, isLoading, error };
}

