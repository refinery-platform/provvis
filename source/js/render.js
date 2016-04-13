/* eslint no-use-before-define:0 default-case:0 */

// External
import * as $ from '$';
import * as d3 from 'd3';
import * as dagre from 'dagre';
// This is defined in Refinery's legacy code. See:
// https://github.com/parklab/refinery-platform/blob/develop/refinery/static/source/js/refinery/solr/solr_response.js
import * as SolrResponse from 'SolrResponse';

// Internal
import {
  customTimeFormat,
  getLayerPredCount,
  getLayerSuccCount,
  hideChildNodes,
  parseISOTimeFormat,
  propagateNodeSelection
} from './helpers';
import * as models from './models';

/**
 * Module for render.
 */
let vis = Object.create(null);
let cell = Object.create(null);

/* Initialize dom elements. */
let lNode = Object.create(null);
let aNode = Object.create(null);
let saNode = Object.create(null);
let node = Object.create(null);
let domNodeset = [];
let link = Object.create(null);
let aLink = Object.create(null);
let saLink = Object.create(null);
let analysis = Object.create(null);
let subanalysis = Object.create(null);
let layer = Object.create(null);
let hLink = Object.create(null);
let lLink = Object.create(null);
let saBBox = Object.create(null);
let aBBox = Object.create(null);
let lBBox = Object.create(null);

let timeColorScale = Object.create(null);
let filterAction = Object.create(null);
let filterMethod = 'timeline';
let timeLineGradientScale = Object.create(null);

let lastSolrResponse = Object.create(null);

let selectedNodeSet = d3.map();

let draggingActive = false;

const nodeLinkTransitionTime = 1000;

let aNodesBAK = [];
let saNodesBAK = [];
let nodesBAK = [];
let aLinksBAK = [];
let lLinksBAK = d3.map();
let lNodesBAK = d3.map();

let scaleFactor = 0.75;

let layoutCols = d3.map();

const linkStyle = 'bezier1';

let colorStrokes = '#136382';
let colorHighlight = '#ed7407';

let fitToWindow = true;

let doiDiffScale = Object.create(null);

let doiAutoUpdate = false;

/* Simple tooltips by NG. */
const tooltip = d3.select('body')
  .append('div')
  .attr('class', 'refinery-tooltip')
  .style('position', 'absolute')
  .style('z-index', '10')
  .style('visibility', 'hidden');

/**
 * For a node, get first visible parent node coords.
 * @param curN Node to start traversing to its parents.
 * @returns {{x: number, y: number}} X and y coordinates of the first visible
 * parent node.
 */
function getVisibleNodeCoords (_curN_) {
  let curN = _curN_;
  let x = 0;
  let y = 0;

  while (curN.hidden && !(curN instanceof models.Layer)) {
    curN = curN.parent;
  }

  if (curN instanceof models.Layer) {
    x = curN.x;
    y = curN.y;
  } else {
    while (!(curN instanceof models.Layer)) {
      x += curN.x;
      y += curN.y;
      curN = curN.parent;
    }
  }

  return { x, y };
}

/**
 * Update link through translation while dragging or on dragend.
 * @param n Node object element.
 */
function updateLink (n) {
  const predLinks = d3.map();
  const succLinks = d3.map();

  /* Get layer and/or analysis links. */
  switch (n.nodeType) {
    case 'layer':
      n.predLinks.values().forEach(pl => {
        predLinks.set(pl.autoId, pl);
      });
      n.succLinks.values().forEach(sl => {
        succLinks.set(sl.autoId, sl);
      });
      n.children.values().forEach(an => {
        an.predLinks.values().forEach(pl => {
          predLinks.set(pl.autoId, pl);
        });
        an.succLinks.values().forEach(sl => {
          succLinks.set(sl.autoId, sl);
        });
      });
      break;
    case 'analysis':
      n.predLinks.values().forEach(pl => {
        predLinks.set(pl.autoId, pl);
      });
      n.succLinks.values().forEach(sl => {
        succLinks.set(sl.autoId, sl);
      });
      break;
  }

  /* Get input links and update coordinates for x2 and y2. */
  predLinks.values().forEach(l => {
    d3.selectAll('#linkId-' + l.autoId + ', #hLinkId-' + l.autoId)
      .classed('link-transition', true)
      .transition()
      .duration(draggingActive ? 0 : nodeLinkTransitionTime)
      .attr('d', ll => {
        const srcCoords = getVisibleNodeCoords(ll.source);
        const tarCoords = getVisibleNodeCoords(ll.target);

        if (linkStyle === 'bezier1') {
          return drawBezierLink(ll, srcCoords.x, srcCoords.y, tarCoords.x,
            tarCoords.y);
        }
        return drawStraightLink(
          ll, srcCoords.x, srcCoords.y, tarCoords.x, tarCoords.y
        );
      });

    setTimeout(() => {
      d3.selectAll('#linkId-' + l.autoId + ', #hLinkId-' + l.autoId)
        .classed('link-transition', false);
    }, nodeLinkTransitionTime);
  });

  /* Get output links and update coordinates for x1 and y1. */
  succLinks.values().forEach(l => {
    d3.selectAll('#linkId-' + l.autoId + ', #hLinkId-' + l.autoId)
      .classed('link-transition', true)
      .transition()
      .duration(draggingActive ? 0 : nodeLinkTransitionTime)
      .attr('d', ll => {
        const tarCoords = getVisibleNodeCoords(ll.target);
        const srcCoords = getVisibleNodeCoords(ll.source);

        if (linkStyle === 'bezier1') {
          return drawBezierLink(
            ll, srcCoords.x, srcCoords.y, tarCoords.x, tarCoords.y
          );
        }
        return drawStraightLink(
          ll, srcCoords.x, srcCoords.y, tarCoords.x, tarCoords.y
        );
      });

    setTimeout(() => {
      d3.selectAll('#linkId-' + l.autoId + ', #hLinkId-' + l.autoId)
        .classed('link-transition', false);
    }, nodeLinkTransitionTime);
  });
}

/**
 * Update node coordinates through translation.
 * @param dom Node dom element.
 * @param n Node object element.
 * @param x The current x-coordinate for the node.
 * @param y The current y-coordinate for the node.
 */
function updateNode (dom, n, x, y) {
  /* Set selected node coordinates. */
  dom.transition()
    .duration(draggingActive ? 0 : nodeLinkTransitionTime)
    .attr('transform', 'translate(' + x + ',' + y + ')');
}

/* TODO: On facet filter reset button, reset filter as well. */
/**
 * Update filtered nodes.
 */
function updateNodeFilter () {
  /* Hide or blend (un)selected nodes. */

  /* Layers. */
  layer.each(ln => {
    const self = d3.select(this).select('#nodeId-' + ln.autoId);
    if (!ln.filtered) {
      /* Blend/Hide layer node. */
      self.classed('filteredNode', false)
        .classed('blendedNode', filterAction === 'blend');
      d3.select('#BBoxId-' + ln.autoId).classed('hiddenBBox', true);
    } else {
      self.classed('filteredNode', true).classed('blendedNode', false);
      if (!ln.hidden) {
        d3.select('#BBoxId-' + ln.autoId).classed('hiddenBBox', false);
      }
    }
  });

  /* Analyses and child nodes. */
  analysis.each(an => {
    const self = d3.select(this).select('#nodeId-' + an.autoId);
    if (!an.filtered) {
      /* Blend/Hide analysis. */
      self.classed('filteredNode', false)
        .classed('blendedNode', filterAction === 'blend');
      d3.select('#BBoxId-' + an.autoId).classed('hiddenBBox', true);

      /* Update child nodes. */
      an.children.values().forEach(san => {
        d3.select('#nodeId-' + san.autoId)
          .classed('filteredNode', false)
          .classed('blendedNode', filterAction === 'blend');

        san.children.values().forEach(n => {
          d3.select('#nodeId-' + n.autoId)
            .classed('filteredNode', false)
            .classed('blendedNode', filterAction === 'blend');
        });
      });
    } else {
      /* Update child nodes. */
      an.children.values().forEach(san => {
        d3.select('#nodeId-' + san.autoId)
          .classed('filteredNode', true)
          .classed('blendedNode', false);
        san.children.values().forEach(n => {
          if (n.filtered) {
            d3.select('#nodeId-' + n.autoId)
              .classed('filteredNode', true)
              .classed('blendedNode', false);
          } else {
            d3.select('#nodeId-' + n.autoId)
              .classed('filteredNode', false)
              .classed('blendedNode', false);
          }
        });

        if (
          an.children.values().some(sann => !sann.hidden) ||
          an.children.values()
            .some(sann => sann.children.values()
            .some(n => !n.hidden))
        ) {
          d3.select('#BBoxId-' + an.autoId).classed('hiddenBBox', false);
        }
      });

      if (!an.hidden) {
        d3.select('#BBoxId-' + an.autoId).classed('hiddenBBox', false);
      }

      /* Display analysis. */
      self.classed('filteredNode', true).classed('blendedNode', false);
    }
  });
}

/**
 * Update filtered links.
 */
function updateLinkFilter () {
  saLink.classed('filteredLink', false);

  saNode.each(san => {
    if (!san.filtered) {
      san.links.values().forEach(l => {
        d3.selectAll('#linkId-' + l.autoId + ', #hLinkId-' + l.autoId)
          .classed('filteredLink', false);
        if (filterAction === 'blend') {
          d3.selectAll('#linkId-' + l.autoId + ', #hLinkId-' + l.autoId)
            .classed('blendedLink', true);
        } else {
          d3.selectAll('#linkId-' + l.autoId + ', #hLinkId-' + l.autoId)
            .classed('blendedLink', false);
        }
      });
    } else {
      san.links.values().forEach(l => {
        d3.selectAll('#linkId-' + l.autoId + ', #hLinkId-' + l.autoId)
          .classed({
            filteredLink: true,
            blendedLink: false
          });
      });
    }
  });
}

/* TODO: Code cleanup. */
/* TODO: Add transitions to bounding boxes. */
/**
 * Sets the visibility of links and (a)nodes when collapsing or expanding
 * analyses.
 * @param d Node.
 * @param keyStroke Keystroke being pressed at mouse click.
 * @param trigger Function triggered by user interaction or automatic
 * doi-function.
 */
function handleCollapseExpandNode (d, keyStroke, _trigger_) {
  const trigger = typeof _trigger_ !== 'undefined' ? _trigger_ : 'user';

  let anBBoxCoords = Object.create(null);
  let wfBBoxCoords = Object.create(null);
  let siblings = [];

  /* Expand. */
  if (keyStroke === 'e' && (d.nodeType === 'layer' ||
    d.nodeType === 'analysis' || d.nodeType === 'subanalysis')) {
    /* Set node visibility. */
    d3.select('#nodeId-' + d.autoId).classed('hiddenNode', true);
    d.hidden = true;
    d.children.values().forEach(cn => {
      d3.select('#nodeId-' + cn.autoId).classed('hiddenNode', false);
      cn.hidden = false;
      hideChildNodes(cn);
    });

    /* Set link visibility. */
    if (d.nodeType === 'subanalysis') {
      d.links.values().forEach(l => {
        l.hidden = false;
        d3.select('#linkId-' + l.autoId).classed('hiddenLink', false);
        if (l.highlighted) {
          d3.select('#hLinkId-' + l.autoId).classed('hiddenLink', false);
        }
      });
    } else if (d.nodeType === 'analysis') {
      d.children.values().forEach(san => {
        san.links.values().forEach(l => {
          l.hidden = true;
          d3.select('#linkId-' + l.autoId).classed('hiddenLink', true);
          if (l.highlighted) {
            d3.select('#hLinkId-' + l.autoId).classed('hiddenLink', true);
          }
        });
      });
    } else {
      /* Hide layer links. */
      d.predLinks.values().forEach(pl => {
        pl.hidden = true;
        d3.select('#linkId-' + pl.autoId).classed('hiddenLink', true);
        if (pl.highlighted) {
          d3.select('#hLinkId-' + pl.autoId).classed('hiddenLink', true);
        }
      });
      d.succLinks.values().forEach(sl => {
        sl.hidden = true;
        d3.select('#linkId-' + sl.autoId).classed('hiddenLink', true);
        if (sl.highlighted) {
          d3.select('#hLinkId-' + sl.autoId).classed('hiddenLink', true);
        }
      });
    }

    /* Set analysis/layer connecting links visibility. */
    d.inputs.values().forEach(sain => {
      sain.predLinks.values().forEach(l => {
        d3.select('#linkId-' + l.autoId).classed('hiddenLink', false);
        if (l.highlighted) {
          d3.select('#hLinkId-' + l.autoId).classed('hiddenLink', false);
        }
        l.hidden = false;
      });
    });
    d.outputs.values().forEach(saon => {
      saon.succLinks.values().forEach(l => {
        d3.select('#linkId-' + l.autoId).classed('hiddenLink', false);
        if (l.highlighted) {
          d3.select('#hLinkId-' + l.autoId).classed('hiddenLink', false);
        }
        l.hidden = false;
      });
    });

    if (d.nodeType === 'subanalysis') {
      /* Set saBBox visibility. */
      d3.select('#BBoxId-' + d.autoId).classed('hiddenBBox', false);

      /* Update. */
      wfBBoxCoords = getWFBBoxCoords(d, 0);
      d.x = 0;
      updateLink(d.parent);
      updateNode(d3.select('#gNodeId-' + d.autoId), d, d.x, d.y);

      /* Shift sibling subanalyses vertical. */
      siblings = d.parent.children.values()
        .filter(san => san !== d && san.y > d.y);
      siblings.forEach(san => {
        san.y += wfBBoxCoords.y.max - wfBBoxCoords.y.min - cell.height;
        updateNode(d3.select('#gNodeId-' + san.autoId), san, san.x, san.y);
      });

      /* Adjust analysis bounding box. */
      anBBoxCoords = getABBoxCoords(d.parent, 0);
      d3.selectAll('#BBoxId-' + d.parent.autoId + ', #aBBClipId-' +
        d.parent.autoId).selectAll('rect')
        .attr('width', anBBoxCoords.x.max - anBBoxCoords.x.min)
        .attr('height', anBBoxCoords.y.max - anBBoxCoords.y.min);

      /* Center non-expanded subanalyses horizontally. */
      d.parent.children.values()
        .filter(san => !san.hidden)
        .forEach(san => {
          san.x = (anBBoxCoords.x.max - anBBoxCoords.x.min) / 2 -
            vis.cell.width / 2;
          updateNode(d3.select('#gNodeId-' + san.autoId), san, san.x, san.y);
        });
      updateNode(d3.select('#gNodeId-' + d.autoId), d, d.x, d.y);
    } else if (d.nodeType === 'analysis') {
      /* Adjust analysis bounding box. */
      anBBoxCoords = getABBoxCoords(d, 0);
      d3.select('#BBoxId-' + d.autoId).select('rect')
        .attr('width', anBBoxCoords.x.max - anBBoxCoords.x.min)
        .attr('height', anBBoxCoords.y.max - anBBoxCoords.y.min);

      /* Update. */
      updateLink(d);
      updateNode(d3.select('#gNodeId-' + d.autoId), d, d.x, d.y);
    } else {
      d.children.values()
        .filter(an => an.filtered)
        .forEach(an => {
          d3.select('#BBoxId-' + an.autoId).classed('hiddenBBox', false);

          /* Hide workflow links. */
          an.links.values().forEach(l => {
            d3.selectAll('#linkId-' + l.autoId + ',#hLinkId-' + l.autoId)
              .classed('hiddenLink', true);
          });

          /* Hide workflow bounding box. */
          an.children.values().forEach(san => {
            d3.select('#BBoxId-' + san.autoId).classed('hiddenBBox', true);
          });

          /* Adjust bounding box. */
          anBBoxCoords = getABBoxCoords(an, 0);
          d3.selectAll('#BBoxId-' + an.autoId + ', #aBBClipId-' + an.autoId)
            .select('rect')
            .attr('width', cell.width)
            .attr('height', cell.height);
        });

      /* Update. */
      updateLink(d);
      updateNode(d3.select('#gNodeId-' + d.autoId), d, d.x, d.y);
    }
  } else if (keyStroke === 'c' && d.nodeType !== 'layer') {
    /* Collapse. */
    /* Collapse subanalyses. */
    if (d.nodeType === 'subanalysis') {
      d.parent.children.values().forEach(san => {
        d3.select('#BBoxId-' + san.autoId).classed('hiddenBBox', true);
      });
    } else if (d.nodeType === 'analysis') {
      d.parent.children.values().forEach(an => {
        d3.select('#BBoxId-' + an.autoId).classed('hiddenBBox', true);
        an.exaggerated = false;
      });

      /* Set layer label and bounding box. */
      d3.select('#nodeId-' + d.parent.autoId).select('g.labels')
        .select('.lLabel')
        .text(d.children.size() + '/' + d.children.size());

      /* Hide bounding boxes. */
      d3.select('#BBoxId-' + d.parent.autoId).classed('hiddenBBox', false);
      d.parent.children.values().forEach(an => {
        an.children.values().forEach(san => {
          d3.select('#BBoxId-' + san.autoId).classed('hiddenBBox', true);
        });
      });
    } else {
      /* Collapse workflow. */
      if (d.hidden === false) {
        /* Shift sibling subanalyses vertical. */
        wfBBoxCoords = getWFBBoxCoords(d.parent, 0);
        siblings = d.parent.parent.children.values().filter(
          san => san !== d.parent && san.y > d.parent.y
        );
        siblings.forEach(san => {
          san.y -= wfBBoxCoords.y.max - wfBBoxCoords.y.min - cell.height;
          updateNode(d3.select('#gNodeId-' + san.autoId), san, san.x, san.y);
        });

        if (
          d.parent.parent.children
            .values()
            .filter(san => san !== d.parent)
            .some(san => san.hidden)
        ) {
          anBBoxCoords = getABBoxCoords(d.parent.parent, 0);
          d.parent.x = (anBBoxCoords.x.max - anBBoxCoords.x.min) / 2 -
            vis.cell.width / 2;
          updateNode(d3.select('#gNodeId-' + d.parent.autoId),
            d.parent, d.parent.x, d.parent.y);
        }

        if (
          d.parent.parent.children
            .values()
            .filter(san => san !== d.parent)
            .every(san => !san.hidden)
        ) {
          d.parent.parent.children.values().forEach(san => {
            san.x = 0;
            updateNode(d3.select('#gNodeId-' + san.autoId), san, san.x,
              san.y);
          });
        }
      }
    }

    /* Set node visibility. */
    d.parent.hidden = false;
    d3.select('#nodeId-' + d.parent.autoId).classed('hiddenNode', false);
    hideChildNodes(d.parent);

    /* Set saBBox visibility. */
    if (d.nodeType === 'subanalysis') {
      d3.select('#BBoxId-' + d.autoId).classed('hiddenBBox', true);
    } else if (d.nodeType === 'analysis') {
      if (!d.parent.filtered) {
        d3.select('#BBoxId-' + d.parent.autoId).classed('hiddenBBox', true);
      }
    } else {
      d3.select('#BBoxId-' + d.parent.autoId).classed('hiddenBBox', true);
    }

    /* Set link visibility. */
    d.parent.links.values().forEach(l => {
      d3.selectAll('#linkId-' + l.autoId + ', #hLinkId-' + l.autoId)
        .classed('hiddenLink', true);
      l.hidden = true;
    });
    d.parent.inputs.values().forEach(sain => {
      sain.predLinks.values().forEach(l => {
        d3.select('#linkId-' + l.autoId).classed('hiddenLink', false);
        if (l.highlighted) {
          d3.select('#hLinkId-' + l.autoId).classed('hiddenLink', false);
        }
        l.hidden = false;
      });
    });
    d.parent.outputs.values().forEach(saon => {
      saon.succLinks.values().forEach(l => {
        d3.select('#linkId-' + l.autoId).classed('hiddenLink', false);
        if (l.highlighted) {
          d3.select('#hLinkId-' + l.autoId).classed('hiddenLink', false);
        }
        l.hidden = false;
      });
    });

    if (d.nodeType === 'subanalysis') {
      /* Resize analysis bounding box. */
      d3.selectAll('#BBoxId-' + d.parent.autoId + ', #aBBClipId-' +
        d.parent.autoId).selectAll('rect')
        .attr('width', cell.width)
        .attr('height', cell.height);

      /* Update links. */
      updateLink(d.parent);
    } else if (d.nodeType === 'analysis') {
      /* Check layer Links. */
      d.parent.predLinks.values().forEach(pl => {
        if (!pl.source.hidden) {
          pl.hidden = false;
        }
      });
      d.parent.succLinks.values().forEach(sl => {
        if (!sl.target.hidden) {
          sl.hidden = false;
        }
      });

      updateLink(d.parent);
      updateNode(d3.select('#gNodeId-' + d.parent.autoId), d.parent,
        d.parent.x, d.parent.y);
    } else {
      /* Set saBBox visibility. */
      d3.select('#BBoxId-' + d.parent.autoId).classed('hiddenBBox', true);

      /* Update. */
      updateLink(d.parent.parent);
      updateNode(d3.select('#gNodeId-' + d.parent.parent.autoId),
        d.parent.parent, d.parent.parent.x, d.parent.parent.y);

      /* Compute bounding box for analysis child nodes. */
      anBBoxCoords = getABBoxCoords(d.parent.parent, 0);

      /* Adjust analysis bounding box. */
      d3.selectAll('#BBoxId-' + d.parent.parent.autoId + ', #aBBClipId-' +
        d.parent.parent.autoId).selectAll('rect')
        .attr('width', anBBoxCoords.x.max - anBBoxCoords.x.min)
        .attr('height', anBBoxCoords.y.max - anBBoxCoords.y.min);

      /* If the selected subanalysis is the last remaining to collapse,
       adjust bounding box and clippath. */
      if (!d.parent.parent.children.values().some(san => san.hidden)) {
        /* Compute bounding box for analysis child nodes. */
        anBBoxCoords = getABBoxCoords(d.parent.parent, 0);

        /* Adjust analysis bounding box. */
        d3.select('#BBoxId-' + d.parent.parent.autoId).select('rect')
          .attr('width', anBBoxCoords.x.max - anBBoxCoords.x.min)
          .attr('height', anBBoxCoords.y.max - anBBoxCoords.y.min);

        /* Adjust clippath. */
        d3.select('#aBBClipId-' + d.parent.parent.autoId).select('rect')
          .attr('width', cell.width)
          .attr('height', cell.height + 2 * scaleFactor * vis.radius)
          .attr('rx', cell.width / 7)
          .attr('ry', cell.height / 7);
      }
      /* Update links. */
      updateLink(d.parent.parent);
    }
  }

  if (trigger === 'user') {
    /* Recompute layout. */
    dagreDynamicLayerLayout(vis.graph);

    if (fitToWindow) {
      fitGraphToWindow(nodeLinkTransitionTime);
    }
  }
}

/* TODO: Code cleanup. */
/**
 * On doi change, update node doi labels.
 */
function updateNodeDoi () {
  /**
   * Helper function to check whether every parent node is hidden.
   * @param n BaseNode
   * @returns {boolean} Returns true if any parent node is visible.
   */
  function allParentsHidden (n) {
    let cur = n;

    while (!(cur instanceof models.Layer)) {
      if (!(cur instanceof models.Layer) && !cur.parent.hidden) {
        return false;
      }
      cur = cur.parent;
    }

    return true;
  }

  /* Update node doi label. */
  domNodeset.select('.nodeDoiLabel').text(d => d.doi.doiWeightedSum);

  /* On layer doi. */
  vis.graph.lNodes.values().forEach(ln => {
    if (ln.doi.doiWeightedSum >= (1 / 4) && !ln.hidden && ln.filtered) {
      /* Expand. */
      handleCollapseExpandNode(ln, 'e', 'auto');
    }
  });

  /* On analysis doi. */
  vis.graph.aNodes.forEach(an => {
    if (an.doi.doiWeightedSum >= (2 / 4) && !an.hidden && an.filtered) {
      /* Expand. */
      handleCollapseExpandNode(an, 'e', 'auto');
    } else if (an.doi.doiWeightedSum < (1 / 4) && !an.hidden &&
      an.parent.children.size() > 1) {
      /* Collapse. */
      handleCollapseExpandNode(an, 'c', 'auto');

      if (an.parent.filtered) {
        /* Only collapse those analysis nodes into the layered node which
         * are below the threshold. */
        an.parent.children.values().forEach(d => {
          if (d.doi.doiWeightedSum >= (1 / 4)) {
            d.exaggerated = true;

            d.hidden = false;
            d3.select('#nodeId-' + d.autoId).classed('hiddenNode', false);
            updateLink(d);

            if (d.doi.doiWeightedSum >= (2 / 4) && !d.hidden && d.filtered) {
              /* Expand. */
              handleCollapseExpandNode(d, 'e', 'auto');
            }
          } else {
            d.exaggerated = false;
            d.hidden = true;
            d3.select('#nodeId-' + an.autoId).classed('hiddenNode', true);
          }
        });
      }
    }
  });

  /* On node doi. */
  vis.graph.saNodes.forEach(san => {
    const maxDoi = d3.max(san.children.values(), n => n.doi.doiWeightedSum);
    if (maxDoi < (3 / 4) && (allParentsHidden(san.children.values()[0]) ||
      san.parent.exaggerated)) {
      /* Collapse. */
      handleCollapseExpandNode(san.children.values()[0], 'c', 'auto');
    }
  });

  /* On subanalysis doi. */
  vis.graph.saNodes.forEach(san => {
    const maxDoi = d3.max(
      san.parent.children.values(), cn => cn.doi.doiWeightedSum
    );

    if (san.doi.doiWeightedSum >= (3 / 4) && !san.hidden && san.filtered) {
      /* Expand. */
      handleCollapseExpandNode(san, 'e', 'auto');
    } else if (maxDoi < (2 / 4) && (allParentsHidden(san) ||
      san.parent.exaggerated)) {
      /* Collapse. */
      handleCollapseExpandNode(san, 'c', 'auto');
    }
  });

  /* Recompute layout. */
  dagreDynamicLayerLayout(vis.graph);

  if (fitToWindow) {
    fitGraphToWindow(nodeLinkTransitionTime);
  }
}

/**
 * Make tooltip visible and align it to the events position.
 * @param label Inner html code appended to the tooltip.
 * @param event E.g. mouse event.
 */
function showTooltip (label, event) {
  tooltip.html(label);
  tooltip.style('visibility', 'visible');
  tooltip.style('top', (event.pageY + 10) + 'px');
  tooltip.style('left', (event.pageX + 10) + 'px');
}

/**
 * Hide tooltip.
 */
function hideTooltip () {
  tooltip.style('visibility', 'hidden');
}

/**
 * Path generator for bezier link.
 * @param l Link.
 * @param srcX Source x coordinate.
 * @param srcY Source y coordinate.
 * @param tarX Target x coordinate.
 * @param tarY Target y coordinate.
 * @returns {*} Path for link.
 */
function drawBezierLink (l, srcX, srcY, tarX, tarY) {
  let pathSegment = 'M' + (srcX) + ',' + srcY;

  if (tarX - srcX > vis.cell.width * 1.5) {
    /* Extend links in expanded columns. */
    let curN = l.source;
    let hLineSrc = srcX;

    if (l.source instanceof models.Layer ||
      l.target instanceof models.Layer ||
      l.source.parent !== l.target.parent) {
      while (!(curN instanceof models.Analysis) &&
        !(curN instanceof models.Layer)) {
        curN = curN.parent;
      }

      if (curN instanceof models.Analysis && !curN.parent.hidden &&
        l.source.hidden) {
        curN = curN.parent;
      }

      /* TODO: Revise. */
      if (l.source instanceof models.Layer && l.source.hidden) {
        hLineSrc = srcX + vis.cell.width / 2;
      } else {
        hLineSrc = getABBoxCoords(curN, 0).x.max - vis.cell.width / 2;
      }

      /* LayoutCols provides the maximum width of any potential expanded node
       * within the column of the graph. An the width difference is calculated
       * as offset and added as horizontal line to the link. */
      layoutCols.values().forEach(c => {
        if (c.nodes.indexOf(curN.autoId) !== -1) {
          const curWidth = getABBoxCoords(curN, 0).x.max -
            getABBoxCoords(curN, 0).x.min;
          const offset = (c.width - curWidth) / 2 + vis.cell.width / 2;
          if (curWidth < c.width) {
            hLineSrc = srcX + offset;
          }
        }
      });

      pathSegment = pathSegment.concat(' H' + (hLineSrc));
    }

    pathSegment = pathSegment.concat(
      ' C' + (hLineSrc + cell.width / 3) + ',' + (srcY) + ' ' +
      (hLineSrc + cell.width / 2 - cell.width / 3) + ',' + (tarY) +
      ' ' + (hLineSrc + cell.width / 2) + ',' + (tarY) + ' ' +
      'H' + (tarX));
  } else {
    pathSegment = pathSegment.concat(
      ' C' + (srcX + cell.width) + ',' + (srcY) + ' ' +
      (tarX - cell.width) + ',' + (tarY) + ' ' +
      (tarX) + ',' + (tarY) + ' ');
  }

  return pathSegment;
}

/**
 * Path generator for straight link.
 * @param l Link.
 * @param srcX Source x coordinate.
 * @param srcY Source y coordinate.
 * @param tarX Target x coordinate.
 * @param tarY Target y coordinate.
 * @returns {*} Path for link.
 */
function drawStraightLink (l, srcX, srcY, tarX, tarY) {
  let pathSegment = ' M' + srcX + ',' + srcY;
  pathSegment = pathSegment.concat(' L' + tarX + ',' + tarY);
  return pathSegment;
}

/**
 * Drag start listener support for nodes.
 */
function dragStart () {
  d3.event.sourceEvent.stopPropagation();
}

/**
 * Drag listener.
 * @param n Node object.
 */
function dragging (n) {
  const self = d3.select(this);

  /* While dragging, hide tooltips. */
  hideTooltip();

  const deltaY = d3.event.y - n.y;

  /* Set coords. */
  n.x = d3.event.x;
  n.y = d3.event.y;

  /* Drag selected node. */
  updateNode(self, n, d3.event.x, d3.event.y);

  /* Drag adjacent links. */
  updateLink(n);

  if (n instanceof models.Layer) {
    n.children.values().forEach(an => {
      an.x = n.x - (getABBoxCoords(an, 0).x.max -
        getABBoxCoords(an, 0).x.min) / 2 + vis.cell.width / 2;
      an.y += deltaY;
      updateNode(d3.select('#gNodeId-' + an.autoId), an, an.x, an.y);
      updateLink(an);
    });
  }

  draggingActive = true;
}

/**
 * Update node and link.
 * @param n Node.
 * @param dom Node as dom object.
 */
function updateNodeAndLink (n, dom) {
  const self = dom;

  /* Align selected node. */
  updateNode(self, n, n.x, n.y);

  /* Align adjacent links. */
  updateLink(n);

  if (n instanceof models.Layer) {
    n.children.values().forEach(an => {
      updateNode(d3.select('#gNodeId-' + an.autoId), an, an.x, an.y);
      updateLink(an);
    });
  }
}

/**
 * Drag end listener.
 */
function dragEnd (n) {
  if (draggingActive) {
    const self = d3.select(this);

    /* Update node and adjacent links. */
    updateNodeAndLink(n, self);

    /* Prevent other mouseevents during dragging. */
    setTimeout(() => {
      draggingActive = false;
    }, 200);
  }
}

/**
 * Sets the drag events for nodes.
 * @param nodeType The dom nodeset to allow dragging.
 */
function applyDragBehavior (domDragSet) {
  /* Drag and drop node enabled. */
  const drag = d3.behavior.drag()
    .origin(d => d)
    .on('dragstart', dragStart)
    .on('drag', dragging)
    .on('dragend', dragEnd);

  /* Invoke dragging behavior on nodes. */
  domDragSet.call(drag);
}

/* TODO: Update to incorporate facet filtering and adjust link visibility
 * on loose graphs. */
/**
 * Filter analyses by time gradient timeline view.
 * @param lowerTimeThreshold The point of time where analyses executed before
 * are hidden.
 * @param upperTimeThreshold The point of time where analyses executed after
 * are hidden.
 * @param vis The provenance visualization root object.
 */
function filterAnalysesByTime (lowerTimeThreshold, upperTimeThreshold, _vis_) {
  _vis_.graph.lNodes = lNodesBAK;
  _vis_.graph.aNodes = aNodesBAK;
  _vis_.graph.saNodes = saNodesBAK;
  _vis_.graph.nodes = nodesBAK;
  _vis_.graph.aLinks = aLinksBAK;
  _vis_.graph.lLinks = lLinksBAK;

  const selAnalyses = _vis_.graph.aNodes.filter(an => {
    upperTimeThreshold.setSeconds(upperTimeThreshold.getSeconds() + 1);
    return parseISOTimeFormat(an.start) >= lowerTimeThreshold &&
    parseISOTimeFormat(an.start) <= upperTimeThreshold;
  });

  /* Set (un)filtered analyses. */
  _vis_.graph.aNodes.forEach(an => {
    if (selAnalyses.indexOf(an) === -1) {
      an.filtered = false;
      an.children.values().forEach(san => {
        san.filtered = false;
        san.children.values().forEach(n => { n.filtered = false; });
      });
    } else {
      an.filtered = true;
      an.children.values().forEach(san => {
        san.filtered = true;
        san.children.values().forEach(n => { n.filtered = true; });
      });
    }
  });

  /* Update analysis filter attributes. */
  _vis_.graph.aNodes.forEach(an => {
    if (an.children.values().some(san => san.filtered)) {
      an.filtered = true;
    } else {
      an.filtered = false;
    }
    an.doi.filteredChanged();
  });

  /* Update layer filter attributes. */
  _vis_.graph.lNodes.values().forEach(ln => {
    if (ln.children.values().some(an => an.filtered)) {
      ln.filtered = true;
    } else {
      ln.filtered = false;
    }
    ln.doi.filteredChanged();
  });

  /* Update analysis link filter attributes. */
  _vis_.graph.aLinks.forEach(al => {
    al.filtered = false;
  });
  _vis_.graph.aLinks.filter(al =>
    al.source.parent.parent.filtered &&
    al.target.parent.parent.filtered
  ).forEach(al => {
    al.filtered = true;
  });
  _vis_.graph.lLinks.values().forEach(ll => {
    ll.filtered = false;
  });
  _vis_.graph.lLinks.values().filter(
    ll => ll.source.filtered && ll.target.filtered
  ).forEach(ll => { ll.filtered = true; });

  /* On filter action 'hide', splice and recompute graph. */
  if (filterAction === 'hide') {
    /* Update filtered nodesets. */
    const cpyLNodes = d3.map();
    _vis_.graph.lNodes.entries().forEach(ln => {
      if (ln.value.filtered) {
        cpyLNodes.set(ln.key, ln.value);
      }
    });
    _vis_.graph.lNodes = cpyLNodes;
    _vis_.graph.aNodes = _vis_.graph.aNodes.filter(an => an.filtered);
    _vis_.graph.saNodes = _vis_.graph.saNodes.filter(san => san.filtered);
    _vis_.graph.nodes = _vis_.graph.nodes.filter(n => n.filtered);

    /* Update filtered linksets. */
    _vis_.graph.aLinks = _vis_.graph.aLinks.filter(al => al.filtered);

    /* Update layer links. */
    const cpyLLinks = d3.map();
    _vis_.graph.lLinks.entries().forEach(ll => {
      if (ll.value.filtered) {
        cpyLLinks.set(ll.key, ll.value);
      }
    });
    _vis_.graph.lLinks = cpyLLinks;
  }

  dagreDynamicLayerLayout(_vis_.graph);

  if (fitToWindow) {
    fitGraphToWindow(nodeLinkTransitionTime);
  }

  updateNodeFilter();
  updateLinkFilter();
  updateAnalysisLinks(_vis_.graph);
  updateLayerLinks(_vis_.graph.lLinks);

  _vis_.graph.aNodes.forEach(an => {
    updateLink(an);
  });
  _vis_.graph.lNodes.values().forEach(ln => {
    updateLink(ln);
  });

  /* TODO: Temporarily enabled. */
  if (doiAutoUpdate) {
    recomputeDOI();
  }
}

/**
 * Draws the timeline view.
 * @param vis The provenance visualization root object.
 */
function drawTimelineView (_vis_) {
  const svg = d3.select('#provenance-timeline-view').select('svg')
    .append('g')
      .append('g')
        .attr('transform', 'translate(20,0)');

  const tlHeight = 50;
  const tlWidth = 250;

  const x = d3.scale.linear()
    .domain([0, tlWidth])
    .range([0, tlWidth]);

  const y = d3.scale.linear()
    .domain([5, 0])
    .range([0, tlHeight - 10]);

  timeLineGradientScale = d3.time.scale()
    .domain([Date.parse(timeColorScale.domain()[0]),
      Date.parse(timeColorScale.domain()[1])])
    .range([0, tlWidth])
    .nice();

  const xAxis = d3.svg.axis()
    .scale(timeLineGradientScale)
    .orient('bottom')
    .ticks(5);

  const yAxis = d3.svg.axis()
    .scale(y)
    .orient('left')
    .ticks(7);

  const tlTickCoords = d3.map();

  aNodesBAK.forEach(an => {
    tlTickCoords.set(an.autoId,
      timeLineGradientScale(parseISOTimeFormat(an.start)));
  });

  /**
   * Drag start listener support for time lines.
   */
  function dragLineStart () {
    d3.event.sourceEvent.stopPropagation();
  }

  /**
   * Get lower and upper date threshold date in timeline view.
   * @param l Time line.
   * @returns {Array} An array of size 2 containing both the lower and upper
   * threshold date.
   */
  function getTimeLineThresholds (l) {
    let lowerTimeThreshold = Object.create(null);
    let upperTimeThreshold = Object.create(null);

    if (l.className === 'startTimeline') {
      lowerTimeThreshold = l.time;
      upperTimeThreshold = d3.select('.endTimeline').data()[0].time;
    } else {
      lowerTimeThreshold = d3.select('.startTimeline').data()[0].time;
      upperTimeThreshold = l.time;
    }

    return [lowerTimeThreshold, upperTimeThreshold];
  }

  /**
   * Update lower and upper date threshold label in timeline view.
   * @param l Time line.
   */
  function updateTimelineLabels (l) {
    const tlThreshold = getTimeLineThresholds(l);
    tlThreshold[1].setSeconds(tlThreshold[1].getSeconds() + 1);

    const labelStart = customTimeFormat(tlThreshold[0]);
    const labelEnd = customTimeFormat(tlThreshold[1]);

    d3.select('#tlThresholdStart').html('Start: ' + labelStart);
    d3.select('#tlThresholdEnd').html('End: ' + labelEnd);

    d3.selectAll('.tlAnalysis').each(an => {
      if (
        parseISOTimeFormat(an.start) < tlThreshold[0] ||
        parseISOTimeFormat(an.start) > tlThreshold[1]
      ) {
        d3.select(this).classed('blendedTLAnalysis', true);
      } else {
        d3.select(this).classed('blendedTLAnalysis', false);
      }
    });
  }

  /**
   * Drag listener.
   * @param l Time line.
   */
  function draggingLine (l) {
    /* Check borders. */
    if (d3.event.x < 0) {
      l.x = 0;
    } else if (d3.event.x > tlWidth) {
      l.x = tlWidth;
    } else {
      l.x = d3.event.x;
    }
    l.time = new Date(timeLineGradientScale.invert(l.x));

    /* Update lines. */
    d3.select(this).attr('transform', 'translate(' + x(l.x) + ',0)');

    /* Update labels. */
    updateTimelineLabels(l);

    /* TODO: Temporarily disabled live filtering as it does not scale
     * well with big graphs. */

    /* On hover filter update. */
    /* if (d3.entries(tlTickCoords).some(function (t) {

     if (l.className === "startTimeline") {

     */
    /* Left to right. */
    /*
     if (l.x > l.lastX) {
     if (x(l.x) - x(t.value) > 0 && x(l.x) - x(t.value) <= 1) {
     return true;
     } else {
     return false;
     }
     */
    /* Right to left. */
    /*
     } else {
     if (x(l.x) - x(t.value) >= -1 && x(l.x) - x(t.value) < 0) {
     return true;
     } else {
     return false;
     }
     }
     } else {
     */
    /* Right to left. */
    /*
     if (l.x < l.lastX) {

     */
    /* TODO: Small bug, time scale is off by 30 seconds. */
    /*
     if (x(l.x) - x(t.value) >= -5 && x(l.x) - x(t.value) < 0) {
     return true;
     } else {
     return false;
     }
     */
    /* Left to right. */
    /*
     } else {
     if (x(l.x) - x(t.value) > 0 && x(l.x) - x(t.value) <= 1) {
     return true;
     } else {
     return false;
     }
     }
     }
     })) {
     filterAnalysesByTime(getTimeLineThresholds(l)[0],
     getTimeLineThresholds(l)[1], vis);
     }*/

    /* Remember last drag x coord. */
    l.lastX = l.x;
  }

  /**
   * Drag end listener.
   * @param l Time line.
   */
  function dragLineEnd (l) {
    l.time = new Date(timeLineGradientScale.invert(l.x));

    /* Update labels. */
    updateTimelineLabels(l);

    /* Filter action. */
    filterAnalysesByTime(getTimeLineThresholds(l)[0],
      getTimeLineThresholds(l)[1], _vis_);

    filterMethod = 'timeline';
  }

  /**
   * Sets the drag events for time lines.
   * @param nodeType The dom lineset to allow dragging.
   */
  function applyTimeLineDragBehavior (domDragSet) {
    /* Drag and drop line enabled. */
    const dragLine = d3.behavior.drag()
      .origin(d => d)
      .on('dragstart', dragLineStart)
      .on('drag', draggingLine)
      .on('dragend', dragLineEnd);

    /* Invoke dragging behavior on nodes. */
    domDragSet.call(dragLine);
  }

  /* Geometric zoom. */
  function redrawTimeline () {
    /* Translations. */
    svg.selectAll('.tlAnalysis')
      .attr('x1', an => x(timeLineGradientScale(parseISOTimeFormat(an.start))))
      .attr('x2', an => x(timeLineGradientScale(parseISOTimeFormat(an.start))));

    svg.selectAll('.startTimeline, .endTimeline')
      .attr('transform', d => 'translate(' + x(d.x) + ',' + 0 + ')');

    svg.select('#timelineView')
      .attr('x', x(0))
      .attr('width', x(tlWidth) - x(0));

    svg.select('#tlxAxis')
      .attr('transform', 'translate(' + x(0) + ',' + tlHeight + ')');

    svg.select('#tlxAxis').selectAll('.tick')
      .attr('transform', d => (
        'translate(' +
        (x(timeLineGradientScale(d)) - (d3.event.translate[0])) +
        ',' +
        0 +
        ')'
      ));

    svg.select('#tlxAxis').select('path')
      .attr('d', 'M0,6V0H' + (tlWidth * d3.event.scale) + 'V6');

    svg.select('#tlyAxis')
      .attr('transform', 'translate(' + x(0) + ',' + 10 + ')');
  }

  /* Timeline zoom behavior. */
  const timelineZoom = d3.behavior.zoom().x(x).scaleExtent([1, 10])
    .on('zoom', redrawTimeline);

  timelineZoom(svg);

  const gradient = svg.append('defs')
    .append('linearGradient')
    .attr('id', 'gradientGrayscale');

  gradient.append('stop')
    .attr('offset', '0%')
    .attr('stop-color', '#fff')
    .attr('stop-opacity', 1);

  gradient.append('stop')
    .attr('offset', '100%')
    .attr('stop-color', '#000')
    .attr('stop-opacity', 1);

  svg.append('rect')
    .attr('id', 'timelineView')
    .attr('x', 0)
    .attr('y', 10)
    .attr('width', tlWidth)
    .attr('height', tlHeight - 10)
    .style({
      fill: 'url(#gradientGrayscale)',
      stroke: 'white',
      'stroke-width': '1px'
    });

  svg.append('g')
    .classed({
      x: true,
      axis: true
    })
    .attr('id', 'tlxAxis')
    .attr('transform', 'translate(0,' + tlHeight + ')')
    .call(xAxis);

  svg.append('g')
    .classed({
      y: true,
      axis: true
    })
    .attr('id', 'tlyAxis')
    .attr('transform', 'translate(0,' + 10 + ')')
    .call(yAxis);

  d3.select('#tlyAxis').selectAll('.tick').each(d => {
    if (d === 5) {
      d3.select(this).select('text').text('>5');
    }
  });

  const startTime = {
    className: 'startTimeline',
    x: 0,
    lastX: -1,
    time: new Date(timeLineGradientScale.invert(0))
  };
  const endTime = {
    className: 'endTimeline',
    x: tlWidth,
    lastX: tlWidth + 1,
    time: new Date(timeLineGradientScale.invert(tlWidth))
  };

  const timeLineThreshold = svg.selectAll('.line')
    .data([startTime, endTime])
    .enter()
    .append('g')
      .attr('transform', d => 'translate(' + d.x + ',0)')
      .attr('class', d => d.className);

  timeLineThreshold.append('line')
    .attr('x1', 0)
    .attr('y1', 0)
    .attr('x2', 0)
    .attr('y2', tlHeight);

  timeLineThreshold.append('polygon').classed('timeMarker', true)
    .attr('points', '0,50 5,60 -5,60');
  timeLineThreshold.append('polygon').classed('timeMarker', true)
    .attr('points', '0,10 5,0 -5,0');

  svg.selectAll('.line')
    .data(_vis_.graph.aNodes)
    .enter().append('line')
    .attr('id', an => 'tlAnalysisId-' + an.autoId)
    .classed('tlAnalysis', true)
    .attr('x1', an => timeLineGradientScale(parseISOTimeFormat(an.start)))
    .attr('y1', an => an.children.size() >= 5 ? 10 :
        parseInt(tlHeight - (tlHeight - 10) / 5 * an.children.size(), 10))
    .attr('x2', an => timeLineGradientScale(parseISOTimeFormat(an.start)))
    .attr('y2', tlHeight);

  d3.selectAll('.startTimeline, .endTimeline').on('mouseover', () => {
    d3.select(this).classed('mouseoverTimeline', true);
  });

  applyTimeLineDragBehavior(d3.selectAll('.startTimeline, .endTimeline'));

  updateTimelineLabels(startTime);
}

/**
 * Recomputes the DOI for every node
 */
function recomputeDOI () {
  vis.graph.lNodes.values().forEach(l => {
    l.doi.computeWeightedSum();
    l.children.values().forEach(an => {
      an.doi.computeWeightedSum();
      an.children.values().forEach(san => {
        san.doi.computeWeightedSum();
        san.children.values().forEach(n => {
          n.doi.computeWeightedSum();
        });
      });
    });
  });
  updateNodeDoi();
}

/* TODO: Code cleanup. */
/**
 * Draws the DOI view.
 */
function drawDoiView () {
  const innerSvg = d3.select('#provenance-doi-view')
    .select('svg').select('g').select('g')
    .attr('transform', 'translate(0,0)').select('g');

  const doiFactors = d3.values(models.DoiFactors.factors);
  const doiColorScale = d3.scale.category10();

  function updateDoiView (data) {
    let rectOffset = 0;
    const labelOffset = 30;
    const labelsStart = (300 - data.length * labelOffset) / 2;

    /* Data join. */
    const dComp = innerSvg.selectAll('g').data(data);

    /* Update. */
    const gDCompUpdate = dComp
      .attr('id', (d, i) => 'doiCompId-' + i)
      .classed('doiComp', true);

    gDCompUpdate.select('.doiCompRect')
      .classed('doiCompRect', true)
      .attr('x', 0)
      .attr('y', d => {
        rectOffset += d.value * 300;
        return rectOffset - d.value * 300;
      })
      .attr('width', 40)
      .attr('height', d => d.value * 300);

    gDCompUpdate.select('.doiCompHandle')
      .classed('doiCompHandle', true)
      .attr('x', 40 + labelOffset)
      .attr('y', (d, i) => labelsStart + labelOffset * i)
      .attr('width', labelOffset)
      .attr('height', labelOffset)
      .style('fill', (d, i) => doiColorScale(10 - i));

    rectOffset = 0;

    gDCompUpdate.select('.doiCompLine', true)
      .attr('x1', 40)
      .attr('y1', d => {
        rectOffset += d.value * 300;
        return rectOffset - (d.value * 300 / 2);
      }).attr('x2', 40 + labelOffset)
      .attr('y2', (d, i) => labelsStart + labelOffset * i + labelOffset / 2)
      .style({
        stroke: (d, i) => doiColorScale(10 - i),
        'stroke-opacity': 0.7,
        'stroke-width': '2px'
      });

    /* Enter. */
    const gDCompEnter = dComp.enter().append('g')
      .attr('id', (d, i) => 'doiCompId-' + i)
      .classed('doiComp', true);

    gDCompEnter.append('rect')
      .classed('doiCompRect', true)
      .attr('x', 0)
      .attr('y', d => {
        rectOffset += d.value * 300;
        return rectOffset - d.value * 300;
      })
      .attr('width', 40)
      .attr('height', d => d.value * 300)
      .style('fill', (d, i) => doiColorScale(10 - i));

    rectOffset = 0;

    gDCompEnter.append('rect')
      .classed('doiCompHandle', true)
      .attr('x', 40 + labelOffset)
      .attr('y', (d, i) => labelsStart + labelOffset * i)
      .attr('width', labelOffset)
      .attr('height', labelOffset)
      .style('fill', (d, i) => doiColorScale(10 - i));

    rectOffset = 0;

    gDCompEnter.append('line').classed('doiCompLine', true)
      .attr('x1', 40)
      .attr('y1', d => {
        rectOffset += d.value * 300;
        return rectOffset - (d.value * 300 / 2);
      })
      .attr('x2', 40 + labelOffset)
      .attr('y2', (d, i) => labelsStart + labelOffset * i + labelOffset / 2)
      .style({
        stroke: (d, i) => doiColorScale(10 - i),
        'stroke-opacity': 0.7,
        'stroke-width': '2px'
      });

    dComp.exit().remove();

    $('#doiSpinners').css('padding-top', labelsStart);
  }

  updateDoiView(doiFactors);

  doiFactors.forEach((dc, i) => {
    $('<div/>', {
      id: 'dc-form-' + i,
      class: 'form dc-form',
      style: 'height: 30px; position: absolute; left: 75px; top: ' +
        parseInt((10 - doiFactors.length) / 2 * 30 + (i + 1) * 30 - 1, 10) +
        'px;'
    }).appendTo('#' + 'doiVis');

    $('<input/>', {
      id: 'dc-checkbox-' + i,
      class: 'dc-checkbox',
      type: 'checkbox',
      checked: 'true',
      style: 'margin-top: 0px; margin-right: 2px; vertical-align: middle;'
    }).appendTo('#' + 'dc-form-' + i);

    $('<input/>', {
      id: 'dc-input-' + i,
      type: 'text',
      class: 'form-control dc-input',
      value: dc.value,
      style: 'display: inline; width: 27px; height: 30px; margin-bottom:' +
        ' 0px;' +
        'margin-right: 2px; text-align: left; padding: 0; margin-left: 2px;' +
        ' border-radius: 0px;'
    }).appendTo('#' + 'dc-form-' + i);

    $('<div/>', {
      id: 'btn-group-wrapper-' + i,
      class: 'btn-group',
      style: 'height: 32px'
    }).appendTo('#' + 'dc-form-' + i);

    $('<div/>', {
      id: 'dc-btn-group-' + i,
      class: 'input-group-btn-vertical',
      style: 'margin-right: 2px;'
    }).appendTo('#' + 'btn-group-wrapper-' + i);

    $('<button/>', {
      id: 'dc-carret-up-' + i,
      class: 'refinery-base btn btn-default',
      html: '<i class=\'fa fa-caret-up\'></i>'
    }).appendTo('#' + 'dc-btn-group-' + i);

    $('<button/>', {
      id: 'dc-carret-down-' + i,
      class: 'refinery-base btn btn-default',
      html: '<i class=\'fa fa-caret-down\'></i>'
    }).appendTo('#' + 'dc-btn-group-' + i);

    $('<span/>', {
      id: 'dc-label-' + i,
      class: 'label dc-label',
      html: dc.label,
      style: 'margin-left: 2px; opacity: 0.7; background-color: ' +
        doiColorScale(10 - i) + ';'
    }).appendTo('#' + 'dc-form-' + i);
  });

  $('<a/>', {
    id: 'prov-doi-view-reset',
    href: '#',
    html: 'Redistribute',
    style: 'width: 25px; position: absolute; left: 90px; top: ' +
      parseInt((10 - doiFactors.length) / 2 * 30 +
        (doiFactors.length + 1) * 30 + 10, 10) + 'px;'
  }).appendTo('#' + 'doiVis');

  /* TODO: Code cleanup. */
  /**
   * Toggle doi components.
   */
  function toggleDoiComps () {
    const numMaskedComps = d3.values(models.DoiFactors.factors)
      .filter(dc => models.DoiFactors.isMasked(dc.label)).length;

    if (numMaskedComps > 0) {
      const accVal = d3.values(models.DoiFactors.factors)
        .filter(dc => models.DoiFactors.isMasked(dc.label))
        .map(dc => dc.value)
        .reduce((_accVal_, cur) => _accVal_ + cur);

      const tar = 1.0;

      d3.values(models.DoiFactors.factors)
        .forEach((dc, i) => {
          if (models.DoiFactors.isMasked(dc.label)) {
            const isMasked = $('#dc-checkbox-' + i)[0].checked;
            if (accVal === 0) {
              models.DoiFactors.set(
                d3.keys(models.DoiFactors.factors)[i],
                1 / numMaskedComps, isMasked);
              $('#dc-input-' + i).val(1 / numMaskedComps);
            } else {
              models.DoiFactors.set(
                d3.keys(models.DoiFactors.factors)[i],
                (dc.value / accVal) * tar, isMasked);
              $('#dc-input-' + i).val((dc.value / accVal) * tar);
            }
          }
        });
    }
    updateDoiView(d3.values(models.DoiFactors.factors));
  }

  /* Toggle component on svg click. */
  d3.selectAll('.doiComp').on('click', () => {
    const dcId = d3.select(this).attr('id').substr(d3.select(this).attr('id')
        .length - 1, 1);
    const val = 0.0;
    if ($('#dc-checkbox-' + dcId)[0].checked) {
      $('#dc-checkbox-' + dcId).prop('checked', false);
      $('#dc-label-' + dcId).css('opacity', 0.3);
      d3.select('#doiCompId-' + dcId)
        .select('.doiCompHandle')
        .classed('blendedDoiComp', true);
      d3.select('#doiCompId-' + dcId).select('.doiCompLine')
        .style('display', 'none');
      $('#dc-input-' + dcId).val(val);
      models.DoiFactors.set(
        d3.keys(models.DoiFactors.factors)[dcId], val, false);
    } else {
      $($('#dc-checkbox-' + dcId)).prop('checked', true);
      $('#dc-label-' + dcId).css('opacity', 0.7);
      d3.select('#doiCompId-' + dcId)
        .select('.doiCompHandle')
        .classed('blendedDoiComp', false);
      d3.select('#doiCompId-' + dcId).select('.doiCompLine')
        .style('display', 'inline');
      models.DoiFactors.set(
        d3.keys(models.DoiFactors.factors)[dcId], val, true);
    }
    toggleDoiComps();
  });

  /* Toggle component on checkbox click. */
  $('.dc-checkbox').click(function () {
    const dcId = $(this)[0].id[$(this)[0].id.length - 1];
    let val = 0.0;
    if ($(this)[0].checked) {
      $(this.parentNode).find('.dc-label').css('opacity', 0.7);
      d3.select('#doiCompId-' + dcId).select('.doiCompHandle')
        .classed('blendedDoiComp', false);
      d3.select('#doiCompId-' + dcId).select('.doiCompLine')
        .style('display', 'inline');
      val = 0.0;
      models.DoiFactors.set(
        d3.keys(models.DoiFactors.factors)[dcId], val, true);
    } else {
      $(this.parentNode).find('.dc-label').css('opacity', 0.3);
      d3.select('#doiCompId-' + dcId).select('.doiCompHandle')
        .classed('blendedDoiComp', true);
      d3.select('#doiCompId-' + dcId).select('.doiCompLine')
        .style('display', 'none');
      val = 0.0;
      $('#dc-input-' + dcId).val(val);
      models.DoiFactors.set(
        d3.keys(models.DoiFactors.factors)[dcId], val, false);
    }

    toggleDoiComps();
  });

  /* TODO: Clean up code duplication. */

  /* Increase component's influence. */
  $('.dc-form .btn:first-of-type').on('click', () => {
    const dcId = $(this)[0].id[$(this)[0].id.length - 1];
    const val = parseFloat($('#dc-input-' + dcId).val()) + 0.01;
    if ($('#dc-checkbox-' + dcId)[0].checked && val <= 1) {
      $('#dc-input-' + dcId).val(val);
      models.DoiFactors.set(
        d3.keys(models.DoiFactors.factors)[dcId], val, true);

      const accVal = d3.values(models.DoiFactors.factors)
        .filter((dc, i) => i !== dcId && models.DoiFactors.isMasked(dc.label))
        .map(dc => dc.value)
        .reduce((_accVal_, cur) => _accVal_ + cur);

      const tar = parseFloat(1 - val);

      d3.values(models.DoiFactors.factors)
        .forEach((dc, i) => {
          if (i !== dcId && models.DoiFactors.isMasked(dc.label)) {
            const isMasked = $('#dc-checkbox-' + i)[0].checked;
            models.DoiFactors.set(
              d3.keys(models.DoiFactors.factors)[i],
              (dc.value / accVal) * tar, isMasked);
            $('#dc-input-' + i).val((dc.value / accVal) * tar);
          }
        });
      updateDoiView(d3.values(models.DoiFactors.factors));
    }
  });

  /* Decrease component's influence. */
  $('.dc-form .btn:last-of-type').on('click', () => {
    const dcId = $(this)[0].id[$(this)[0].id.length - 1];
    const val = parseFloat($('#dc-input-' + dcId).val()) - 0.01;
    if ($('#dc-checkbox-' + dcId)[0].checked && val >= 0) {
      $('#dc-input-' + dcId).val(val);
      models.DoiFactors.set(
        d3.keys(models.DoiFactors.factors)[dcId], val, true);

      const accVal = d3.values(models.DoiFactors.factors)
        .filter((dc, i) => i !== dcId && models.DoiFactors.isMasked(dc.label))
        .map(dc => dc.value)
        .reduce((_accVal_, cur) => _accVal_ + cur);

      const tar = parseFloat(1 - val);

      d3.values(models.DoiFactors.factors)
        .forEach((dc, i) => {
          if (i !== dcId && models.DoiFactors.isMasked(dc.label)) {
            const isMasked = $('#dc-checkbox-' + i)[0].checked;
            models.DoiFactors.set(
              d3.keys(models.DoiFactors.factors)[i],
              (dc.value / accVal) * tar, isMasked);
            $('#dc-input-' + i).val((dc.value / accVal) * tar);
          }
        });
      updateDoiView(d3.values(models.DoiFactors.factors));
    }
  });

  $('.dc-input').keypress(function (e) {
    if (e.which === 13) {
      const dcId = $(this)[0].id[$(this)[0].id.length - 1];
      let val = parseFloat($('#dc-input-' + dcId).val());

      if (val > 1) {
        val = 1;
      } else if (val < 0) {
        val = 0;
      }

      $(this).val(val);
      $($('#dc-checkbox-' + dcId)).prop('checked', true);
      $('#doiCompId-' + dcId).find('.dc-label').css('opacity', 0.7);
      d3.select('#doiCompId-' + dcId).select('.doiCompHandle')
        .classed('blendedDoiComp', false);
      d3.select('#doiCompId-' + dcId).select('.doiCompLine')
        .style('display', 'inline');
      models.DoiFactors.set(
        d3.keys(models.DoiFactors.factors)[dcId], val, true);

      const accVal = d3.values(models.DoiFactors.factors)
        .filter((dc, i) => i !== dcId && models.DoiFactors.isMasked(dc.label))
        .map(dc => dc.value)
        .reduce((_accVal_, cur) => _accVal_ + cur);

      const tar = parseFloat(1 - val);

      d3.values(models.DoiFactors.factors).forEach((dc, i) => {
        if (i !== dcId && models.DoiFactors.isMasked(dc.label)) {
          const isMasked = $('#dc-checkbox-' + i)[0].checked;
          models.DoiFactors.set(
            d3.keys(models.DoiFactors.factors)[i],
            (dc.value / accVal) * tar, isMasked);
          $('#dc-input-' + i).val((dc.value / accVal) * tar);
        }
      });
      updateDoiView(d3.values(models.DoiFactors.factors));
    }
  });

  $('#prov-doi-view-apply').on('click', () => {
    /* Recompute doi. */
    recomputeDOI();
  });

  $('#prov-doi-view-reset').on('click', () => {
    const val = parseFloat(1 / d3.values(models.DoiFactors.factors)
        .filter(dc => models.DoiFactors.isMasked(dc.label)).length);

    d3.values(models.DoiFactors.factors)
      .forEach((dc, i) => {
        if (!models.DoiFactors.isMasked(dc.label)) {
          $('#dc-input-' + i).val(0.0);
          models.DoiFactors.set(
            d3.keys(models.DoiFactors.factors)[i], 0.0, false);
        } else {
          $('#dc-input-' + i).val(val);
          models.DoiFactors.set(
            d3.keys(models.DoiFactors.factors)[i], val, true);
        }
      });
    updateDoiView(d3.values(models.DoiFactors.factors));
  });

  /* Toggle DOI auto update. */
  $('#prov-doi-trigger').click(function () {
    if ($(this).find('input[type=\'checkbox\']').prop('checked')) {
      doiAutoUpdate = true;
    } else {
      doiAutoUpdate = false;
    }
  });

  /* Show and hide doi labels. */
  $('#prov-doi-view-show').click(function () {
    if ($(this).find('input[type=\'checkbox\']').prop('checked')) {
      d3.selectAll('.nodeDoiLabel').style('display', 'inline');
    } else {
      d3.selectAll('.nodeDoiLabel').style('display', 'none');
    }
  });
}

/**
 * Reset css for all links.
 */
function clearHighlighting () {
  hLink.classed('hiddenLink', true);
  link.each(l => {
    l.highlighted = false;
  });

  domNodeset.each(n => {
    n.highlighted = false;
    n.doi.highlightedChanged();
  });
}

/* TODO: Layer link highlighting. */
/**
 * Get predecessing nodes for highlighting the path by the current
 * node selection.
 * @param n BaseNode extending constructor function.
 */
function highlightPredPath (n) {
  /* Current node is highlighted. */
  n.highlighted = true;
  n.doi.highlightedChanged();

  /* Parent nodes are highlighted too. */
  let pn = n.parent;
  while (pn instanceof models.BaseNode === true) {
    pn.highlighted = true;
    pn.doi.highlightedChanged();
    pn = pn.parent;
  }

  if (n instanceof models.Layer) {
    n.children.values().forEach(an => {
      an.predLinks.values().forEach(l => {
        l.highlighted = true;
        l.hidden = false;
        d3.select('#hLinkId-' + l.autoId).classed('hiddenLink', false);

        highlightPredPath(l.source);
      });
    });
  } else {
    /* Get svg link element, and for each predecessor call recursively. */
    n.predLinks.values().forEach(l => {
      l.highlighted = true;
      if (!l.hidden) {
        d3.select('#hLinkId-' + l.autoId).classed('hiddenLink', false);
      }
      highlightPredPath(l.source);
    });
  }
}

/**
 * Get succeeding nodes for highlighting the path by the current
 * node selection.
 * @param n BaseNode extending constructor function.
 */
function highlightSuccPath (n) {
  /* Current node is highlighted. */
  n.highlighted = true;
  n.doi.highlightedChanged();

  /* Parent nodes are highlighted too. */
  let pn = n.parent;
  while (pn instanceof models.BaseNode === true) {
    pn.highlighted = true;
    pn.doi.highlightedChanged();
    pn = pn.parent;
  }

  if (n instanceof models.Layer) {
    n.children.values().forEach(an => {
      an.succLinks.values().forEach(l => {
        l.highlighted = true;
        l.hidden = false;
        d3.select('#hLinkId-' + l.autoId).classed('hiddenLink', false);

        highlightSuccPath(l.target);
      });
    });
  } else {
    /* Get svg link element, and for each successor call recursively. */
    n.succLinks.values().forEach(l => {
      l.highlighted = true;
      if (!l.hidden) {
        d3.select('#hLinkId-' + l.autoId).classed('hiddenLink', false);
      }

      highlightSuccPath(l.target);
    });
  }
}

/**
 * Update analysis links.
 * @param graph The provenance graph.
 */
function updateAnalysisLinks (graph) {
  /* Data join. */
  const ahl = vis.canvas.select('g.aHLinks').selectAll('.hLink')
    .data(graph.aLinks);

  /* Enter. */
  ahl.enter().append('path')
    .classed({
      hLink: true
    })
    .classed('blendedLink', filterAction === 'blend')
    .classed('filteredLink', l => l.filtered)
    .classed('hiddenLink', l => !l.highlighted)
    .attr('id', l => 'hLinkId-' + l.autoId);

  /* Enter and update. */
  ahl.attr('d', l => {
    const srcCoords = getVisibleNodeCoords(l.source);
    const tarCoords = getVisibleNodeCoords(l.target);
    if (linkStyle === 'bezier1') {
      return drawBezierLink(
        l, srcCoords.x, srcCoords.y, tarCoords.x, tarCoords.y
      );
    }
    return drawStraightLink(
      l, srcCoords.x, srcCoords.y, tarCoords.x, tarCoords.y
    );
  })
  .classed('blendedLink', l => !l.filtered && filterAction === 'blend')
  .classed('filteredLink', l => l.filtered)
  .classed('hiddenLink', l => !l.highlighted)
  .attr('id', l => 'hLinkId-' + l.autoId);

  /* Exit. */
  ahl.exit().remove();

  /* Set dom elements. */
  hLink = d3.selectAll('.hLink');

  /* Data join */
  const al = vis.canvas.select('g.aLinks').selectAll('.link')
    .data(graph.aLinks);

  /* Enter. */
  al.enter().append('path')
    .classed({
      link: true,
      aLink: true
    })
    .classed('blendedLink', l => !l.filtered && filterAction === 'blend')
    .classed('filteredLink', l => l.filtered)
    .classed('hiddenLink', l => l.hidden)
    .attr('id', l => 'linkId-' + l.autoId);

  /* Enter and update. */
  al.attr('d', l => {
    const srcCoords = getVisibleNodeCoords(l.source);
    const tarCoords = getVisibleNodeCoords(l.target);
    if (linkStyle === 'bezier1') {
      return drawBezierLink(
        l, srcCoords.x, srcCoords.y, tarCoords.x, tarCoords.y
      );
    }
    return drawStraightLink(
      l, srcCoords.x, srcCoords.y, tarCoords.x, tarCoords.y
    );
  })
  .classed('blendedLink', l => !l.filtered && filterAction === 'blend')
  .classed('filteredLink', l => l.filtered)
  .classed('hiddenLink', l => l.hidden)
  .attr('id', l => 'linkId-' + l.autoId);

  /* Exit. */
  al.exit().remove();

  /* Set dom elements. */
  aLink = d3.selectAll('.aLink');
  link = d3.selectAll('.link');
}

/**
 * Creates a linear time scale ranging from the first to the last analysis
 * created.
 * @param aNodes Analysis nodes.
 * @param range Linear color scale for domain values.
 */
function createAnalysistimeColorScale (aNodes, range) {
  const min = d3.min(aNodes, d => parseISOTimeFormat(d.start));
  const max = d3.max(aNodes, d => parseISOTimeFormat(d.start));

  return d3.time.scale()
    .domain([min, max])
    .range([range[0], range[1]]);
}

/**
 * Draw layered nodes.
 * @param lNodes Layer nodes.
 */
function updateLayerNodes (lNodes) {
  /* Data join. */
  const ln = vis.canvas.select('g.layers').selectAll('.layer')
    .data(lNodes.values());

  /* Enter. */
  const lEnter = ln.enter().append('g')
    .classed({
      layer: true
    });

  lEnter
    .attr('id', d => 'gNodeId-' + d.autoId)
    .attr('transform', d => 'translate(' + d.x + ',' + d.y + ')');

  /* Adjust gradient start and stop position as well as steps based on min,
   * max and occurrences of analyses at a specific time. */
  const gradient = lEnter.append('defs')
    .append('linearGradient')
    .attr('id', d => 'layerGradientId-' + d.autoId)
    .attr('x1', '0%')
    .attr('y1', '100%')
    .attr('x2', '0%')
    .attr('y2', '0%');

  gradient.append('stop')
    .attr('offset', '0%')
    .attr('stop-color', l => {
      const latestDate = d3.min(l.children.values(), d => d.start);
      return timeColorScale(parseISOTimeFormat(latestDate));
    })
    .attr('stop-opacity', 1);

  gradient.append('stop')
    .attr('offset', '100%')
    .attr('stop-color', l => {
      const earliestDate = d3.max(l.children.values(), d => d.start);
      return timeColorScale(parseISOTimeFormat(earliestDate));
    })
    .attr('stop-opacity', 1);

  /* Draw bounding box. */
  lBBox = lEnter.append('g')
    .attr('id', lln => 'BBoxId-' + lln.autoId)
    .classed({
      lBBox: true,
      BBox: true,
      hiddenBBox: false
    })
    .attr('transform', (
      'translate(' +
      (-cell.width / 2) + ',' + (-cell.height / 2) +
      ')'
    ));

  lBBox.append('rect')
    .attr('y', -0.6 * scaleFactor * vis.radius)
    .attr('width', cell.width)
    .attr('height', cell.height)
    .attr('rx', cell.width / 7)
    .attr('ry', cell.height / 7);

  /* Add a clip-path to restrict labels within the cell area. */
  lBBox.append('defs')
    .append('clipPath')
    .attr('id', lln => 'lBBClipId-' + lln.autoId)
    .append('rect')
    .attr('y', -0.6 * scaleFactor * vis.radius)
    .attr('width', cell.width)
    .attr('height', cell.height + 2 * scaleFactor * vis.radius)
    .attr('rx', cell.width / 7)
    .attr('ry', cell.height / 7);

  /* Time as label. */
  lBBox.append('g')
    .classed('labels', true)
    .attr('clip-path', lln => 'url(#lBBClipId-' + lln.autoId + ')')
    .append('text')
    .attr('transform', (
      'translate(' + 1 * scaleFactor * vis.radius + ',' +
      0.5 * scaleFactor * vis.radius + ')'
    ))
    .text(d => '\uf013' + ' ' + d.wfCode)
    .classed('lBBoxLabel', true)
    .style('font-family', 'FontAwesome');

  const lDiff = lBBox.append('g')
    .classed('lDiff', true)
    .attr('transform', 'translate(' + (0) + ',' + (0) + ')');

  lDiff.each(lln => {
    if (
      lln.children.values().some(
        an =>
        an.motifDiff.numIns !== 0 ||
        an.motifDiff.numOuts !== 0 ||
        an.motifDiff.numSubanalyses !== 0
      )
    ) {
      d3.select(this).append('text')
        .text('\uf069')
        .classed('diff-node-type-icon', true)
        .style('font-family', 'FontAwesome');
    }
  });

  const layerNode = lEnter.append('g')
    .attr('id', l => 'nodeId-' + l.autoId)
    .classed({
      lNode: true,
      filteredNode: true,
      blendedNode: false,
      selectedNode: false,
      hiddenNode: an => an.hidden
    });

  lEnter.append('g').classed({
    children: true
  });

  const lGlyph = layerNode.append('g').classed({
    glyph: true
  });
  const lLabels = layerNode.append('g').classed({
    labels: true
  });

  /* TODO: Aggregate hidden analysis nodes into a single layer glyph.
   * Glyph dimensions depend on the amount of analysis children the layer has
   * as well as how many analyses of them are hidden. */

  lGlyph.append('defs')
    .append('clipPath')
    .attr('id', l => 'bbClipId-' + l.autoId)
    .append('rect')
    .attr('x', -2 * scaleFactor * vis.radius)
    .attr('y', -2 * scaleFactor * vis.radius)
    .attr('rx', 1)
    .attr('ry', 1)
    .attr('width', 4 * scaleFactor * vis.radius)
    .attr('height', 4 * scaleFactor * vis.radius);

  lGlyph.each(lln => {
    if (getLayerPredCount(lln) > 0) {
      d3.select(this)
        .append('g')
        .classed('glAnchor', true)
        .append('path')
        .attr('d', (
          'm' + (-2 * scaleFactor * vis.radius) + ' ' +
          (-0.5 * scaleFactor * vis.radius) + ' ' +
          'h' + (-0.8 * scaleFactor * vis.radius) + ' ' +
          'a' + (-0.5 * scaleFactor * vis.radius) + ' ' +
          (0.5 * scaleFactor * vis.radius) + ' 0 0 0 ' +
          '0 ' + (1 * scaleFactor * vis.radius) + ' ' +
          'h' + (+0.8 * scaleFactor * vis.radius) + ' ' +
          'z'
        ))
        .classed('llAnchor', true);
    }
  });

  lGlyph.each(lln => {
    if (getLayerSuccCount(lln) > 0) {
      d3.select(this)
        .append('g')
        .classed('grAnchor', true)
        .append('path')
        .attr('d', (
          'm' + (2 * scaleFactor * vis.radius) + ' ' +
          (-0.5 * scaleFactor * vis.radius) + ' ' +
          'h' + (0.8 * scaleFactor * vis.radius) + ' ' +
          'a' + (0.5 * scaleFactor * vis.radius) + ' ' +
          (0.5 * scaleFactor * vis.radius) + ' 0 0 1 ' +
          '0 ' + (1 * scaleFactor * vis.radius) + ' ' +
          'h' + (-0.8 * scaleFactor * vis.radius) + ' ' +
          'z'
        ))
        .classed('rlAnchor', true);
    }
  });

  lGlyph.each(lln => {
    if (getLayerPredCount(lln) > 1) {
      d3.select(this)
        .select('g.glAnchor')
        .append('text')
        .attr('transform', (
          'translate(' + (-2.8 * scaleFactor * vis.radius) + ',' + 0.5 + ')'
        ))
        .text(getLayerPredCount(ln))
        .attr('class', 'lLabel');
    }
  });

  lGlyph.each(lln => {
    if (getLayerSuccCount(lln) > 1) {
      d3.select(this)
        .select('g.grAnchor')
        .append('text')
        .attr('transform', (
          'translate(' + (2.8 * scaleFactor * vis.radius) + ',' + 0.5 + ')'
        ))
        .text(getLayerSuccCount(ln))
        .attr('class', 'lLabel');
    }
  });

  lGlyph.append('rect')
    .attr('x', -2.25 * scaleFactor * vis.radius)
    .attr('y', -1 * scaleFactor * vis.radius)
    .attr('rx', 1)
    .attr('ry', 1)
    .attr('width', 4.5 * scaleFactor * vis.radius)
    .attr('height', 2 * scaleFactor * vis.radius)
    .style('fill', d => 'url(#layerGradientId-' + d.autoId + ')')
    .classed('lGlyph', true);

  /* Add text labels. */
  lLabels.append('text')
    .text(d => d.doi.doiWeightedSum)
    .attr('class', 'nodeDoiLabel')
    .style('display', 'none');

  lLabels.append('g')
    .classed('wfLabel', true)
    .attr('clip-path', l => 'url(#bbClipId-' + l.autoId + ')');

  lLabels.append('text')
    .attr('transform', (
      'translate(' +
      (-1.1 * scaleFactor * vis.radius) + ',' + (0 * scaleFactor * vis.radius) +
      ')'
    ))
    .text('\uf0c9')
    .classed('l-node-type-icon', true)
    .style('fill', l => {
      const latestDate = d3.min(l.children.values(), d => d.start);
      return timeColorScale(parseISOTimeFormat(latestDate)) < '#888888' ?
        '#ffffff' : '#000000';
    });

  lLabels.append('text')
    .attr(
      'transform',
      'translate(' + (0.8 * scaleFactor * vis.radius) + ',' + '0.25)'
    )
    .text(d => d.children.size())
    .attr('class', 'lnLabel glyphNumeral')
    .style('fill', l => {
      const latestDate = d3.min(l.children.values(), d => d.start);
      return timeColorScale(parseISOTimeFormat(latestDate)) < '#888888' ?
        '#ffffff' : '#000000';
    });

  /* Enter and update. */
  ln.attr('id', d => 'gNodeId-' + d.autoId)
    .attr('transform', d => 'translate(' + d.x + ',' + d.y + ')');

  /* TODO: Implements update parameters. */

  /* Exit. */
  ln.exit().remove();

  /* Set dom elements. */
  layer = vis.canvas.select('g.layers').selectAll('.layer');
  lNode = d3.selectAll('.lNode');
  lBBox = d3.selectAll('.lBBox');
}

/**
 * Draw layered nodes.
 * @param lLinks Layer links.
 */
function updateLayerLinks (lLinks) {
  /* Data join. */
  const ln = vis.canvas.select('g.lLinks').selectAll('.link')
    .data(lLinks.values());

  /* Enter. */
  ln.enter().append('path')
    .classed({
      link: true,
      lLink: true
    })
    .attr('id', d => 'linkId-' + d.autoId)
    .classed('blendedLink', l => !l.filtered && filterAction === 'blend')
    .classed('filteredLink', l => l.filtered)
    .classed('hiddenLink', l => l.hidden)
    .attr('id', l => 'linkId-' + l.autoId);

  /* Enter and update. */
  ln.attr(
    'd',
    l => {
      const srcCoords = getVisibleNodeCoords(l.source);
      const tarCoords = getVisibleNodeCoords(l.target);

      if (linkStyle === 'bezier1') {
        return drawBezierLink(
          l, srcCoords.x, srcCoords.y, tarCoords.x, tarCoords.y
        );
      }
      return drawStraightLink(
        l, srcCoords.x, srcCoords.y, tarCoords.x, tarCoords.y
      );
    })
    .classed({
      link: true,
      lLink: true
    })
    .attr('id', d => 'linkId-' + d.autoId)
    .classed('blendedLink', l => !l.filtered && filterAction === 'blend')
    .classed('filteredLink', l => l.filtered)
    .classed('hiddenLink', l => l.hidden)
    .attr('id', l => 'linkId-' + l.autoId);

  /* Exit. */
  ln.exit().remove();

  /* Set dom elements. */
  lLink = vis.canvas.select('g.lLinks').selectAll('.link');
}

/**
 * Draw analysis nodes.
 */
function updateAnalysisNodes () {
  /* Data join. */
  const lAnalysis = d3.select('g.analyses').selectAll('.analysis')
    .data(vis.graph.aNodes
      .sort((a, b) => parseISOTimeFormat(a.start) - parseISOTimeFormat(b.start))
    );

  /* Enter and update. */
  const anUpdate = lAnalysis.attr('id', d => 'gNodeId-' + d.autoId);

  anUpdate
    .attr('transform', d => 'translate(' + d.x + ',' + d.y + ')')
    .style('fill', d => timeColorScale(parseISOTimeFormat(d.start)));

  /* Add a clip-path to restrict labels within the cell area. */
  anUpdate.select('defs')
    .select('clipPath')
    .attr('id', an => 'bbClipId-' + an.autoId)
    .select('rect')
    .attr(
      'transform',
      'translate(' + (-cell.width / 2) + ',' + (-cell.height / 2) + ')'
    )
    .attr('y', -scaleFactor * vis.radius)
    .attr('width', cell.width)
    .attr('height', cell.height)
    .attr('rx', cell.width / 7)
    .attr('ry', cell.height / 7);

  /* Draw bounding box. */
  let analysisBBox = anUpdate.select('g')
    .attr('id', an => 'BBoxId-' + an.autoId)
    .classed({
      aBBox: true,
      BBox: true,
      hiddenBBox: true
    })
    .attr(
      'transform',
      'translate(' + (-cell.width / 2) + ',' + (-cell.height / 2) + ')'
    );

  analysisBBox.select('rect')
    .attr('y', -0.6 * scaleFactor * vis.radius)
    .attr('width', () => cell.width)
    .attr('height', () => cell.height)
    .attr('rx', cell.width / 7)
    .attr('ry', cell.height / 7);

  /* Add a clip-path to restrict labels within the cell area. */
  analysisBBox.select('defs')
    .select('clipPath')
    .attr('id', an => 'aBBClipId-' + an.autoId)
    .select('rect')
    .attr('y', -scaleFactor * vis.radius)
    .attr('width', cell.width)
    .attr('height', cell.height)
    .attr('rx', cell.width / 7)
    .attr('ry', cell.height / 7);

  /* Time as label. */
  analysisBBox.select('g')
    .classed('labels', true)
    .attr('clip-path', an => 'url(#aBBClipId-' + an.autoId + ')')
    .select('text')
    .attr(
      'transform',
      'translate(' + 1 * scaleFactor * vis.radius + ',' + 0 * scaleFactor * vis.radius + ')'
    )
    .text(d => '\uf013' + ' ' + d.wfCode)
    .classed('aBBoxLabel', true)
    .style('font-family', 'FontAwesome');

  /* Draw analysis node. */
  analysisNode = anUpdate.select('g')
    .attr('id', an => 'nodeId-' + an.autoId)
    .classed({
      aNode: true,
      filteredNode: true,
      blendedNode: false,
      selectedNode: false
    })
    .classed('hiddenNode', an => an.hidden);

  anUpdate.select('g').classed('children', true);

  aGlyph = analysisNode.select('g.glyph');
  aLabels = analysisNode.select('g.labels')
    .attr('clip-path', an => 'url(#bbClipId-' + an.autoId + ')');

  scaleFactor = 0.75;

  aGlyph.each(an => {
    if (an.predLinks.size() > 0) {
      d3.select(this).select('g.glAnchor').select('path')
        .attr('d', (
          'm' + (-2 * scaleFactor * vis.radius) + ' ' +
          (-0.5 * scaleFactor * vis.radius) + ' ' +
          'h' + (-0.8 * scaleFactor * vis.radius) + ' ' +
          'a' + (-0.5 * scaleFactor * vis.radius) + ' ' +
          (0.5 * scaleFactor * vis.radius) + ' 0 0 0 ' +
          '0 ' + (1 * scaleFactor * vis.radius) + ' ' +
          'h' + (+0.8 * scaleFactor * vis.radius) + ' ' +
          'z'
        ));
    }
  });

  aGlyph.each(an => {
    if (an.predLinks.size() > 1) {
      aGlyph.select('g.grAnchor').select('text')
        .attr(
          'transform',
          'translate(' + (-2.8 * scaleFactor * vis.radius) + ',' + 0.5 + ')'
        )
        .text(d => d.predLinks.size())
        .attr('class', 'aLabel')
        .style('display', 'inline');
    }
  });

  aGlyph.each(an => {
    if (an.succLinks.size() > 0) {
      d3.select(this).select('path')
        .attr('d', (
          'm' + (2 * scaleFactor * vis.radius) + ' ' +
          (-0.5 * scaleFactor * vis.radius) + ' ' +
          'h' + (0.8 * scaleFactor * vis.radius) + ' ' +
          'a' + (0.5 * scaleFactor * vis.radius) + ' ' +
          (0.5 * scaleFactor * vis.radius) + ' 0 0 1 ' +
          '0 ' + (1 * scaleFactor * vis.radius) + ' ' +
          'h' + (-0.8 * scaleFactor * vis.radius) + ' ' +
          'z'
        ));
    }
  });

  aGlyph.each(an => {
    if (an.succLinks.size() > 1) {
      d3.select(this).select('text')
        .attr(
          'transform',
          'translate(' + (2.8 * scaleFactor * vis.radius) + ',' + 0.5 + ')'
        )
        .text(d => d.succLinks.size())
        .attr('class', 'aLabel')
        .style('display', 'inline');
    }
  });

  aGlyph.select('rect')
    .attr('x', -2 * scaleFactor * vis.radius)
    .attr('y', -1.5 * scaleFactor * vis.radius)
    .attr('rx', 1)
    .attr('ry', 1)
    .attr('width', 4 * scaleFactor * vis.radius)
    .attr('height', 3 * scaleFactor * vis.radius);

  /* Add text labels. */
  aLabels.select('text')
    .text(d => d.doi.doiWeightedSum)
    .attr('class', 'nodeDoiLabel')
    .style('display', 'none');

  /* Enter. */
  const anEnter = lAnalysis.enter().append('g')
    .classed('analysis', true)
    .attr('id', d => 'gNodeId-' + d.autoId);

  anEnter
    .attr('transform', d => 'translate(' + d.x + ',' + d.y + ')')
    .style('fill', d => timeColorScale(parseISOTimeFormat(d.start)));

  /* Add a clip-path to restrict labels within the cell area. */
  anEnter.append('defs')
    .append('clipPath')
    .attr('id', an => 'bbClipId-' + an.autoId)
    .append('rect')
    .attr(
      'transform',
      'translate(' + (-cell.width / 2) + ',' + (-cell.height / 2) + ')'
    )
    .attr('y', -scaleFactor * vis.radius)
    .attr('width', cell.width)
    .attr('height', cell.height + 2 * scaleFactor * vis.radius)
    .attr('rx', cell.width / 7)
    .attr('ry', cell.height / 7);

  /* Draw bounding box. */
  analysisBBox = anEnter.append('g')
    .attr('id', an => 'BBoxId-' + an.autoId)
    .classed({
      aBBox: true,
      BBox: true,
      hiddenBBox: true
    })
    .attr(
      'transform',
      'translate(' + (-cell.width / 2) + ',' + (-cell.height / 2) + ')'
    );

  analysisBBox.append('rect')
    .attr('y', -0.6 * scaleFactor * vis.radius)
    .attr('width', () => cell.width)
    .attr('height', () => cell.height)
    .attr('rx', cell.width / 7)
    .attr('ry', cell.height / 7);

  const aDiff = analysisBBox.append('g').classed('aDiff', true)
    .attr(
      'transform',
      'translate(' + (0) + ',' + (0) + ')'
    );

  aDiff.each(an => {
    if (
      an.motifDiff.numIns !== 0 ||
      an.motifDiff.numOuts !== 0 ||
      an.motifDiff.numSubanalyses !== 0
    ) {
      d3.select(this).append('text')
        .text('\uf069')
        .classed('diff-node-type-icon', true)
        .style('font-family', 'FontAwesome');
    }
  });

  /* Add a clip-path to restrict labels within the cell area. */
  analysisBBox.append('defs')
    .append('clipPath')
    .attr('id', an => 'aBBClipId-' + an.autoId)
    .append('rect')
    .attr('y', -scaleFactor * vis.radius)
    .attr('width', cell.width)
    .attr('height', cell.height)
    .attr('rx', cell.width / 7)
    .attr('ry', cell.height / 7);

  /* Workflow as label. */
  analysisBBox.append('g')
    .classed('labels', true)
    .attr('clip-path', an => 'url(#aBBClipId-' + an.autoId + ')')
    .append('text')
    .attr(
      'transform',
      'translate(' + 1 * scaleFactor * vis.radius + ',' +
      0 * scaleFactor * vis.radius + ')'
    )
    .text(d => '\uf013' + ' ' + d.wfCode)
    .classed('aBBoxLabel', true)
    .style('font-family', 'FontAwesome');

  /* Draw analysis node. */
  let analysisNode = anEnter.append('g')
    .attr('id', an => 'nodeId-' + an.autoId)
    .classed({
      aNode: true,
      filteredNode: true,
      blendedNode: false,
      selectedNode: false
    })
    .classed('hiddenNode', an => an.hidden);

  anEnter.append('g').classed('children', true);

  let aGlyph = analysisNode.append('g')
    .classed('glyph', true);

  let aLabels = analysisNode.append('g')
    .classed('labels', true)
    .attr('clip-path', an => 'url(#bbClipId-' + an.autoId + ')');

  aGlyph.each(an => {
    if (an.predLinks.size() > 0) {
      d3.select(this).append('g')
        .classed('glAnchor', true)
        .append('path')
        .attr('d', (
          'm' + (-2 * scaleFactor * vis.radius) + ' ' +
          (-0.5 * scaleFactor * vis.radius) + ' ' +
          'h' + (-0.8 * scaleFactor * vis.radius) + ' ' +
          'a' + (-0.5 * scaleFactor * vis.radius) + ' ' +
          (0.5 * scaleFactor * vis.radius) + ' 0 0 0 ' +
          '0 ' + (1 * scaleFactor * vis.radius) + ' ' +
          'h' + (+0.8 * scaleFactor * vis.radius) + ' ' +
          'z'
        ))
        .classed('laAnchor', true);
    }
  });

  aGlyph.each(an => {
    if (an.predLinks.size() > 1) {
      d3.select(this)
        .select('g.glAnchor')
        .append('text')
        .attr(
          'transform',
          'translate(' + (-2.8 * scaleFactor * vis.radius) + ',' + 0.5 + ')'
        )
        .text(d => d.predLinks.size())
        .attr('class', 'aLabel')
        .style('display', 'inline');
    }
  });

  aGlyph.each(an => {
    if (an.succLinks.size() > 0) {
      d3.select(this).append('g')
        .classed('grAnchor', true)
        .append('path')
        .attr('d',
          'm' + (2 * scaleFactor * vis.radius) + ' ' +
          (-0.5 * scaleFactor * vis.radius) + ' ' +
          'h' + (0.8 * scaleFactor * vis.radius) + ' ' +
          'a' + (0.5 * scaleFactor * vis.radius) + ' ' +
          (0.5 * scaleFactor * vis.radius) + ' 0 0 1 ' +
          '0 ' + (1 * scaleFactor * vis.radius) + ' ' +
          'h' + (-0.8 * scaleFactor * vis.radius) + ' ' +
          'z'
        )
        .classed('raAnchor', true);
    }
  });

  aGlyph.each(an => {
    if (an.succLinks.size() > 1) {
      d3.select(this).select('g.grAnchor').append('text')
        .attr(
          'transform',
          'translate(' + (2.8 * scaleFactor * vis.radius) + ',' + 0.5 + ')'
        )
        .text(d => d.succLinks.size())
        .attr('class', 'aLabel')
        .style('display', 'inline');
    }
  });

  aGlyph.append('rect')
    .attr('x', -2.25 * scaleFactor * vis.radius)
    .attr('y', -1.0 * scaleFactor * vis.radius)
    .attr('rx', 1)
    .attr('ry', 1)
    .attr('width', 4.5 * scaleFactor * vis.radius)
    .attr('height', 2 * scaleFactor * vis.radius)
    .classed('aGlyph', true);

  /* Add text labels. */
  aLabels.append('text')
    .text(d => d.doi.doiWeightedSum)
    .attr('class', 'nodeDoiLabel')
    .style('display', 'none');

  aLabels.append('text')
    .attr(
      'transform',
      'translate(' + (-1.1 * scaleFactor * vis.radius) + ',0)'
    )
    .text('\uf085')
    .classed('an-node-type-icon', true)
    .style(
      'fill',
      an => timeColorScale(parseISOTimeFormat(an.start)) < '#888888' ?
        '#ffffff' : '#000000'
    );

  aLabels.append('text')
    .attr(
      'transform',
      'translate(' + (1.0 * scaleFactor * vis.radius) + ',0.25)'
    )
    .text(d => d.children.size())
    .attr('class', 'anLabel glyphNumeral')
    .style(
      'fill',
      an => timeColorScale(parseISOTimeFormat(an.start)) < '#888888' ?
        '#ffffff' : '#000000'
    );

  /* Exit. */
  lAnalysis.exit().remove();

  /* Set dom elements. */
  analysis = vis.canvas.select('g.analyses').selectAll('.analysis');
  aNode = d3.selectAll('.aNode');
  aBBox = d3.selectAll('.aBBox');
}

/**
 * Draws the subanalalysis containing links.
 * @param san Subanalysis node.
 */
function drawSubanalysisLinks (san) {
  /* Draw highlighting links. */
  /* Data join. */
  const sahl = d3.select('#gNodeId-' + san.autoId)
    .select('g.saHLinks').selectAll('.hLink')
    .data(san.links.values());

  /* Enter and update. */
  sahl.attr('d',
    l => {
      if (linkStyle === 'bezier1') {
        return drawBezierLink(l, l.source.x, l.source.y, l.target.x,
          l.target.y);
      }
      return drawStraightLink(
        l, l.source.x, l.source.y, l.target.x, l.target.y
      );
    })
    .classed({
      hLink: true,
      hiddenLink: true
    })
    .attr('id', l => 'hLinkId-' + l.autoId);

  /* Enter. */
  sahl.enter().append('path')
    .attr('d', l => {
      if (linkStyle === 'bezier1') {
        return drawBezierLink(l, l.source.x, l.source.y, l.target.x,
          l.target.y);
      }
      return drawStraightLink(
        l, l.source.x, l.source.y, l.target.x, l.target.y
      );
    })
    .classed({
      hLink: true,
      hiddenLink: true
    })
    .attr('id', l => 'hLinkId-' + l.autoId);

  /* Exit. */
  sahl.exit().remove();

  /* Draw normal links. */
  /* Data join. */
  const sal = d3.select('#gNodeId-' + san.autoId).select('g.saLinks')
    .selectAll('.Link')
    .data(san.links.values());

  /* Enter and update. */
  sal.attr(
    'd',
    l => {
      if (linkStyle === 'bezier1') {
        return drawBezierLink(
          l, l.source.x, l.source.y, l.target.x, l.target.y
        );
      }
      return drawStraightLink(l, l.source.x, l.source.y, l.target.x, l.target.y);
    })
    .classed({
      link: true,
      saLink: true,
      hiddenLink: true
    })
    .attr('id', l => 'linkId-' + l.autoId);

  /* Enter. */
  sal.enter().append('path')
    .attr('d', l => {
      if (linkStyle === 'bezier1') {
        return drawBezierLink(
          l, l.source.x, l.source.y, l.target.x, l.target.y
        );
      }
      return drawStraightLink(
        l, l.source.x, l.source.y, l.target.x, l.target.y
      );
    })
    .classed({
      link: true,
      saLink: true,
      hiddenLink: true
    })
    .attr('id', l => 'linkId-' + l.autoId);

  /* Exit. */
  sal.exit().remove();
}

/**
 * Draw subanalysis nodes.
 * @param saNodes Subanalysis nodes.
 */
function drawSubanalysisNodes () {
  analysis.each(an => {
    /* Data join. */
    subanalysis = d3.select(this).select('.children')
      .selectAll('.subanalysis')
      .data(an.children.values());

    const saEnter = subanalysis.enter().append('g')
      .classed('subanalysis', true)
      .attr('id', d => 'gNodeId-' + d.autoId)
      .attr('transform', d => 'translate(' + d.x + ',' + d.y + ')');

    saEnter.each(san => {
      const self = d3.select(this);
      /* Draw links for each subanalysis. */

      d3.select('#gNodeId-' + san.autoId).append('g')
        .classed('saHLinks', true);
      d3.select('#gNodeId-' + san.autoId).append('g')
        .classed('saLinks', true);
      drawSubanalysisLinks(san);

      /* Compute bounding box for subanalysis child nodes. */
      const saBBoxCoords = getWFBBoxCoords(san, 0);

      /* Add a clip-path to restrict labels within the cell area. */
      self.append('defs')
        .append('clipPath')
        .attr('id', 'bbClipId-' + san.autoId)
        .append('rect')
        .attr('transform',
          'translate(' + (-cell.width / 2) + ',' + (-cell.height / 2) + ')'
        )
        .attr('width', cell.width)
        .attr('height', cell.height);

      /* Draw bounding box. */
      const subanalysisBBox = self.append('g')
        .attr('id', 'BBoxId-' + san.autoId)
        .classed({
          saBBox: true,
          BBox: true,
          hiddenBBox: true
        })
        .attr(
          'transform',
          'translate(' + (-cell.width / 2) + ',' + (-cell.height / 2) + ')'
        );

      /* Add a clip-path to restrict labels within the cell area. */
      subanalysisBBox.append('defs')
        .attr('x', scaleFactor * vis.radius)
        .attr('y', -0.5 * scaleFactor * vis.radius)
        .append('clipPath')
        .attr('id', 'saBBClipId-' + san.autoId)
        .append('rect')
        .attr('width', saBBoxCoords.x.max - saBBoxCoords.x.min -
          scaleFactor * vis.radius)
        .attr('height', cell.height);

      subanalysisBBox.append('rect')
        .attr('x', scaleFactor * vis.radius)
        .attr('y', scaleFactor * vis.radius)
        .attr('width',
          saBBoxCoords.x.max - saBBoxCoords.x.min -
          2 * scaleFactor * vis.radius
        )
        .attr('height',
          saBBoxCoords.y.max - saBBoxCoords.y.min -
          2 * scaleFactor * vis.radius
        )
        .attr('rx', cell.width / 7)
        .attr('ry', cell.height / 7);

      /* Draw subanalysis node. */
      const subanalysisNode = self.append('g')
        .attr('id', 'nodeId-' + san.autoId)
        .classed({
          saNode: true,
          filteredNode: true,
          blendedNode: false,
          selectedNode: false
        })
        .classed('hiddenNode', sann => sann.hidden);

      self.append('g').classed('children', true);

      const saGlyph = subanalysisNode.append('g').classed('glyph', true);
      const saLabels = subanalysisNode.append('g')
        .classed('labels', true)
        .attr('clip-path', 'url(#bbClipId-' + san.autoId + ')');

      saGlyph.each(sann => {
        if (sann.predLinks.size() > 0) {
          d3.select(this).append('g')
            .classed('glAnchor', true)
            .append('path')
            .attr(
              'd',
              'm' + (-2 * scaleFactor * vis.radius) + ' ' +
              (-0.5 * scaleFactor * vis.radius) + ' ' +
              'h' + (-0.8 * scaleFactor * vis.radius) + ' ' +
              'a' + (-0.5 * scaleFactor * vis.radius) + ' ' +
              (0.5 * scaleFactor * vis.radius) + ' 0 0 0 ' +
              '0 ' + (1 * scaleFactor * vis.radius) + ' ' +
              'h' + (+0.8 * scaleFactor * vis.radius) + ' ' +
              'z'
            )
            .classed('lsaAnchor', true);
        }
      });

      saGlyph.each(sann => {
        if (sann.predLinks.size() > 1) {
          d3.select(this).select('g.glAnchor').append('text')
            .attr(
              'transform',
              'translate(' + (-2.8 * scaleFactor * vis.radius) +
              ',' +
              0.5 + ')'
            )
            .text(d => d.predLinks.size())
            .attr('class', 'saLabel')
            .style('display', 'inline');
        }
      });

      saGlyph.each(sann => {
        if (sann.succLinks.size() > 0) {
          saGlyph.append('g')
            .classed('grAnchor', true)
            .append('path')
            .attr(
              'd',
              'm' + (2 * scaleFactor * vis.radius) + ' ' +
              (-0.5 * scaleFactor * vis.radius) + ' ' +
              'h' + (0.8 * scaleFactor * vis.radius) + ' ' +
              'a' + (0.5 * scaleFactor * vis.radius) + ' ' +
              (0.5 * scaleFactor * vis.radius) + ' 0 0 1 ' +
              '0 ' + (1 * scaleFactor * vis.radius) + ' ' +
              'h' + (-0.8 * scaleFactor * vis.radius) + ' ' +
              'z'
            )
            .classed('rsaAnchor', true);
        }
      });

      saGlyph.each(sann => {
        if (sann.succLinks.size() > 1) {
          d3.select(this).select('g.grAnchor')
            .append('text')
            .attr(
              'transform',
              'translate(' + (2.8 * scaleFactor * vis.radius) +
              ',' +
              0.5 + ')'
            )
            .text(d => d.succLinks.size()).attr('class', 'saLabel')
            .style('display', 'inline');
        }
      });

      saGlyph.append('rect')
        .attr('x', -2.25 * scaleFactor * vis.radius)
        .attr('y', -1 * scaleFactor * vis.radius)
        .attr('rx', 1)
        .attr('ry', 1)
        .attr('width', 4.5 * scaleFactor * vis.radius)
        .attr('height', 2 * scaleFactor * vis.radius);

      /* Add text labels. */
      saLabels.append('text')
        .text(d => d.doi.doiWeightedSum)
        .attr('class', 'nodeDoiLabel')
        .style('display', 'none');

      saLabels.append('text')
        .attr(
          'transform',
          'translate(' + (-1.1 * scaleFactor * vis.radius) + ',0)'
        )
        .text('\uf013')
        .classed('san-node-type-icon', true)
        .style(
          'fill',
          sann => timeColorScale(
            parseISOTimeFormat(sann.parent.start)
          ) < '#888888' ? '#ffffff' : '#000000'
        );

      saLabels.append('text')
        .attr('transform',
          'translate(' + (1.0 * scaleFactor * vis.radius) + ',0.25)')
        .text(
          d => d.wfUuid !== 'dataset' ?
            d.children.values().filter(cn => cn.nodeType === 'dt').length :
            d.children.size()
        )
        .attr('class', 'sanLabel glyphNumeral')
        .style(
          'fill',
          sann => timeColorScale(
            parseISOTimeFormat(sann.parent.start)
          ) < '#888888' ? '#ffffff' : '#000000'
        );
    });
  });

  /* Set dom elements. */
  saNode = d3.selectAll('.saNode');
  subanalysis = d3.selectAll('.subanalysis');
  saBBox = d3.selectAll('.saBBox');

  saLink = d3.selectAll('.saLink');
  link = d3.selectAll('.link');
  hLink = d3.selectAll('.hLink');
}

/**
 * Draw nodes.
 * @param nodes All nodes within the graph.
 */
function drawNodes () {
  subanalysis.each(san => {
    node = d3.select(this).select('.children').selectAll('.node')
      .data(san.children.values())
      .enter()
      .append('g')
      .classed('node', true)
      .attr('id', d => 'gNodeId-' + d.autoId)
      .attr('transform', d => 'translate(' + d.x + ',' + d.y + ')');

    node.each(d => {
      const self = d3.select(this);
      self.attr('class', dd => 'node ' + dd.nodeType + 'Node')
      .attr('id', dd => 'nodeId-' + dd.autoId)
      .classed('blendedNode', l => !l.filtered && filterAction === 'blend')
      .classed('filteredNode', l => l.filtered)
      .classed('hiddenNode', l => l.hidden);

      /* Add a clip-path to restrict labels within the cell area. */
      self.append('defs')
        .append('clipPath')
        .attr('id', 'bbClipId-' + d.autoId)
        .append('rect')
        .attr('transform',
          'translate(' + (-1.5 * scaleFactor * vis.radius) + ',' +
          (-cell.height * 3 / 4) + ')'
        )
        .attr('width', cell.width - 2 * scaleFactor * vis.radius)
        .attr('height', cell.height + 1 * scaleFactor * vis.radius);

      const nGlyph = self.append('g').classed('glyph', true);
      const nLabels = self.append('g').classed('labels', true)
        .attr('clip-path', 'url(#bbClipId-' + d.autoId + ')');

      nGlyph.each(n => {
        if (n.predLinks.size() > 0) {
          d3.select(this).append('g')
            .classed('glAnchor', true)
            .append('path')
            .attr(
              'd',
              'm' + 0 + ' ' + (-0.5 * scaleFactor * vis.radius) +
              ' ' +
              'h' + (-1 * scaleFactor * vis.radius) + ' ' +
              'a' + (-0.5 * scaleFactor * vis.radius) + ' ' +
              (0.5 * scaleFactor * vis.radius) + ' 0 0 0 ' +
              '0 ' + (1 * scaleFactor * vis.radius) + ' ' +
              'h' + (+1 * scaleFactor * vis.radius) + ' ' +
              'z'
            )
            .classed('lnAnchor', true);
        }
      });

      nGlyph.each(n => {
        if (n.succLinks.size() > 0) {
          nGlyph.append('g')
            .classed('grAnchor', true)
            .append('path')
            .attr(
              'd',
              'm' + 0 + ' ' + (-0.5 * scaleFactor * vis.radius) +
              ' ' +
              'h' + (1 * scaleFactor * vis.radius) + ' ' +
              'a' + (0.5 * scaleFactor * vis.radius) + ' ' +
              (0.5 * scaleFactor * vis.radius) + ' 0 0 1 ' +
              '0 ' + (1 * scaleFactor * vis.radius) + ' ' +
              'h' + (-1 * scaleFactor * vis.radius) + ' ' +
              'z'
            )
            .classed('rnAnchor', true);
        }
      });

      if (d.nodeType === 'raw' || d.nodeType === 'intermediate' ||
        d.nodeType === 'stored') {
        nGlyph
          .append('circle')
          .attr(
            'r',
            dd => dd.nodeType === 'intermediate' ?
              3 * scaleFactor * vis.radius / 4 :
              5 * scaleFactor * vis.radius / 6
          );
      } else {
        if (d.nodeType === 'special') {
          nGlyph
            .append('rect')
            .attr('transform', 'translate(' +
              (-3 * scaleFactor * vis.radius / 4) + ',' +
              (-3 * scaleFactor * vis.radius / 4) + ')')
            .attr('width', 1.5 * scaleFactor * vis.radius)
            .attr('height', 1.5 * scaleFactor * vis.radius);
        } else if (d.nodeType === 'dt') {
          nGlyph
            .append('rect')
            .attr(
              'transform',
              'translate(' +
              (-1.25 * scaleFactor * vis.radius / 2) + ',' +
              (-1.25 * scaleFactor * vis.radius / 2) + ')' +
              'rotate(45 ' +
              (1.25 * scaleFactor * vis.radius / 2) + ',' +
              (1.25 * scaleFactor * vis.radius / 2) + ')'
            )
            .attr('width', 1.25 * scaleFactor * vis.radius)
            .attr('height', 1.25 * scaleFactor * vis.radius);
        }
      }

      nLabels.append('text')
        .text(dd => dd.doi.doiWeightedSum)
        .attr('class', 'nodeDoiLabel')
        .style('display', 'none');

      nLabels.each(() => {
        d3.select(this)
          .append('text')
          .attr(
            'transform',
            'translate(' + (-1.5 * scaleFactor * vis.radius) + ',' +
            (-1.5 * scaleFactor * vis.radius) + ')'
          )
          .text(ddd => {
            let nodeAttrLabel = '';

            if (ddd.nodeType === 'stored') {
              nodeAttrLabel = ddd.attributes.get('name');
            } else {
              /* Trim data transformation node names for
               testtoolshed repo.*/
              if (ddd.nodeType === 'dt') {
                if (ddd.name.indexOf(': ') > 0) {
                  const firstPart = ddd.name.substr(
                    ddd.name.indexOf(': ') + 2, ddd.name.length - ddd.name.indexOf(': ') - 2
                  );
                  ddd.label = firstPart;
                  const secondPart = ddd.name.substr(0, ddd.name.indexOf(': '));
                  ddd.name = firstPart + ' (' + secondPart + ')';
                  nodeAttrLabel = ddd.label;
                }
              } else {
                nodeAttrLabel = ddd.name;
              }
            }
            return nodeAttrLabel;
          })
          .attr('class', 'nodeAttrLabel');
      });

      nLabels.each(dd => {
        if (dd.nodeType === 'stored') {
          d3.select(this).append('text')
            .text('\uf0f6')
            .classed('stored-node-type-icon', true)
            .style(
              'fill',
              n => timeColorScale(
                parseISOTimeFormat(n.parent.parent.start)
                ) < '#888888' ? '#ffffff' : '#000000'
            );
        }
      });
    });
  });
  /* Set node dom element. */
  node = d3.selectAll('.node');
}

/**
 * Compute bounding box for child nodes.
 * @param n BaseNode.
 * @param offset Cell offset.
 * @returns {{x: {min: *, max: *}, y: {min: *, max: *}}} Min and
 * max x, y coords.
 */
function getWFBBoxCoords (n, offset) {
  let minX;
  let minY;
  let maxX;
  let maxY = 0;

  if (n.children.empty() || !n.hidden) {
    minX = (-cell.width / 2 + offset);
    maxX = (cell.width / 2 - offset);
    minY = (-cell.width / 2 + offset);
    maxY = (cell.width / 2 - offset);
  } else {
    minX = d3.min(n.children.values(), d => d.x - cell.width / 2 + offset);
    maxX = d3.max(n.children.values(), d => d.x + cell.width / 2 - offset);
    minY = d3.min(n.children.values(), d => d.y - cell.height / 2 + offset);
    maxY = d3.max(n.children.values(), d => d.y + cell.height / 2 - offset);
  }

  return {
    x: {
      min: minX,
      max: maxX
    },
    y: {
      min: minY,
      max: maxY
    }
  };
}

/**
 * Compute bounding box for expanded analysis nodes.
 * @param an Analysis node.
 * @param offset Cell offset.
 * @returns {{x: {min: number, max: number}, y: {min: number, max: number}}}
 * Min and max x, y coords.
 */
function getABBoxCoords (an, _offset_) {
  let offset = _offset_;

  if (!offset) {
    offset = 0;
  }

  const minX = !an.hidden ? an.x : d3.min(an.children.values(),
    san => !san.hidden ? an.x + san.x : d3.min(san.children.values(),
      cn => !cn.hidden ? an.x + san.x + cn.x : an.x)
  );
  const maxX = !an.hidden ? an.x : d3.max(an.children.values(),
    san => !san.hidden ? an.x + san.x : d3.max(san.children.values(),
      cn => !cn.hidden ? an.x + san.x + cn.x : an.x)
  );
  const minY = !an.hidden ? an.y : d3.min(an.children.values(),
    san => !san.hidden ? an.y + san.y : d3.min(san.children.values(),
      cn => !cn.hidden ? an.y + san.y + cn.y : an.y)
  );
  const maxY = !an.hidden ? an.y : d3.max(an.children.values(),
    san => !san.hidden ? an.y + san.y : d3.max(san.children.values(),
      cn => !cn.hidden ? an.y + san.y + cn.y : an.y)
  );

  return {
    x: {
      min: minX + offset,
      max: maxX + cell.width - offset
    },
    y: {
      min: minY + offset,
      max: maxY + cell.height - offset
    }
  };
}

/**
 * Dagre layout including layer nodes.
 * @param graph The provenance graph.
 */
function dagreLayerLayout (graph) {
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
    curWidth = vis.cell.width;
    curHeight = vis.cell.height;

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
    curWidth = vis.cell.width;
    curHeight = vis.cell.height;

    ln.x = dlLNodes
      .filter(d => d.key === ln.autoId.toString())[0].value.x - curWidth / 2;

    ln.y = dlLNodes
      .filter(d => d.key === ln.autoId.toString())[0].value.y - curHeight / 2;

    updateNodeAndLink(ln, d3.select('#gNodeId-' + ln.autoId));
  });
}

/* TODO: Code cleanup. */
/**
 * Dynamic Dagre layout.
 * @param graph The provenance Graph.
 */
function dagreDynamicLayerLayout (graph) {
  /* Initializations. */
  const g = new dagre.graphlib.Graph();
  g.setGraph({
    rankdir: 'LR',
    nodesep: 1 * scaleFactor * vis.radius,
    edgesep: 0,
    ranksep: 4 * scaleFactor * vis.radius,
    marginx: 0,
    marginy: 0
  });
  g.setDefaultEdgeLabel({});
  let anBBoxCoords = {};
  let curWidth = 0;
  let curHeight = 0;
  let exNum = 0;
  let accY = 0;

  /* Add layer or analysis nodes with a dynamic bounding box size
   * (based on visible child nodes). */
  graph.lNodes.values().forEach(ln => {
    d3.select('#BBoxId-' + ln.autoId).classed('hiddenBBox', true);
    if (!ln.hidden) {
      if (ln.filtered) {
        d3.select('#BBoxId-' + ln.autoId).classed('hiddenBBox', false);
      }
      curWidth = vis.cell.width;
      curHeight = vis.cell.height;

      /* Check exaggerated layer children. */
      /* Add visible dimensions to layer node without bounding boxes. */
      /* Based on current y-coord order, the stack of nodes will be drawn
       vertically. */
      /* Child nodes inherit x-coord of layer node and y-coord will be
       computed based on the statement above.*/
      /* Layer node number labels may be updated. */
      /* Maybe add a bounding box for layered node and exaggerated nodes.*/

      exNum = 0;
      accY = ln.y + vis.cell.height;
      ln.children.values()
        .filter(an => an.filtered || filterAction === 'blend')
        .sort((a, b) => a.y - b.y)
        .forEach(an => {
          if (an.exaggerated && an.filtered) {
            exNum++;
            an.x = an.parent.x;
            an.y = accY;
            accY += (getABBoxCoords(an, 0).y.max - getABBoxCoords(an, 0).y.min);

            updateNodeAndLink(an, d3.select('#gNodeId-' + an.autoId));
            d3.select('#BBoxId-' + ln.autoId).classed('hiddenBBox', false);
            d3.select('#BBoxId-' + an.autoId).classed('hiddenBBox', false);
          } else {
            an.x = an.parent.x;
            an.y = an.parent.y;
          }
        });

      /* Set layer label and bounding box. */
      const numChildren = ln.children.values()
        .filter(an => an.filtered || filterAction === 'blend').length;

      d3.select('#nodeId-' + ln.autoId).select('g.labels').select('.lnLabel')
        .text(numChildren - exNum + '/' + ln.children.size());

      /* Get potential expanded bounding box size. */
      let accHeight = curHeight;
      let accWidth = curWidth;
      ln.children.values()
        .filter(an => an.filtered || filterAction === 'blend')
        .forEach(an => {
          if (an.exaggerated) {
            anBBoxCoords = getABBoxCoords(an, 0);
            if (anBBoxCoords.x.max - anBBoxCoords.x.min > accWidth) {
              accWidth = anBBoxCoords.x.max - anBBoxCoords.x.min;
            }
            accHeight += anBBoxCoords.y.max - anBBoxCoords.y.min;
          }
        });

      d3.select('#lBBClipId-' + ln.autoId)
        .select('rect')
        .attr('width', accWidth)
        .attr('height', accHeight);

      d3.select('#BBoxId-' + ln.autoId).attr('transform',
        'translate(' + (-accWidth / 2) + ',' +
        (-vis.cell.height / 2) + ')')
        .select('rect')
        .attr('width', accWidth)
        .attr('height', accHeight);

      g.setNode(ln.autoId, {
        label: ln.autoId,
        width: accWidth,
        height: accHeight
      });
    } else {
      ln.children.values()
        .filter(an => an.filtered || filterAction === 'blend')
        .forEach(an => {
          anBBoxCoords = getABBoxCoords(an, 0);
          curWidth = anBBoxCoords.x.max - anBBoxCoords.x.min;
          curHeight = anBBoxCoords.y.max - anBBoxCoords.y.min;
          g.setNode(an.autoId, {
            label: an.autoId,
            width: curWidth,
            height: curHeight
          });
        });
    }
  });

  /* Add layer-to-layer links. */
  graph.lLinks.values().forEach(ll => {
    if (!ll.hidden) {
      g.setEdge(ll.source.autoId, ll.target.autoId, {
        minlen: 1,
        weight: 1,
        width: 0,
        height: 0,
        labelpos: 'r',
        labeloffset: 0
      });
    }
  });

  /* Add analysis-mixed links. */
  graph.aLinks.forEach(l => {
    if (!l.hidden) {
      /* Either the layer or the analysis is visible and therefore
       virtual links are created.*/
      let src = l.source.parent.parent.parent.autoId;
      let tar = l.target.parent.parent.parent.autoId;
      if (l.source.parent.parent.parent.hidden) {
        src = l.source.parent.parent.autoId;
      }
      if (l.target.parent.parent.parent.hidden) {
        tar = l.target.parent.parent.autoId;
      }

      g.setEdge(src, tar, {
        minlen: 1,
        weight: 1,
        width: 0,
        height: 0,
        labelpos: 'r',
        labeloffset: 0
      });
    }
  });

  /* Compute layout. */
  dagre.layout(g);

  /* Set layer and analysis coords. */
  layoutCols = d3.map();
  let accWidth = 0;
  let accHeight = 0;

  /* Assign x and y coords for layers or analyses. Check filter action
   as well as exaggerated nodes. */
  d3.map(g._nodes).values().forEach(n => {
    if (typeof n !== 'undefined') {
      if (graph.lNodes.has(n.label) && (graph.lNodes.get(n.label).filtered ||
        filterAction === 'blend')) {
        const ln = graph.lNodes.get(n.label);
        accHeight = vis.cell.height;
        accWidth = vis.cell.width;

        ln.children.values()
        .filter(an => an.filtered || filterAction === 'blend')
        .forEach(an => {
          if (an.exaggerated) {
            anBBoxCoords = getABBoxCoords(an, 0);
            if (anBBoxCoords.x.max - anBBoxCoords.x.min > accWidth) {
              accWidth = anBBoxCoords.x.max - anBBoxCoords.x.min;
            }
            accHeight += anBBoxCoords.y.max - anBBoxCoords.y.min;
          }
        });

        ln.x = n.x - vis.cell.width / 2;
        ln.y = n.y - accHeight / 2;

        exNum = 0;
        accY = ln.y + vis.cell.height;
        ln.children.values()
        .filter(an => an.filtered || filterAction === 'blend')
        .sort((a, b) => a.y - b.y)
        .forEach(an => {
          anBBoxCoords = getABBoxCoords(an, 0);
          curWidth = anBBoxCoords.x.max - anBBoxCoords.x.min;
          an.x = ln.x - curWidth / 2 + vis.cell.width / 2;

          if (an.exaggerated) {
            an.y = accY;
            accY += (getABBoxCoords(an, 0).y.max -
            getABBoxCoords(an, 0).y.min);
          } else {
            an.y = an.parent.y;
          }
        });
      } else {
        const an = graph.aNodes
          .filter(
            ann => ann.autoId === n.label &&
            (ann.filtered || filterAction === 'blend')
          )[0];

        if (an && typeof an !== 'undefined') {
          anBBoxCoords = getABBoxCoords(an, 0);
          accWidth = anBBoxCoords.x.max - anBBoxCoords.x.min;
          accHeight = anBBoxCoords.y.max - anBBoxCoords.y.min;

          an.x = n.x - accWidth / 2;
          an.y = n.y - accHeight / 2;
        }
      }

      /* Compute layouted columns. */
      if (layoutCols.has(n.x)) {
        layoutCols.get(n.x).nodes.push(n.label);
      } else {
        layoutCols.set(n.x, {
          nodes: [],
          width: 0
        });
        layoutCols.get(n.x).nodes.push(n.label);
      }
      if (accWidth > layoutCols.get(n.x).width) {
        layoutCols.get(n.x).width = accWidth;
      }
    }
  });

  /* Update graph dom elements. */
  vis.graph.lNodes.values().forEach(ln => {
    updateNodeAndLink(ln, d3.select('#gNodeId-' + ln.autoId));
  });

  /* Reorder node columns by y-coords. */
  layoutCols.values().forEach(c => {
    c.nodes = c.nodes.sort((a, b) => a.y - b.y);
  });
}

/**
 * Path highlighting.
 * @param d Node.
 * @param keyStroke Keystroke being pressed at mouse click.
 */
function handlePathHighlighting (d, keyStroke) {
  /* Clear any highlighting. */
  clearHighlighting();

  if (keyStroke === 's') {
    /* Highlight path. */
    highlightSuccPath(d);
  } else if (keyStroke === 'p') {
    /* Highlight path. */
    highlightPredPath(d);
  }

  d3.select('.aHLinks').selectAll('.hLink').each(l => {
    if (l.highlighted) {
      l.hidden = false;
      d3.select(this).classed('hiddenLink', false);
    }
  });

  /* TODO: Temporarily enabled. */
  if (doiAutoUpdate) {
    recomputeDOI();
  }
}

/* TODO: Revise. */
/**
 * Fit visualization onto free windows space.
 * @param transitionTime The time in milliseconds for the duration of the
 * animation.
 */
function fitGraphToWindow (transitionTime) {
  const min = [0, 0];
  const max = [0, 0];

  vis.graph.aNodes.forEach(an => {
    const anBBox = getABBoxCoords(an, 0);
    if (anBBox.x.min < min[0]) {
      min[0] = anBBox.x.min;
    }
    if (anBBox.x.max > max[0]) {
      max[0] = anBBox.x.max;
    }
    if (anBBox.y.min < min[1]) {
      min[1] = anBBox.y.min;
    }
    if (anBBox.y.max > max[1]) {
      max[1] = anBBox.y.max;
    }
  });

  /* TODO: Fix for temporary sidebar overlap. */
  const sidebarOverlap = $('#provenance-sidebar').width() -
  $('#solr-facet-view').width() -
  parseFloat($('#main-area').css('margin-left').replace('px', ''));


  const delta = [max[0] - min[0], max[1] - min[1]];
  const factor = [(vis.width / delta[0]), (vis.height / delta[1])];
  const newScale = d3.min(factor.concat([3])) * 0.9;
  const newPos = [(sidebarOverlap > 0 ? sidebarOverlap : 0) +
  vis.margin.left * 2 * newScale,
    ((vis.height - delta[1] * newScale) / 2 + vis.margin.top * 2)];

  vis.canvas
    .transition()
    .duration(transitionTime)
    .attr('transform', 'translate(' + newPos + ')scale(' + newScale + ')');

  vis.zoom.translate(newPos);
  vis.zoom.scale(newScale);

  /* Semantic zoom. */
  setTimeout(() => {
    if (newScale < 1) {
      d3.selectAll('.BBox').classed('hiddenNode', true);
      d3.selectAll('.lDiff, .aDiff').classed('hiddenNode', true);
    } else {
      d3.selectAll('.BBox').classed('hiddenNode', false);
      d3.selectAll('.lDiff, .aDiff').classed('hiddenNode', false);
    }

    if (newScale < 1.7) {
      vis.canvas.selectAll('.anLabel, .sanLabel, .lnLabel, ' +
        '.nodeAttrLabel, .stored-node-type-icon, .an-node-type-icon, ' +
        '.san-node-type-icon, .l-node-type-icon, .lBBoxLabel, ' +
        '.aBBoxLabel, .nodeDoiLabel')
        .classed('hiddenLabel', true);
      d3.selectAll('.glAnchor, .grAnchor').classed('hiddenNode', true);
    } else {
      vis.canvas.selectAll('.anLabel, .sanLabel, .lnLabel, ' +
        '.nodeAttrLabel, .stored-node-type-icon, .an-node-type-icon, ' +
        '.san-node-type-icon, .l-node-type-icon, .lBBoxLabel, ' +
        '.aBBoxLabel, .nodeDoiLabel')
        .classed('hiddenLabel', false);
      d3.selectAll('.glAnchor, .grAnchor').classed('hiddenNode', false);
    }
  }, transitionTime);


  /* Background rectangle fix. */
  vis.rect.attr('transform', 'translate(' +
    (-newPos[0] / newScale) + ',' +
    (-newPos[1] / newScale) + ')' + ' ' +
    'scale(' + (1 / newScale) + ')');

  /* Quick fix to exclude scale from text labels. */
  vis.canvas.selectAll('.lBBoxLabel')
    .transition()
    .duration(transitionTime)
    .attr('transform', 'translate(' +
      1 * scaleFactor * vis.radius + ',' +
      0.5 * scaleFactor * vis.radius + ') ' +
      'scale(' + (1 / newScale) + ')');

  vis.canvas.selectAll('.aBBoxLabel')
    .transition()
    .duration(transitionTime)
    .attr('transform', 'translate(' +
      1 * scaleFactor * vis.radius + ',' +
      0 * scaleFactor * vis.radius + ') ' +
      'scale(' + (1 / newScale) + ')');

  vis.canvas.selectAll('.nodeDoiLabel')
    .transition()
    .duration(transitionTime)
    .attr('transform', 'translate(' + 0 + ',' +
      (1.6 * scaleFactor * vis.radius) + ') ' +
      'scale(' + (1 / newScale) + ')');

  vis.canvas.selectAll('.nodeAttrLabel')
    .transition()
    .duration(transitionTime)
    .attr('transform', 'translate(' +
      (-1.5 * scaleFactor * vis.radius) + ',' +
      (-1.5 * scaleFactor * vis.radius) + ') ' +
      'scale(' + (1 / newScale) + ')');

  /* Trim nodeAttrLabel */
  /* Get current node label pixel width. */
  const maxLabelPixelWidth = (cell.width - 2 * scaleFactor * vis.radius) *
  d3.transform(d3.select('.canvas').select('g').select('g')
    .attr('transform')).scale[0];

  /* Get label text. */
  d3.selectAll('.node').select('.nodeAttrLabel').each(d => {
    let attrText = (d.label === '') ? d.name : d.label;
    if (d.nodeType === 'stored') {
      let selAttrName = '';
      $('#prov-ctrl-visible-attribute-list > li').each(function () {
        if ($(this).find('input[type=\'radio\']').prop('checked')) {
          selAttrName = $(this).find('label').text();
        }
      });
      attrText = d.attributes.get(selAttrName);
    }

    /* Set label text. */
    if (typeof attrText !== 'undefined') {
      d3.select(this).text(attrText);
      const trimRatio = parseInt(attrText.length *
        (maxLabelPixelWidth / this.getComputedTextLength()), 10);
      if (trimRatio < attrText.length) {
        d3.select(this).text(attrText.substr(0, trimRatio - 3) + '...');
      }
    }
  });
}

/**
 * Clears node selection.
 */
function clearNodeSelection () {
  domNodeset.each(d => {
    d.selected = false;
    d.doi.selectedChanged();
    d3.select('#nodeId-' + d.autoId).classed('selectedNode', false);
    $('#nodeId-' + d.autoId).find('.glyph').find('rect, circle')
      .css('stroke', colorStrokes);
  });

  $('#nodeInfoTitle').html('Select a node: - ');
  $('#nodeInfoTitleLink').html('');
  $('#' + 'provenance-nodeInfo-content').html('');

  selectedNodeSet = d3.map();

  $('.filteredNode').hover(function () {
    $(this).find('rect, circle').css('stroke', colorHighlight);
  }, () => {
    $(this).find('rect, circle').css('stroke', colorStrokes);
  });
}

/**
 * Left click on a node to select and reveal additional details.
 * @param d Node
 */
function handleNodeSelection (d) {
  clearNodeSelection();
  d.selected = true;
  propagateNodeSelection(d, true);
  selectedNodeSet.set(d.autoId, d);
  d3.select('#nodeId-' + d.autoId).classed('selectedNode', d.selected)
    .select('.glyph').select('rect, circle')
    .style('stroke', colorHighlight);

  $('#nodeId-' + d.autoId).hover(function () {
    $(this).find('rect, circle').css('stroke', colorHighlight);
  }, () => {
    $(this).find('rect, circle').css('stroke', colorHighlight);
  });

  d.doi.selectedChanged();
  if (doiAutoUpdate) {
    recomputeDOI();
  }
}


/* TODO: Clean up. */
/* TODO: May add bounding box color. */
/**
 * Colorcoding view.
 */
function drawColorcodingView () {
  const wfColorScale = d3.scale.category10();
  const wfColorData = d3.map();

  wfColorData.set('dataset', 0);
  let wfIndex = 1;
  vis.graph.workflowData.values().forEach(wf => {
    let wfName = wf.name;
    if (wf.name.substr(0, 15) === 'Test workflow: ') {
      wfName = wf.name.substr(15, wf.name.length - 15);
    }
    if (wfName.indexOf('(') > 0) {
      wfName = wfName.substr(0, wfName.indexOf('('));
    }
    if (wfName.indexOf('-') > 0) {
      wfName = wfName.substr(0, wfName.indexOf('-'));
    }
    if (!wfColorData.has(wfName)) {
      wfColorData.set(wfName, (wfIndex));
      wfIndex++;
    }
    wf.code = wfName;
  });

  wfColorData.entries().forEach((wf, i) => {
    const wfName = wf.key;

    $('<tr/>', {
      id: 'provvis-cc-wf-tr-' + i
    }).appendTo('#prov-ctrl-cc-workflow-content');

    $('<td/>', {
      id: 'provvis-cc-wf-td-' + i
    }).appendTo('#provvis-cc-wf-tr-' + i);

    $('<label/>', {
      id: 'provvis-cc-wf-label-' + i,
      class: 'provvis-cc-label',
      html: '<input id="provvis-cc-wf-color-' + i +
        '" type="text">' + wfName
    }).appendTo('#provvis-cc-wf-td-' + i);

    $('<em/>', {
      id: 'provvis-cc-wf-hex-' + i,
      class: 'provvis-cc-hide-hex',
      html: wfColorScale(wf.value)
    }).appendTo('#provvis-cc-wf-label-' + i);

    /* Change event. */
    $('#provvis-cc-wf-color-' + i).spectrum({
      color: wfColorScale(wf.value),
      showAlpha: false,
      change (color) {
        $('#provvis-cc-wf-hex-' + i).text(color.toHexString());
        switchColorScheme('workflow');
      }
    });
  });

  function updateStrokesColor (color) {
    $('#provvis-cc-strokes-hex').text(color);
    link.style({
      stroke: color
    });
    domNodeset.style({
      stroke: color
    });
    $('.glAnchor, .grAnchor').css({
      stroke: color,
      fill: color
    });
  }

  function updateHighlightColor (color) {
    $('#provvis-cc-highlight-hex').text(color);
    hLink.style({
      stroke: color
    });

    $('.filteredNode').hover(function () {
      $(this).find('rect, circle').css({
        stroke: color
      });
    }, () => {
      $(this).find('rect, circle').css({
        stroke: colorStrokes
      });
    });

    $('.glAnchor, .grAnchor').hover(function () {
      $(this).css({
        stroke: color,
        fill: color
      });
    }, () => {
      $(this).css({
        stroke: colorStrokes,
        fill: colorStrokes
      });
    });
  }

  /* Change events. */
  $('#provvis-cc-strokes').spectrum({
    color: '#136382',
    showAlpha: true,
    change (color) {
      colorStrokes = color.toHexString();
      updateStrokesColor(colorStrokes);
      updateHighlightColor(colorHighlight);
    }
  });

  $('#provvis-cc-highlight').spectrum({
    color: '#ed7407',
    showAlpha: true,
    change (color) {
      colorHighlight = color.toHexString();
      updateHighlightColor(colorHighlight);
    }
  });

  $('#provvis-cc-layer').spectrum({
    color: '#1f77b4',
    showAlpha: true,
    change (color) {
      $('#provvis-cc-layer-hex').text(color.toHexString());
      switchColorScheme('nodetype');
    }
  });

  $('#provvis-cc-analysis').spectrum({
    color: '#2ca02c',
    showAlpha: true,
    change (color) {
      $('#provvis-cc-analysis-hex').text(color.toHexString());
      switchColorScheme('nodetype');
    }
  });

  $('#provvis-cc-subanalysis').spectrum({
    color: '#d62728',
    showAlpha: true,
    change (color) {
      $('#provvis-cc-subanalysis-hex').text(color.toHexString());
      switchColorScheme('nodetype');
    }
  });

  $('#provvis-cc-special').spectrum({
    color: '#17becf',
    showAlpha: true,
    change (color) {
      $('#provvis-cc-special-hex').text(color.toHexString());
      switchColorScheme('nodetype');
    }
  });

  $('#provvis-cc-dt').spectrum({
    color: '#7f7f7f',
    showAlpha: true,
    change (color) {
      $('#provvis-cc-dt-hex').text(color.toHexString());
      switchColorScheme('nodetype');
    }
  });

  $('#provvis-cc-intermediate').spectrum({
    color: '#bcbd22',
    showAlpha: true,
    change (color) {
      $('#provvis-cc-intermediate-hex').text(color.toHexString());
      switchColorScheme('nodetype');
    }
  });

  $('#provvis-cc-stored').spectrum({
    color: '#8c564b',
    showAlpha: true,
    change (color) {
      $('#provvis-cc-stored-hex').text(color.toHexString());
      switchColorScheme('nodetype');
    }
  });

  /* On accordion header click. */
  $('[id^=prov-ctrl-cc-none-]').on('click', () => {
    switchColorScheme('none');
  });

  $('[id^=prov-ctrl-cc-time-]').on('click', () => {
    switchColorScheme('time');
  });

  $('[id^=prov-ctrl-cc-workflow-]').on('click', () => {
    switchColorScheme('workflow');
  });

  $('[id^=prov-ctrl-cc-nodetype-]').on('click', () => {
    switchColorScheme('nodetype');
  });

  /**
   * Helper function to switch color scheme.
   * @param checkedColor Color scheme.
   */
  function switchColorScheme (checkedColor) {
    switch (checkedColor) {
      case 'none':
        domNodeset.select('.glyph').selectAll('rect, circle')
          .style('fill', '#ffffff');
        domNodeset.selectAll('.anLabel, .sanLabel, .anwfLabel, ' +
          '.sanwfLabel, .an-node-type-icon, .san-node-type-icon')
          .style('fill', '#000000');
        lNode.selectAll('.lnLabel, .wfLabel, .l-node-type-icon')
          .style('fill', '#000000');
        break;
      case 'time':
        lNode.each(l => {
          d3.select('#nodeId-' + l.autoId)
            .select('.glyph')
            .selectAll('rect')
            .style('fill', 'url(#layerGradientId-' + l.autoId + ')');
        });
        lNode.selectAll('.lnLabel, .wfLabel, .l-node-type-icon')
        .style(
          'fill',
          l => {
            const latestDate = d3.min(l.children.values(), d => d.start);
            return timeColorScale(parseISOTimeFormat(latestDate)) <
              '#888888' ? '#ffffff' : '#000000';
          });

        aNode.select('.glyph').selectAll('rect, circle')
          .style(
            'fill',
            d => timeColorScale(parseISOTimeFormat(d.start))
          );
        aNode.selectAll('.anLabel, .anwfLabel, .an-node-type-icon')
          .style(
            'fill',
            an => timeColorScale(
              parseISOTimeFormat(an.start)
            ) < '#888888' ? '#ffffff' : '#000000'
          );

        saNode.select('.glyph').selectAll('rect, circle')
          .style(
            'fill',
            d => timeColorScale(parseISOTimeFormat(d.parent.start))
          );

        saNode.selectAll('.sanLabel, .sanwfLabel, .san-node-type-icon')
          .style(
            'fill',
            san => timeColorScale(
              parseISOTimeFormat(san.parent.start)
            ) < '#888888' ? '#ffffff' : '#000000'
          );

        node.select('.glyph').selectAll('rect, circle')
          .style(
            'fill',
            d => timeColorScale(parseISOTimeFormat(d.parent.parent.start))
          );

        node.selectAll('.stored-node-type-icon')
          .style(
            'fill',
            n => timeColorScale(
              parseISOTimeFormat(n.parent.parent.start)
            ) < '#888888' ? '#ffffff' : '#000000'
          );
        break;
      case 'workflow': {
        const wfc = function (i) {
          return $('#provvis-cc-wf-hex-' + i).text();
        };

        domNodeset.each(d => {
          let cur = d;
          while (!(cur instanceof models.Layer)) {
            cur = cur.parent;
          }
          d3.select('#nodeId-' + d.autoId).select('.glyph')
            .selectAll('rect, circle')
            .style('fill', wfc(wfColorData.get(cur.wfCode)));
        });
        domNodeset.selectAll('.anLabel, .sanLabel, .anwfLabel, ' +
          '.sanwfLabel, .an-node-type-icon, .san-node-type-icon')
          .style('fill', '#000000');
        lNode.selectAll('.lnLabel, .wfLabel, .l-node-type-icon')
          .style('fill', '#000000');
        break;
      }
      case 'nodetype': {
        const nt = function (t) {
          return $('#provvis-cc-' + t + '-hex').text();
        };

        domNodeset.each(d => {
          d3.select('#nodeId-' + d.autoId).select('.glyph')
            .selectAll('rect, circle').style('fill', nt(d.nodeType));
        });
        domNodeset.selectAll('.anLabel, .sanLabel, .anwfLabel, ' +
          '.sanwfLabel, .an-node-type-icon, .san-node-type-icon')
          .style('fill', '#000000');
        lNode.selectAll('.lnLabel, .wfLabel, .l-node-type-icon')
          .style('fill', '#000000');
        node.selectAll('.stored-node-type-icon').style('fill', '#ffffff');
        break;
      }
    }
  }
}

/* TODO: Left clicking on href links doesn't trigger the download. */
/**
 * Update node info tab on node selection.
 * @param selNode Selected node.
 */
function updateNodeInfoTab (selNode) {
  let title = ' - ';
  let titleLink = ' - ';
  let data = Object.create(null);
  const nodeDiff = d3.map();
  let diffNegIns = 0;
  let diffPosIns = 0;
  let diffNegSA = 0;
  let diffPosSA = 0;
  let diffNegOuts = 0;
  let diffPosOuts = 0;

  switch (selNode.nodeType) {
    case 'raw':
    case 'special':
    case 'intermediate':
    case 'stored':
      data = vis.graph.nodeData.get(selNode.uuid);
      if (typeof data !== 'undefined') {
        title = '<i class="fa fa-sitemap rotate-icon-90"></i>&nbsp;' +
        selNode.fileType;
        if (data.file_url !== null) {
          /* TODO: Trigger download without window.open. */
          titleLink = '<a title="Download linked file" href="' +
            data.file_url + '" onclick=window.open("' + data.file_url +
            '")>' +
            '<i class="fa fa-arrow-circle-o-down"></i>&nbsp;' + data.name + '</a>';
        } else {
          titleLink = ' - ';
        }
      }
      break;

    case 'dt':
    /* TODO: Add tool_state parameters column. */
    /* From parent workflow steps attribute, extract step by id.
     * let steps = vis.graph.workflowData
     * .get(selNode.parent.wfUuid).steps; */

      data = vis.graph.nodeData.get(selNode.uuid);
      if (typeof data !== 'undefined') {
        title = '<i class="fa fa-sitemap rotate-icon-90"></i>&nbsp;' +
        selNode.fileType;
        if (data.file_url !== null) {
          /* TODO: Trigger download without window.open. */
          titleLink = '<a title="Download linked file" href="' +
            data.file_url + '" onclick=window.open("' + data.file_url +
            '")>' +
            '<i class="fa fa-arrow-circle-o-down"></i>&nbsp;' + data.name + '</a>';
        }
      }
      break;

    case 'subanalysis':
      data = vis.graph.workflowData.get(selNode.parent.wfUuid);
      if (typeof data !== 'undefined') {
        title = '<i class="fa fa-cog"></i>&nbsp; Analysis Group';
        titleLink = '<a href=/workflows/' + selNode.wfUuid +
          ' target="_blank">' +
          selNode.parent.wfName + '</a>';
      } else {
        title = '<i class="fa fa-cog"></i>&nbsp; Dataset';
      }

      if (selNode.parent.motifDiff.numIns !== 0 ||
        selNode.parent.motifDiff.numOuts !== 0 ||
        selNode.parent.motifDiff.numSubanalyses !== 0) {
        if (selNode.parent.motifDiff.numIns < 0) {
          diffNegIns += selNode.parent.motifDiff.numIns;
        } else {
          diffPosIns += selNode.parent.motifDiff.numIns;
        }
        if (selNode.parent.motifDiff.numSubanalyses < 0) {
          diffNegSA += selNode.parent.motifDiff.numSubanalyses;
        } else {
          diffPosSA += selNode.parent.motifDiff.numSubanalyses;
        }
        if (selNode.parent.motifDiff.numOuts < 0) {
          diffNegOuts += selNode.parent.motifDiff.numOuts;
        } else {
          diffPosOuts += selNode.parent.motifDiff.numOuts;
        }
      }
      break;

    case 'analysis':
      data = vis.graph.analysisData.get(selNode.uuid);
      if (typeof data !== 'undefined') {
        title = '<i class="fa fa-cogs"></i>&nbsp; Analysis';
        titleLink = '<a href=/workflows/' + selNode.wfUuid +
          ' target="_blank">' +
          selNode.wfName + '</a>';
      } else {
        title = '<i class="fa fa-cogs"></i>&nbsp; Dataset';
      }
      if (selNode.motifDiff.numIns !== 0 || selNode.motifDiff.numOuts !== 0 ||
        selNode.motifDiff.numSubanalyses !== 0) {
        if (selNode.motifDiff.numIns < 0) {
          diffNegIns += selNode.motifDiff.numIns;
        } else {
          diffPosIns += selNode.motifDiff.numIns;
        }
        if (selNode.motifDiff.numSubanalyses < 0) {
          diffNegSA += selNode.motifDiff.numSubanalyses;
        } else {
          diffPosSA += selNode.motifDiff.numSubanalyses;
        }
        if (selNode.motifDiff.numOuts < 0) {
          diffNegOuts += selNode.motifDiff.numOuts;
        } else {
          diffPosOuts += selNode.motifDiff.numOuts;
        }
      }
      break;

    case 'layer':
      data = {
        aggregation_count: selNode.children.size(),
        workflow: selNode.wfName,
        subanalysis_count: selNode.motif.numSubanalyses,
        wfUuid: selNode.motif.wfUuid
      };

      if (typeof data !== 'undefined') {
        title = '<i class="fa fa-bars"></i>&nbsp; Layer';
        titleLink = '<a href=/workflows/' + data.wfUuid +
          ' target="_blank">' + data.workflow + '</a>';
      }
      if (
        selNode.children.values()
        .some(
          an =>
          an.motifDiff.numIns !== 0 ||
          an.motifDiff.numOuts !== 0 ||
          an.motifDiff.numSubanalyses !== 0
        )
      ) {
        selNode.children.values().forEach(an => {
          if (an.motifDiff.numIns < 0) {
            diffNegIns += an.motifDiff.numIns;
          } else {
            diffPosIns += an.motifDiff.numIns;
          }
          if (an.motifDiff.numSubanalyses < 0) {
            diffNegSA += an.motifDiff.numSubanalyses;
          } else {
            diffPosSA += an.motifDiff.numSubanalyses;
          }
          if (an.motifDiff.numOuts < 0) {
            diffNegOuts += an.motifDiff.numOuts;
          } else {
            diffPosOuts += an.motifDiff.numOuts;
          }
        });
      }
      break;
  }

  /* Add diff info to data. */
  if (diffNegIns !== 0 || diffPosIns !== 0) {
    nodeDiff.set('Diff: Inputs', (diffNegIns + ' ' + diffPosIns));
  }
  if (diffNegSA !== 0 || diffPosSA !== 0) {
    nodeDiff.set('Diff: Subanalyses', (diffNegSA + ' ' + diffPosSA));
  }
  if (diffNegOuts !== 0 || diffPosOuts !== 0) {
    nodeDiff.set('Diff: Outputs', (diffNegOuts + ' ' + diffPosOuts));
  }

  $('#nodeInfoTitle').html(title);
  $('#nodeInfoTitleLink').html(titleLink);

  $('#' + 'provenance-nodeInfo-content').html('');
  nodeDiff.entries().forEach(d => {
    $('<div/>', {
      class: 'refinery-subheader',
      html: '<h4>' + d.key + '</h4>'
    }).appendTo('#' + 'provenance-nodeInfo-content');
    $('<p/>', {
      class: 'provvisNodeInfoValue provvisNodeInfoDiff',
      html: '<i><b>' + d.value + '</b></i>'
    }).appendTo('#' + 'provenance-nodeInfo-content');
  });

  d3.entries(data).forEach(d => {
    $('<div/>', {
      class: 'refinery-subheader',
      html: '<h4>' + d.key + '</h4>'
    }).appendTo('#' + 'provenance-nodeInfo-content');
    $('<p/>', {
      class: 'provvisNodeInfoValue',
      html: '<i>' + d.value + '</i>'
    }).appendTo('#' + 'provenance-nodeInfo-content');
  });
}

/**
 * Get workflow name string.
 * @param n Node of type BaseNode.
 * @returns {string} The name string.
 */
function getWfNameByNode (n) {
  let wfName = 'dataset';
  let an = n;
  while (!(an instanceof models.Analysis)) {
    an = an.parent;
  }
  if (typeof vis.graph.workflowData.get(an.wfUuid) !== 'undefined') {
    wfName = vis.graph.workflowData.get(an.wfUuid).name;
  }
  return wfName.toString();
}

/**
 * Adds tooltips to nodes.
 */
function handleTooltips () {
  /**
   * Helper function for tooltip creation.
   * @param key Property name.
   * @param value Property value.
   * @returns {string} Inner html code.
   */
  function createHTMLKeyValuePair (key, value) {
    return '<b>' + key + ': ' + '</b>' + value;
  }

  /* Node tooltips. */
  node.on('mouseover', d => {
    const self = d3.select(this);
    let ttStr = createHTMLKeyValuePair('Name', d.name) + '<br>' +
      createHTMLKeyValuePair('Type', d.fileType) + '<br>' +
      createHTMLKeyValuePair('File Url', d.fileUrl) + '<br>' +
      createHTMLKeyValuePair('UUID', d.uuid) + '<br>';
    d.attributes.forEach((key, value) => {
      ttStr += createHTMLKeyValuePair(key, value) + '<br>';
    });
    showTooltip(ttStr, event);

    d.parent.parent.parent.children.values().forEach(sibling => {
      d3.select('#BBoxId-' + sibling.autoId).style('stroke-opacity', 0.3);
    });
    d3.select('#BBoxId-' + d.parent.autoId).classed('mouseoverBBox', true);
    self.select('.labels').attr('clip-path', '');

    /* Get current node label pixel width. */
    let attrText = (d.label === '') ? d.name : d.label;
    if (d.nodeType === 'stored') {
      let selAttrName = '';
      $('#prov-ctrl-visible-attribute-list > li').each(() => {
        if ($(this).find('input[type=\'radio\']').prop('checked')) {
          selAttrName = $(this).find('label').text();
        }
      });
      attrText = d.attributes.get(selAttrName);
    }

    /* Set label text. */
    self.select('.nodeAttrLabel').text(attrText);

    d3.selectAll('.node:not(#nodeId-' + d.autoId +
      ')').selectAll('.nodeAttrLabel').transition()
      .duration(nodeLinkTransitionTime).attr('opacity', 0);
  }).on('mousemove', d => {
    let ttStr = createHTMLKeyValuePair('Name', d.name) + '<br>' +
      createHTMLKeyValuePair('Type', d.fileType) + '<br>' +
      createHTMLKeyValuePair('File Url', d.fileUrl) + '<br>' +
      createHTMLKeyValuePair('UUID', d.uuid) + '<br>';
    d.attributes.forEach((key, value) => {
      ttStr += createHTMLKeyValuePair(key, value) + '<br>';
    });
    d3.select('#BBoxId-' + d.parent.autoId).classed('mouseoverBBox', true);
    showTooltip(ttStr, event);
  }).on('mouseout', d => {
    const self = d3.select(this);
    hideTooltip();

    d.parent.parent.parent.children.values().forEach(sibling => {
      d3.select('#BBoxId-' + sibling.autoId).style('stroke-opacity', 0.0);
    });
    d3.select('#BBoxId-' + d.parent.autoId).classed('mouseoverBBox', false);
    self.select('.labels').attr('clip-path',
      'url(#bbClipId-' + d.autoId + ')');


    /* Get current node label pixel width. */
    const maxLabelPixelWidth = (cell.width - 2 * scaleFactor * vis.radius) *
    d3.transform(d3.select('.canvas').select('g').select('g')
      .attr('transform')).scale[0];
    let attrText = (d.label === '') ? d.name : d.label;
    if (d.nodeType === 'stored') {
      let selAttrName = '';
      $('#prov-ctrl-visible-attribute-list > li').each(() => {
        if ($(this).find('input[type=\'radio\']').prop('checked')) {
          selAttrName = $(this).find('label').text();
        }
      });
      attrText = d.attributes.get(selAttrName);
    }

    /* Set label text. */
    if (typeof attrText !== 'undefined') {
      self.select('.nodeAttrLabel').text(attrText);
      const trimRatio = parseInt(attrText.length * (maxLabelPixelWidth /
        self.select('.nodeAttrLabel').node().getComputedTextLength()), 10);
      if (trimRatio < attrText.length) {
        self.select('.nodeAttrLabel').text(attrText.substr(0, trimRatio - 3) +
          '...');
      }
    }

    d3.selectAll('.nodeAttrLabel').transition()
      .duration(nodeLinkTransitionTime).attr('opacity', 1);
  });

  /* Subanalysis tooltips. */
  saNode
    .on('mouseover', d => {
      const self = d3.select(this);
      self.select('.labels').attr('clip-path', '');
      d.parent.parent.children.values().forEach(sibling => {
        d3.select('#BBoxId-' + sibling.autoId).style('stroke-opacity', 0.3);
      });
    })
    .on('mouseout', d => {
      const self = d3.select(this);
      self.select('.labels').attr('clip-path',
        'url(#bbClipId-' + d.autoId + ')');
      d.parent.parent.children.values().forEach(sibling => {
        d3.select('#BBoxId-' + sibling.autoId).style('stroke-opacity', 0.0);
      });
    });

  /* Analysis tolltips. */
  aNode
    .on('mouseover', d => {
      const self = d3.select(this);
      self.select('.labels').attr('clip-path', '');
      d.parent.children.values().forEach(sibling => {
        d3.select('#BBoxId-' + sibling.autoId).style('stroke-opacity', 0.3);
      });
    })
    .on('mouseout', d => {
      const self = d3.select(this);
      self.select('.labels')
        .attr('clip-path', 'url(#bbClipId-' + d.autoId + ')');
      d.parent.children.values().forEach(sibling => {
        d3.select('#BBoxId-' + sibling.autoId).style('stroke-opacity', 0.0);
      });
    });

  /* Layer . */
  lNode
    .on('mouseover', () => {
      const self = d3.select(this);
      self.select('.labels').select('.wfLabel').attr('clip-path', '');
    })
    .on('mouseout', d => {
      const self = d3.select(this);
      self.select('.labels').select('.wfLabel')
        .attr('clip-path', 'url(#bbClipId-' + d.autoId + ')');
    });

  /* On mouseover subanalysis bounding box. */
  saBBox
    .on('mouseover', d => {
      const self = d3.select(this);
      self.classed('mouseoverBBox', true);
      d.parent.parent.children.values().forEach(sibling => {
        d3.select('#BBoxId-' + sibling.autoId).style('stroke-opacity', 0.3);
      });
      self.select('.labels').attr('clip-path', '');
    })
    .on('mouseout', d => {
      const self = d3.select(this);
      self.classed('mouseoverBBox', false);
      d.parent.parent.children.values().forEach(sibling => {
        d3.select('#BBoxId-' + sibling.autoId).style('stroke-opacity', 0.0);
      });
      self.select('.labels')
        .attr('clip-path', 'url(#saBBClipId-' + d.autoId + ')');
    });

  /* On mouseover analysis bounding box. */
  aBBox
    .on('mouseover', an => {
      const self = d3.select(this);
      self.select('.labels').attr('clip-path', '');
      an.parent.children.values().forEach(sibling => {
        d3.select('#BBoxId-' + sibling.autoId).style('stroke-opacity', 0.3);
      });
    })
    .on('mouseout', an => {
      const self = d3.select(this);
      self.select('.labels')
        .attr('clip-path', 'url(#aBBClipId-' + an.autoId + ')');
      an.parent.children.values().forEach(sibling => {
        d3.select('#BBoxId-' + sibling.autoId).style('stroke-opacity', 0.0);
      });
    });

  /* On mouseover layer bounding box. */
  lBBox
    .on('mouseover', () => {
      const self = d3.select(this);
      self.select('.labels').attr('clip-path', '');
    })
    .on('mouseout', ln => {
      const self = d3.select(this);
      self.select('.labels')
        .attr('clip-path', 'url(#lBBClipId-' + ln.autoId + ')');
    });

  /* On mouseover timeline analysis lines. */
  d3.selectAll('.tlAnalysis').on('mouseover', an => {
    showTooltip(
      createHTMLKeyValuePair('Created', parseISOTimeFormat(an.start)) +
      '<br>' +
      createHTMLKeyValuePair('Workflow', getWfNameByNode(an)) +
      '<br>', event);
    d3.select('#BBoxId-' + an.autoId).classed('mouseoverTlBBox', true);
  }).on('mousemove', an => {
    showTooltip(
      createHTMLKeyValuePair('Created', parseISOTimeFormat(an.start)) +
      '<br>' +
      createHTMLKeyValuePair('Workflow', getWfNameByNode(an)) +
      '<br>', event);
  }).on('mouseout', an => {
    hideTooltip();
    d3.select('#BBoxId-' + an.autoId).classed('mouseoverTlBBox', false);
  });
}

/**
 * Expand all analsyes into workflow nodes.
 */
function showAllWorkflows () {
  /* Set node visibility. */
  lNode.each(ln => {
    ln.hidden = true;
  });
  lNode.classed('hiddenNode', true);
  aNode.each(an => {
    an.hidden = true;
  });
  aNode.classed('hiddenNode', true);
  saNode.each(san => {
    san.hidden = true;
  });
  saNode.classed('hiddenNode', true);
  node.each(n => {
    n.hidden = false;
  });
  node.classed('hiddenNode', false);

  /* Bounding box visibility. */
  saBBox.each(san => {
    if (san.filtered && san.children.values().some(cn => !cn.hidden)) {
      d3.select(this).classed('hiddenBBox', false);
    } else {
      d3.select(this).classed('hiddenBBox', true);
    }
  });

  /* Layer exaggeration label control. */
  aBBox.each(an => {
    if (an.filtered && an.parent.hidden) {
      d3.select(this).classed('hiddenBBox', false);
      d3.select(this).select('text').classed('hiddenLabel', false);
    }
  });

  aNode.each(an => {
    /* Adjust dataset subanalysis coords. */
    if (an.uuid === 'dataset') {
      let yOffset = 0;
      an.children.values()
      .sort((a, b) => a.y - b.y)
      .forEach(san => {
        const wfBBoxCoords = getWFBBoxCoords(san, 0);
        san.y = yOffset;
        yOffset += (wfBBoxCoords.y.max - wfBBoxCoords.y.min);
        san.x = 0;
        /* TODO: May cause problems. Revise! */
        updateNode(d3.select('#gNodeId-' + san.autoId), san, san.x, san.y);
      });
    } else {
      /* Adjust subanalysis coords. */
      const wfBBoxCoords = getWFBBoxCoords(an.children.values()[0], 0);
      an.children.values()
      .sort((a, b) => a.y - b.y)
      .forEach((san, i) => {
        san.y = i * (wfBBoxCoords.y.max - wfBBoxCoords.y.min);
        san.x = 0;
        /* TODO: May cause problems. Revise! */
        updateNode(d3.select('#gNodeId-' + san.autoId), san, san.x, san.y);
      });
    }

    /* Adjust analysis bounding box. */
    const anBBoxCoords = getABBoxCoords(an, 0);
    d3.selectAll('#BBoxId-' + an.autoId + ', #aBBClipId-' + an.autoId)
      .selectAll('rect')
      .attr('width', anBBoxCoords.x.max - anBBoxCoords.x.min)
      .attr('height', anBBoxCoords.y.max - anBBoxCoords.y.min);
    d3.select('#BBoxId-' + an.autoId).classed('hiddenBBox', false);

    if (!an.filtered) {
      d3.select('#BBoxId-' + an.autoId).classed('hiddenBBox', true);
    }
  });

  /* Set link visibility. */
  link.each(l => {
    l.hidden = false;
  });
  link.classed('hiddenLink', false);

  link.each(l => {
    if (l.filtered) {
      l.hidden = false;
      if (l.highlighted) {
        d3.select('#hLinkId-' + l.autoId).classed('hiddenLink', false);
      }
    } else {
      if (filterAction === 'hide') {
        l.hidden = true;
        d3.select('#hLinkId-' + l.autoId).classed('hiddenLink', true);
      } else {
        l.hidden = false;
        if (l.highlighted) {
          d3.select('#hLinkId-' + l.autoId).classed('hiddenLink', false);
        }
      }
    }
  });

  lLink.each(l => {
    l.hidden = true;
  });
  lLink.classed('hiddenLink', true);
}

/**
 * Collapse all analyses into single subanalysis nodes.
 */
function showAllSubanalyses () {
  /* Set node visibility. */
  lNode.each(ln => {
    ln.hidden = true;
  });
  lNode.classed('hiddenNode', true);
  aNode.each(an => {
    an.hidden = true;
  });
  aNode.classed('hiddenNode', true);
  saNode.each(san => {
    san.hidden = false;
  });
  saNode.classed('hiddenNode', false);
  node.each(n => {
    n.hidden = true;
  });
  node.classed('hiddenNode', true);

  /* Bounding box visibility. */
  saBBox.classed('hiddenBBox', true);

  aNode.each(an => {
    /* Adjust subanalysis coords. */
    an.children.values().sort((a, b) => a.y - b.y)
    .forEach((san, i) => {
      san.y = i * vis.cell.height;
      san.x = 0;
      updateNode(d3.select('#gNodeId-' + san.autoId), san, san.x, san.y);
    });

    /* Adjust analysis bounding box. */
    const anBBoxCoords = getABBoxCoords(an, 0);
    d3.selectAll('#BBoxId-' + an.autoId + ', #aBBClipId-' + an.autoId)
      .selectAll('rect')
      .attr('width', vis.cell.width)
      .attr('height', anBBoxCoords.y.max - anBBoxCoords.y.min);
    d3.select('#BBoxId-' + an.autoId).classed('hiddenBBox', false);

    if (!an.filtered) {
      d3.select('#BBoxId-' + an.autoId).classed('hiddenBBox', true);
    }
  });

  /* Link visibility. */
  aNode.each(an => {
    an.links.values().forEach(l => {
      d3.selectAll('#linkId-' + l.autoId + ', #hLinkId-' + l.autoId)
        .classed('hiddenLink', true);
      l.hidden = true;
    });
    an.inputs.values().forEach(ain => {
      ain.predLinks.values().forEach(l => {
        d3.select('#linkId-' + l.autoId).classed('hiddenLink', false);
        l.hidden = false;
      });
    });
  });

  lLink.each(l => {
    l.hidden = true;
  });
  lLink.classed('hiddenLink', true);
}

/**
 * Collapse all analyses into single analysis nodes.
 */
function showAllAnalyses () {
  /* Node visibility. */
  lNode.each(ln => {
    ln.hidden = true;
  });
  lNode.classed('hiddenNode', true);

  aNode.each(an => {
    an.hidden = false;
    hideChildNodes(an);

    /* Filtered visibility. */
    if (an.filtered) {
      d3.select('#BBoxId-' + an.autoId).classed('hiddenBBox', false);
    }

    /* Bounding box size. */
    d3.selectAll('#BBoxId-' + an.autoId + ', #aBBClipId-' + an.autoId)
      .select('rect')
      .attr('width', vis.cell.width)
      .attr('height', vis.cell.height);

    /* Adjust subanalysis coords. */
    an.children.values().sort((a, b) => a.y - b.y)
    .forEach((san, i) => {
      san.y = i * vis.cell.height;
      san.x = 0;
      updateNode(d3.select('#gNodeId-' + san.autoId), san, san.x, san.y);
    });
  });
  aNode.classed('hiddenNode', false);

  /* Bounding box visibility. */
  saBBox.classed('hiddenBBox', true);

  /* Link visibility. */
  aNode.each(an => {
    an.links.values().forEach(l => {
      d3.selectAll('#linkId-' + l.autoId + ', #hLinkId-' + l.autoId)
        .classed('hiddenLink', true);
      l.hidden = true;
    });
    an.inputs.values().forEach(ain => {
      ain.predLinks.values().forEach(l => {
        d3.select('#linkId-' + l.autoId).classed('hiddenLink', false);
        l.hidden = false;
      });
    });
  });

  lLink.each(l => {
    l.hidden = true;
  });
  lLink.classed('hiddenLink', true);
}

/**
 * Collapse all nodes into single layer nodes.
 */
function showAllLayers () {
  /* Node visibility. */
  lNode.each(ln => {
    ln.hidden = false;
    hideChildNodes(ln);

    /* Layer exaggeration reset. */
    ln.children.values().forEach(an => {
      an.exaggerated = false;
    });

    /* Filtered visibility. */
    if (ln.filtered) {
      d3.select('BBoxId-' + ln.autoId).classed('hiddenBBox', false);
    }
  });
  lNode.classed('hiddenNode', false);

  /* Bounding box visibility. */
  saBBox.classed('hiddenBBox', true);
  aBBox.classed('hiddenBBox', true);

  /* Link visibility. */
  aNode.each(an => {
    an.links.values().forEach(l => {
      d3.selectAll('#linkId-' + l.autoId + ', #hLinkId-' + l.autoId)
        .classed('hiddenLink', true);
      l.hidden = true;
    });

    /* Adjust subanalysis coords. */
    an.children.values().sort((a, b) => a.y - b.y)
    .forEach((san, i) => {
      san.y = i * vis.cell.height;
      san.x = 0;
      updateNode(d3.select('#gNodeId-' + san.autoId), san, san.x, san.y);
    });
  });

  aLink.each(l => {
    l.hidden = true;
  });
  aLink.classed('hiddenLink', true);

  lLink.each(l => {
    l.hidden = false;
  });
  lLink.classed('hiddenLink', false);

  /* Show highlighted alinks. */
  d3.select('.aHLinks').selectAll('.hLink').each(l => {
    if (l.highlighted) {
      l.hidden = false;
      d3.select(this).classed('hiddenLink', false);
    }
  });
}

/**
 * Handle interaction controls.
 * @param graph Provenance graph object.
 */
function handleToolbar (graph) {
  $('#prov-ctrl-layers-click').click(() => {
    showAllLayers();
    dagreDynamicLayerLayout(graph);
    if (fitToWindow) {
      fitGraphToWindow(nodeLinkTransitionTime);
    }
  });

  $('#prov-ctrl-analyses-click').click(() => {
    showAllAnalyses();
    dagreDynamicLayerLayout(graph);
    if (fitToWindow) {
      fitGraphToWindow(nodeLinkTransitionTime);
    }
  });

  $('#prov-ctrl-subanalyses-click').click(() => {
    showAllSubanalyses();
    dagreDynamicLayerLayout(graph);
    if (fitToWindow) {
      fitGraphToWindow(nodeLinkTransitionTime);
    }
  });

  $('#prov-ctrl-workflows-click').click(() => {
    showAllWorkflows();
    dagreDynamicLayerLayout(graph);
    if (fitToWindow) {
      fitGraphToWindow(nodeLinkTransitionTime);
    }
  });

  /* Switch filter action. */
  $('#prov-ctrl-filter-action > label').click(() => {
    filterAction = $(this).find('input[type=\'radio\']').prop('value');
    if (filterMethod === 'timeline') {
      filterAnalysesByTime(d3.select('.startTimeline')
        .data()[0].time, d3.select('.endTimeline').data()[0].time, vis);
    } else {
      runRenderUpdatePrivate(vis, lastSolrResponse);
    }
  });

  /* Choose visible node attribute. */
  $('[id^=prov-ctrl-visible-attribute-list-]').click(() => {
    /* Set and get chosen attribute as active. */
    $(this).find('input[type=\'radio\']').prop('checked', true);
    const selAttrName = $(this).find('label').text();

    /* On click, set current to active and unselect others. */
    $('#prov-ctrl-visible-attribute-list > li').each((idx, li) => {
      const item = $(li);
      if (item[0].id !== ('prov-ctrl-visible-attribute-list-' +
        selAttrName)) {
        item.find('input[type=\'radio\']').prop('checked', false);
      }
    });

    /* Change attribute label on every node. */
    graph.nodes.filter(d => d.nodeType === 'stored').forEach(n => {
      const self = d3.select('#nodeId-' + n.autoId);

      const maxLabelPixelWidth = (cell.width - 2 * scaleFactor * vis.radius) *
      d3.transform(d3.select('.canvas').select('g').select('g')
        .attr('transform')).scale[0];
      let attrText = n.name;
      if (n.nodeType === 'stored') {
        let selAttrNamee = '';
        $('#prov-ctrl-visible-attribute-list > li').each(() => {
          if ($(this).find('input[type=\'radio\']').prop('checked')) {
            selAttrNamee = $(this).find('label').text();
          }
        });
        attrText = n.attributes.get(selAttrNamee);
      }

      /* Set label text. */
      if (typeof attrText !== 'undefined') {
        self.select('.nodeAttrLabel').text(attrText);
        const trimRatio = parseInt(attrText.length * (maxLabelPixelWidth /
        self.select('.nodeAttrLabel').node().getComputedTextLength()),
          10);
        if (trimRatio < attrText.length) {
          self.select('.nodeAttrLabel').text(
            attrText.substr(0, trimRatio - 3) + '...'
          );
        }
      }
    });
  });

  /* Switch sidebar on or off. */
  $('#prov-ctrl-toggle-sidebar').click(() => {
    if (!$('#prov-ctrl-toggle-sidebar')[0].checked) {
      $('#provenance-sidebar')
        .animate({
          left: '-355'
        }, nodeLinkTransitionTime);
    } else {
      $('#provenance-sidebar')
        .animate({
          left: '20'
        }, nodeLinkTransitionTime);

      /* TODO: Temporary fix for sidbear div. */
      $('#provvis-sidebar-content').css('height', vis.canvas.height);
    }
  });

  /* Switch fit to screen on or off. */
  $('#prov-ctrl-toggle-fit').click(() => {
    if (!$('#prov-ctrl-toggle-fit')[0].checked) {
      fitToWindow = false;
    } else {
      fitToWindow = true;
    }
  });
}


/* TODO: Recompute layout only after all nodes were collapsed/expanded. */

/**
 * Handle events.
 * @param graph Provenance graph object.
 */
function handleEvents (graph) {
  handleToolbar(graph);

  /* Handle click separation on nodes. */
  let domNodesetClickTimeout;
  domNodeset.on('mousedown', d => {
    if (d3.event.defaultPrevented) {
      return;
    }
    clearTimeout(domNodesetClickTimeout);


    /* Click event is executed after 100ms unless the double click event
     below clears the click event timeout.*/
    domNodesetClickTimeout = setTimeout(() => {
      if (!draggingActive) {
        handleNodeSelection(d);
        updateNodeInfoTab(d);
      }
    }, 200);
  });

  domNodeset.on('dblclick', d => {
    if (d3.event.defaultPrevented) {
      return;
    }
    clearTimeout(domNodesetClickTimeout);

    /* Double click event is executed when this event is triggered before
     the click timeout has finished. */
    handleCollapseExpandNode(d, 'e');
  });

  /* Handle click separation on other dom elements. */
  let bRectClickTimeout;
  d3.selectAll('.brect, .link, .hLink, .vLine, .hLine', '.cell')
    .on('click', () => {
      if (d3.event.defaultPrevented) {
        return;
      }
      clearTimeout(bRectClickTimeout);

      /* Click event is executed after 100ms unless the double click event
       below clears the click event timeout.*/
      bRectClickTimeout = setTimeout(() => {
        clearHighlighting(graph.links);
        clearNodeSelection();

        /* TODO: Temporarily enabled. */
        if (doiAutoUpdate) {
          recomputeDOI();
        }
      }, 200);
    });

  d3.selectAll('.brect, .link, .hLink, .vLine, .hLine, .cell')
    .on('dblclick', () => {
      if (d3.event.defaultPrevented) {
        return;
      }
      clearTimeout(bRectClickTimeout);

      /* Double click event is executed when this event is triggered
       before the click timeout has finished. */
      fitGraphToWindow(1000);
    });

  /* Handle tooltips. */
  handleTooltips();
  /* TODO: Currently disabled. */
  // handleDebugTooltips();

  /* Collapse on bounding box click.*/
  saBBox.on('click', d => {
    if (!draggingActive) {
      handleCollapseExpandNode(d.children.values()[0], 'c');

      /* TODO: Temporarily disabled. */
      /* Deselect. */
      // clearNodeSelection();

    /* Update node doi. */
    // updateNodeDoi();
    }
  });

  /* Collapse on bounding box click.*/
  let aBBoxClickTimeout;
  aBBox.on('click', d => {
    if (d3.event.defaultPrevented) {
      return;
    }
    clearTimeout(aBBoxClickTimeout);

    aBBoxClickTimeout = setTimeout(() => {
      if (!draggingActive) {
        if (d.hidden) {
          if (d.children.values().some(san => san.hidden)) {
            d.children.values().forEach(san => {
              handleCollapseExpandNode(san.children.values()[0], 'c');
            });
          } else {
            handleCollapseExpandNode(d.children.values()[0], 'c');
          }
        } else {
          handleCollapseExpandNode(d, 'c');
        }
      }
    }, 200);
  });

  aBBox.on('dblclick', d => {
    if (d3.event.defaultPrevented) {
      return;
    }
    clearTimeout(aBBoxClickTimeout);

    if (!draggingActive) {
      d.children.values().forEach(san => {
        handleCollapseExpandNode(san.children.values()[0], 'c');
      });
      handleCollapseExpandNode(d.children.values()[0], 'c');
      handleCollapseExpandNode(d, 'c');
    }
  });

  /* Collapse to layer node. */
  lBBox.on('click', d => {
    if (d3.event.defaultPrevented) {
      return;
    }

    if (!draggingActive) {
      d.children.values().forEach(an => {
        an.children.values().forEach(san => {
          handleCollapseExpandNode(san.children.values()[0], 'c');
        });
        handleCollapseExpandNode(an.children.values()[0], 'c');
      });
      handleCollapseExpandNode(d.children.values()[0], 'c');

    /* TODO: Temporarily disabled. */
    /* Deselect. */
    // clearNodeSelection();
    /* Update node doi. */
    // updateNodeDoi();
    }
  });

  /* Handle path highlighting. */
  d3.selectAll('.glAnchor').on('click', d => {
    handlePathHighlighting(d, 'p');
  }).on('mousedown', d3.event.stopPropagation);

  d3.selectAll('.grAnchor').on('click', d => {
    handlePathHighlighting(d, 's');
  }).on('mousedown', d3.event.stopPropagation);
}

/**
 * Compute doi weight based on analysis start time.
 * @param aNodes Analysis nodes.
 */
function initDoiTimeComponent (aNodes) {
  let min = d3.time.format.iso(new Date(0));
  let max = d3.time.format.iso(new Date(0));

  if (aNodes.length > 1) {
    min = d3.min(aNodes, d => parseISOTimeFormat(d.start));
    max = d3.max(aNodes, d => parseISOTimeFormat(d.start));
  }

  const doiTimeScale = d3.time.scale()
    .domain([min, max])
    .range([0.0, 1.0]);

  aNodes.forEach(an => {
    an.doi.initTimeComponent(doiTimeScale(parseISOTimeFormat(an.start)));
    an.children.values().forEach(san => {
      san.doi.initTimeComponent(doiTimeScale(parseISOTimeFormat(an.start)));
      san.children.values().forEach(n => {
        n.doi.initTimeComponent(doiTimeScale(parseISOTimeFormat(an.start)));
      });
    });
  });

  vis.graph.lNodes.values().forEach(l => {
    l.doi.initTimeComponent(
      d3.mean(
        l.children.values(), an => doiTimeScale(parseISOTimeFormat(an.start))
      )
    );
  });
}

/**
 * Compute doi weight based on nodes initially set as filtered.
 * @param lNodes Layer nodes.
 */
function initDoiFilterComponent (lNodes) {
  lNodes.values().forEach(ln => {
    ln.filtered = true;
    ln.doi.filteredChanged();

    ln.children.values().forEach(an => {
      an.filtered = true;
      an.doi.filteredChanged();

      an.children.values().forEach(san => {
        san.filtered = true;
        san.doi.filteredChanged();

        san.children.values().forEach(n => {
          n.filtered = true;
          n.doi.filteredChanged();
        });
      });
    });
  });
}

/**
 * Compute doi weight based on the motif diff.
 * @param lNodes Layer nodes.
 * @param aNodes Analysis nodes.
 */
function initDoiLayerDiffComponent (lNodes, aNodes) {
  const doiDiffMin = 0;
  const doiDiffMax = d3.max(
    aNodes,
    an => d3.max([
      Math.abs(an.motifDiff.numIns),
      Math.abs(an.motifDiff.numSubanalyses),
      Math.abs(an.motifDiff.numOuts)
    ], d => d)
  );

  doiDiffScale = d3.scale.linear()
    .domain([doiDiffMin, doiDiffMax])
    .range([0.0, 1.0]);

  /* Init analysis nodes with a factor in relation to the highes diff in
   the whole graph. */
  aNodes.forEach(an => {
    an.doi.initLayerDiffComponent(doiDiffScale(Math.abs(an.motifDiff.numIns) +
      Math.abs(an.motifDiff.numOuts) +
      Math.abs(an.motifDiff.numSubanalyses)));
    an.children.values().forEach(san => {
      san.doi.initLayerDiffComponent(an.doi.doiLayerDiff);
      san.children.values().forEach(cn => {
        cn.doi.initLayerDiffComponent(an.doi.doiLayerDiff);
      });
    });
  });

  /* Init layer nodes with max value from child nodes. */
  lNodes.values().forEach(ln => {
    const anMax = d3.max(ln.children.values(), an => an.doi.doiLayerDiff);
    ln.doi.initLayerDiffComponent(anMax);
  });
}

/**
 * Concats an array of dom elements.
 * @param domArr An array of dom class selector strings.
 */
function concatDomClassElements (domArr) {
  let domClassStr = '';
  domArr.forEach(d => {
    domClassStr += '.' + d + ',';
  });

  return d3.selectAll(domClassStr.substr(0, domClassStr.length - 1));
}

/**
 * Main render module function.
 * @param provVis The provenance visualization root object.
 */
function runRenderPrivate (provVis) {
  /* Save vis object to module scope. */
  vis = provVis;
  cell = provVis.cell;

  lNodesBAK = vis.graph.lNodes;
  aNodesBAK = vis.graph.aNodes;
  saNodesBAK = vis.graph.saNodes;
  nodesBAK = vis.graph.nodes;
  lLinksBAK = vis.graph.lLinks;
  aLinksBAK = vis.graph.aLinks;

  // width = vis.graph.l.width;
  // depth = vis.graph.l.depth;

  timeColorScale = createAnalysistimeColorScale(vis.graph.aNodes,
    ['white', 'black']);
  initDoiTimeComponent(vis.graph.aNodes);

  /* Init all nodes filtered. */
  initDoiFilterComponent(vis.graph.lNodes);
  filterAction = 'blend';

  /* Init all nodes with the motif diff. */
  initDoiLayerDiffComponent(vis.graph.lNodes, vis.graph.aNodes);

  /* Draw analysis links. */
  vis.canvas.append('g').classed('aHLinks', true);
  vis.canvas.append('g').classed('aLinks', true);
  updateAnalysisLinks(vis.graph);

  /* Draw layer nodes and links. */
  dagreLayerLayout(vis.graph);
  vis.canvas.append('g').classed('lLinks', true);
  vis.canvas.append('g').classed('layers', true);
  updateLayerLinks(vis.graph.lLinks);
  updateLayerNodes(vis.graph.lNodes);

  /* Draw analysis nodes. */
  vis.canvas.append('g').classed('analyses', true);
  updateAnalysisNodes();

  /* Draw subanalysis nodes. */
  drawSubanalysisNodes();

  /* Draw nodes. */
  drawNodes();

  /* Concat aNode, saNode and node. */
  domNodeset = concatDomClassElements(['lNode', 'aNode', 'saNode', 'node']);

  /* Add dragging behavior to nodes. */
  applyDragBehavior(layer);
  applyDragBehavior(analysis);

  /* Initiate doi. */
  vis.graph.aNodes.forEach(an => {
    handleCollapseExpandNode(an, 'c', 'auto');
  });
  updateNodeFilter();
  updateLinkFilter();
  updateNodeDoi();

  /* Draw timeline view. */
  drawTimelineView(vis);

  /* Draw doi view. */
  drawDoiView();

  /* Draw colorcoding view. */
  drawColorcodingView();

  /* Event listeners. */
  handleEvents(vis.graph);

  /* Set initial graph position. */
  fitGraphToWindow(0);
}

/**
 * On attribute filter change, the provenance visualization will be updated.
 * @param vis The provenance visualization root object.
 * @param solrResponse Query response object holding information about
 * attribute filter changed.
 */
function runRenderUpdatePrivate (_vis_, solrResponse) {
  const selNodes = [];

  filterMethod = 'facet';

  if (solrResponse instanceof SolrResponse) {
    _vis_.graph.lNodes = lNodesBAK;
    _vis_.graph.aNodes = aNodesBAK;
    _vis_.graph.saNodes = saNodesBAK;
    _vis_.graph.nodes = nodesBAK;
    _vis_.graph.aLinks = aLinksBAK;
    _vis_.graph.lLinks = lLinksBAK;

    /* Copy filtered nodes. */
    solrResponse.getDocumentList().forEach(d => {
      selNodes.push(_vis_.graph.nodeMap.get(d.uuid));
    });

    /* Update subanalysis and workflow filter attributes. */
    _vis_.graph.nodes.forEach(n => {
      if (selNodes.map(d => d.parent).indexOf(n.parent) === -1) {
        n.parent.children.values().forEach(cn => {
          cn.filtered = false;
        });
        n.parent.filtered = false;
        n.parent.links.values().forEach(l => {
          l.filtered = false;
        });
      } else {
        /* Filter pred path. */
        const filterPredPath = curN => {
          curN.filtered = true;
          curN.predLinks.values().forEach(l => {
            l.filtered = true;
            if (l.source.parent === curN.parent) {
              filterPredPath(l.source);
            }
          });
        };
        filterPredPath(n);

        n.parent.filtered = true;
        n.parent.links.values().forEach(l => {
          l.filtered = true;
        });
      }

      /* Filtered attribute changed. */
      n.parent.children.values().forEach(cn => {
        cn.doi.filteredChanged();
      });
      n.parent.doi.filteredChanged();
    });

    /* Update analysis filter attributes. */
    _vis_.graph.aNodes.forEach(an => {
      if (an.children.values().some(san => san.filtered)) {
        an.filtered = true;
      } else {
        an.filtered = false;
      }
      an.doi.filteredChanged();
    });

    /* Update layer filter attributes. */
    _vis_.graph.lNodes.values().forEach(ln => {
      if (ln.children.values().some(an => an.filtered)) {
        ln.filtered = true;
      } else {
        ln.filtered = false;
      }
      ln.doi.filteredChanged();
    });

    /* Update analysis link filter attributes. */
    _vis_.graph.aLinks.forEach(al => {
      al.filtered = false;
    });
    _vis_.graph.aLinks.filter(
        al => al.source.parent.parent.filtered && al.target.parent.parent.filtered
      )
      .forEach(al => {
        al.filtered = true;
      });

    _vis_.graph.lLinks.values().forEach(ll => {
      ll.filtered = false;
    });

    _vis_.graph.lLinks.values().filter(
        ll => ll.source.filtered && ll.target.filtered
      )
      .forEach(ll => {
        ll.filtered = true;
      });


    /* On filter action 'hide', splice and recompute graph. */
    if (filterAction === 'hide') {
      /* Update filtered nodesets. */
      const cpyLNodes = d3.map();
      _vis_.graph.lNodes.entries().forEach(ln => {
        if (ln.value.filtered) {
          cpyLNodes.set(ln.key, ln.value);
        }
      });
      _vis_.graph.lNodes = cpyLNodes;
      _vis_.graph.aNodes = _vis_.graph.aNodes.filter(an => an.filtered);
      _vis_.graph.saNodes = _vis_.graph.saNodes.filter(san => san.filtered);
      _vis_.graph.nodes = _vis_.graph.nodes.filter(n => n.filtered);

      /* Update filtered linksets. */
      _vis_.graph.aLinks = _vis_.graph.aLinks.filter(al => al.filtered);

      /* Update layer links. */
      const cpyLLinks = d3.map();
      _vis_.graph.lLinks.entries().forEach(ll => {
        if (ll.value.filtered) {
          cpyLLinks.set(ll.key, ll.value);
        }
      });
      _vis_.graph.lLinks = cpyLLinks;
    }

    dagreDynamicLayerLayout(_vis_.graph);
    if (fitToWindow) {
      fitGraphToWindow(nodeLinkTransitionTime);
    }

    updateNodeFilter();
    updateLinkFilter();
    updateAnalysisLinks(_vis_.graph);
    updateLayerLinks(_vis_.graph.lLinks);

    _vis_.graph.aNodes.forEach(an => {
      updateLink(an);
    });
    _vis_.graph.lNodes.values().forEach(ln => {
      updateLink(ln);
    });

    /* TODO: Currently enabled. */
    if (doiAutoUpdate) {
      recomputeDOI();
    }
  }
  lastSolrResponse = solrResponse;
}

/**
 * Publish module function.
 */
function run (_vis_) {
  runRenderPrivate(_vis_);
}

function update (_vis_, solrResponse) {
  runRenderUpdatePrivate(_vis_, solrResponse);
}

export { run, update };
