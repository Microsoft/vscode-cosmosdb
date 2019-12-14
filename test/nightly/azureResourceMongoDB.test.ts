/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { CosmosDBManagementModels } from 'azure-arm-cosmosdb';
import { IHookCallbackContext, ISuiteCallbackContext } from 'mocha';
import * as vscode from 'vscode';
import { randomUtils, appendExtensionUserAgent, connectToMongoClient, IDatabaseInfo, DialogResponses } from '../../extension.bundle';
import { longRunningTestsEnabled, testUserInput } from '../global.test';
import { resourceGroupsToDelete, client, testAccount } from './global.resource.test';
import { MongoClient, Collection } from 'mongodb';

suite('MongoDB action', async function (this: ISuiteCallbackContext): Promise<void> {
    this.timeout(20 * 60 * 1000);
    let resourceGroupName: string;
    let accountName: string;
    let databaseName1: string;

    suiteSetup(async function (this: IHookCallbackContext): Promise<void> {
        if (!longRunningTestsEnabled) {
            this.skip();
        }
        this.timeout(2 * 60 * 1000);
        resourceGroupName = randomUtils.getRandomHexString(12);
        // Cosmos DB account must have lower case name
        accountName = randomUtils.getRandomHexString(12).toLowerCase();
        databaseName1 = randomUtils.getRandomHexString(12);
        resourceGroupsToDelete.push(resourceGroupName);
    });

    test('Create MongoDB account', async () => {
        const testInputs: (string | RegExp)[] = [accountName, /MongoDB/, '$(plus) Create new resource group', resourceGroupName, 'West US'];
        await testUserInput.runWithInputs(testInputs, async () => {
            await vscode.commands.executeCommand('cosmosDB.createAccount');
        });
        const createAccount: CosmosDBManagementModels.DatabaseAccount | undefined = await client.databaseAccounts.get(resourceGroupName, accountName);
        assert.ok(createAccount);
    });

    test('Create Mongo Database', async () => {
        const collectionName: string = randomUtils.getRandomHexString(12);
        const testInputs: string[] = [testAccount.getSubscriptionContext().subscriptionDisplayName, `${accountName} (MongoDB)`, databaseName1, collectionName];
        await testUserInput.runWithInputs(testInputs, async () => {
            await vscode.commands.executeCommand('cosmosDB.createMongoDatabase');
        });
        assert.ok(await doesMongoDatabaseExist(accountName, databaseName1));
    });

    test('Create Mongo Collection', async () => {
        const databaseName2: string = randomUtils.getRandomHexString(12);
        const collectionName: string = randomUtils.getRandomHexString(12);
        const testInputs: string[] = [testAccount.getSubscriptionContext().subscriptionDisplayName, `${accountName} (MongoDB)`, '$(plus) Create new Database...', databaseName2, collectionName];
        await testUserInput.runWithInputs(testInputs, async () => {
            await vscode.commands.executeCommand('cosmosDB.createMongoCollection');
        });
        const mongoClient: MongoClient | undefined = await getMongoClient(accountName);
        const listCollections: Collection[] = await mongoClient.db(databaseName2).collections();
        const collection: Collection | undefined = listCollections.find((collection: Collection) => collection.collectionName === collectionName);
        assert.ok(collection);
    });

    test('Delete Mongo Database', async () => {
        assert.ok(await doesMongoDatabaseExist(accountName, databaseName1));
        const testInputs: string[] = [testAccount.getSubscriptionContext().subscriptionDisplayName, `${accountName} (MongoDB)`, databaseName1, DialogResponses.deleteResponse.title];
        await testUserInput.runWithInputs(testInputs, async () => {
            await vscode.commands.executeCommand('cosmosDB.deleteMongoDB');
        });
        const mongoDatabase: IDatabaseInfo | undefined = await doesMongoDatabaseExist(accountName, databaseName1);
        assert.ifError(mongoDatabase);
    });

    test('Delete account', async () => {
        const mongoAccount: CosmosDBManagementModels.DatabaseAccount = await client.databaseAccounts.get(resourceGroupName, accountName);
        assert.ok(mongoAccount);
        const testInputs: string[] = [`${accountName} (MongoDB)`, DialogResponses.deleteResponse.title];
        await testUserInput.runWithInputs(testInputs, async () => {
            await vscode.commands.executeCommand('cosmosDB.deleteAccount');
        });
        const listAccounts: CosmosDBManagementModels.DatabaseAccountsListResult = await client.databaseAccounts.listByResourceGroup(resourceGroupName);
        const accountExists: CosmosDBManagementModels.DatabaseAccount | undefined = listAccounts.find((account: CosmosDBManagementModels.DatabaseAccount) => account.name === accountName);
        assert.ifError(accountExists);
    });

    async function getMongoClient(resourceName: string): Promise<MongoClient> {
        await vscode.env.clipboard.writeText('');
        await testUserInput.runWithInputs([new RegExp(resourceName)], async () => {
            await vscode.commands.executeCommand('cosmosDB.copyConnectionString');
        });
        const connectionString: string = await vscode.env.clipboard.readText();
        return await connectToMongoClient(connectionString, appendExtensionUserAgent());
    }

    async function doesMongoDatabaseExist(mongodbAccountName: string, databasebName: string): Promise<IDatabaseInfo | undefined> {
        const mongoClient: MongoClient | undefined = await getMongoClient(mongodbAccountName);
        const listDatabases: { databases: IDatabaseInfo[] } = await mongoClient.db(mongodbAccountName).admin().listDatabases();
        return listDatabases.databases.find((database: IDatabaseInfo) => database.name === databasebName);
    }
});
