import type {AnyRemotionOption} from './option';

let forceParallelEncoding = false;

const cliFlag = 'force-parallel-encoding' as const;

export const forceParallelEncodingOption = {
	name: 'Force parallel encoding',
	cliFlag,
	description: () => (
		<>
			Forces the renderer to use parallel encoding (pipe mode) regardless of
			available memory. When enabled, frames are piped directly to FFmpeg
			instead of writing to disk. Useful when using hardware-accelerated
			encoding (NVENC) where the memory heuristic is overly conservative, or
			when you know your system can handle it. The user takes responsibility
			for ensuring sufficient resources.
		</>
	),
	ssrName: 'forceParallelEncoding' as const,
	docLink: null,
	type: false as boolean,
	getValue: ({commandLine}) => {
		if (commandLine[cliFlag] !== undefined) {
			return {
				value: commandLine[cliFlag] as boolean,
				source: 'cli',
			};
		}

		if (forceParallelEncoding !== false) {
			return {
				value: forceParallelEncoding,
				source: 'config',
			};
		}

		return {
			value: false,
			source: 'default',
		};
	},
	setConfig(value: boolean) {
		forceParallelEncoding = value;
	},
	id: cliFlag,
} satisfies AnyRemotionOption<boolean>;
