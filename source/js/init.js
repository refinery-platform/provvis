// External
import * as $ from '$';
import * as d3 from 'd3';
// This is defined in Refinery's legacy code. See:
// https://github.com/parklab/refinery-platform/blob/develop/refinery/static/source/js/refinery/solr/solr_response.js
import * as SolrResponse from 'SolrResponse';

// Internal
import * as models from './models';

/**
 * Module for init.
 */

/* Initialize node-link arrays. */
const nodes = [];
const links = [];
const aLinks = [];
const iNodes = [];
const oNodes = [];
const aNodes = [];
const saNodes = [];
const nodeAttributeList = [];
const nodeMap = d3.map();
const analysisWorkflowMap = d3.map();
const workflowData = d3.map();
const analysisData = d3.map();
const nodeData = d3.map();

let dataset = Object.create(null);

/**
 * Assign node types.
 * @param n Current raw node.
 * @returns {string} The CSS class corresponding to the type of the node.
 */
function assignNodeType (n) {
  let nodeType = '';

  switch (n.type) {
    case 'Source Name':
    case 'Sample Name':
    case 'Assay Name':
      nodeType = 'special';
      break;
    case 'Data Transformation Name':
      nodeType = 'dt';
      break;
    default:
      if (n.file_url === null) {
        nodeType = 'intermediate';
      } else {
        nodeType = 'stored';
      }
      break;
  }
  return nodeType;
}

/**
 * Extract node api properties.
 * @param n Node object.
 * @param type Dataset specified node type.
 * @param id Integer identifier for the node.
 * @returns {models.Node} New Node object.
 */
function createNode (n, type, id) {
  const study = (n.study !== null) ?
    n.study.replace(/\/api\/v1\/study\//g, '').replace(/\//g, '') : '';
  const assay = (n.assay !== null) ?
    n.assay.replace(/\/api\/v1\/assay\//g, '').replace(/\//g, '') : '';
  const parents = n.parents.map(
    y => y.replace(/\/api\/v1\/node\//g, '').replace(/\//g, '')
  );
  const analysis = (n.analysis_uuid !== null) ?
    n.analysis_uuid : 'dataset';

  /* Fix for datasets which nodes might not contain a name attribute. */
  let nodeName = 'undefined';
  if (typeof n.name !== 'undefined') {
    nodeName = n.name;
  }

  return new models.Node(id, type, Object.create(null), true, nodeName,
    n.type, study, assay, parents, analysis, n.subanalysis, n.uuid,
    n.file_url);
}

/**
 * Extract nodes.
 * @param datasetJsonObj Analysis dataset of type JSON.
 */
function extractNodes (datasetJsonObj) {
  d3.values(datasetJsonObj.value).forEach((n, i) => {
    /* Assign class string for node types. */
    const nodeType = assignNodeType(n);

    /* Extract node properties from api and create Node. */
    const newNode = createNode(n, nodeType, i);
    nodes.push(newNode);

    /* Build node hash. */
    nodeMap.set(n.uuid, newNode);

    nodeData.set(n.uuid, n);
  });
}

/**
 * Extract link properties.
 * @param lId Integer identifier for the link.
 * @param source Source node object.
 * @param target Target node object.
 * @returns {models.Link} New Link object.
 */
function createLink (lId, source, target) {
  return new models.Link(lId, source, target, true);
}

/**
 * Extract links.
 */
function extractLinks () {
  let lId = 0;

  nodes.forEach(n => {
    if (typeof n.uuid !== 'undefined') {
      if (typeof n.parents !== 'undefined') {
        /* For each parent entry. */
        n.parents.forEach(puuid => { /* n -> target; p -> source */
          if (typeof nodeMap.get(puuid) !== 'undefined') {
            /* ExtractLinkProperties. */
            links.push(createLink(lId, nodeMap.get(puuid), n));
            lId++;
          } else {
            console.log('ERROR: Dataset might be corrupt - parent: ' + puuid +
              ' of node with uuid: ' + n.uuid + ' does not exist.');
          }
        });
      } else {
        console.log('Error: Parents array of node with uuid: ' + n.uuid +
          ' is undefined!');
      }
    } else {
      console.log('Error: Node uuid is undefined!');
    }
  });
}

/**
 * For each node, set pred nodes, succ nodes, predLinks links as well as
 * succLinks links.
 */
function createNodeLinkMapping () {
  links.forEach(l => {
    l.source.succs.set(l.target.autoId, l.target);
    l.source.succLinks.set(l.autoId, l);
    l.target.preds.set(l.source.autoId, l.source);
    l.target.predLinks.set(l.autoId, l);
  });

  /* Set input and output nodes. */
  nodes.forEach(n => {
    if (n.succs.empty()) {
      /* Set output nodes. */
      oNodes.push(n);
    } else if (n.preds.empty()) {
      /* Set input nodes. */
      iNodes.push(n);
    }
  });
}

/**
 * Divide analyses into independent subanalyses.
 */
function markSubanalyses () {
  let subanalysis = 0;

  /**
   * Traverse graph back when the node has two or more predecessors.
   * @param n Current node.
   * @param subanalysis Current subanalysis.
   */
  const traverseBackSubanalysis = function (n, currentSubAnalysis) {
    n.subanalysis = currentSubAnalysis;
    n.preds.values().forEach(pn => {
      if (pn.subanalysis === null) {
        traverseBackSubanalysis(pn, currentSubAnalysis);
      }
    });

    n.succs.values().forEach(sn => {
      if (sn.subanalysis === null) {
        // Need to disable ESLint here because of a circular dependency
        traverseDataset(sn, currentSubAnalysis);  // eslint-disable-line no-use-before-define
      }
    });
  };

  /**
   * Traverse graph in a DFS fashion.
   * @param n Current node.
   * @param subanalysis Current subanalysis.
   */
  let traverseDataset = function (n, _currentSubAnalysis_) {
    let currentSubAnalysis = _currentSubAnalysis_;

    n.subanalysis = currentSubAnalysis;

    if (n.preds.size() > 1) {
      n.preds.values().forEach(pn => {
        if (pn.subanalysis === null) {
          traverseBackSubanalysis(pn, currentSubAnalysis);
        }
      });
    }

    n.succs.values().forEach(sn => {
      if (sn.analysis !== 'dataset') {
        if (sn.subanalysis === null) {
          if (!sn.succs.empty()) {
            currentSubAnalysis = sn.succs.values()[0].subanalysis;
          }
        } else {
          currentSubAnalysis = sn.subanalysis;
        }
      }
      traverseDataset(sn, currentSubAnalysis);
    });
  };

  /* For each subanalysis in the dataset. */
  iNodes.forEach(n => {
    /* Processed nodes are set to "null" after parsing nodes. */
    if (n.subanalysis === null) {
      traverseDataset(n, subanalysis);
      subanalysis++;
    }
  });
}

/**
 * Create analysis node.
 * @param a Analysis.
 * @param i Index.
 * @returns {models.Analysis} New Analysis object.
 */
function createAnalysisNode (a, i) {
  const initTime = {
    start: a.time_start,
    end: a.time_end,
    created: a.creation_date
  };

  if (initTime.start.length === 19) {
    initTime.start = initTime.start.concat('.000');
  } else if (initTime.start.length === 26) {
    initTime.start = initTime.start.substr(0, initTime.start.length - 3);
  }
  if (initTime.end.length === 19) {
    initTime.end = initTime.end.concat('.000');
  } else if (initTime.end.length === 26) {
    initTime.end = initTime.end.substr(0, initTime.end.length - 3);
  }
  if (initTime.created.length === 19) {
    initTime.created = initTime.created = initTime.created.concat('.000');
  } else if (initTime.created.length === 26) {
    initTime.created = initTime.created.substr(0, initTime.created.length - 3);
  }

  return new models.Analysis(i, Object.create(null), true, a.uuid,
    a.workflow__uuid, i, initTime.start, initTime.end, initTime.created);
}

/**
 * Extracts workflow uuid with its workflow data.
 * @param analysesData analyses object extracted from global refinery
 * variable.
 */
function extractWorkflows (analysesData) {
  analysesData.forEach(a => {
    /* Prepare for json format. */
    const prepareJSON = function (wfCpy) {
      let text = wfCpy.replace(/u'/g, '"');
      text = text.replace(/\'/g, '"');
      text = text.replace(/\sNone/g, ' "None"');
      text = text.replace(/\\n/g, '');
      text = text.replace(/\\/g, '');
      text = text.replace(/\"{\"/g, '{"');
      text = text.replace(/}\"/g, '}');
      text = text.replace(/\"\"(\S+)\"\"/g, '"$1"');

      /* Eliminate __xxxx__ parameters. */
      text = text.replace(/\"__(\S*)__\":\s{1}\d*(,\s{1})?/g, '');
      text = text.replace(/,\s{1}null/g, '');
      text = text.replace(/null,/g, '');  // TODO: temp fix
      text = text.replace(/,\s{1}}/g, '}');

      return text;
    };

    /* Transform to JSON object. */
    const text = prepareJSON(a.workflow_copy);
    const wfData = JSON.parse(text);
    const wfObj = wfData;
    workflowData.set(a.workflow__uuid, wfObj);
  });
}

/**
 * Extracts analyses nodes as well as maps it to their corresponding
 * workflows.
 * @param analysesData analyses object extracted from global refinery
 * variable.
 */
function extractAnalyses (analysesData) {
  /* Datasets have no date information. */
  let initDate = d3.time.format.iso(new Date(0));
  if (analysesData.length > 0) {
    initDate = d3.min(analysesData, d => new Date(d.time_start));
    initDate.setSeconds(initDate.getSeconds() - 1);
    initDate = d3.time.format.iso(initDate);
  }

  /* Fix to remove Z at the end of the date string. */
  initDate = initDate.substr(0, initDate.length - 1);

  /* Create analysis for dataset. */
  dataset = new models.Analysis(0, Object.create(null), true, 'dataset',
    'dataset', 0, initDate, initDate, initDate);
  aNodes.push(dataset);
  analysisWorkflowMap.set('dataset', 'dataset');

  /* Create remaining analyses. */
  analysesData.forEach((a, i) => {
    aNodes.push(createAnalysisNode(a, i + 1));
    analysisWorkflowMap.set(a.uuid, a.workflow__uuid);
    analysisData.set(a.uuid, a);
  });
}

/**
 * Create subanalysis node.
 * @param sanId Subanalysis id.
 * @param an Analysis.
 * @param subanalysis
 * @returns {models.Subanalysis} New Subanalysis object.
 */
function createSubanalysisNode (sanId, an, subanalysis) {
  return new models.Subanalysis(sanId, an, true, subanalysis);
}

/**
 * For each analysis the corresponding nodes as well as specifically in- and
 * output nodes are mapped to it.
 */
function createAnalysisNodeMapping () {
  /* Subanalysis. */

  /* Create subanalysis node. */
  let sanId = 0;
  aNodes.forEach(an => {
    nodes
      .filter(n => n.analysis === an.uuid)
      .forEach(n => {
        if (!an.children.has(n.subanalysis)) {
          const san = createSubanalysisNode(sanId, an, n.subanalysis);
          saNodes.push(san);
          an.children.set(n.subanalysis, san);
          sanId++;
        }
      });
  });

  saNodes.forEach(san => {
    /* Set child nodes for subanalysis. */
    nodes
    .filter(n => san.parent.uuid === n.analysis &&
      n.subanalysis === san.subanalysis)
    .forEach(cn => san.children.set(cn.autoId, cn));

    /* Set subanalysis parent for nodes. */
    san.children.values().forEach(n => {
      n.parent = san;
    });

    /* Set input nodes for subanalysis. */
    san.children.values()
      .filter(
        n => n.preds.values().some(
          p => p.analysis !== san.parent.uuid
        ) || n.preds.empty()
      )
      /* If no src analyses exists. */
      .forEach(inn => san.inputs.set(inn.autoId, inn));

    /* Set output nodes for subanalysis. */
    san.children.values()
      .filter(
        n => n.succs.empty() ||
        n.succs.values().some(s => s.analysis !== san.parent.uuid)
      )
      .forEach(onn => {
        san.outputs.set(onn.autoId, onn);
      });
  });

  saNodes.forEach(san => {
    /* Set predecessor subanalyses. */
    san.inputs.values().forEach(n => {
      n.preds.values().forEach(pn => {
        if (!san.preds.has(pn.parent.autoId)) {
          san.preds.set(pn.parent.autoId, pn.parent);
        }
      });
    });

    /* Set successor subanalyses. */
    san.outputs.values().forEach(n => {
      n.succs.values().forEach(sn => {
        if (!san.succs.has(sn.parent.autoId)) {
          san.succs.set(sn.parent.autoId, sn.parent);
        }
      });
    });
  });

  /* Set link references for subanalyses. */
  saNodes.forEach(san => {
    san.inputs.values().forEach(sain => {
      sain.predLinks.values().forEach(l => {
        san.predLinks.set(l.autoId, l);
      });
    });

    san.outputs.values().forEach(saon => {
      saon.succLinks.values().forEach(l => {
        san.succLinks.set(l.autoId, l);
      });
    });
  });

  /* Set links for subanalysis. */
  saNodes.forEach(san => {
    links
      .filter(
        l => l !== null && san.parent.uuid === l.source.analysis &&
        l.source.subanalysis === san.subanalysis
      )
      .forEach(ll => {
        if (san.parent.uuid === ll.target.analysis) {
          san.links.set(ll.autoId, ll);
        } else {
          /* Set links between analyses. */
          aLinks.push(ll);
        }
      });
  });

  /* Analysis. */
  aNodes.forEach(an => {
    /* Children are set already. */
    an.children.values().forEach(san => {
      /* Set input nodes. */
      san.inputs.entries().forEach(sani => {
        an.inputs.set(sani.key, sani.value);
      });

      /* Set output nodes. */
      san.outputs.entries().forEach(sano => {
        an.outputs.set(sano.key, sano.value);
      });

      /* Set subanalysis wfUuid. */
      san.wfUuid = an.wfUuid;
    });

    /* Set workflow name. */
    const wfObj = workflowData.get(an.wfUuid);
    an.wfName = (typeof wfObj === 'undefined') ? 'dataset' : wfObj.name;

    /*  TODO: Temporary workflow abbreviation. */
    if (an.wfName.substr(0, 15) === 'Test workflow: ') {
      an.wfName = an.wfName.substr(15, an.wfName.length - 15);
    }
    if (an.wfName.indexOf('(') > 0) {
      an.wfName = an.wfName.substr(0, an.wfName.indexOf('('));
    }
    if (an.wfName.indexOf('-') > 0) {
      an.wfName = an.wfName.substr(0, an.wfName.indexOf('-'));
    }
    an.wfCode = an.wfName;
  });

  aNodes.forEach(an => {
    /* Set predecessor analyses. */
    an.children.values().forEach(san => {
      san.preds.values().forEach(psan => {
        if (!an.preds.has(psan.parent.autoId)) {
          an.preds.set(psan.parent.autoId, psan.parent);
        }
      });
    });

    /* TODO: Bug when deleting a successful analysis
     * through django admin gui. */

    /* Set successor analyses. */
    an.children.values().forEach(san => {
      san.succs.values().forEach(ssan => {
        if (!an.succs.has(ssan.parent.autoId)) {
          an.succs.set(ssan.parent.autoId, ssan.parent);
        }
      });
    });
  });

  /* Set analysis links. */
  aNodes.forEach(an => {
    an.children.values().forEach(san => {
      san.links.values().forEach(sanl => {
        an.links.set(sanl.autoId, sanl);
      });
    });
  });

  /* Set predLinks and succLinks. */
  aNodes.forEach(an => {
    an.inputs.values().forEach(ain => {
      ain.predLinks.values().forEach(l => {
        an.predLinks.set(l.autoId, l);
      });
    });
    an.outputs.values().forEach(aon => {
      aon.succLinks.values().forEach(l => {
        an.succLinks.set(l.autoId, l);
      });
    });
  });
}

/**
 * Temporarily facet node attribute extraction.
 * @param solrResponse Facet filter information on node attributes.
 */
function extractFacetNodeAttributesPrivate (solrResponse) {
  if (solrResponse instanceof SolrResponse) {
    solrResponse.getDocumentList().forEach(d => {
      /* Set facet attributes to all nodes for the subanalysis of the selected
       * node.
       */
      const selNode = nodeMap.get(d.uuid);
      const rawFacetAttributes = d3.entries(d);

      rawFacetAttributes.forEach(fa => {
        const attrNameEndIndex = fa.key.indexOf('_Characteristics_');
        let attrName = '';

        if (attrNameEndIndex === -1) {
          attrName = fa.key.replace(/REFINERY_/g, '');
          attrName = attrName.replace(/_([0-9])+_([0-9])+_s/g, '');
          attrName = attrName.toLowerCase();
        } else {
          attrName = fa.key.substr(0, attrNameEndIndex);
        }

        selNode.attributes.set(attrName, fa.value);
      });
    });
  }
}

/**
 * Add face node attributes to dropdown button menu in toolbar.
 * @param solrResponse Facet filter information on node attributes.
 */
function createFacetNodeAttributeList (solrResponse) {
  /* Extract attributes. */
  if (solrResponse instanceof SolrResponse &&
    solrResponse.getDocumentList().length > 0) {
    const sampleNode = solrResponse.getDocumentList()[0];
    const rawAttrSet = d3.entries(sampleNode);

    rawAttrSet.forEach(fa => {
      const attrNameEndIndex = fa.key.indexOf('_Characteristics_');
      let attrName = '';

      if (attrNameEndIndex === -1) {
        attrName = fa.key.replace(/REFINERY_/g, '');
        attrName = attrName.replace(/_([0-9])+_([0-9])+_s/g, '');
        attrName = attrName.toLowerCase();
      } else {
        attrName = fa.key.substr(0, attrNameEndIndex);
      }

      nodeAttributeList.push(attrName);
    });
  }

  /* Add to button dropdown list. */
  nodeAttributeList.forEach(na => {
    $('<li/>', {
      id: 'prov-ctrl-visible-attribute-list-' + na,
      style: 'padding-left: 5px',
      html: '<a href="#" class="field-name"><label class="radio" ' +
        'style="text-align: start;margin-top: 0px;margin-bottom: 0px;">' +
        '<input type="radio">' +
        na + '</label></a>'
    }).appendTo('#prov-ctrl-visible-attribute-list');
  });

  /* Initially set name attribute checked. */
  $('#prov-ctrl-visible-attribute-list-name')
    .find('input').prop('checked', true);
}

/**
 * Sets the parent objects for analysis nodes.
 * @param graph The provenance graph.
 */
function setAnalysisParent (graph) {
  graph.aNodes.forEach(an => {
    an.parent = graph;
  });
}

/**
 * Main init module function.
 * @param data Dataset holding the information for nodes and links.
 * @param analysesData Collection holding the information for
 * analysis - node mapping.
 * @param solrResponse Facet filter information on node attributes.
 * @returns {models.ProvGraph} The main graph object of the provenance
 * visualization.
 */
function runInitPrivate (data, analysesData, solrResponse) {
  /* Extract raw objects. */
  const obj = d3.entries(data)[1];

  /* Create node collection. */
  extractNodes(obj, solrResponse);

  /* Create link collection. */
  extractLinks();

  /* Set preds, succs, and predLinks as well as succLinks. */
  createNodeLinkMapping();

  /* Create analysis nodes. */
  extractAnalyses(analysesData);

  /* Extract workflow information. */
  extractWorkflows(analysesData);

  /* Divide dataset and analyses into subanalyses. */
  markSubanalyses();

  /* Create analysis node mapping. */
  createAnalysisNodeMapping();

  /* Temporarily facet node attribute extraction. */
  extractFacetNodeAttributesPrivate(solrResponse);

  /* Create node attribute list. */
  createFacetNodeAttributeList(solrResponse);

  /* Create graph. */
  const graph = new models.ProvGraph(dataset, nodes, links, aLinks, iNodes,
    oNodes, aNodes, saNodes, analysisWorkflowMap, nodeMap, analysisData,
    workflowData, nodeData);

  /* Set parent objects for analysis nodes. */
  setAnalysisParent(graph);

  return graph;
}

/**
 * Publish module function.
 */
function run (data, analysesData, solrResponse) {
  return runInitPrivate(data, analysesData, solrResponse);
}

export default run;
