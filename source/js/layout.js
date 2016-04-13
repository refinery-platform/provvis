// External
import * as d3 from 'd3';
import * as dagre from 'dagre';

// Internal
import * as models from './models';

/**
 * Module for layout.
 */

/**
 * Generic implementation for the linear time topology sort [Kahn 1962]
 * (http://en.wikipedia.org/wiki/Topological_sorting).
 * @param startNodes Array containing the starting nodes.
 * @param nodesLength Size of the nodes array.
 * @param parent The parent node.
 * @returns {Array} Topology sorted array of nodes.
 */
function topSortNodes (startNodes, nodesLength, parent) {
  const sortedNodes = [];

  /* For each successor node. */
  function handleSuccessorNodes (_curNode_) {
    let curNode = _curNode_;

    /* When the analysis layout is computed, links occur between Nodes or
     * analyses. */
    if (curNode instanceof models.Node &&
      parent instanceof models.ProvGraph) {
      curNode = curNode.parent.parent;
    }

    /* Get successors. */
    curNode.succs.values().filter(
      s => s.parent === null || s.parent === parent
    ).forEach(_succNode_ => {
      let succNode = _succNode_;

      if (succNode instanceof models.Node &&
        parent instanceof models.ProvGraph) {
        succNode = succNode.parent.parent;
      }

      /* Mark edge as removed. */
      succNode.predLinks.values().forEach(predLink => {
        /* The source node directly is an analysis. */
        let predLinkNode = null;
        if (curNode instanceof models.Analysis) {
          if (predLink.source instanceof models.Analysis) {
            predLinkNode = predLink.source;
          } else {
            predLinkNode = predLink.source.parent.parent;
          }
        } else if (curNode instanceof models.Node) {
          predLinkNode = predLink.source;
        }

        if (predLinkNode && predLinkNode.autoId === curNode.autoId) {
          predLink.l.ts.removed = true;
        }
      });

      /* When successor node has no other incoming edges,
       insert successor node into result set. */
      if (
        !succNode.predLinks.values().some(
          predLink => !predLink.l.ts.removed
        ) && !succNode.l.ts.removed
      ) {
        startNodes.push(succNode);
        succNode.l.ts.removed = true;
      }
    });
  }

  /* While the input set is not empty. */
  let i = 0;
  while (i < startNodes.length && i < nodesLength) {
    /* Remove first item. */
    const curNode = startNodes[i];

    /* And push it into result set. */
    sortedNodes.push(curNode);
    curNode.l.ts.removed = true;

    /* Get successor nodes for current node. */
    handleSuccessorNodes(curNode);
    i++;
  }

  /* Handle cyclic graphs. */
  if (startNodes.length > nodesLength) {
    return null;
  }
  return sortedNodes;
}

/**
 * Assign layers.
 * @param tsNodes Topology sorted nodes.
 * @param parent The parent node.
 */
function layerNodes (tsNodes, parent) {
  const layer = 0;
  const preds = [];

  tsNodes.forEach(n => {
    /* Get incoming predecessors. */
    n.preds.values().forEach(p => {
      if (p.parent === parent) {
        preds.push(p);
      } else if (
        p instanceof models.Node &&
        parent instanceof models.ProvGraph
      ) {
        preds.push(p.parent.parent);
      }
    });

    if (preds.length === 0) {
      n.col = layer;
    } else {
      let minLayer = layer;
      preds.forEach(p => {
        if (p.col > minLayer) {
          minLayer = p.col;
        }
      });
      n.col = minLayer + 1;
    }
  });
}

/**
 * Group nodes by layers into a 2d array.
 * @param tsNodes Topology sorted nodes.
 * @returns {Array} Layer grouped nodes.
 */
function groupNodes (tsNodes) {
  let layer = 0;
  const lgNodes = [];

  lgNodes.push([]);

  let k = 0;
  tsNodes.forEach(n => {
    if (n.col === layer) {
      lgNodes[k].push(n);
    } else if (n.col < layer) {
      lgNodes[n.col].push(n);
    } else {
      k++;
      layer++;
      lgNodes.push([]);
      lgNodes[k].push(n);
    }
  });

  return lgNodes;
}

/**
 * Reorder subanalysis layout to minimize edge crossings.
 * @param bclgNodes Barcyenter sorted, layered and grouped analysis nodes.
 * @param cell Width and height of a workflow node.
 */
function reorderSubanalysisNodes (bclgNodes, cell) {
  /* Initializations. */
  let degree = 1;
  let accCoords = 0;
  let usedCoords = [];
  let delta = 0;
  let colList = [];

  bclgNodes.forEach(l => {
    l.forEach(an => {
      usedCoords = [];
      an.children.values().forEach((san, j) => {
        degree = 1;
        accCoords = 0;
        delta = 0;

        /* Initialize subanalysis col and row attributes.
         * Only one column does exist in this view. */
        san.x = 0;
        san.y = j * cell.height;

        /* The preceding analysis marks the fixed layer. */
        if (!san.preds.empty()) {
          degree = san.preds.size();

          /* Accumulate san y-coord as well as an y-coord for each pred. */
          san.preds.values().forEach(psan => {
            accCoords += psan.y + psan.parent.y;
          });

          /* If any subanalysis within the analysis has the same barycenter
           * value, increase it by a small value. */
          if (usedCoords.indexOf(accCoords / degree) === -1) {
            san.l.bcOrder = accCoords / degree;
            usedCoords.push(accCoords / degree);
          } else {
            delta += 0.01;
            san.l.bcOrder = accCoords / degree + delta;
            usedCoords.push(accCoords / degree + delta);
          }

          /* Push into array to reorder afterwards. */
          colList.push(san);
        }
      });

      /* Sort and reorder subanalysis nodes. */
      colList.sort((a, b) => a.l.bcOrder - b.l.bcOrder).forEach(
        (d, j) => {
          d.y = j * cell.height;
        });

      /* Reset reorder list. */
      colList = [];
    });
  });

  delta = 0;

  const looseSAn = [];

  /* Reorder most left layer based on the second most left layer. */
  bclgNodes[0][0].children.values().forEach((san, j) => {
    /* Only one column does exist in this view. */
    san.x = 0;
    san.y = j * cell.height;
    accCoords = 0;
    degree = 0;

    /* Accumulate san y-coord as well as an y-coord for each pred.
     * Take analysis, subanalysis and workflow coordinates into account. */
    san.succs.values().forEach(ssan => {
      ssan.inputs.values().forEach(ni => {
        if (
          ni.preds.values().some(pni => pni.parent === san)
        ) {
          /* Prioritize subanalysis ordering over workflow node ordering. */
          accCoords += ssan.parent.y + ssan.y +
          ((ssan.y / cell.height) / 10) + ni.y;
          degree++;
        }
      });
    });

    /* Avoid zero division. */
    if (degree !== 0) {
      /* If any subanalysis within the analysis has the same barycenter value,
       * increase it by a small value. */
      if (usedCoords.indexOf(accCoords / degree) === -1) {
        san.l.bcOrder = accCoords / degree;
        usedCoords.push(accCoords / degree);
      } else {
        delta += 0.01;
        san.l.bcOrder = accCoords / degree + delta;
        usedCoords.push(accCoords / degree + delta);
      }
    } else {
      san.l.bcOrder = 0;
      looseSAn.push(san);
    }

    /* Push into array to reorder afterwards. */
    colList.push(san);
  });

  /* Sort and reorder subanalysis nodes. */
  colList.sort((a, b) => a.l.bcOrder - b.l.bcOrder);

  for (let i = 0; i < looseSAn.length / 2; i++) {
    colList.push(colList.shift());
  }

  colList.forEach((d, j) => {
    d.y = j * cell.height;
  });
}

/**
 * Dagre layout for subanalysis.
 * @param graph The provenance graph.
 * @param cell Width and height of a workflow node.
 */
function dagreWorkflowLayout (graph, cell) {
  graph.saNodes.forEach(san => {
    /* Init graph. */
    const g = new dagre.graphlib.Graph();
    g.setGraph({
      rankdir: 'LR',
      nodesep: 0,
      edgesep: 0,
      ranksep: 0,
      marginx: 0,
      marginy: 0
    });
    g.setDefaultEdgeLabel(() => ({}));

    /* Add nodes. */
    san.children.values().forEach(n => {
      g.setNode(n.autoId, {
        label: n.autoId,
        width: cell.width,
        height: cell.height
      });
    });

    /* Add edges. */
    san.links.values().forEach(l => {
      g.setEdge(l.source.autoId, l.target.autoId, {
        minlen: 0,
        weight: 1,
        width: 0,
        height: 0,
        labelpos: 'r',
        labeloffset: 10
      });
    });

    /* Compute layout. */
    dagre.layout(g);

    /* Init workflow node coords. */
    d3.entries(g._nodes).forEach(n => {
      /* TODO: Revise potential refinery database bug. */
      if (san.children.has(n.key)) {
        san.children.get(n.key).x = parseInt(n.value.x - cell.width / 2, 10);
        san.children.get(n.key).y = parseInt(n.value.y - cell.height / 2, 10);
      }
    });
  });
}

/**
 * Dagre layout for analysis.
 * @param graph The provenance Graph.
 * @param cell Grid cell.
 */
function dagreGraphLayout (graph, cell) {
  /* Init graph. */
  const g = new dagre.graphlib.Graph();
  g.setGraph({
    rankdir: 'LR',
    nodesep: 0,
    edgesep: 0,
    ranksep: 0,
    marginx: 0,
    marginy: 0
  });

  g.setDefaultEdgeLabel(() => ({}));

  /* Add nodes. */
  graph.aNodes.forEach(an => {
    g.setNode(an.autoId, {
      label: an.autoId,
      width: cell.width,
      height: cell.height
    });
  });

  /* Add edges. */
  graph.aLinks.forEach(l => {
    g.setEdge(l.source.parent.parent.autoId, l.target.parent.parent.autoId, {
      minlen: 1,
      weight: 1,
      width: 0,
      height: 0,
      labelpos: 'r',
      labeloffset: 10
    });
  });

  /* Compute layout. */
  dagre.layout(g);

  const dlANodes = d3.entries(g._nodes);
  graph.aNodes.forEach(an => {
    an.x = parseInt(
      dlANodes.filter(
        d => d.key === an.autoId.toString()
      )[0].value.x - cell.width / 2, 10
    );
    an.y = parseInt(
      dlANodes.filter(
        d => d.key === an.autoId.toString()
      )[0].value.y - cell.height / 2, 10
    );
  });
}

/**
 * Main layout module function.
 * @param graph The main graph object of the provenance visualization.
 * @param cell Width and height of a workflow node.
 */
function runLayoutPrivate (graph, cell) {
  /* Graph layout. */
  dagreGraphLayout(graph, cell);

  /* Workflow layout. */
  dagreWorkflowLayout(graph, cell);

  /* Analysis layout:
   * Topology sort first, followed by layering and the creation of a 2d-array.
   * Subanalysis may then be reorderd based on their preceding analysis node
   * positions. */
  let bclgNodes = [];
  let startANodes = [];
  startANodes.push(graph.dataset);
  let tsANodes = topSortNodes(startANodes, graph.aNodes.length, graph);

  if (tsANodes !== null) {
    layerNodes(tsANodes, graph);

    startANodes = [];
    startANodes.push(graph.dataset);
    graph.aNodes.forEach(an => {
      an.l.ts.removed = false;
    });
    graph.aLinks.forEach(al => {
      al.l.ts.removed = false;
    });
    tsANodes = topSortNodes(startANodes, graph.aNodes.length, graph);
    layerNodes(tsANodes, graph);

    bclgNodes = groupNodes(tsANodes);

    /* Analysis layout. */
    reorderSubanalysisNodes(bclgNodes, cell);
  } else {
    throw new Error('Graph is not acyclic.');
  }
  return bclgNodes;
}

/**
 * Publish module function.
 */
function run (graph, cell) {
  return runLayoutPrivate(graph, cell);
}

export default run;
