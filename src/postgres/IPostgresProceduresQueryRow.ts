/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface IPostgresProceduresQueryRow {
    schema: string;
    name: string;
    args: string;
    oid: number;
    definition: string;
}
