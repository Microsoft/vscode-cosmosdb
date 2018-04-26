/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureTreeDataProvider, AzureActionHandler, IAzureParentNode, IAzureNode } from "vscode-azureextensionui";
import { DocDBDatabaseTreeItem } from "./tree/DocDBDatabaseTreeItem";
import { DocDBAccountTreeItem } from "./tree/DocDBAccountTreeItem";
import { DocDBCollectionTreeItem } from "./tree/DocDBCollectionTreeItem";
import { DocDBDocumentTreeItem } from "./tree/DocDBDocumentTreeItem";
import { DocDBStoredProcedureTreeItem } from "./tree/DocDBStoredProcedureTreeItem";
import { commands } from "vscode";

export function registerDocDBCommands(actionHandler: AzureActionHandler, tree: AzureTreeDataProvider): void {
    actionHandler.registerCommand('cosmosDB.createDocDBDatabase', async (node?: IAzureParentNode) => {
        if (!node) {
            node = <IAzureParentNode>await tree.showNodePicker(DocDBAccountTreeItem.contextValue);
        }
        const databaseNode: IAzureParentNode = <IAzureParentNode>await node.createChild();
        await databaseNode.createChild();
    });
    actionHandler.registerCommand('cosmosDB.createDocDBCollection', async (node?: IAzureParentNode) => {
        if (!node) {
            node = <IAzureParentNode>await tree.showNodePicker(DocDBDatabaseTreeItem.contextValue);
        }
        await node.createChild();
    });
    actionHandler.registerCommand('cosmosDB.createDocDBDocument', async (node?: IAzureParentNode) => {
        if (!node) {
            // #region Temporary changes to remove Documents node until viewing/editor stored procedures is implemented
            // node = <IAzureParentNode>await tree.showNodePicker(DocDBDocumentsTreeItem.contextValue);
            node = <IAzureParentNode>await tree.showNodePicker(DocDBCollectionTreeItem.contextValue);
            // #endregion
        }
        let childNode = await node.createChild();
        await commands.executeCommand("cosmosDB.openDocument", childNode);

    });
    actionHandler.registerCommand('cosmosDB.deleteDocDBDatabase', async (node?: IAzureNode) => {
        if (!node) {
            node = await tree.showNodePicker(DocDBDatabaseTreeItem.contextValue);
        }
        await node.deleteNode();
    });
    actionHandler.registerCommand('cosmosDB.deleteDocDBCollection', async (node?: IAzureNode) => {
        if (!node) {
            node = await tree.showNodePicker(DocDBCollectionTreeItem.contextValue);
        }
        await node.deleteNode();
    });
    actionHandler.registerCommand('cosmosDB.deleteDocDBDocument', async (node?: IAzureNode) => {
        if (!node) {
            node = await tree.showNodePicker(DocDBDocumentTreeItem.contextValue);
        }
        await node.deleteNode();
    });
    actionHandler.registerCommand('cosmosDB.deleteStoredProcedure', async (node?: IAzureNode) => {
        if (!node) {
            node = await tree.showNodePicker(DocDBStoredProcedureTreeItem.contextValue);
        }
        await node.deleteNode();
    });
}
