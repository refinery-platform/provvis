// External
import * as d3 from 'd3';
import * as dagre from 'dagre';

/**
 * Dagre layout including layer nodes.
 * @param graph The provenance graph.
 */
function dagreLayerLayout (graph, cell, updateNodeAndLink) {
  const g = new dagre.graphlib.Graph();

  g.setGraph({
    rankdir: 'LR',
    nodesep: 0,
    edgesep: 0,
    ranksep: 0,
    marginx: 0,
    marginy: 0
  });

  g.setDefaultEdgeLabel({});

  let curWidth = 0;
  let curHeight = 0;

  graph.lNodes.values().forEach(ln => {
    curWidth = cell.width;
    curHeight = cell.height;

    g.setNode(ln.autoId, {
      label: ln.autoId,
      width: curWidth,
      height: curHeight
    });
  });

  graph.lLinks.values().forEach(l => {
    g.setEdge(l.source.autoId, l.target.autoId, {
      minlen: 1,
      weight: 1,
      width: 0,
      height: 0,
      labelpos: 'r',
      labeloffset: 0
    });
  });

  dagre.layout(g);

  const dlLNodes = d3.entries(g._nodes);
  graph.lNodes.values().forEach(ln => {
    curWidth = cell.width;
    curHeight = cell.height;

    ln.x = dlLNodes
      .filter(d => d.key === ln.autoId.toString())[0].value.x - curWidth / 2;

    ln.y = dlLNodes
      .filter(d => d.key === ln.autoId.toString())[0].value.y - curHeight / 2;

    updateNodeAndLink(ln, d3.select('#gNodeId-' + ln.autoId));
  });
}

export default dagreLayerLayout;
