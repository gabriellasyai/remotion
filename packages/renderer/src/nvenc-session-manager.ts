import {getNvencMaxSessions, type NvencGpuType} from './nvenc-detection';

export type NvencSessionLease = {
	id: string;
	acquired: number;
};

type SessionWaiter = {
	resolve: (lease: NvencSessionLease) => void;
	reject: (err: Error) => void;
};

let leaseCounter = 0;

/**
 * Manages NVENC encoding session limits.
 * Consumer GPUs (GeForce) are limited to 5 concurrent NVENC sessions.
 * Enterprise GPUs (Tesla T4, L4, A10, A100, etc.) have no practical limit.
 */
export class NvencSessionManager {
	#activeSessions = 0;
	#maxSessions: number;
	#waiters: SessionWaiter[] = [];
	#closed = false;

	constructor(gpuType: NvencGpuType, maxSessionsOverride?: number) {
		this.#maxSessions = maxSessionsOverride ?? getNvencMaxSessions(gpuType);
	}

	/**
	 * Acquire an NVENC session lease. Blocks if the session limit is reached.
	 * The caller MUST call release() when the encode is complete.
	 */
	async acquire(): Promise<NvencSessionLease> {
		if (this.#closed) {
			throw new Error(
				'[NvencSessionManager] Manager is closed, cannot acquire session',
			);
		}

		if (this.#activeSessions < this.#maxSessions) {
			this.#activeSessions++;
			return this.#createLease();
		}

		// At the session limit — wait for a slot
		return new Promise<NvencSessionLease>((resolve, reject) => {
			this.#waiters.push({resolve, reject});
		});
	}

	/**
	 * Release a previously acquired NVENC session lease.
	 */
	release(_lease: NvencSessionLease): void {
		this.#activeSessions = Math.max(0, this.#activeSessions - 1);

		// If there are waiters, give the next one a session
		if (this.#waiters.length > 0 && this.#activeSessions < this.#maxSessions) {
			const waiter = this.#waiters.shift();
			if (waiter) {
				this.#activeSessions++;
				waiter.resolve(this.#createLease());
			}
		}
	}

	/**
	 * Close the manager, rejecting all pending waiters.
	 */
	close(): void {
		this.#closed = true;
		const pending = this.#waiters.splice(0, this.#waiters.length);
		for (const waiter of pending) {
			waiter.reject(
				new Error('[NvencSessionManager] Manager is closing'),
			);
		}
	}

	get active(): number {
		return this.#activeSessions;
	}

	get available(): number {
		return Math.max(0, this.#maxSessions - this.#activeSessions);
	}

	get maxSessions(): number {
		return this.#maxSessions;
	}

	#createLease(): NvencSessionLease {
		leaseCounter++;
		return {
			id: `nvenc-lease-${leaseCounter}`,
			acquired: Date.now(),
		};
	}
}
