/**
 * Make tooltip visible and align it to the events position.
 * @param label Inner html code appended to the tooltip.
 * @param event E.g. mouse event.
 */
function showTooltip (tooltip, label, event) {
  tooltip.html(label);
  tooltip.style('visibility', 'visible');
  tooltip.style('top', (event.pageY + 10) + 'px');
  tooltip.style('left', (event.pageX + 10) + 'px');
}

export default showTooltip;
