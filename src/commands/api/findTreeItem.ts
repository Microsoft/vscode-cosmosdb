/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzExtTreeItem, callWithTelemetryAndErrorHandling, IActionContext } from 'vscode-azureextensionui';
import { parseDocDBConnectionString } from '../../docdb/docDBConnectionStrings';
import { DocDBAccountTreeItemBase } from '../../docdb/tree/DocDBAccountTreeItemBase';
import { DocDBDatabaseTreeItemBase } from '../../docdb/tree/DocDBDatabaseTreeItemBase';
import { ext } from '../../extensionVariables';
import { parseMongoConnectionString } from '../../mongo/mongoConnectionStrings';
import { MongoAccountTreeItem } from '../../mongo/tree/MongoAccountTreeItem';
import { MongoDatabaseTreeItem } from '../../mongo/tree/MongoDatabaseTreeItem';
import { ParsedConnectionString } from '../../ParsedConnectionString';
import { parsePostgresConnectionString } from '../../postgres/postgresConnectionStrings';
import { PostgresDatabaseTreeItem } from '../../postgres/tree/PostgresDatabaseTreeItem';
import { PostgresServerTreeItem } from '../../postgres/tree/PostgresServerTreeItem';
import { SubscriptionTreeItem } from '../../tree/SubscriptionTreeItem';
import { DatabaseAccountTreeItem, DatabaseTreeItem, TreeItemQuery } from '../../vscode-cosmosdb.api';
import { cacheTreeItem, tryGetTreeItemFromCache } from './apiCache';
import { DatabaseAccountTreeItemInternal } from './DatabaseAccountTreeItemInternal';
import { DatabaseTreeItemInternal } from './DatabaseTreeItemInternal';

export async function findTreeItem(query: TreeItemQuery): Promise<DatabaseAccountTreeItem | DatabaseTreeItem | undefined> {
    return await callWithTelemetryAndErrorHandling('api.findTreeItem', async (context: IActionContext) => {
        context.errorHandling.suppressDisplay = true;
        context.errorHandling.rethrow = true;

        const connectionString = query.connectionString;
        let parsedCS: ParsedConnectionString;
        if (/^mongodb[^:]*:\/\//i.test(connectionString)) {
            parsedCS = await parseMongoConnectionString(connectionString);
        } else if (/^postgres:\/\//i.test(connectionString)) {
            parsedCS = parsePostgresConnectionString(connectionString);
        } else {
            parsedCS = parseDocDBConnectionString(connectionString);
        }

        const maxTime = Date.now() + 10 * 1000; // Give up searching subscriptions after 10 seconds and just attach the account

        // 1. Get result from cache if possible
        let result: DatabaseAccountTreeItem | DatabaseTreeItem | undefined = tryGetTreeItemFromCache(parsedCS);

        // 2. Search attached accounts (do this before subscriptions because it's faster)
        if (!result) {
            const attachedDbAccounts = await ext.attachedAccountsNode.getCachedChildren(context);
            result = await searchAccountsList(attachedDbAccounts, parsedCS, context, maxTime);
        }

        // 3. Search subscriptions
        if (!result) {
            const rootNodes = await ext.tree.getChildren();
            for (const rootNode of rootNodes) {
                if (Date.now() > maxTime) {
                    break;
                }

                if (rootNode instanceof SubscriptionTreeItem) {
                    const dbAccounts = await rootNode.getCachedChildren(context);
                    result = await searchAccountsList(dbAccounts, parsedCS, context, maxTime);
                    if (result) {
                        break;
                    }
                }
            }
        }

        // 4. If all else fails, just attach a new node
        if (!result) {
            if (parsedCS.databaseName) {
                result = new DatabaseTreeItemInternal(parsedCS, parsedCS.databaseName);
            } else {
                result = new DatabaseAccountTreeItemInternal(parsedCS);
            }
        }

        cacheTreeItem(parsedCS, result);

        return result;
    });
}

async function searchAccountsList(dbAccounts: AzExtTreeItem[], expected: ParsedConnectionString, context: IActionContext, maxTime: number): Promise<DatabaseAccountTreeItem | DatabaseTreeItem | undefined> {
    try {
        for (const dbAccount of dbAccounts) {
            if (Date.now() > maxTime) {
                return undefined;
            }

            let result: DatabaseAccountTreeItem | DatabaseTreeItem | undefined;
            let actual: ParsedConnectionString;
            if (dbAccount instanceof PostgresServerTreeItem) {
                actual = dbAccount.connectionString;
                result = await searchPostgresServerAccount(dbAccount, expected, actual, context);
            } else if (dbAccount instanceof MongoAccountTreeItem) {
                actual = await parseMongoConnectionString(dbAccount.connectionString);
                result = await searchCosmosDbAccount(dbAccount, expected, actual, context);
            } else if (dbAccount instanceof DocDBAccountTreeItemBase) {
                actual = parseDocDBConnectionString(dbAccount.connectionString);
                result = await searchCosmosDbAccount(dbAccount, expected, actual, context);
            } else {
                return undefined;
            }

            if (result) {
                return result;
            }

        }
    } catch (error) {
        // Swallow all errors to avoid blocking the db account search
        // https://github.com/microsoft/vscode-cosmosdb/issues/966
    }

    return undefined;
}

async function searchCosmosDbAccount(dbAccount: MongoAccountTreeItem | DocDBAccountTreeItemBase, expected: ParsedConnectionString, actual: ParsedConnectionString, context: IActionContext): Promise<DatabaseAccountTreeItem | DatabaseTreeItem | undefined> {

    if (expected.accountId === actual.accountId) {
        if (expected.databaseName) {
            const dbs = await dbAccount.getCachedChildren(context);
            for (const db of dbs) {
                if ((db instanceof MongoDatabaseTreeItem || db instanceof DocDBDatabaseTreeItemBase) && expected.databaseName === db.databaseName) {
                    return new DatabaseTreeItemInternal(expected, expected.databaseName, dbAccount, db);
                }
            }
            // We found the right account - just not the db. In this case we can still 'reveal' the account
            return new DatabaseTreeItemInternal(expected, expected.databaseName, dbAccount);
        }
        return new DatabaseAccountTreeItemInternal(expected, dbAccount);
    }

    return undefined;
}

async function searchPostgresServerAccount(dbAccount: PostgresServerTreeItem, expected: ParsedConnectionString, actual: ParsedConnectionString, context: IActionContext): Promise<DatabaseAccountTreeItem | DatabaseTreeItem | undefined> {
    if (expected.accountId === actual.accountId && expected.databaseName) {
        const dbs = await dbAccount.getCachedChildren(context);
        // account-specific attached/azure scenario
        if (!actual.databaseName) {
            for (const db of dbs) {
                if ((db instanceof PostgresDatabaseTreeItem) && expected.databaseName === db.databaseName) {
                    return new DatabaseTreeItemInternal(expected, expected.databaseName, dbAccount, db);
                }
            }
            return new DatabaseTreeItemInternal(expected, expected.databaseName, dbAccount);
            // database-specific attached scenario
        } else {
            const db = dbs[0];
            if ((db instanceof PostgresDatabaseTreeItem) && expected.databaseName === db.databaseName) {
                return new DatabaseTreeItemInternal(expected, expected.databaseName, dbAccount, db);
            }
        }
    }
    return undefined;
}
