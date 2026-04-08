import {DEFAULT_BROWSER} from './browser';
import type {HeadlessBrowser} from './browser/Browser';
import {BrowserEmittedEvents} from './browser/Browser';
import type {Page} from './browser/BrowserPage';
import {defaultBrowserDownloadProgress} from './browser/browser-download-progress-bar';
import type {BrowserPoolConfig} from './browser-pool-config';
import {getCpuCount} from './get-cpu-count';
import {Log} from './logger';
import {internalOpenBrowser} from './open-browser';

type BrowserEntry = {
	browser: HeadlessBrowser;
	activePages: number;
	totalPagesServed: number;
	markedForRecycle: boolean;
};

type Waiter = {
	resolve: (result: {browser: HeadlessBrowser; page: Page}) => void;
	reject: (err: Error) => void;
};

export type BrowserPoolStats = {
	activeBrowsers: number;
	activePages: number;
	queuedRequests: number;
};

const defaultMaxBrowsers = () => Math.ceil(getCpuCount() / 8);

const resolveConfig = (
	partial: Partial<BrowserPoolConfig> & Pick<BrowserPoolConfig, 'browserOptions'>,
): BrowserPoolConfig => {
	return {
		maxBrowsers: partial.maxBrowsers ?? defaultMaxBrowsers(),
		pagesPerBrowser: partial.pagesPerBrowser ?? 8,
		maxPagesBeforeRecycle: partial.maxPagesBeforeRecycle ?? 200,
		browserOptions: partial.browserOptions,
		chromeMode: partial.chromeMode ?? 'headless-shell',
		logLevel: partial.logLevel ?? 'info',
		indent: partial.indent ?? false,
		browserExecutable: partial.browserExecutable ?? null,
		onBrowserDownload: partial.onBrowserDownload ?? undefined,
		forceDeviceScaleFactor: partial.forceDeviceScaleFactor ?? undefined,
	};
};

export class BrowserPoolManager {
	#config: BrowserPoolConfig;
	#entries: BrowserEntry[] = [];
	#waiters: Waiter[] = [];
	#closed = false;

	private constructor(config: BrowserPoolConfig) {
		this.#config = config;
	}

	static async create(
		partialConfig: Partial<BrowserPoolConfig> & Pick<BrowserPoolConfig, 'browserOptions'>,
	): Promise<BrowserPoolManager> {
		const config = resolveConfig(partialConfig);
		const pool = new BrowserPoolManager(config);

		Log.verbose(
			{indent: config.indent, logLevel: config.logLevel},
			`[BrowserPool] Creating pool: maxBrowsers=${config.maxBrowsers}, pagesPerBrowser=${config.pagesPerBrowser}, maxPagesBeforeRecycle=${config.maxPagesBeforeRecycle}`,
		);

		// Eagerly launch all browsers in parallel (not lazy/on-demand)
		const launchPromises = Array.from(
			{length: config.maxBrowsers},
			() => pool.#launchBrowser().catch((err) => {
				Log.warn(
					{indent: config.indent, logLevel: config.logLevel},
					`[BrowserPool] Failed to pre-launch browser: ${err instanceof Error ? err.message : String(err)}`,
				);
				return null;
			}),
		);

		await Promise.all(launchPromises);

		Log.verbose(
			{indent: config.indent, logLevel: config.logLevel},
			`[BrowserPool] Pool ready: ${pool.#entries.length}/${config.maxBrowsers} browsers launched`,
		);

		return pool;
	}

	async #launchBrowser(): Promise<BrowserEntry> {
		const {
			browserOptions,
			browserExecutable,
			forceDeviceScaleFactor,
			indent,
			logLevel,
			onBrowserDownload,
			chromeMode,
		} = this.#config;

		Log.verbose(
			{indent, logLevel},
			`[BrowserPool] Launching new browser (current count: ${this.#entries.length})`,
		);

		const browser = await internalOpenBrowser({
			browser: DEFAULT_BROWSER,
			browserExecutable,
			chromiumOptions: browserOptions,
			forceDeviceScaleFactor,
			indent,
			viewport: null,
			logLevel,
			onBrowserDownload:
				onBrowserDownload ??
				defaultBrowserDownloadProgress({
					indent,
					logLevel,
					api: 'BrowserPoolManager',
				}),
			chromeMode,
		});

		const entry: BrowserEntry = {
			browser,
			activePages: 0,
			totalPagesServed: 0,
			markedForRecycle: false,
		};

		this.#entries.push(entry);
		this.#listenForCrash(entry);

		Log.verbose(
			{indent, logLevel},
			`[BrowserPool] Browser launched (id: ${browser.id}, total: ${this.#entries.length})`,
		);

		return entry;
	}

	#listenForCrash(entry: BrowserEntry): void {
		const {indent, logLevel} = this.#config;

		const onCrash = () => {
			Log.warn(
				{indent, logLevel},
				`[BrowserPool] Browser crashed (id: ${entry.browser.id}), removing from pool`,
			);
			this.#removeEntry(entry);

			// If there are waiters and we have capacity for new browsers,
			// launch a replacement and drain the queue
			if (this.#waiters.length > 0 && !this.#closed) {
				this.#drainWaiters();
			}
		};

		entry.browser.on(BrowserEmittedEvents.Closed, onCrash);
		entry.browser.on(BrowserEmittedEvents.ClosedSilent, onCrash);
	}

	#removeEntry(entry: BrowserEntry): void {
		const idx = this.#entries.indexOf(entry);
		if (idx !== -1) {
			this.#entries.splice(idx, 1);
		}
	}

	#findAvailableEntry(): BrowserEntry | null {
		let best: BrowserEntry | null = null;

		for (const entry of this.#entries) {
			if (entry.markedForRecycle) {
				continue;
			}

			if (entry.activePages >= this.#config.pagesPerBrowser) {
				continue;
			}

			// Prefer the browser with fewest active pages (load balancing)
			if (best === null || entry.activePages < best.activePages) {
				best = entry;
			}
		}

		return best;
	}

	async acquirePage(): Promise<{browser: HeadlessBrowser; page: Page}> {
		if (this.#closed) {
			throw new Error('[BrowserPool] Pool is closed, cannot acquire page');
		}

		// Try to find a browser with capacity
		const entry = this.#findAvailableEntry();
		if (entry) {
			return this.#createPageOnEntry(entry);
		}

		// No available browser with capacity - can we launch a new one?
		if (this.#entries.length < this.#config.maxBrowsers) {
			const newEntry = await this.#launchBrowser();
			return this.#createPageOnEntry(newEntry);
		}

		// All browsers at capacity and at max - wait
		Log.verbose(
			{indent: this.#config.indent, logLevel: this.#config.logLevel},
			`[BrowserPool] All browsers at capacity, queuing request (queue size: ${this.#waiters.length + 1})`,
		);

		return new Promise<{browser: HeadlessBrowser; page: Page}>(
			(resolve, reject) => {
				this.#waiters.push({resolve, reject});
			},
		);
	}

	async #createPageOnEntry(
		entry: BrowserEntry,
	): Promise<{browser: HeadlessBrowser; page: Page}> {
		entry.activePages++;
		entry.totalPagesServed++;

		// Check if this browser should be marked for recycling
		if (entry.totalPagesServed >= this.#config.maxPagesBeforeRecycle) {
			entry.markedForRecycle = true;
			Log.verbose(
				{indent: this.#config.indent, logLevel: this.#config.logLevel},
				`[BrowserPool] Browser marked for recycle (id: ${entry.browser.id}, totalPagesServed: ${entry.totalPagesServed})`,
			);
		}

		const page = await entry.browser.newPage({
			context: () => null,
			logLevel: this.#config.logLevel,
			indent: this.#config.indent,
			pageIndex: entry.activePages - 1,
			onBrowserLog: null,
			onLog: () => {
				// noop
			},
		});

		return {browser: entry.browser, page};
	}

	releasePage(browser: HeadlessBrowser, page: Page): void {
		page.close().catch(() => {
			// Ignore close errors - browser may have crashed
		});

		const entry = this.#entries.find((e) => e.browser === browser);
		if (!entry) {
			// Browser was already removed (crash or recycle), nothing to do
			return;
		}

		entry.activePages = Math.max(0, entry.activePages - 1);

		// If marked for recycle and no more active pages, close and remove
		if (entry.markedForRecycle && entry.activePages === 0) {
			this.#removeEntry(entry);
			Log.verbose(
				{indent: this.#config.indent, logLevel: this.#config.logLevel},
				`[BrowserPool] Recycling browser (id: ${browser.id})`,
			);
			browser.close({silent: true}).catch(() => {
				// Ignore close errors
			});

			// If there are waiters, try to drain them with a new browser
			if (this.#waiters.length > 0 && !this.#closed) {
				this.#drainWaiters();
			}

			return;
		}

		// Drain any waiting requests
		this.#drainWaiters();
	}

	#drainWaiters(): void {
		while (this.#waiters.length > 0) {
			const entry = this.#findAvailableEntry();
			if (entry) {
				const waiter = this.#waiters.shift();
				if (waiter) {
					this.#createPageOnEntry(entry).then(waiter.resolve, waiter.reject);
				}

				continue;
			}

			// No available entry - can we create a new browser?
			if (this.#entries.length < this.#config.maxBrowsers) {
				const waiter = this.#waiters.shift();
				if (waiter) {
					this.#launchBrowser()
						.then((newEntry) => this.#createPageOnEntry(newEntry))
						.then(waiter.resolve, waiter.reject);
				}

				continue;
			}

			// No capacity at all, stop draining
			break;
		}
	}

	async closeAll(): Promise<void> {
		this.#closed = true;

		// Reject all waiting requests
		for (const waiter of this.#waiters) {
			waiter.reject(new Error('[BrowserPool] Pool is closing'));
		}

		this.#waiters = [];

		// Close all browsers
		const closePromises = this.#entries.map((entry) =>
			entry.browser.close({silent: true}).catch(() => {
				// Ignore close errors
			}),
		);

		this.#entries = [];
		await Promise.all(closePromises);

		Log.verbose(
			{indent: this.#config.indent, logLevel: this.#config.logLevel},
			'[BrowserPool] All browsers closed',
		);
	}

	getStats(): BrowserPoolStats {
		let activePages = 0;
		for (const entry of this.#entries) {
			activePages += entry.activePages;
		}

		return {
			activeBrowsers: this.#entries.length,
			activePages,
			queuedRequests: this.#waiters.length,
		};
	}

	/**
	 * Acquires a browser from the pool for use with renderFrames/renderMedia.
	 * Returns the browser instance and a release function that must be called
	 * when the render is complete.
	 */
	async acquireBrowser(): Promise<{
		browser: HeadlessBrowser;
		release: () => void;
	}> {
		if (this.#closed) {
			throw new Error('[BrowserPool] Pool is closed, cannot acquire browser');
		}

		// Find or create a browser with capacity
		const existingEntry = this.#findAvailableEntry();
		if (existingEntry) {
			const browserRef = existingEntry.browser;
			return {
				browser: browserRef,
				release: () => {
					this.#onBrowserReleased(browserRef);
				},
			};
		}

		if (this.#entries.length < this.#config.maxBrowsers) {
			const newEntry = await this.#launchBrowser();
			const browserRef = newEntry.browser;
			return {
				browser: browserRef,
				release: () => {
					this.#onBrowserReleased(browserRef);
				},
			};
		}

		// All browsers at capacity and at max - wait for one to become available
		Log.verbose(
			{indent: this.#config.indent, logLevel: this.#config.logLevel},
			`[BrowserPool] All browsers at capacity for acquireBrowser, queuing`,
		);

		// We use the page acquisition mechanism to wait, then immediately
		// release the page and return the browser
		const {browser, page} = await this.acquirePage();
		page.close().catch(() => {
			// Ignore
		});

		const foundEntry = this.#entries.find((e) => e.browser === browser);
		if (foundEntry) {
			foundEntry.activePages = Math.max(0, foundEntry.activePages - 1);
		}

		return {
			browser,
			release: () => {
				this.#onBrowserReleased(browser);
			},
		};
	}

	#onBrowserReleased(browser: HeadlessBrowser): void {
		const entry = this.#entries.find((e) => e.browser === browser);
		if (!entry) {
			return;
		}

		// If marked for recycle and no more active pages, close and remove
		if (entry.markedForRecycle && entry.activePages === 0) {
			this.#removeEntry(entry);
			Log.verbose(
				{indent: this.#config.indent, logLevel: this.#config.logLevel},
				`[BrowserPool] Recycling browser on release (id: ${browser.id})`,
			);
			browser.close({silent: true}).catch(() => {
				// Ignore
			});

			if (this.#waiters.length > 0 && !this.#closed) {
				this.#drainWaiters();
			}
		}
	}

	/**
	 * Creates a makeBrowser function suitable for crash recovery in renderFrames.
	 * When a browser from the pool crashes, this will acquire a new one from the pool
	 * instead of creating an isolated browser.
	 */
	makeBrowserFactory(): () => Promise<HeadlessBrowser> {
		return async () => {
			const entry = this.#findAvailableEntry();
			if (entry) {
				return entry.browser;
			}

			if (this.#entries.length < this.#config.maxBrowsers) {
				const newEntry = await this.#launchBrowser();
				return newEntry.browser;
			}

			// Wait for capacity by acquiring and releasing a page
			const {browser, page} = await this.acquirePage();
			page.close().catch(() => {
				// Ignore
			});
			const foundEntry = this.#entries.find((e) => e.browser === browser);
			if (foundEntry) {
				foundEntry.activePages = Math.max(0, foundEntry.activePages - 1);
			}

			return browser;
		};
	}
}
