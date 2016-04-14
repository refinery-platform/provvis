// External
import * as d3 from 'd3';

// Internal
import { parseISOTimeFormat } from '../helpers';

/**
 * Compute doi weight based on analysis start time.
 * @param aNodes Analysis nodes.
 */
function initDoiTimeComponent (aNodes, vis) {
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

export default initDoiTimeComponent;
