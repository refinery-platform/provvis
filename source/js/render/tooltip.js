// External
import * as d3 from 'd3';

/* Simple tooltips by NG. */
const tooltip = d3.select('body')
  .append('div')
  .attr('class', 'refinery-tooltip')
  .style('position', 'absolute')
  .style('z-index', '10')
  .style('visibility', 'hidden');

export default tooltip;
