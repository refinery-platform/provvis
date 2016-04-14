// External
import * as d3 from 'd3';

/**
 * Concats an array of dom elements.
 * @param domArr An array of dom class selector strings.
 */
function concatDomClassElements (domArr) {
  let domClassStr = '';
  domArr.forEach(d => {
    domClassStr += '.' + d + ',';
  });

  return d3.selectAll(domClassStr.substr(0, domClassStr.length - 1));
}

export default concatDomClassElements;
