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

export default drawStraightLink;
