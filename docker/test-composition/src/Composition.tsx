import React from 'react';
import {Composition, staticFile} from 'remotion';
import {VideoWithSubtitles} from './VideoWithSubtitles';
import {ViralStressTest} from './ViralStressTest';

export const ScaleTestComp: React.FC = () => {
	return (
		<>
			{/* ── STRESS TEST: Full viral video (~60s) ─── */}
			<Composition
				id="ViralStress"
				component={ViralStressTest}
				durationInFrames={30 * 60} // 60 seconds
				fps={30}
				width={1080}
				height={1920}
				defaultProps={{
					videoSrc: staticFile('test-video.mp4'),
				}}
			/>

			{/* ── STRESS TEST: Short version (30s) ─── */}
			<Composition
				id="ViralStress30"
				component={ViralStressTest}
				durationInFrames={30 * 30} // 30 seconds
				fps={30}
				width={1080}
				height={1920}
				defaultProps={{
					videoSrc: staticFile('test-video.mp4'),
				}}
			/>

			{/* ── Original test compositions ─── */}
			<Composition
				id="VideoSubtitleClip"
				component={VideoWithSubtitles}
				durationInFrames={30 * 60}
				fps={30}
				width={1920}
				height={1080}
				defaultProps={{
					videoSrc: staticFile('test-video.mp4'),
					subtitles: [
						{start: 0, end: 90, text: 'Welcome to the scale rendering test'},
						{start: 90, end: 180, text: 'This clip tests subtitles overlay'},
						{start: 180, end: 360, text: 'Now testing zoom effect...'},
						{start: 360, end: 540, text: 'And blur background effect'},
						{start: 540, end: 720, text: 'Combined: zoom + blur + subtitle'},
						{start: 720, end: 900, text: 'Testing OffthreadVideo performance'},
						{start: 900, end: 1080, text: 'Frame extraction under load'},
						{start: 1080, end: 1260, text: 'Multiple concurrent renders'},
						{start: 1260, end: 1440, text: 'NVENC hardware encoding active'},
						{start: 1440, end: 1800, text: 'Scale rendering benchmark complete'},
					],
					enableZoom: true,
					enableBlur: true,
				}}
			/>
			<Composition
				id="ShortClip"
				component={VideoWithSubtitles}
				durationInFrames={30 * 10}
				fps={30}
				width={1920}
				height={1080}
				defaultProps={{
					videoSrc: staticFile('test-video.mp4'),
					subtitles: [
						{start: 0, end: 150, text: 'Quick benchmark clip (10s)'},
						{start: 150, end: 300, text: 'Testing all effects combined'},
					],
					enableZoom: true,
					enableBlur: true,
				}}
			/>
		</>
	);
};
