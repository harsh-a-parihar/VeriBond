
import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { createPublicClient, http, parseAbiItem } from 'viem';
import { baseSepolia } from 'viem/chains';
import { CONTRACTS, VERIBOND_REGISTRAR } from '@/lib/contracts';
import { TRUTH_STAKE_ABI, IDENTITY_REGISTRY_ABI, AGENT_TOKEN_FACTORY_ABI } from '@/lib/abis';

// --- CONFIG ---
const BATCH_SIZE = 2000;

const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(),
});

// --- SCHEMA MIGRATION ---
async function ensureSchema() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Indexer State
        await client.query(`
      CREATE TABLE IF NOT EXISTS indexer_state (
        id SERIAL PRIMARY KEY,
        key TEXT UNIQUE NOT NULL,
        value TEXT NOT NULL
      );
    `);

        // 2. Agents Table (Expanded)
        await client.query(`
      CREATE TABLE IF NOT EXISTS agents (
        id BIGINT PRIMARY KEY,
        owner TEXT NOT NULL,          -- NFT Owner (EOA)
        wallet TEXT,                  -- Agent Wallet (6551/Smart Account)
        name TEXT,
        ticker TEXT,
        image TEXT,
        description TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        trust_score NUMERIC DEFAULT 0,
        total_claims NUMERIC DEFAULT 0,
        total_revenue NUMERIC DEFAULT 0,
        total_slashed NUMERIC DEFAULT 0,
        is_active BOOLEAN DEFAULT TRUE,
        status TEXT DEFAULT 'active'
      );
    `);

        // Trust Score Columns (Migration)
        await client.query(`
            ALTER TABLE agents 
            ADD COLUMN IF NOT EXISTS correct_claims INTEGER DEFAULT 0,
            ADD COLUMN IF NOT EXISTS slashed_claims INTEGER DEFAULT 0;
        `);

        // ENS Subname Column (Migration)
        await client.query(`
            ALTER TABLE agents 
            ADD COLUMN IF NOT EXISTS claimed_name TEXT;
        `);

        // 3. Claims Table
        await client.query(`
      CREATE TABLE IF NOT EXISTS claims (
        id TEXT PRIMARY KEY,          -- Claim Hash
        agent_id BIGINT REFERENCES agents(id),
        submitter TEXT NOT NULL,
        stake NUMERIC NOT NULL,
        predicted_outcome BOOLEAN,
        resolved BOOLEAN DEFAULT FALSE,
        outcome BOOLEAN,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        resolved_at TIMESTAMP WITH TIME ZONE
      );
    `);

        // 4. Auctions Table
        await client.query(`
      CREATE TABLE IF NOT EXISTS auctions (
        agent_id BIGINT PRIMARY KEY REFERENCES agents(id),
        auction_address TEXT NOT NULL,
        token_address TEXT NOT NULL,
        tokens_for_sale NUMERIC,
        total_cleared NUMERIC DEFAULT 0,
        status TEXT DEFAULT 'active',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

        // Initialize state if not exists
        const res = await client.query("SELECT value FROM indexer_state WHERE key = 'last_synced_block'");
        if (res.rowCount === 0) {
            const currentBlock = await publicClient.getBlockNumber();
            const startBlock = currentBlock - BigInt(50);
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
        const [tokenURI, owner, wallet, slashed] = await publicClient.multicall({
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
                    address: CONTRACTS.IDENTITY_REGISTRY as `0x${string}`,
                    abi: IDENTITY_REGISTRY_ABI,
                    functionName: 'getAgentWallet',
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

        // Fetch IPFS/HTTP JSON
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
            wallet: wallet.status === 'success' ? (wallet.result as string) : null,
            slashed: slashed.status === 'success' ? slashed.result : BigInt(0),
            name: metadata.name || `Agent #${agentId}`,
            description: metadata.description || '',
            image: metadata.image ? metadata.image.replace('ipfs://', 'https://gateway.pinata.cloud/ipfs/') : '',
            ticker: (metadata.name || 'UNK').slice(0, 4).toUpperCase(),
            isActive: metadata.active !== false
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

        const client = await pool.connect();

        // RESET Logic
        if (reset === 'true') {
            const currentBlock = await publicClient.getBlockNumber();
            const startBlock = currentBlock - BigInt(2000); // Look back further for reset

            // Drop tables to valid schema recreation
            await client.query("DROP TABLE IF EXISTS claims, auctions, agents, indexer_state CASCADE");
            console.log('Indexer Tables Dropped for Reset');

            // Re-initialize schema immediately
            await ensureSchema();

            // Set sync start
            await client.query("UPDATE indexer_state SET value = $1 WHERE key = 'last_synced_block'", [startBlock.toString()]);
            console.log('Indexer Reset to LATEST block:', startBlock);
        } else {
            // Normal run: ensure schema matches
            await ensureSchema();
        }

        // 1. Get Sync Range
        const stateRes = await client.query("SELECT value FROM indexer_state WHERE key = 'last_synced_block'");
        const lastBlock = BigInt(stateRes.rows[0].value);
        const currentBlock = await publicClient.getBlockNumber();

        if (lastBlock >= currentBlock) {
            client.release();
            return NextResponse.json({ status: 'up-to-date', lastBlock: lastBlock.toString() });
        }

        // Limit range and ensure buffer (sync up to HEAD-2 to allow node indexing)
        const targetBlock = currentBlock - BigInt(2);

        if (targetBlock <= lastBlock) {
            client.release();
            return NextResponse.json({ status: 'syncing', message: 'Waiting for more confirmations', lastBlock: lastBlock.toString() });
        }

        const toBlock = (targetBlock - lastBlock > BigInt(BATCH_SIZE))
            ? lastBlock + BigInt(BATCH_SIZE)
            : targetBlock;

        console.log(`Syncing logs from ${lastBlock} to ${toBlock}...`);

        // 2. Fetch Logs (Parallel)
        const [identityLogs, claimSubmittedLogs, claimResolvedLogs, auctionLogs, nameClaimedLogs] = await Promise.all([
            // Identity Registry: New Agents
            publicClient.getLogs({
                address: CONTRACTS.IDENTITY_REGISTRY as `0x${string}`,
                event: parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)'),
                args: { from: '0x0000000000000000000000000000000000000000' }, // Mints
                fromBlock: lastBlock + BigInt(1),
                toBlock: toBlock,
            }),
            // TruthStake: Claim Submitted
            publicClient.getLogs({
                address: CONTRACTS.TRUTH_STAKE as `0x${string}`,
                event: parseAbiItem('event ClaimSubmitted(bytes32 indexed claimId, uint256 indexed agentId, address submitter, bytes32 claimHash, uint256 stake)'),
                fromBlock: lastBlock + BigInt(1),
                toBlock: toBlock,
            }),
            // TruthStake: Claim Resolved
            publicClient.getLogs({
                address: CONTRACTS.TRUTH_STAKE as `0x${string}`,
                event: parseAbiItem('event ClaimResolved(bytes32 indexed claimId, uint256 indexed agentId, bool wasCorrect, uint256 slashAmount, uint256 bonusAmount)'),
                fromBlock: lastBlock + BigInt(1),
                toBlock: toBlock,
            }),
            // AgentTokenFactory: Auction Launched
            publicClient.getLogs({
                address: CONTRACTS.AGENT_TOKEN_FACTORY as `0x${string}`,
                event: parseAbiItem('event AuctionLaunched(uint256 indexed agentId, address token, address auction, uint256 tokensForSale, uint256 lpReserveTokens)'),
                fromBlock: lastBlock + BigInt(1),
                toBlock: toBlock,
            }),
            // VeriBondRegistrar: Name Claimed
            publicClient.getLogs({
                address: VERIBOND_REGISTRAR as `0x${string}`,
                event: parseAbiItem('event NameClaimed(uint256 indexed agentId, string label, address owner, bytes32 node)'),
                fromBlock: lastBlock + BigInt(1),
                toBlock: toBlock,
            })
        ]);

        console.log(`Found ${identityLogs.length} agents, ${claimSubmittedLogs.length} claims, ${claimResolvedLogs.length} resolutions, ${auctionLogs.length} auctions, ${nameClaimedLogs.length} names.`);

        // 3. Process Agents
        for (const log of identityLogs) {
            const agentId = log.args.tokenId!;
            const data = await fetchAgentMetadata(agentId);
            if (data) {
                await client.query(`
                    INSERT INTO agents (id, owner, wallet, name, ticker, image, description, total_slashed, is_active)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                    ON CONFLICT (id) DO UPDATE SET
                        owner = EXCLUDED.owner,
                        wallet = EXCLUDED.wallet,
                        updated_at = CURRENT_TIMESTAMP;
                `, [
                    data.agentId.toString(),
                    data.owner,
                    data.wallet,
                    data.name,
                    data.ticker,
                    data.image,
                    data.description,
                    data.slashed.toString(),
                    data.isActive
                ]);
            }
        }

        // 4. Process Claims (Submitted)
        for (const log of claimSubmittedLogs) {
            const { claimId, agentId, submitter, stake } = log.args;
            if (!claimId || !agentId) continue;

            // Insert Claim
            await client.query(`
                INSERT INTO claims (id, agent_id, submitter, stake)
                VALUES ($1, $2, $3, $4)
                ON CONFLICT (id) DO NOTHING;
            `, [claimId, agentId.toString(), submitter, stake?.toString()]);

            // Increment Agent Total Claims
            await client.query(`
                UPDATE agents SET total_claims = total_claims + 1 WHERE id = $1
            `, [agentId.toString()]);
        }

        // 5. Process Resolutions
        for (const log of claimResolvedLogs) {
            const { claimId, agentId, wasCorrect, slashAmount, bonusAmount } = log.args;
            if (!claimId || !agentId) continue;

            // Update Claim Status
            await client.query(`
                UPDATE claims 
                SET resolved = TRUE, outcome = $2, resolved_at = CURRENT_TIMESTAMP
                WHERE id = $1
            `, [claimId, wasCorrect]);

            // Update Agent Metrics (Slash / Revenue)
            // Update Agent Metrics (Slash / Revenue / Trust)
            if (wasCorrect) {
                await client.query(`
                    UPDATE agents SET 
                        total_revenue = total_revenue + $2,
                        correct_claims = correct_claims + 1,
                        trust_score = LEAST(100, GREATEST(0, (correct_claims + 1) * 10 - (slashed_claims * 50)))
                    WHERE id = $1
                `, [agentId.toString(), bonusAmount?.toString() || '0']);
            } else {
                await client.query(`
                    UPDATE agents SET 
                        total_slashed = total_slashed + $2,
                        slashed_claims = slashed_claims + 1,
                        trust_score = LEAST(100, GREATEST(0, (correct_claims * 10) - ((slashed_claims + 1) * 50)))
                    WHERE id = $1
                `, [agentId.toString(), slashAmount?.toString() || '0']);
            }
        }

        // 6. Process Auctions
        for (const log of auctionLogs) {
            const { agentId, token, auction, tokensForSale } = log.args;
            if (!agentId) continue;

            await client.query(`
                INSERT INTO auctions (agent_id, auction_address, token_address, tokens_for_sale)
                VALUES ($1, $2, $3, $4)
                ON CONFLICT (agent_id) DO UPDATE SET
                    auction_address = EXCLUDED.auction_address,
                    token_address = EXCLUDED.token_address;
            `, [agentId.toString(), auction, token, tokensForSale?.toString()]);
        }

        // 7. Process Name Claims
        for (const log of nameClaimedLogs) {
            const { agentId, label } = log.args;
            if (!agentId || !label) continue;

            await client.query(`
                UPDATE agents 
                SET claimed_name = $2 
                WHERE id = $1
            `, [agentId.toString(), label]);

            console.log(`[Indexer] Indexed ENS Name: ${label}.veribond for Agent #${agentId}`);
        }

        // 8. Update State
        await client.query("UPDATE indexer_state SET value = $1 WHERE key = 'last_synced_block'", [toBlock.toString()]);
        client.release();

        return NextResponse.json({
            status: 'success',
            processed: {
                agents: identityLogs.length,
                claims: claimSubmittedLogs.length,
                resolutions: claimResolvedLogs.length,
                auctions: auctionLogs.length,
                names: nameClaimedLogs.length
            },
            fromBlock: lastBlock.toString(),
            toBlock: toBlock.toString()
        });

    } catch (e: any) {
        console.error('Indexer Sync Error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
