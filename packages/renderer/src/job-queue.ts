type QueueEntry<T> = {
	item: T;
	resolve: (value: void) => void;
	reject: (err: Error) => void;
	processor: (item: T) => Promise<void>;
	priority: number;
};

/**
 * A generic async queue with concurrency control and priority ordering.
 * Lower priority numbers are dequeued first.
 */
export class AsyncQueue<T> {
	#running = 0;
	#queue: Array<QueueEntry<T>> = [];
	#maxConcurrency: number;

	constructor(maxConcurrency: number) {
		if (maxConcurrency < 1 || !Number.isFinite(maxConcurrency)) {
			throw new Error(
				`[AsyncQueue] maxConcurrency must be >= 1, got ${maxConcurrency}`,
			);
		}

		this.#maxConcurrency = maxConcurrency;
	}

	/**
	 * Enqueue an item for processing. Resolves when the processor completes.
	 * Items with lower priority numbers are processed first.
	 */
	async enqueue(
		item: T,
		processor: (item: T) => Promise<void>,
		priority = 0,
	): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			this.#queue.push({item, resolve, reject, processor, priority});
			// Keep the queue sorted so lowest-priority-number items run first
			this.#queue.sort((a, b) => a.priority - b.priority);
			this.#drain();
		});
	}

	/**
	 * Remove all pending (not yet running) items from the queue.
	 * In-progress items continue to completion.
	 * Pending items are rejected with the given error.
	 */
	cancelPending(reason: string): void {
		const pending = this.#queue.splice(0, this.#queue.length);
		for (const entry of pending) {
			entry.reject(new Error(reason));
		}
	}

	get pending(): number {
		return this.#queue.length;
	}

	get active(): number {
		return this.#running;
	}

	#drain(): void {
		while (this.#running < this.#maxConcurrency && this.#queue.length > 0) {
			const entry = this.#queue.shift();
			if (!entry) {
				break;
			}

			this.#running++;
			entry
				.processor(entry.item)
				.then(() => {
					entry.resolve();
				})
				.catch((err: Error) => {
					entry.reject(err);
				})
				.finally(() => {
					this.#running--;
					this.#drain();
				});
		}
	}
}
