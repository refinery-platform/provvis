// External
import * as d3 from 'd3';

/**
 * Compute bounding box for expanded analysis nodes.
 * @param an Analysis node.
 * @param offset Cell offset.
 * @returns {{x: {min: number, max: number}, y: {min: number, max: number}}}
 * Min and max x, y coords.
 */
function getABBoxCoords (an, cell, _offset_) {
  let offset = _offset_;

  if (!offset) {
    offset = 0;
  }

  const minX = !an.hidden ? an.x : d3.min(an.children.values(),
    san => (!san.hidden ? an.x + san.x : d3.min(
      san.children.values(), cn => (!cn.hidden ? an.x + san.x + cn.x : an.x)
    ))
  );
  const maxX = !an.hidden ? an.x : d3.max(an.children.values(),
    san => (!san.hidden ? an.x + san.x : d3.max(san.children.values(),
      cn => (!cn.hidden ? an.x + san.x + cn.x : an.x)))
  );
  const minY = !an.hidden ? an.y : d3.min(an.children.values(),
    san => (!san.hidden ? an.y + san.y : d3.min(san.children.values(),
      cn => (!cn.hidden ? an.y + san.y + cn.y : an.y)))
  );
  const maxY = !an.hidden ? an.y : d3.max(an.children.values(),
    san => (!san.hidden ? an.y + san.y : d3.max(san.children.values(),
      cn => (!cn.hidden ? an.y + san.y + cn.y : an.y)))
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

export default getABBoxCoords;
