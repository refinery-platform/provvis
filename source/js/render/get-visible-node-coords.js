// Internal
import * as models from '../models';

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

export default getVisibleNodeCoords;
