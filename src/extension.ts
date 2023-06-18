// https://github1s.com/hepter/i18n-codelens/blob/HEAD/src/extension.ts#L9
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode'

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  let disposable = vscode.commands.registerCommand('extension.translateLine', () => {
    const editor = vscode.window.activeTextEditor
    if (editor) {
      const selection = editor.selection
      const selectedText = editor.document.getText(selection)

      // 发送翻译请求，将 selectedText 替换为翻译结果
      const translatedText = translate(selectedText)

      // 在编辑器左侧显示黄色警告
      const decorationType = vscode.window.createTextEditorDecorationType({
        color: 'yellow',
        backgroundColor: 'black',
      })
      const startPosition = new vscode.Position(selection.start.line, 0)
      const endPosition = new vscode.Position(selection.end.line, 0)
      const range = new vscode.Range(startPosition, endPosition)
      editor.setDecorations(decorationType, [{ range, hoverMessage: translatedText }])

      // 注册点击事件，点击后执行翻译
      const disposable = vscode.window.onDidChangeTextEditorSelection(event => {
        const selectedRange = event.selections[0]
        if (selectedRange && selectedRange.isSingleLine && selectedRange.isEqual(selection)) {
          vscode.commands.executeCommand('extension.translateLine')
        }
      })
      context.subscriptions.push(disposable)
    }
  })

  context.subscriptions.push(disposable)
}
function translate(text: string): string {
  // 在这里编写您的翻译逻辑，可以调用翻译 API 或使用其他方式进行翻译
  // 返回翻译后的文本
  return 'Translated: ' + text
}
// This method is called when your extension is deactivated
export function deactivate() {}
