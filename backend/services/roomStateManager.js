/**
 * Room state management service with optional Redis support
 * Allows state persistence even after server restart
 */

class RoomStateManager {
    constructor(redisClient = null) {
        this.redisClient = redisClient;
        this.useRedis = !!redisClient;

        // In-memory state (fallback)
        this.memoryState = {
            queue: [],
            currentTrackIndex: 0,
            isPlaying: false,
            currentTime: 0,
            startTime: null,
            users: new Map(),
            serverStartTimestamp: null
        };

        console.log(`[StateManager] Initialized (Redis: ${this.useRedis ? 'enabled' : 'disabled'})`);
    }

    async getState() {
        if (this.useRedis) {
            try {
                const state = await this.redisClient.get('room:state');
                if (state) {
                    const parsed = JSON.parse(state);
                    // Rebuild users Map
                    parsed.users = new Map(Object.entries(parsed.usersObj || {}));
                    delete parsed.usersObj;
                    return parsed;
                }
            } catch (error) {
                console.error('[StateManager] Redis state retrieval error:', error);
            }
        }
        return this.memoryState;
    }

    async setState(state) {
        if (this.useRedis) {
            try {
                // Convert Map to object for JSON
                const stateToSave = {
                    ...state,
                    usersObj: Object.fromEntries(state.users || new Map())
                };
                delete stateToSave.users;

                await this.redisClient.set('room:state', JSON.stringify(stateToSave), {
                    EX: 86400 // Expires after 24h
                });
            } catch (error) {
                console.error('[StateManager] Redis state save error:', error);
            }
        }
        this.memoryState = state;
    }

    async updateField(field, value) {
        const state = await this.getState();
        state[field] = value;
        await this.setState(state);
    }

    async addUser(socketId, userData) {
        const state = await this.getState();
        state.users.set(socketId, userData);
        await this.setState(state);
    }

    async removeUser(socketId) {
        const state = await this.getState();
        state.users.delete(socketId);
        await this.setState(state);
    }

    async updateUser(socketId, updates) {
        const state = await this.getState();
        const user = state.users.get(socketId);
        if (user) {
            state.users.set(socketId, { ...user, ...updates });
            await this.setState(state);
        }
    }

    async addToQueue(track) {
        const state = await this.getState();
        state.queue.push(track);
        await this.setState(state);
        return state;
    }

    async removeFromQueue(index) {
        const state = await this.getState();
        if (index >= 0 && index < state.queue.length) {
            state.queue.splice(index, 1);

            // Adjust current track index
            if (index < state.currentTrackIndex) {
                state.currentTrackIndex--;
            } else if (index === state.currentTrackIndex) {
                if (state.queue.length <= 0) {
                    state.isPlaying = false;
                    state.currentTime = 0;
                    state.currentTrackIndex = 0;
                } else if (state.currentTrackIndex >= state.queue.length) {
                    state.currentTrackIndex = Math.max(0, state.queue.length - 1);
                }
            }

            await this.setState(state);
        }
        return state;
    }

    async reset() {
        const state = {
            queue: [],
            currentTrackIndex: 0,
            isPlaying: false,
            currentTime: 0,
            startTime: null,
            users: new Map(),
            serverStartTimestamp: null
        };
        await this.setState(state);
        return state;
    }

    // Automatic periodic save
    startAutoSave(intervalMs = 5000) {
        if (!this.useRedis) return;

        this.autoSaveInterval = setInterval(async () => {
            try {
                await this.setState(this.memoryState);
                console.log('[StateManager] Auto-save successful');
            } catch (error) {
                console.error('[StateManager] Auto-save error:', error);
            }
        }, intervalMs);

        console.log(`[StateManager] Auto-save enabled (interval: ${intervalMs}ms)`);
    }

    stopAutoSave() {
        if (this.autoSaveInterval) {
            clearInterval(this.autoSaveInterval);
            this.autoSaveInterval = null;
            console.log('[StateManager] Auto-save disabled');
        }
    }
}

module.exports = RoomStateManager;
