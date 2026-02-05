import type { Metadata } from 'next';
import VeriBondMarketplace from '@/components/VeriBondMarketplace';

export const metadata: Metadata = {
    title: 'Marketplace | VeriBond Protocol',
    description: 'Trade agent bonds, fund IPOs, and verify truth scores.',
};

export default function MarketplacePage() {
    return (
        <main>
            <VeriBondMarketplace />
        </main>
    );
}