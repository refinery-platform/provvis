// External
import * as d3 from 'd3';

/**
 * Drag start listener support for nodes.
 */
function dragStart () {
  d3.event.sourceEvent.stopPropagation();
}

export default dragStart;
