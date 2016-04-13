// External
import * as d3 from 'd3';

/**
 * Helper function collection for the provvis module.
 */

/**
 * Set hidden attribute for object and class for css of BaseNode.
 * @param n BaseNode.
 */
export function hideChildNodes (n) {
  if (!n.children.empty()) {
    n.children.values().forEach(cn => {
      cn.hidden = true;
      d3.selectAll('#nodeId-' + cn.autoId).classed({
        selectedNode: false,
        hiddenNode: true
      });
      if (!cn.children.empty()) {
        hideChildNodes(cn);
      }
    });
  }
}

/**
 * Set selected attribute for object of BaseNode.
 * @param n BaseNode.
 * @param selected Node may be selected or not.
 */
export function propagateNodeSelection (n, selected) {
  if (!n.children.empty()) {
    n.children.values().forEach(cn => {
      cn.selected = selected;
      cn.doi.selectedChanged();
      // d3.selectAll("#nodeId-" + cn.autoId).classed({"selectedNode":
      // selected});
      if (!cn.children.empty()) {
        propagateNodeSelection(cn, selected);
      }
    });
  }
}

/**
 * Helper function to parse a date with the declated time format.
 * @returns {*} Returns the custom time format.
 */
export function customTimeFormat (date) {
  return d3.time.format('%Y-%m-%d %H:%M:%S %p')(date);
}

/**
 * Parses a string into the ISO time format.
 * @param value The time in the string format.
 * @returns {*} The value in the ISO time format.
 */
export function parseISOTimeFormat (value) {
  return d3.time.format('%Y-%m-%dT%H:%M:%S.%L').parse(value);
}

/**
 * Helper function to compare two d3.map() objects.
 * @param a
 * @param b
 * @returns {boolean}
 */
export function compareMaps (a, b) {
  let equal = true;
  if (a.size() === b.size()) {
    a.keys().forEach(k => {
      if (!b.has(k)) {
        equal = false;
      }
    });
  } else {
    equal = false;
  }
  return equal;
}

/**
 * Get layer child analysis predecessor link count.
 * @param ln Layer node.
 */
export function getLayerPredCount (ln) {
  return ln.children.values()
    .map(an => an.predLinks.size())
    .reduce((acc, pls) => acc + pls);
}

/**
 * Get layer child analysis successor link count.
 * @param ln Layer node.
 */
export function getLayerSuccCount (ln) {
  return ln.children.values()
    .map(an => an.succLinks.size())
    .reduce((acc, pls) => acc + pls);
}

/**
 * Breadth first search algorithm.
 * @param dsn Dataset node.
 */
export function bfs (dsn) {
  /**
   * Helper function to get successors of the current node;
   * @param n Node.
   */
  function getSuccs (n) {
    /* Add successor nodes to queue. */
    n.succs.values().forEach(s => {
      if (s instanceof window.provvisDecl.Node &&
        window.nset.indexOf(s.parent.parent) === -1) {
        window.nset.push(s.parent.parent);
        window.nqueue.push(s.parent.parent);
      } else if (window.nset.indexOf(s) === -1) {
        window.nset.push(s);
        window.nqueue.push(s);
      }
    });
  }

  const nqueue = [];
  const nset = [];

  nset.push(dsn);
  nqueue.push(dsn);

  while (nqueue.length > 0) {
    getSuccs(nqueue.shift());
  }
}
