
import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { createPublicClient, http, parseAbiItem } from 'viem';
import { baseSepolia } from 'viem/chains';
import { CONTRACTS } from '@/lib/contracts';
import { TRUTH_STAKE_ABI, IDENTITY_REGISTRY_ABI, OWNER_BADGE_ABI } from '@/lib/abis';

// --- CONFIG ---
const BATCH_SIZE = 2000; // Reduced to 2,000 to prevent RPC 503 errors
// const DEPLOY_BLOCK = BigInt(18000000); // Legacy: Now using dynamic head

const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(),
});

// --- SCHEMA MIGRATION ---
async function ensureSchema() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Indexer State (Tracks last synced block)
        await client.query(`
      CREATE TABLE IF NOT EXISTS indexer_state (
        id SERIAL PRIMARY KEY,
        key TEXT UNIQUE NOT NULL,
        value TEXT NOT NULL
      );
    `);

        // 2. Agents Table
        await client.query(`
      CREATE TABLE IF NOT EXISTS agents (
        id BIGINT PRIMARY KEY,
        address TEXT NOT NULL,
        name TEXT,
        ticker TEXT,
        image TEXT,
        description TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        trust_score NUMERIC DEFAULT 0,
        total_slashed NUMERIC DEFAULT 0,
        is_active BOOLEAN DEFAULT TRUE,
        status TEXT DEFAULT 'active'
      );
    `);

        // Initialize state if not exists
        const res = await client.query("SELECT value FROM indexer_state WHERE key = 'last_synced_block'");
        if (res.rowCount === 0) {
            const currentBlock = await publicClient.getBlockNumber();
            const startBlock = currentBlock - BigInt(50); // Start very close to head (50 block buffer)
            await client.query("INSERT INTO indexer_state (key, value) VALUES ($1, $2)", ['last_synced_block', startBlock.toString()]);
        }

        await client.query('COMMIT');
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
}

// --- HELPER: Resolve Metadata from ID ---
async function fetchAgentMetadata(agentId: bigint) {
    try {
        // 1. Get URI & Owner from Contract
        const [tokenURI, owner, slashed] = await publicClient.multicall({
            contracts: [
                {
                    address: CONTRACTS.IDENTITY_REGISTRY as `0x${string}`,
                    abi: IDENTITY_REGISTRY_ABI,
                    functionName: 'tokenURI',
                    args: [agentId]
                },
                {
                    address: CONTRACTS.IDENTITY_REGISTRY as `0x${string}`,
                    abi: IDENTITY_REGISTRY_ABI,
                    functionName: 'ownerOf',
                    args: [agentId]
                },
                {
                    address: CONTRACTS.TRUTH_STAKE as `0x${string}`,
                    abi: TRUTH_STAKE_ABI,
                    functionName: 'agentTotalSlashed',
                    args: [agentId]
                }
            ]
        });

        if (tokenURI.status !== 'success' || owner.status !== 'success') return null;

        // 2. Fetch IPFS/HTTP JSON
        let metadata: any = {};
        try {
            let uri = tokenURI.result as string;
            if (uri.startsWith('ipfs://')) {
                uri = uri.replace('ipfs://', 'https://gateway.pinata.cloud/ipfs/');
            }
            const res = await fetch(uri);
            metadata = await res.json();
        } catch (e) {
            console.warn(`Failed to fetch metadata for #${agentId}`, e);
        }

        return {
            agentId,
            owner: owner.result as string,
            slashed: slashed.status === 'success' ? slashed.result : BigInt(0),
            name: metadata.name || `Agent #${agentId}`,
            description: metadata.description || '',
            image: metadata.image ? metadata.image.replace('ipfs://', 'https://gateway.pinata.cloud/ipfs/') : '',
            ticker: (metadata.name || 'UNK').slice(0, 4).toUpperCase(),
            isActive: metadata.active !== false // Default true
        };

    } catch (e) {
        console.error(`Error resolving agent #${agentId}`, e);
        return null;
    }
}

// --- HANDLER ---
export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const reset = searchParams.get('reset');

        await ensureSchema();

        const client = await pool.connect();

        // RESET Logic: If ?reset=true, force start from LATEST
        if (reset === 'true') {
            const currentBlock = await publicClient.getBlockNumber();
            const startBlock = currentBlock - BigInt(500);

            await client.query("UPDATE indexer_state SET value = $1 WHERE key = 'last_synced_block'", [startBlock.toString()]);
            await client.query("TRUNCATE TABLE agents");
            console.log('Indexer Reset to LATEST block:', startBlock);
        }

        // 1. Get Sync Range
        const stateRes = await client.query("SELECT value FROM indexer_state WHERE key = 'last_synced_block'");
        const lastBlock = BigInt(stateRes.rows[0].value);
        const currentBlock = await publicClient.getBlockNumber();

        if (lastBlock >= currentBlock) {
            client.release();
            return NextResponse.json({ status: 'up-to-date', lastBlock: lastBlock.toString() });
        }

        // Limit range to prevent massive queries
        const toBlock = (currentBlock - lastBlock > BigInt(BATCH_SIZE))
            ? lastBlock + BigInt(BATCH_SIZE)
            : currentBlock;

        console.log(`Syncing logs from ${lastBlock} to ${toBlock}...`);

        // 2. Fetch Logs
        const logs = await publicClient.getLogs({
            address: CONTRACTS.IDENTITY_REGISTRY as `0x${string}`,
            event: parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)'),
            args: {
                from: '0x0000000000000000000000000000000000000000', // Mint events only
            },
            fromBlock: lastBlock + BigInt(1),
            toBlock: toBlock,
        });

        console.log(`Found ${logs.length} new agents.`);

        // 3. Process & Insert Agents
        for (const log of logs) {
            const agentId = log.args.tokenId!;
            const data = await fetchAgentMetadata(agentId);

            if (data) {
                await client.query(`
          INSERT INTO agents (id, address, name, ticker, image, description, total_slashed, is_active)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          ON CONFLICT (id) DO UPDATE SET
            name = EXCLUDED.name,
            address = EXCLUDED.address,
            image = EXCLUDED.image,
            description = EXCLUDED.description,
            total_slashed = EXCLUDED.total_slashed,
            updated_at = CURRENT_TIMESTAMP;
        `, [
                    data.agentId.toString(),
                    data.owner,
                    data.name,
                    data.ticker,
                    data.image,
                    data.description,
                    data.slashed.toString(),
                    data.isActive
                ]);
            }
        }

        // 4. Update State
        await client.query("UPDATE indexer_state SET value = $1 WHERE key = 'last_synced_block'", [toBlock.toString()]);

        client.release();

        return NextResponse.json({
            status: 'success',
            processed: logs.length,
            fromBlock: lastBlock.toString(),
            toBlock: toBlock.toString()
        });

    } catch (e: any) {
        console.error('Indexer Sync Error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
