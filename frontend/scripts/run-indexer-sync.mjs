const baseUrl = (process.env.APP_BASE_URL || '').trim().replace(/\/+$/, '');

if (!baseUrl) {
    console.error('APP_BASE_URL is required');
    process.exit(1);
}

const target = `${baseUrl}/api/indexer/sync`;

try {
    const response = await fetch(target, {
        method: 'GET',
        headers: { Accept: 'application/json' },
    });

    const body = await response.text();
    if (!response.ok) {
        console.error(`[IndexerCron] sync failed (${response.status}) ${body}`);
        process.exit(1);
    }

    console.log(`[IndexerCron] sync ok ${body}`);
} catch (error) {
    console.error('[IndexerCron] request error', error);
    process.exit(1);
}
