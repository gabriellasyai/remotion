import type {LogLevel} from './log-level';
import type {ChromiumOptions} from './open-browser';
import type {ChromeMode} from './options/chrome-mode';
import type {OnBrowserDownload} from './options/on-browser-download';

export type BrowserPoolConfig = {
	maxBrowsers: number;
	pagesPerBrowser: number;
	maxPagesBeforeRecycle: number;
	browserOptions: ChromiumOptions;
	chromeMode: ChromeMode;
	logLevel: LogLevel;
	indent: boolean;
	browserExecutable: string | null;
	onBrowserDownload: OnBrowserDownload | undefined;
	forceDeviceScaleFactor: number | undefined;
};
