/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as io from 'socket.io';

/**
 * Wraps SocketIO.Socket to provide type safety
 */
export class GraphViewServerSocket {
  constructor(private _socket: io.Socket) { }

  public onClientMessage(event: ClientMessage, listener: Function): void {
    this._socket.on(event, listener);
  }

  // tslint:disable-next-line:no-any
  public emitToClient(message: ServerMessage, ...args: any[]): boolean {
    // use post message

    // console.log("Message to client: " + message + " " + args.join(", "));
    return this._socket.emit(message, ...args);
  }

  public disconnect(): void {
    this._socket.disconnect();
  }
}
