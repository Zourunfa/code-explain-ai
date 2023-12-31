'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = exports.showInputBox = void 0;
const vscode = require("vscode");
const openai_1 = require("openai");
let openai = undefined;
let commentId = 1;
class NoteComment {
    constructor(body, mode, author, parent, contextValue) {
        this.body = body;
        this.mode = mode;
        this.author = author;
        this.parent = parent;
        this.contextValue = contextValue;
        this.id = ++commentId;
        this.savedBody = this.body;
    }
}
/**
 * Shows an input box for getting API key using window.showInputBox().
 * Checks if inputted API Key is valid.
 * Updates the User Settings API Key with the newly inputted API Key.
 */
async function showInputBox() {
    const result = await vscode.window.showInputBox({
        ignoreFocusOut: true,
        placeHolder: 'Your OpenAI API Key',
        title: 'Scribe AI',
        prompt: 'You have not set your OpenAI API key yet or your API key is incorrect, please enter your API key to use the ScribeAI extension.',
        validateInput: async (text) => {
            vscode.window.showInformationMessage(`Validating: ${text}`);
            if (text === '') {
                return 'The API Key can not be empty';
            }
            try {
                openai = new openai_1.OpenAIApi(new openai_1.Configuration({
                    apiKey: text,
                }));
                await openai.listModels();
            }
            catch (err) {
                return 'Your API key is invalid';
            }
            return null;
        },
    });
    vscode.window.showInformationMessage(`Got: ${result}`);
    // Write to user settings
    await vscode.workspace.getConfiguration('scribeai').update('ApiKey', result, true);
    // Write to workspace settings
    //await vscode.workspace.getConfiguration('scribeai').update('ApiKey', result, false);
    return result;
}
exports.showInputBox = showInputBox;
async function validateAPIKey() {
    try {
        openai = new openai_1.OpenAIApi(new openai_1.Configuration({
            apiKey: vscode.workspace.getConfiguration('scribeai').get('ApiKey'),
        }));
        await openai.listModels();
    }
    catch (err) {
        return false;
    }
    return true;
}
async function activate(context) {
    // Workspace settings override User settings when getting the setting.
    if (vscode.workspace.getConfiguration('scribeai').get('ApiKey') === '' ||
        !(await validateAPIKey())) {
        const apiKey = await showInputBox();
    }
    if (openai === undefined) {
        openai = new openai_1.OpenAIApi(new openai_1.Configuration({
            apiKey: vscode.workspace.getConfiguration('scribeai').get('ApiKey'),
        }));
    }
    // A `CommentController` is able to provide comments for documents.
    const commentController = vscode.comments.createCommentController('comment-scribeai', 'ScribeAI Comment Controller');
    context.subscriptions.push(commentController);
    // A `CommentingRangeProvider` controls where gutter decorations that allow adding comments are shown
    commentController.commentingRangeProvider = {
        provideCommentingRanges: (document, token) => {
            const lineCount = document.lineCount;
            return [new vscode.Range(0, 0, lineCount - 1, 0)];
        },
    };
    commentController.options = {
        prompt: 'Ask Scribe AI...',
        placeHolder: 'Ask me anything! Example: "Explain the above code in plain English"',
    };
    context.subscriptions.push(vscode.commands.registerCommand('mywiki.createNote', (reply) => {
        replyNote(reply);
    }));
    context.subscriptions.push(vscode.commands.registerCommand('mywiki.askAI', (reply) => {
        vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Generating AI response...',
            cancellable: true,
        }, async () => {
            await askAI(reply);
        });
    }));
    context.subscriptions.push(vscode.commands.registerCommand('mywiki.aiEdit', (reply) => {
        vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Generating AI response...',
            cancellable: true,
        }, async () => {
            await aiEdit(reply);
        });
    }));
    context.subscriptions.push(vscode.commands.registerCommand('mywiki.genDocString', (reply) => {
        vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Generating AI response...',
            cancellable: true,
        }, async () => {
            reply.text =
                'Write a docstring for the above code and use syntax of the coding language to format it.';
            await askAI(reply);
        });
    }));
    context.subscriptions.push(vscode.commands.registerCommand('mywiki.replyNote', (reply) => {
        replyNote(reply);
    }));
    context.subscriptions.push(vscode.commands.registerCommand('mywiki.deleteNoteComment', (comment) => {
        const thread = comment.parent;
        if (!thread) {
            return;
        }
        thread.comments = thread.comments.filter((cmt) => cmt.id !== comment.id);
        if (thread.comments.length === 0) {
            thread.dispose();
        }
    }));
    context.subscriptions.push(vscode.commands.registerCommand('mywiki.deleteNote', (thread) => {
        thread.dispose();
    }));
    context.subscriptions.push(vscode.commands.registerCommand('mywiki.cancelsaveNote', (comment) => {
        if (!comment.parent) {
            return;
        }
        comment.parent.comments = comment.parent.comments.map((cmt) => {
            if (cmt.id === comment.id) {
                cmt.body = cmt.savedBody;
                cmt.mode = vscode.CommentMode.Preview;
            }
            return cmt;
        });
    }));
    context.subscriptions.push(vscode.commands.registerCommand('mywiki.saveNote', (comment) => {
        if (!comment.parent) {
            return;
        }
        comment.parent.comments = comment.parent.comments.map((cmt) => {
            if (cmt.id === comment.id) {
                cmt.savedBody = cmt.body;
                cmt.mode = vscode.CommentMode.Preview;
            }
            return cmt;
        });
    }));
    context.subscriptions.push(vscode.commands.registerCommand('mywiki.editNote', (comment) => {
        if (!comment.parent) {
            return;
        }
        comment.parent.comments = comment.parent.comments.map((cmt) => {
            if (cmt.id === comment.id) {
                cmt.mode = vscode.CommentMode.Editing;
            }
            return cmt;
        });
    }));
    context.subscriptions.push(vscode.commands.registerCommand('mywiki.dispose', () => {
        commentController.dispose();
    }));
    /**
     * Generates the prompt to pass to OpenAI.
     * Prompt includes:
     * - Role play text that gives context to AI
     * - Code block highlighted for the comment thread
     * - All of past conversation history + example conversation
     * - User's new question
     * @param question
     * @param thread
     * @returns
     */
    async function generatePromptV1(question, thread) {
        const rolePlay = 'I want you to act as a highly intelligent AI chatbot that has deep understanding of any coding language and its API documentations. I will provide you with a code block and your role is to provide a comprehensive answer to any questions or requests that I will ask about the code block. Please answer in as much detail as possible and not be limited to brevity. It is very important that you provide verbose answers and answer in markdown format.';
        const codeBlock = await getCommentThreadCode(thread);
        let conversation = 'Human: Who are you?\n\nAI: I am a intelligent AI chatbot\n\n';
        const filteredComments = thread.comments.filter((comment) => comment.label !== 'NOTE');
        for (let i = Math.max(0, filteredComments.length - 8); i < filteredComments.length; i++) {
            if (filteredComments[i].author.name === 'VS Code') {
                conversation += `Human: ${filteredComments[i].body.value}\n\n`;
            }
            else if (filteredComments[i].author.name === 'Scribe AI') {
                conversation += `AI: ${filteredComments[i].body.value}\n\n`;
            }
        }
        conversation += `Human: ${question}\n\nAI: `;
        return rolePlay + '\n```\n' + codeBlock + '\n```\n\n\n' + conversation;
    }
    /**
     * Generates the prompt to pass to OpenAI ChatGPT API.
     * Prompt includes:
     * - Role play text that gives context to AI
     * - Code block highlighted for the comment thread
     * - All of past conversation history + example conversation
     * - User's new question
     * @param question
     * @param thread
     * @returns
     */
    async function generatePromptChatGPT(question, thread) {
        const messages = [];
        const rolePlay = 'I want you to act as a highly intelligent AI chatbot that has deep understanding of any coding language and its API documentations. I will provide you with a code block and your role is to provide a comprehensive answer to any questions or requests that I will ask about the code block. Please answer in as much detail as possible and not be limited to brevity. It is very important that you provide verbose answers and answer in markdown format.';
        const codeBlock = await getCommentThreadCode(thread);
        messages.push({
            role: 'system',
            content: rolePlay + '\nCode:\n```\n' + codeBlock + '\n```',
        });
        messages.push({ role: 'user', content: 'Who are you?' });
        messages.push({
            role: 'assistant',
            content: 'I am a intelligent and helpful AI chatbot.',
        });
        const filteredComments = thread.comments.filter((comment) => comment.label !== 'NOTE');
        for (let i = Math.max(0, filteredComments.length - 8); i < filteredComments.length; i++) {
            if (filteredComments[i].author.name === 'VS Code') {
                messages.push({
                    role: 'user',
                    content: `${filteredComments[i].body.value}`,
                });
            }
            else if (filteredComments[i].author.name === 'Scribe AI') {
                messages.push({
                    role: 'assistant',
                    content: `${filteredComments[i].body.value}`,
                });
            }
        }
        messages.push({ role: 'user', content: `${question}` });
        return messages;
    }
    /**
     * Generates the prompt to pass to OpenAI.
     * Note: Not as performant as V1 but consumes less tokens per request.
     * Prompt includes:
     * - Role play text that gives context to AI
     * - Code block highlighted for the comment thread
     * - An example conversation to give the AI an example. "Human: Who are you?\nAI: I am a intelligent AI chatbot\n";
     * - User's new question
     * @param question
     * @param thread
     * @returns
     */
    function generatePromptV2(question, thread) {
        const rolePlay = 'I want you to act as a highly intelligent AI chatbot that has deep understanding of any coding language and its API documentations. ' +
            'I will provide you with a code block and your role is to provide a comprehensive answer to any questions or requests that I will ask about the code block. Please answer in as much detail as possible and not be limited to brevity. It is very important that you provide verbose answers. (When responding to the following prompt, please make sure to properly style your response using Github Flavored Markdown.' +
            ' Use markdown syntax for things like headings, lists, colored text, code blocks, highlights etc. Make sure not to mention markdown or stying in your actual response.' +
            ' Try to write code inside a single code block if possible)';
        const codeBlock = getCommentThreadCode(thread);
        let conversation = 'Human: Who are you?\n\nAI: I am a intelligent AI chatbot\n\n';
        conversation += `Human: ${question}\n\nAI: `;
        return rolePlay + '\n' + codeBlock + '\n\n\n' + conversation;
    }
    /**
     * Gets the highlighted code for this comment thread
     * @param thread
     * @returns
     */
    async function getCommentThreadCode(thread) {
        const document = await vscode.workspace.openTextDocument(thread.uri);
        // Get selected code for the comment thread
        return document.getText(thread.range).trim();
    }
    /**
     * User replies with a question.
     * The question + conversation history + code block then gets used
     * as input to call the OpenAI API to get a response.
     * The new humna question and AI response then gets added to the thread.
     * @param reply
     */
    const axiosOptionForOpenAI = (onData) => ({
        responseType: 'stream',
        onDownloadProgress: (e) => {
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
                    console.log(line, '---line');
                    if (message === '[DONE]') {
                        // stream finished
                        ended = true;
                        break;
                    }
                    const parsed = JSON.parse(message);
                    const text = parsed.choices[0].text ||
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
                }
                else {
                    onData?.(result);
                }
            }
            catch (e) {
                // expose current response for error display
                onData?.('', e.currentTarget.response);
            }
        },
    });
    const handelPrompt = async (prompt, ref, onData) => {
        const controller = new AbortController();
        const commonOption = {
            max_tokens: 4000 - prompt.replace(/[\u4e00-\u9fa5]/g, 'aa').length,
            stream: true,
            model: 'gpt-3.5-turbo',
            temperature: 0,
        };
        ref.current = controller;
        try {
            await openai.createChatCompletion({
                ...commonOption,
                messages: [{ role: 'user', content: prompt }],
            }, {
                ...axiosOptionForOpenAI(onData),
                signal: controller.signal,
            });
        }
        catch (error) {
            console.log(error.message);
        }
    };
    const handler = (text, err, end) => {
        console.log(text, '---text');
    };
    async function askAI(reply) {
        const question = reply.text.trim();
        const thread = reply.thread;
        const model = vscode.workspace.getConfiguration('scribeai').get('models') + '';
        let prompt = '';
        let chatGPTPrompt = [];
        if (model === 'ChatGPT' || model === 'gpt-4') {
            chatGPTPrompt = await generatePromptChatGPT(question, thread);
        }
        else {
            prompt = await generatePromptV1(question, thread);
        }
        const humanComment = new NoteComment(new vscode.MarkdownString(question), vscode.CommentMode.Preview, {
            name: 'VS Code',
            iconPath: vscode.Uri.parse('https://img.icons8.com/fluency/96/null/user-male-circle.png'),
        }, thread, thread.comments.length ? 'canDelete' : undefined);
        thread.comments = [...thread.comments, humanComment];
        // If openai is not initialized initialize it with existing API Key
        // or if doesn't exist then ask user to input API Key.
        if (openai === undefined) {
            if (vscode.workspace.getConfiguration('scribeai').get('ApiKey') === '') {
                const apiKey = await showInputBox();
            }
            openai = new openai_1.OpenAIApi(new openai_1.Configuration({
                apiKey: vscode.workspace.getConfiguration('scribeai').get('ApiKey'),
            }));
        }
        if (model === 'ChatGPT' || model === 'gpt-4') {
            // const response = await openai.createChatCompletion({
            // 	model: model === 'ChatGPT' ? 'gpt-3.5-turbo' : 'gpt-4',
            // 	messages: chatGPTPrompt,
            // 	temperature: 0,
            // 	max_tokens: 1000,
            // 	top_p: 1.0,
            // 	frequency_penalty: 1,
            // 	presence_penalty: 1,
            // 	stream: true,
            // });
            // const { body, status } = response;
            const controllerRef = {};
            const prompt = '1';
            handelPrompt(prompt, controllerRef, handler);
            // if (body) {
            //     const reader = body.getReader()
            // 			const AIComment = new NoteComment(
            // 			new vscode.MarkdownString('1'),
            // 			vscode.CommentMode.Preview,
            // 			{
            // 				name: 'Scribe AI',
            // 				iconPath: vscode.Uri.parse('https://img.icons8.com/fluency/96/null/chatbot.png'),
            // 			},
            // 			thread,
            // 			thread.comments.length ? 'canDelete' : undefined
            // 		);
            // 		thread.comments = [...thread.comments, AIComment];
            //     await readStream(reader, status,AIComment,)
            //   }
            // const responseText = response.data.choices[0].message?.content
            // 	? response.data.choices[0].message?.content
            // 	: 'An error occured. Please try again...';
            // const AIComment = new NoteComment(
            // 	new vscode.MarkdownString(responseText.trim()),
            // 	vscode.CommentMode.Preview,
            // 	{
            // 		name: 'Scribe AI',
            // 		iconPath: vscode.Uri.parse('https://img.icons8.com/fluency/96/null/chatbot.png'),
            // 	},
            // 	thread,
            // 	thread.comments.length ? 'canDelete' : undefined
            // );
            // thread.comments = [...thread.comments, AIComment];
            // console.log(flatted.stringify(thread), '---thread');
            // console.log(flatted.stringify(AIComment), '----AIcomment');.
            // console.log(AIComment, '----AIcomment');
            // console.log(AIComment.body.valueOf, '----AIcommentBody');
            // console.log(AIComment.author, '----AIcommentBody');
            // console.log(AIComment.parent, '----AIcommentBody');
            // console.log(AIComment.contextValue, '----AIcommentBody');
            // console.log(AIComment.body, '----AIcommentBody');
        }
        else {
            const response = await openai.createCompletion({
                model: model,
                prompt: prompt,
                //prompt: generatePromptV2(question, thread),
                temperature: 0,
                max_tokens: 500,
                top_p: 1.0,
                frequency_penalty: 1,
                presence_penalty: 1,
                stop: ['Human:'], // V1: "Human:"
            });
            const responseText = response.data.choices[0].text
                ? response.data.choices[0].text
                : 'An error occured. Please try again...';
            const AIComment = new NoteComment(new vscode.MarkdownString(responseText.trim()), vscode.CommentMode.Preview, {
                name: 'Scribe AI',
                iconPath: vscode.Uri.parse('https://img.icons8.com/fluency/96/null/chatbot.png'),
            }, thread, thread.comments.length ? 'canDelete' : undefined);
            thread.comments = [...thread.comments, AIComment];
        }
    }
    /**
     * AI will edit the highlighted code based on the given instructions.
     * Uses the OpenAI Edits endpoint. Replaces the highlighted code
     * with AI generated code. You can undo to go back.
     *
     * @param reply
     * @returns
     */
    async function aiEdit(reply) {
        const question = reply.text.trim();
        const code = await getCommentThreadCode(reply.thread);
        const thread = reply.thread;
        // If openai is not initialized initialize it with existing API Key
        // or if doesn't exist then ask user to input API Key.
        if (openai === undefined) {
            if (vscode.workspace.getConfiguration('scribeai').get('ApiKey') === '') {
                const apiKey = await showInputBox();
            }
            openai = new openai_1.OpenAIApi(new openai_1.Configuration({
                apiKey: vscode.workspace.getConfiguration('scribeai').get('ApiKey'),
            }));
        }
        const response = await openai.createEdit({
            model: 'code-davinci-edit-001',
            input: code,
            instruction: question,
            temperature: 0,
            top_p: 1.0,
        });
        if (response.data.choices[0].text) {
            const editor = await vscode.window.showTextDocument(thread.uri);
            if (!editor) {
                return; // No open text editor
            }
            editor.edit((editBuilder) => {
                editBuilder.replace(thread.range, response.data.choices[0].text + '');
            });
        }
        else {
            vscode.window.showErrorMessage('An error occured. Please try again...');
        }
    }
    /**
     * Adds a regular note. Doesn't call OpenAI API.
     * @param reply
     */
    function replyNote(reply) {
        const thread = reply.thread;
        const newComment = new NoteComment(new vscode.MarkdownString(reply.text), vscode.CommentMode.Preview, {
            name: 'VS Code',
            iconPath: vscode.Uri.parse('https://img.icons8.com/fluency/96/null/user-male-circle.png'),
        }, thread, thread.comments.length ? 'canDelete' : undefined);
        newComment.label = 'NOTE';
        thread.comments = [...thread.comments, newComment];
    }
}
exports.activate = activate;
//# sourceMappingURL=extension.js.map