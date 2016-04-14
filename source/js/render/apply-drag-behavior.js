// External
import * as d3 from 'd3';

/**
 * Sets the drag events for nodes.
 * @param nodeType The dom nodeset to allow dragging.
 */
function applyDragBehavior (domDragSet, dragStart, dragging, dragEnd) {
  /* Drag and drop node enabled. */
  const drag = d3.behavior.drag()
    .origin(d => d)
    .on('dragstart', dragStart)
    .on('drag', dragging)
    .on('dragend', dragEnd);

  /* Invoke dragging behavior on nodes. */
  domDragSet.call(drag);
}

export default applyDragBehavior;
