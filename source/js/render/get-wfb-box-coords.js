// External
import * as d3 from 'd3';

/**
 * Compute bounding box for child nodes.
 * @param n BaseNode.
 * @param offset Cell offset.
 * @returns {{x: {min: *, max: *}, y: {min: *, max: *}}} Min and
 * max x, y coords.
 */
function getWFBBoxCoords (n, cell, offset) {
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

export default getWFBBoxCoords;
