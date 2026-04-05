#!/usr/bin/env node

/**
 * Remotion Scale Rendering Benchmark
 *
 * Tests all 5 optimization pieces:
 *   1. NVENC hardware encoding
 *   2. Shared browser pool
 *   3. Force pipe mode (no disk I/O)
 *   4. Job scheduler with concurrency control
 *   5. Scale performance tuning
 *
 * Usage:
 *   node run-benchmark.mjs [options]
 *
 * Options:
 *   --jobs=N            Number of clips to render (default: 10)
 *   --concurrency=N     Max concurrent render jobs (default: 5)
 *   --composition=ID    Composition to render (default: ShortClip)
 *   --gpu-type=TYPE     consumer | enterprise (default: enterprise)
 *   --skip-vanilla      Skip the vanilla baseline benchmark
 *   --output-dir=PATH   Output directory (default: /tmp/benchmark-output)
 *   --serve-url=URL     Pre-built bundle URL (optional)
 *   --video=PATH        Path to test video file (copies to public/)
 */

import {execSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// ── Parse CLI args ─────────────────────────────────────────

const args = Object.fromEntries(
	process.argv.slice(2).map((a) => {
		const [k, v] = a.replace(/^--/, '').split('=');
		return [k, v ?? 'true'];
	}),
);

const NUM_JOBS = parseInt(args.jobs ?? '10', 10);
const MAX_CONCURRENCY = parseInt(args.concurrency ?? '5', 10);
const COMPOSITION_ID = args.composition ?? 'ShortClip';
const GPU_TYPE = args['gpu-type'] ?? 'enterprise';
const SKIP_VANILLA = args['skip-vanilla'] === 'true';
const OUTPUT_DIR = args['output-dir'] ?? '/tmp/benchmark-output';
const CUSTOM_BIN_DIR = '/app/custom-bin';
const TEST_COMP_DIR = '/app/test-composition';

// ── Utilities ──────────────────────────────────────────────

function log(msg) {
	const ts = new Date().toISOString().slice(11, 23);
	console.log(`[${ts}] ${msg}`);
}

function formatDuration(ms) {
	if (ms < 1000) return `${ms}ms`;
	if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
	const min = Math.floor(ms / 60000);
	const sec = ((ms % 60000) / 1000).toFixed(0);
	return `${min}m${sec}s`;
}

function formatBytes(bytes) {
	if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(0)}KB`;
	if (bytes < 1024 ** 3) return `${(bytes / (1024 ** 2)).toFixed(1)}MB`;
	return `${(bytes / (1024 ** 3)).toFixed(2)}GB`;
}

// ── System Info ────────────────────────────────────────────

function printSystemInfo() {
	console.log('\n╔══════════════════════════════════════════╗');
	console.log('║   Remotion Scale Rendering Benchmark     ║');
	console.log('╚══════════════════════════════════════════╝\n');

	log(`CPU: ${os.cpus()[0]?.model ?? 'unknown'} (${os.cpus().length} cores)`);
	log(`RAM: ${formatBytes(os.totalmem())} total, ${formatBytes(os.freemem())} free`);
	log(`OS: ${os.platform()} ${os.release()}`);
	log(`Node: ${process.version}`);

	// GPU info
	try {
		const gpuInfo = execSync('nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader', {encoding: 'utf8'}).trim();
		log(`GPU: ${gpuInfo}`);
	} catch {
		log('GPU: nvidia-smi not available');
	}

	// NVENC check
	try {
		const encoders = execSync('ffmpeg -hide_banner -encoders 2>&1 | grep nvenc', {encoding: 'utf8'}).trim();
		log(`NVENC encoders: ${encoders.split('\n').map((l) => l.trim().split(/\s+/)[1]).join(', ')}`);
	} catch {
		log('NVENC: NOT AVAILABLE');
	}

	console.log('');
	log(`Benchmark config: ${NUM_JOBS} jobs, ${MAX_CONCURRENCY} concurrent, composition=${COMPOSITION_ID}, gpu=${GPU_TYPE}`);
	console.log('');
}

// ── Setup ──────────────────────────────────────────────────

async function setup() {
	// Handle custom video file
	if (args.video) {
		const publicDir = path.join(TEST_COMP_DIR, 'public');
		fs.mkdirSync(publicDir, {recursive: true});
		const dest = path.join(publicDir, 'test-video.mp4');
		if (!fs.existsSync(dest)) {
			log(`Copying test video: ${args.video} → ${dest}`);
			fs.copyFileSync(args.video, dest);
		}
	}

	// Create public dir with placeholder if no video provided
	const publicDir = path.join(TEST_COMP_DIR, 'public');
	fs.mkdirSync(publicDir, {recursive: true});

	if (!fs.existsSync(path.join(publicDir, 'test-video.mp4'))) {
		log('No test video found. Generating a 60s test pattern with FFmpeg...');
		execSync(
			`ffmpeg -y -f lavfi -i "testsrc2=size=1920x1080:rate=30:duration=60" ` +
			`-f lavfi -i "sine=frequency=440:duration=60" ` +
			`-c:v libx264 -preset ultrafast -crf 23 -c:a aac -b:a 128k ` +
			`"${path.join(publicDir, 'test-video.mp4')}"`,
			{stdio: 'pipe'},
		);
		log('Test video generated.');
	}

	// Create output directory
	fs.mkdirSync(OUTPUT_DIR, {recursive: true});

	return publicDir;
}

// ── Bundle ─────────────────────────────────────────────────

async function bundleProject() {
	if (args['serve-url']) {
		log(`Using pre-built bundle: ${args['serve-url']}`);
		return args['serve-url'];
	}

	log('Bundling test composition...');
	const bundlePath = path.join(OUTPUT_DIR, 'bundle');

	// Dynamic import to avoid issues when Remotion isn't built yet
	const {bundle} = await import('@remotion/bundler');
	const result = await bundle({
		entryPoint: path.join(TEST_COMP_DIR, 'src', 'index.ts'),
		outDir: bundlePath,
		publicDir: path.join(TEST_COMP_DIR, 'public'),
	});

	log(`Bundle ready: ${result}`);
	return result;
}

// ── Benchmark: Vanilla (baseline) ──────────────────────────

async function benchmarkVanilla(serveUrl) {
	log('═══ BENCHMARK A: Vanilla Remotion (baseline) ═══');

	const {renderMedia, selectComposition} = await import('@remotion/renderer');

	const composition = await selectComposition({
		serveUrl,
		id: COMPOSITION_ID,
	});

	const vanillaDir = path.join(OUTPUT_DIR, 'vanilla');
	fs.mkdirSync(vanillaDir, {recursive: true});

	const startAll = Date.now();
	const results = [];

	// Run jobs sequentially (vanilla behavior for fairness)
	for (let i = 0; i < Math.min(NUM_JOBS, 3); i++) {
		const jobStart = Date.now();
		const outputFile = path.join(vanillaDir, `clip-${i}.mp4`);

		log(`  [vanilla] Rendering clip ${i + 1}/3...`);
		await renderMedia({
			serveUrl,
			composition,
			codec: 'h264',
			outputLocation: outputFile,
			hardwareAcceleration: 'disable',
			concurrency: 4,
			logLevel: 'warn',
		});

		const elapsed = Date.now() - jobStart;
		results.push(elapsed);
		log(`  [vanilla] Clip ${i + 1} done in ${formatDuration(elapsed)}`);
	}

	const totalVanilla = Date.now() - startAll;
	const avgVanilla = results.reduce((a, b) => a + b, 0) / results.length;

	log(`  [vanilla] Total: ${formatDuration(totalVanilla)}, Avg per clip: ${formatDuration(avgVanilla)}`);

	return {total: totalVanilla, avg: avgVanilla, count: results.length, perClip: results};
}

// ── Benchmark: Fork (optimized) ────────────────────────────

async function benchmarkFork(serveUrl) {
	log('═══ BENCHMARK B: Fork (NVENC + Pool + Pipe + Scheduler) ═══');

	const {
		initializeNvencDetection,
		BrowserPoolManager,
		JobScheduler,
		getRecommendedScaleConfig,
		selectComposition,
	} = await import('@remotion/renderer');

	// 1. Initialize NVENC
	const nvencAvailable = await initializeNvencDetection({
		indent: false,
		logLevel: 'info',
		binariesDirectory: CUSTOM_BIN_DIR,
	});
	log(`  NVENC available: ${nvencAvailable}`);

	// 2. Get scale config
	const scaleConfig = getRecommendedScaleConfig(MAX_CONCURRENCY);
	log(`  Scale config: ${JSON.stringify(scaleConfig)}`);

	// 3. Create browser pool
	const pool = await BrowserPoolManager.create({
		browserOptions: {},
		maxBrowsers: scaleConfig.maxBrowsers,
		pagesPerBrowser: 8,
		logLevel: 'warn',
	});
	log(`  Browser pool created: ${JSON.stringify(pool.getStats())}`);

	// 4. Resolve composition
	const composition = await selectComposition({
		serveUrl,
		id: COMPOSITION_ID,
	});

	// 5. Create scheduler
	const jobResults = [];
	const scheduler = new JobScheduler({
		maxConcurrentJobs: MAX_CONCURRENCY,
		browserPool: pool,
		nvencGpuType: GPU_TYPE,
		onJobStart: (job) => {
			log(`  [fork] Started: ${job.id}`);
		},
		onJobProgress: (job, progress) => {
			const pct = Math.round(progress.progress * 100);
			if (pct % 25 === 0 && pct > 0) {
				process.stdout.write(`\r  [fork] ${job.id}: ${pct}%`);
			}
		},
		onJobComplete: (job) => {
			log(`  [fork] Complete: ${job.id}`);
		},
		onJobError: (job, err) => {
			log(`  [fork] FAILED: ${job.id} - ${err.message}`);
		},
	});

	// 6. Build job batch
	const forkDir = path.join(OUTPUT_DIR, 'fork');
	fs.mkdirSync(forkDir, {recursive: true});

	const jobs = Array.from({length: NUM_JOBS}, (_, i) => ({
		options: {
			serveUrl,
			composition,
			codec: 'h264',
			outputLocation: path.join(forkDir, `clip-${i}.mp4`),
			hardwareAcceleration: nvencAvailable ? 'if-possible' : 'disable',
			forceParallelEncoding: true,
			jpegQuality: scaleConfig.jpegQuality,
			concurrency: scaleConfig.concurrencyPerJob,
			binariesDirectory: CUSTOM_BIN_DIR,
			logLevel: 'warn',
		},
		priority: 0,
	}));

	// 7. Run benchmark
	const startAll = Date.now();

	try {
		const results = await scheduler.addBatch(jobs);
		jobResults.push(...results);
	} catch (err) {
		log(`  [fork] Batch error: ${err.message}`);
	}

	const totalFork = Date.now() - startAll;

	// 8. Stats
	const stats = scheduler.getStats();
	log(`  [fork] Scheduler stats: ${JSON.stringify(stats)}`);
	log(`  [fork] Pool stats: ${JSON.stringify(pool.getStats())}`);

	// 9. Cleanup
	await scheduler.shutdown();
	await pool.closeAll();

	log(`  [fork] Total: ${formatDuration(totalFork)} for ${NUM_JOBS} clips`);
	log(`  [fork] Avg per clip: ${formatDuration(totalFork / NUM_JOBS)}`);
	log(`  [fork] Throughput: ${(NUM_JOBS / (totalFork / 1000)).toFixed(2)} clips/sec`);

	return {total: totalFork, avg: totalFork / NUM_JOBS, count: NUM_JOBS};
}

// ── Individual Component Tests ─────────────────────────────

async function testNvencDetection() {
	log('── Test: NVENC Detection ──');
	const {initializeNvencDetection, isNvencAvailableCached, NVENC_SESSION_LIMITS} = await import('@remotion/renderer');

	const result = await initializeNvencDetection({
		indent: false,
		logLevel: 'verbose',
		binariesDirectory: CUSTOM_BIN_DIR,
	});

	log(`  initializeNvencDetection() → ${result}`);
	log(`  isNvencAvailableCached() → ${isNvencAvailableCached()}`);
	log(`  Session limits: ${JSON.stringify(NVENC_SESSION_LIMITS)}`);

	return result;
}

async function testBrowserPool() {
	log('── Test: Browser Pool ──');
	const {BrowserPoolManager} = await import('@remotion/renderer');

	const pool = await BrowserPoolManager.create({
		browserOptions: {},
		maxBrowsers: 2,
		pagesPerBrowser: 4,
		logLevel: 'warn',
	});

	log(`  Pool created: ${JSON.stringify(pool.getStats())}`);

	// Acquire and release pages
	const pages = [];
	for (let i = 0; i < 6; i++) {
		const {browser, page} = await pool.acquirePage();
		pages.push({browser, page});
		log(`  Acquired page ${i + 1}: ${JSON.stringify(pool.getStats())}`);
	}

	for (const {browser, page} of pages) {
		pool.releasePage(browser, page);
	}
	log(`  All released: ${JSON.stringify(pool.getStats())}`);

	await pool.closeAll();
	log(`  Pool closed.`);
	return true;
}

async function testSingleRenderWithNvenc(serveUrl) {
	log('── Test: Single Render with NVENC ──');
	const {renderMedia, selectComposition, initializeNvencDetection} = await import('@remotion/renderer');

	await initializeNvencDetection({
		indent: false,
		logLevel: 'info',
		binariesDirectory: CUSTOM_BIN_DIR,
	});

	const composition = await selectComposition({serveUrl, id: COMPOSITION_ID});
	const outputFile = path.join(OUTPUT_DIR, 'single-nvenc-test.mp4');

	const start = Date.now();
	await renderMedia({
		serveUrl,
		composition,
		codec: 'h264',
		outputLocation: outputFile,
		hardwareAcceleration: 'if-possible',
		forceParallelEncoding: true,
		binariesDirectory: CUSTOM_BIN_DIR,
		logLevel: 'verbose',
		concurrency: 4,
	});

	const elapsed = Date.now() - start;
	const fileSize = fs.statSync(outputFile).size;
	log(`  Render done in ${formatDuration(elapsed)}, output: ${formatBytes(fileSize)}`);
	return elapsed;
}

// ── Report ─────────────────────────────────────────────────

function printReport(vanilla, fork) {
	console.log('\n╔══════════════════════════════════════════════════╗');
	console.log('║              BENCHMARK RESULTS                    ║');
	console.log('╠══════════════════════════════════════════════════╣');

	if (vanilla) {
		console.log(`║  Vanilla (${vanilla.count} clips sequential):            ║`);
		console.log(`║    Total:    ${formatDuration(vanilla.total).padEnd(35)}║`);
		console.log(`║    Avg/clip: ${formatDuration(vanilla.avg).padEnd(35)}║`);
		console.log('╠──────────────────────────────────────────────────╣');
	}

	if (fork) {
		console.log(`║  Fork (${fork.count} clips, ${MAX_CONCURRENCY} concurrent):            ║`);
		console.log(`║    Total:    ${formatDuration(fork.total).padEnd(35)}║`);
		console.log(`║    Avg/clip: ${formatDuration(fork.avg).padEnd(35)}║`);
		console.log(`║    Throughput: ${(fork.count / (fork.total / 1000)).toFixed(2)} clips/sec`.padEnd(50) + '║');
	}

	if (vanilla && fork) {
		const speedup = vanilla.avg / fork.avg;
		const timeReduction = ((1 - fork.avg / vanilla.avg) * 100).toFixed(1);
		console.log('╠──────────────────────────────────────────────────╣');
		console.log(`║  Speedup: ${speedup.toFixed(2)}x faster per clip`.padEnd(50) + '║');
		console.log(`║  Time reduction: ${timeReduction}%`.padEnd(50) + '║');

		// Extrapolate for 60 clips
		const vanilla60 = vanilla.avg * 60;
		const fork60 = fork.total * (60 / fork.count);
		console.log('╠──────────────────────────────────────────────────╣');
		console.log(`║  Projected for 60 clips:`.padEnd(50) + '║');
		console.log(`║    Vanilla (sequential): ${formatDuration(vanilla60)}`.padEnd(50) + '║');
		console.log(`║    Fork (${MAX_CONCURRENCY} concurrent): ${formatDuration(fork60)}`.padEnd(50) + '║');
	}

	console.log('╚══════════════════════════════════════════════════╝\n');

	// Save report as JSON
	const report = {
		timestamp: new Date().toISOString(),
		system: {
			cpu: os.cpus()[0]?.model,
			cores: os.cpus().length,
			ram: os.totalmem(),
			platform: os.platform(),
		},
		config: {jobs: NUM_JOBS, concurrency: MAX_CONCURRENCY, composition: COMPOSITION_ID, gpuType: GPU_TYPE},
		vanilla: vanilla ?? null,
		fork: fork ?? null,
	};

	const reportPath = path.join(OUTPUT_DIR, 'benchmark-report.json');
	fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
	log(`Report saved to ${reportPath}`);
}

// ── Main ───────────────────────────────────────────────────

async function main() {
	printSystemInfo();

	await setup();
	const serveUrl = await bundleProject();

	// Component tests
	console.log('\n━━━ Component Tests ━━━\n');
	await testNvencDetection();
	await testBrowserPool();
	await testSingleRenderWithNvenc(serveUrl);

	// Benchmarks
	console.log('\n━━━ Full Benchmarks ━━━\n');

	let vanillaResult = null;
	if (!SKIP_VANILLA) {
		vanillaResult = await benchmarkVanilla(serveUrl);
	}

	const forkResult = await benchmarkFork(serveUrl);

	// Report
	printReport(vanillaResult, forkResult);
}

main().catch((err) => {
	console.error('Benchmark failed:', err);
	process.exit(1);
});
