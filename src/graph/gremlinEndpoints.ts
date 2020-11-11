/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CosmosDBManagementClient } from '@azure/arm-cosmosdb';
import { DatabaseAccountGetResults } from '@azure/arm-cosmosdb/src/models';
import { nonNullValue } from '../utils/nonNull';
import { IGremlinEndpoint } from '../vscode-cosmosdbgraph.api';

export async function tryGetGremlinEndpointFromAzure(client: CosmosDBManagementClient, resourceGroup: string, account: string): Promise<IGremlinEndpoint | undefined> {
    const response: DatabaseAccountGetResults = (await client.databaseAccounts.get(resourceGroup, account))._response.parsedBody;
    const endpointUri = response.documentEndpoint;
    // If it doesn't have gremlinEndpoint in its properties, it must be a pre-GA endpoint
    return endpointUri ? parseEndpointUrl(endpointUri) : undefined;
}

export function getPossibleGremlinEndpoints(documentEndpoint: string): IGremlinEndpoint[] {
    // E.g., given a document endpoint from Azure such as https://<graphname>.documents.azure.com:443/

    const documentSuffix = '.documents.azure.com';
    if (documentEndpoint.indexOf(documentSuffix) >= 0) {
        // Pre-GA style (Dec 2017)
        const preGAEndpoint = documentEndpoint.replace(documentSuffix, '.graphs.azure.com');

        // Post-GA style (Dec 2017)
        const postGAEndpoint = documentEndpoint.replace(documentSuffix, '.gremlin.cosmosdb.azure.com');

        return [parseEndpointUrl(postGAEndpoint), parseEndpointUrl(preGAEndpoint)];
    } else {
        console.warn(`Unexpected document URL format: ${documentEndpoint}`);
        return [parseEndpointUrl(documentEndpoint)];
    }
}

/**
 * Parses a IGremlinPoint from a URL
 * @param url An account URL such as 'https://<graphname>.documents.azure.com:443/'
 */
function parseEndpointUrl(url: string): IGremlinEndpoint {
    const [, protocol, host, , portString] = nonNullValue(url.match(/^([^:]+):\/\/([^:]+)(:([0-9]+))?\/?$/), 'urlMatch');
    console.assert(!!protocol && !!host, "Unexpected endpoint format");
    const port = parseInt(portString || "443", 10);
    console.assert(port > 0, "Unexpected port");
    return { host, port, ssl: protocol.toLowerCase() === "https" };
}
