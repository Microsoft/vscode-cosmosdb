/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fse from 'fs-extra';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { MessageItem, ViewColumn } from 'vscode';
import { AzureTreeItem, DialogResponses, IActionContext, UserCancelledError } from 'vscode-azureextensionui';
import { DocDBDocumentNodeEditor } from './docdb/editors/DocDBDocumentNodeEditor';
import { DocDBStoredProcedureNodeEditor } from './docdb/editors/DocDBStoredProcedureNodeEditor';
import { DocDBDocumentTreeItem } from './docdb/tree/DocDBDocumentTreeItem';
import { DocDBStoredProcedureTreeItem } from './docdb/tree/DocDBStoredProcedureTreeItem';
import { ext } from './extensionVariables';
import { MongoCollectionNodeEditor } from './mongo/editors/MongoCollectionNodeEditor';
import { MongoDocumentNodeEditor } from './mongo/editors/MongoDocumentNodeEditor';
import { MongoCollectionTreeItem } from './mongo/tree/MongoCollectionTreeItem';
import { MongoDocumentTreeItem } from './mongo/tree/MongoDocumentTreeItem';
import { PostgresFunctionEditor } from './postgres/editors/PostgresFunctionEditor';
import { PostgresFunctionTreeItem } from './postgres/tree/PostgresFunctionTreeItem';
import { nonNullValue } from './utils/nonNull';
import * as vscodeUtils from './utils/vscodeUtils';

export interface IEditor<T = {}> {
    label: string;
    id: string;
    getData(context: IActionContext): Promise<T>;
    update(data: T, context: IActionContext): Promise<T>;
    convertFromString(data: string): T;
    convertToString(data: T): string;
}

export interface ShowEditorDocumentOptions {
    /**
     * Shows the document to the right of the current editor, and keeps focus on the active document
     */
    showInNextColumn?: boolean;
}

type PersistedEditors = { [key: string]: string };

export class EditorManager {
    private fileMap: { [key: string]: IEditor } = {};
    private ignoreSave: boolean = false;

    private readonly showSavePromptKey: string = 'cosmosDB.showSavePrompt';
    private _globalState: vscode.Memento;
    private readonly _persistedEditorsKey: string = "ms-azuretools.vscode-azuredatabases.editors";

    constructor(globalState: vscode.Memento) {
        this._globalState = globalState;
    }

    public async showDocument(context: IActionContext, editor: IEditor, fileName: string, options?: ShowEditorDocumentOptions): Promise<void> {
        let column: vscode.ViewColumn = vscode.ViewColumn.Active;
        let preserveFocus: boolean = false;
        if (options && options.showInNextColumn) {
            preserveFocus = true;
            const viewColumn = vscode.window.activeTextEditor?.viewColumn;
            if (typeof viewColumn === 'number' && viewColumn >= vscode.ViewColumn.One) {
                column = viewColumn < ViewColumn.Three ? viewColumn + 1 : ViewColumn.One;
            }
        }

        const localFilename = fileName.replace(/[<>:"\/\\|?*]/g, "-");
        const localDocPath = path.join(os.tmpdir(), 'vscode-azuredatabases-editor', localFilename);
        await fse.ensureFile(localDocPath);

        const document = await vscode.workspace.openTextDocument(localDocPath);
        if (document.isDirty) {
            const overwriteFlag = await vscode.window.showWarningMessage(`You are about to overwrite "${fileName}", which has unsaved changes. Do you want to continue?`, { modal: true }, DialogResponses.yes, DialogResponses.cancel);
            if (overwriteFlag !== DialogResponses.yes) {
                throw new UserCancelledError();
            }
        }

        this.fileMap[localDocPath] = editor;
        const fileMapLabels: PersistedEditors = this._globalState.get(this._persistedEditorsKey, {});
        Object.keys(this.fileMap).forEach((key) => fileMapLabels[key] = (this.fileMap[key]).id);
        this._globalState.update(this._persistedEditorsKey, fileMapLabels);

        const data = await editor.getData(context);
        const textEditor = await vscode.window.showTextDocument(document, column, preserveFocus);
        await this.updateEditor(data, textEditor, editor);
    }

    public async updateMatchingNode(context: IActionContext, documentUri: vscode.Uri): Promise<void> {
        let filePath: string | undefined = Object.keys(this.fileMap).find((fp) => path.relative(documentUri.fsPath, fp) === '');
        if (!filePath) {
            filePath = nonNullValue(await this.loadPersistedEditor(documentUri, context), 'filePath');
        }
        const document = await vscode.workspace.openTextDocument(documentUri.fsPath);
        await this.updateToCloud(this.fileMap[filePath], document, context);
    }

    public async onDidSaveTextDocument(context: IActionContext, doc: vscode.TextDocument): Promise<void> {
        context.telemetry.suppressIfSuccessful = true;
        let filePath = Object.keys(this.fileMap).find((fp) => path.relative(doc.uri.fsPath, fp) === '');
        if (!filePath) {
            filePath = await this.loadPersistedEditor(doc.uri, context);
        }
        if (!this.ignoreSave && filePath) {
            context.telemetry.suppressIfSuccessful = false;
            const editor: IEditor = this.fileMap[filePath];
            const showSaveWarning: boolean | undefined = vscode.workspace.getConfiguration().get(this.showSavePromptKey);
            if (showSaveWarning !== false) {
                const message: string = `Saving '${path.parse(doc.fileName).base}' will update the entity "${editor.label}" to the Cloud.`;
                const result: MessageItem | undefined = await vscode.window.showWarningMessage(message, DialogResponses.upload, DialogResponses.alwaysUpload, DialogResponses.cancel);

                if (result === DialogResponses.alwaysUpload) {
                    await vscode.workspace.getConfiguration().update(this.showSavePromptKey, false, vscode.ConfigurationTarget.Global);
                } else if (result !== DialogResponses.upload) {
                    throw new UserCancelledError();
                }
            }

            await this.updateToCloud(editor, doc, context);
        }
    }

    private async updateToCloud(editor: IEditor, doc: vscode.TextDocument, context: IActionContext): Promise<void> {
        const newContent = editor.convertFromString(doc.getText());
        const updatedContent: {} = await editor.update(newContent, context);
        ext.outputChannel.appendLog(`Updated entity "${editor.label}"`);
        ext.outputChannel.show();
        if (doc.isClosed !== true) {
            const firstRelatedEditor = vscode.window.visibleTextEditors.find((ed) => ed.document === doc);
            if (firstRelatedEditor) {
                await this.updateEditor(updatedContent, firstRelatedEditor, editor);
                //all visible editors for that doc will be updated
            }
        }
    }

    private async updateEditor(data: {}, textEditor: vscode.TextEditor, editor: IEditor): Promise<void> {
        const updatedText = editor.convertToString(data);
        await vscodeUtils.writeToEditor(textEditor, updatedText);
        this.ignoreSave = true;
        try {
            await textEditor.document.save();
        } finally {
            this.ignoreSave = false;
        }
    }

    private async loadPersistedEditor(documentUri: vscode.Uri, context: IActionContext): Promise<string | undefined> {
        const persistedEditors: PersistedEditors = this._globalState.get(this._persistedEditorsKey, {});
        //Based on the documentUri, split just the appropriate key's value on '/'
        const editorFilePath = Object.keys(persistedEditors).find((label) => path.relative(documentUri.fsPath, label) === '');
        if (editorFilePath) {
            const editorNode: AzureTreeItem | undefined = await ext.tree.findTreeItem(persistedEditors[editorFilePath], context);
            let editor: IEditor;
            if (editorNode) {
                if (editorNode instanceof MongoCollectionTreeItem) {
                    editor = new MongoCollectionNodeEditor(editorNode);
                } else if (editorNode instanceof DocDBDocumentTreeItem) {
                    editor = new DocDBDocumentNodeEditor(editorNode);
                } else if (editorNode instanceof MongoDocumentTreeItem) {
                    editor = new MongoDocumentNodeEditor(editorNode);
                } else if (editorNode instanceof DocDBStoredProcedureTreeItem) {
                    editor = new DocDBStoredProcedureNodeEditor(editorNode);
                } else if (editorNode instanceof PostgresFunctionTreeItem) {
                    editor = new PostgresFunctionEditor(editorNode);
                } else {
                    throw new Error("Unexpected type of Editor treeItem");
                }
                this.fileMap[editorFilePath] = editor;
                return editorFilePath;
            } else {
                throw new Error("Failed to find entity on the tree. Please check the explorer to confirm that the entity exists, and that permissions are intact.");
            }
        }

        return undefined;
    }
}
