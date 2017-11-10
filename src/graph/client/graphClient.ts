import { error } from "util";

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Do not add any imports do this file, they will not work since they're not hosted in a Node.js process.
 * Dependencies must be added to graphClient.html as script includes.
 *
 * Client code should be kept small.
 */

declare let d3: any;

const animationStepMs = 50;
const graphWidth = 1200, graphHeight = 500;
const defaultQuery = "g.V()";
const maxNodes = 300;
const maxEdges = 1000;

let htmlElements: {
  debugLog: HTMLTextAreaElement,
  graphRadio: HTMLInputElement,
  graphSection: HTMLDivElement,
  jsonRadio: HTMLInputElement,
  jsonResults: HTMLTextAreaElement,
  jsonSection: HTMLDivElement,
  queryError: HTMLTextAreaElement,
  queryInput: HTMLInputElement,
  stats: HTMLSpanElement,
  title: HTMLElement
};

type State = "empty" | "querying" | "error" | "json-results" | "graph-results";

type PageState = {
  results: {
    queryResults: any[],
    edgeResults: any[]
  },
  isQueryRunning: boolean,
  errorMessage?: string,
  query: string,
  view: 'json' | 'graph'
};

window.onerror = (message) => {
  logToUI("ERROR: " + message);
};

function logToUI(s: string) {
  console.log(s);
  // let v = htmlElements.debugLog.value;
  // v += "\r\n" + s;
  // htmlElements.debugLog.value = v;
}

// results may not be nodes
interface ResultNode {
  [key: string]: any;
  id: string;
  type: "vertex" | "edge";
};

interface ResultEdge extends ResultNode {
  inV: string;  // Edge source ID
  outV: string; // Edge target ID
};

interface ResultVertex extends ResultNode {
};

interface ForceNode {
  vertex: ResultVertex;
  x: number;
  y: number;
}

interface ForceLink {
  edge: ResultEdge;
  source: ForceNode;
  target: ForceNode;
}

export class GraphClient {
  private _socket: SocketIOClient.Socket;
  private _force: any;
  private _currentQueryId = 0;
  private _graphView: boolean;

  private selectById<T extends HTMLElement>(id: string): T {
    let elem = <T>d3.select(`#${id}`)[0][0];
    console.assert(!!elem, `Could not find element with ID ${id}`)
    return elem;
  }

  constructor(port: number) {
    htmlElements = {
      debugLog: this.selectById("debugLog"),
      jsonSection: this.selectById("jsonSection"),
      graphSection: this.selectById("graphSection"),
      jsonResults: this.selectById("jsonResults"),
      queryError: this.selectById("queryError"),
      queryInput: this.selectById("queryInput"),
      stats: this.selectById("stats"),
      title: this.selectById("title"),
      graphRadio: this.selectById("graphRadio"),
      jsonRadio: this.selectById("jsonRadio")
    };

    htmlElements.queryInput.value = defaultQuery;

    this.setStateEmpty();

    this.log(`Connecting on port ${port}`);
    this._socket = io.connect(`http://localhost:${port}`);

    // setInterval(() => {
    //   this.log(`Client heartbeat on port ${port}: ${Date()}`);
    // }, 10000);

    this._socket.on('connect', (): void => {
      this.log(`Client connected on port ${port}`);
      this._socket.emit('getTitle');
    });

    this._socket.on('disconnect', (): void => {
      this.log("disconnect");
    });

    this._socket.on('setPageState', (pageState: PageState) => {
      htmlElements.queryInput.value = pageState.query;

      if (pageState.isQueryRunning) {
        this._currentQueryId = pageState.runningQueryId;
        this.setStateQuerying();
        return;
      }

      if (!pageState.errorMessage) {
        this.showResults(pageState.results.queryResults, pageState.results.edgeResults);
      } else {
        this.setStateError(pageState.errorMessage);
      }

      if (pageState.view === 'json') {
        this.selectJsonView();
      } else {
        this.selectGraphView();
      }
    });

    this._socket.on('setTitle', (title: string): void => {
      this.log(`Received title: ${title}`);
      d3.select(htmlElements.title).text(title);
    });

    this._socket.on('showResults', (queryId: number, queryResults: any[], edgeResults: any[]): void => {
      this.log(`Received results for query ${queryId} - ${queryResults.length} data points, plus ${edgeResults.length} edges`);

      if (queryId !== this._currentQueryId) {
        this.log("  Ignoring results, out of date");
      } else {
        this.showResults(queryResults, edgeResults);
      }
    });

    this._socket.on('showQueryError', (queryId: number, error: string): void => {
      this.log(`Received error for query ${queryId} - ${error}`);

      if (queryId !== this._currentQueryId) {
        this.log("  Ignoring error, out of date");
      } else {
        this.setStateError(error);
      }
    });
  }

  public getPageState() {
    this.emitToHost('getPageState');
  }

  public query(gremlin: string) {
    this._currentQueryId += 1;
    this.emitToHost("query", this._currentQueryId, gremlin);

    this.setStateQuerying();
  }

  public selectGraphView() {
    this._graphView = true;
    this.setView();
  }

  public selectJsonView() {
    this._graphView = false;
    this.setView();
  }

  public setQuery(query: string) {
    this.emitToHost('setQuery', query);
  }

  private setView() {
    htmlElements.graphRadio.checked = this._graphView;
    htmlElements.jsonRadio.checked = !this._graphView;
    d3.select(htmlElements.graphSection).classed("active", !!this._graphView);
    d3.select(htmlElements.jsonSection).classed("active", !this._graphView);
    this.emitToHost('setView', this._graphView ? 'graph' : 'json');
  }

  private emitToHost(message: string, ...args: any[]) {
    logToUI("Message to host: " + message + " " + args.join(", "));
    this._socket.emit(message, ...args);
  }

  private log(s: string) {
    if (this._socket) {
      this.emitToHost('log', s);
    }

    logToUI(s);
  }

  private setStateEmpty() {
    this._setState("empty");
  }

  private setStateQuerying() {
    this._setState("querying");
    this.clearGraph();
  }

  private setStateResults(hasGraph: boolean) {
    this._setState(hasGraph ? "graph-results" : "json-results");
  }

  private setStateError(error: any) {
    let message: string = error.message || error.toString();
    htmlElements.queryError.value = message;
    this._setState("error");
    this.clearGraph();
  }

  private _setState(state: State) {
    let fullState = `state-${state}`;
    switch (state) {
      case "graph-results":
      case "json-results":
        fullState += " state-results";
    }

    d3.select("#states").attr("class", fullState);
  }

  private showResults(queryResults: any[], edgeResults: any[]): void {
    // queryResults may contain any type of data, not just vertices or edges

    // Always show results JSON (but not edgeResults)
    htmlElements.jsonResults.value = JSON.stringify(queryResults, null, 2);
    console.log(JSON.stringify(queryResults, null, 2));

    let [vertices, edges] = this.splitVerticesAndEdges(queryResults);
    if (!vertices.length) {
      // No vertices to show, just show query JSON
      this.setStateResults(false);
      return;
    }

    // Fold in additionally-queried edges
    edges = edges.concat(edgeResults);

    this.setStateResults(true);
    this.displayGraph(vertices, edges);
  }

  private splitVerticesAndEdges(nodes: any[]): [ResultVertex[], ResultEdge[]] {
    let vertices = nodes.filter(n => n.type === "vertex");
    let edges = nodes.filter(n => n.type === "edge");
    return [vertices, edges];
  }

  private clearGraph(): void {
    d3.select(htmlElements.graphSection).select("svg").selectAll(".vertex, .edge, .label").remove();
  }

  private displayGraph(vertices: ResultVertex[], edges: ResultEdge[]) {
    try {
      this.clearGraph();

      // Set up nodes and links for the force simulation
      var nodes: ForceNode[] = vertices
        .slice(0, maxNodes) // Limit # of nodes
        .map(v => <ForceNode>{ vertex: v });
      var links: ForceLink[] = [];

      var nodesById = new Map<string, ForceNode>();
      nodes.forEach(n => nodesById.set(n.vertex.id, n));
      edges.forEach(e => {
        var source = nodesById.get(e.inV);
        var target = nodesById.get(e.outV);
        // Source/target might have been eliminated via maxVertices
        if (source && target) {
          links.push({ edge: e, source, target });
        }
      });
      nodesById = null;

      // Limit number of edges (done after determining which edges are still valid based on reduced vertex set)
      links = links.slice(0, maxEdges);

      var statsText: string = (nodes.length === vertices.length && links.length === edges.length) ?
        `Displaying all ${nodes.length} vertices and ${links.length} edges` :
        `Displaying ${nodes.length} of ${vertices.length} vertices and ${links.length} of ${edges.length} edges`;
      d3.select(htmlElements.stats).text(statsText);

      // Set up force simulation
      if (this._force) {
        this._force.stop();
      }

      this._force = d3.layout.force()
        .size([graphWidth, graphHeight])
        .nodes(nodes)
        .links(links);
      let force = this._force;

      force.gravity(1); // Makes the nodes gravitate toward the center
      force.friction(.5);

      force.linkDistance(graphWidth / 3); // edge length
      force.linkStrength(0.01); // Reduce rigidity of the links (if < 1, the full linkDistance is relaxed)
      force.charge(-3000);

      let svg = d3.select(htmlElements.graphSection).select("svg")
        .attr("height", graphHeight);

      // Allow user to drag/zoom the entire SVG
      svg = svg
        .call(d3.behavior.zoom().on("zoom", function () {
          svg.attr("transform", "translate(" + d3.event.translate + ")" + " scale(" + d3.event.scale + ")")
        }))
        .append("g");

      // Links before nodes so that links don't get drawn on top of node labels, obscuring them
      let edge = svg.selectAll(".edge")
        .data(links)
        .enter().append("line")
        .attr("class", "edge")
        ;

      // Arrow
      // svg.select('defs').selectAll('marker')
      //   .data(['end'])
      //   .enter()
      //   .append('marker')
      //   .attr('id', 'triangle')
      //   .attr('viewBox', '0 -5 10 10')
      //   .attr('refX', D3ForceGraph.MARKER_REFX) // Shift arrow so that we can see it.
      //   .attr('refY', 0)
      //   .attr('markerWidth', 6)
      //   .attr('markerHeight', 6)
      //   .attr('orient', 'auto')
      //   .attr('markerUnits', 'userSpaceOnUse') // No auto-scaling with stroke width
      //   .attr('fill', this.graphConfig.linkColor()).attr('stroke', this.graphConfig.linkColor())
      //   .append('path')
      //   .attr('d', 'M0,-5L10,0L0,5');

      // Allow user to drag nodes. Set "dragging" class while dragging.
      let vertexDrag = force.drag().on("dragstart", function () {
        d3.select(this).classed("dragging", true);

        // Make sure a drag gesture doesn't also start a zoom action
        d3.event.sourceEvent.stopPropagation();
      })
        .on("dragend", function () { d3.select(this).classed("dragging", false); });

      let label = svg.selectAll(".label")
        .data(nodes)
        .enter().append("text")
        .attr("class", "label")
        .attr("x", "10px")
        .attr("y", "2px")
        .attr('font-size', 13)
        .text((d: ForceNode) => {
          let displayText = d.vertex.id;
          return displayText;
        })
        ;

      // Nodes last so that they're always and top to be able to be dragged
      let vertex = svg.selectAll(".vertex")
        .data(nodes)
        .enter().append("circle")
        .attr("class", "vertex")
        .attr("cx", (d: ForceNode) => d.x)
        .attr("cy", (d: ForceNode) => d.y)
        .call(vertexDrag)
        ;

      force.on("tick", () => {
        // The force engine has recalculated x and y for each vertex and edge, so
        // move them in the SVG to those new positions.

        vertex
          .transition().ease("linear").duration(animationStepMs)
          .attr("cx", (d: ForceNode) => d.x)
          .attr("cy", (d: ForceNode) => d.y)
          ;

        edge
          .transition().ease("linear").duration(animationStepMs)
          .attr("x1", (d: ForceLink) => d.source.x)
          .attr("y1", (d: ForceLink) => d.source.y)
          .attr("x2", (d: ForceLink) => d.target.x)
          .attr("y2", (d: ForceLink) => d.target.y)
          ;

        label
          .transition().ease("linear").duration(animationStepMs)
          .attr("class", "label")
          .attr("dx", (d: ForceNode) => d.x)
          .attr("dy", (d: ForceNode) => d.y)
          ;
      });

      force.start();
    } catch (err) {
      this.log(err);
    }
  }
}
