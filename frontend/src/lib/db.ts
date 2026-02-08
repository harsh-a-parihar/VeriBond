
import { Pool } from 'pg';

let pool: Pool;

if (!process.env.DATABASE_URL) {
    console.error('⚠️ DATABASE_URL environment variable is missing in .env.local or Render environment!');
}

// Use a singleton pool in development to avoid exhausting connections
// during Hot Module Replacement (HMR).
if (process.env.NODE_ENV === 'development') {
    let globalWithPool = global as typeof globalThis & {
        _postgresPool?: Pool;
    };

    if (!globalWithPool._postgresPool) {
        globalWithPool._postgresPool = new Pool({
            connectionString: process.env.DATABASE_URL,
        });
    }
    pool = globalWithPool._postgresPool;
} else {
    pool = new Pool({
        connectionString: process.env.DATABASE_URL,
    });
}

export default pool;
