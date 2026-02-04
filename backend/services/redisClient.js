const redis = require('redis');

class RedisClient {
    constructor() {
        this.client = null;
        this.isConnected = false;
        this.isEnabled = process.env.REDIS_ENABLED === 'true';
    }

    async connect() {
        if (!this.isEnabled) {
            console.log('[Redis] Redis disabled, memory-only mode');
            return null;
        }

        try {
            const redisHost = process.env.REDIS_HOST || 'localhost';
            const redisPort = process.env.REDIS_PORT || 6379;
            const redisPassword = process.env.REDIS_PASSWORD || '';

            console.log(`[Redis] Connecting to Redis at ${redisHost}:${redisPort}...`);

            this.client = redis.createClient({
                socket: {
                    host: redisHost,
                    port: redisPort,
                    reconnectStrategy: (retries) => {
                        if (retries > 10) {
                            console.error('[Redis] Too many reconnection attempts, giving up');
                            return new Error('Too many reconnection attempts');
                        }
                        const delay = Math.min(retries * 100, 3000);
                        console.log(`[Redis] Reconnecting in ${delay}ms (attempt ${retries})`);
                        return delay;
                    }
                },
                password: redisPassword || undefined
            });

            // Redis events
            this.client.on('error', (err) => {
                console.error('[Redis] Error:', err.message);
                this.isConnected = false;
            });

            this.client.on('connect', () => {
                console.log('[Redis] Connection established');
            });

            this.client.on('ready', () => {
                console.log('[Redis] Ready');
                this.isConnected = true;
            });

            this.client.on('reconnecting', () => {
                console.log('[Redis] Reconnecting...');
                this.isConnected = false;
            });

            this.client.on('end', () => {
                console.log('[Redis] Connection closed');
                this.isConnected = false;
            });

            await this.client.connect();

            // Connection test
            const pingResult = await this.client.ping();
            if (pingResult === 'PONG') {
                console.log('[Redis] Connection test successful');
                return this.client;
            }

        } catch (error) {
            console.error('[Redis] Connection error:', error.message);
            console.log('[Redis] Falling back to memory-only mode');
            this.client = null;
            this.isConnected = false;
            return null;
        }
    }

    async disconnect() {
        if (this.client && this.isConnected) {
            try {
                await this.client.quit();
                console.log('[Redis] Disconnected cleanly');
            } catch (error) {
                console.error('[Redis] Disconnection error:', error.message);
            }
        }
    }

    getClient() {
        return this.isConnected ? this.client : null;
    }

    async healthCheck() {
        if (!this.client || !this.isConnected) {
            return { status: 'disabled', message: 'Redis not available' };
        }

        try {
            const start = Date.now();
            await this.client.ping();
            const latency = Date.now() - start;

            const info = await this.client.info('memory');
            const memoryMatch = info.match(/used_memory_human:(.+)/);
            const memory = memoryMatch ? memoryMatch[1].trim() : 'N/A';

            return {
                status: 'ok',
                latency: `${latency}ms`,
                memory: memory,
                connected: this.isConnected
            };
        } catch (error) {
            return {
                status: 'error',
                message: error.message
            };
        }
    }
}

module.exports = new RedisClient();
