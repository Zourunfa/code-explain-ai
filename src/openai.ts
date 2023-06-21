import { TextDecoder } from 'util';
import { Comment } from 'vscode';
const decoder = new TextDecoder('utf-8');
export const readStream = async (reader: any, status: any, messages: any) => {
	let partialLine = '';

	// eslint-disable-next-line no-constant-condition
	while (true) {
		const { value, done } = await reader.read();
		if (done) break;

		const decodedText = decoder.decode(value, { stream: true });

		if (status !== 200) {
			const json = JSON.parse(decodedText); // start with "data: "
			const content = json.error.message ?? decodedText;
			appendLastMessageContent(content, messages);
			return;
		}

		const chunk = partialLine + decodedText;
		const newLines = chunk.split(/\r?\n/);
		const judgeErrorLine = _.cloneDeep(newLines);
		let jsonError;

		try {
			jsonError = JSON.parse(judgeErrorLine);
			if (jsonError.code) {
				messages.pop();
				messages.push({
					content: jsonError.msg.toString(),
					role: 'chatdoc',
					error: true,
				});
				throw new Error(jsonError.msg);
			}
		} catch (error) {}

		partialLine = newLines.pop() ?? '';
		const index = 0;
		// newLines.shift()
		console.log(newLines, '----newLing');
		console.log(newLines.length, '---leng');
		const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
		for (const line of newLines) {
			if (line.length === 0) continue; // ignore empty message
			if (line.startsWith(':')) continue; // ignore sse comment message
			const json = JSON.parse(line); // start with "id:: "
			const s =
				json && json.choices && json.choices[0].delta.content
					? json.choices[0].delta.content
					: '';
			if (s) {
				appendLastMessageContent(s, messages);
				await delay(16);
			}
		}
	}
};

export const appendLastMessageContent = (AIComment: Comment, content: string) => {
	AIComment.body += content;
};

let gpt: any;
const config = new Configuration({
	apiKey: API_KEY,
});

gpt = new OpenAIApi(config);

const axiosOptionForOpenAI = (
	onData: (text: string, err?: any, end?: boolean) => void
) => ({
	responseType: 'stream' as any,
	onDownloadProgress: (e: any) => {
		try {
			if (e.currentTarget.status !== 200) {
				onData('', new Error(e.currentTarget.responseText), false);
				return;
			}

			const lines = e.currentTarget.response
				.toString()
				.split('\n')
				.filter((line) => line.trim() !== '');

			let result = '';

			let ended = false;

			for (const line of lines) {
				const message = line.replace(/^data: /, '');

				if (message === '[DONE]') {
					// stream finished
					ended = true;
					break;
				}

				const parsed = JSON.parse(message);

				const text =
					parsed.choices[0].text ||
					parsed.choices[0]?.delta?.content ||
					parsed.choices[0]?.message?.content ||
					'';

				if (!text && !result) {
					continue;
				}

				result += text;

				// edits don't support stream
				if (parsed.object === 'edit') {
					ended = true;
					break;
				}
			}

			if (ended) {
				onData(result, '', true);
			} else {
				onData?.(result);
			}
		} catch (e) {
			// expose current response for error display
			onData?.('', e.currentTarget.response);
		}
	},
});

export const handelPrompt = async (
	prompt: string,
	ref: any,
	onData: (text: string, err?: any, end?: boolean) => void
) => {
	const controller = new AbortController();

	const commonOption = {
		max_tokens: 4000 - prompt.replace(/[\u4e00-\u9fa5]/g, 'aa').length,
		stream: true,
		model: 'gpt-3.5-turbo',
		temperature: 0,
	};
	ref.current = controller;

	try {
		await openai!.createChatCompletion(
			{
				...commonOption,
				messages: [{ role: 'user', content: prompt }],
			},
			{
				...axiosOptionForOpenAI(onData),
				signal: controller.signal,
			}
		);
	} catch (error: any) {
		console.log(error.message);
	}
};
