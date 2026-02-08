'use client';

import { useEffect, useState } from 'react';

interface SummaryStatsState {
    agentsRegistered: number;
    ensClaimed: number;
    yellowEarnedMicroUsdc: string;
    yellowSettledMicroUsdc: string;
    isLoading: boolean;
    error: string | null;
}

export function useSummaryStats(): SummaryStatsState {
    const [agentsRegistered, setAgentsRegistered] = useState(0);
    const [ensClaimed, setEnsClaimed] = useState(0);
    const [yellowEarnedMicroUsdc, setYellowEarnedMicroUsdc] = useState('0');
    const [yellowSettledMicroUsdc, setYellowSettledMicroUsdc] = useState('0');
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;

        const run = async () => {
            try {
                setIsLoading(true);
                const res = await fetch('/api/stats/summary', { cache: 'no-store' });
                if (!res.ok) throw new Error(`Request failed (${res.status})`);
                const data = await res.json();
                if (cancelled) return;

                setAgentsRegistered(Number(data?.agentsRegistered ?? 0));
                setEnsClaimed(Number(data?.ensClaimed ?? 0));
                setYellowEarnedMicroUsdc(String(data?.yellowEarnedMicroUsdc ?? '0'));
                setYellowSettledMicroUsdc(String(data?.yellowSettledMicroUsdc ?? '0'));
                setError(null);
            } catch (err) {
                if (cancelled) return;
                setError(err instanceof Error ? err.message : 'Unknown error');
                setAgentsRegistered(0);
                setEnsClaimed(0);
                setYellowEarnedMicroUsdc('0');
                setYellowSettledMicroUsdc('0');
            } finally {
                if (!cancelled) setIsLoading(false);
            }
        };

        run();
        return () => {
            cancelled = true;
        };
    }, []);

    return {
        agentsRegistered,
        ensClaimed,
        yellowEarnedMicroUsdc,
        yellowSettledMicroUsdc,
        isLoading,
        error,
    };
}
