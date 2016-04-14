/* Copyright Stefan Luger: Refinery's Provenance Visualization */
var refineryProvVis = (function ($,d3,SolrResponse,dagre) {
	'use strict';

	var version = "1.0.0";

	/**
	 * Module for constructor function declaration.
	 */
	var DoiFactors = function () {
	  var factors = {
	    filtered: {
	      label: 'filtered',
	      value: 0.2,
	      masked: true
	    },
	    selected: {
	      label: 'selected',
	      value: 0.2,
	      masked: true
	    },
	    highlighted: {
	      label: 'highlighted',
	      value: 0.2,
	      masked: true
	    },
	    time: {
	      label: 'time',
	      value: 0.2,
	      masked: true
	    },
	    diff: {
	      label: 'diff',
	      value: 0.2,
	      masked: true
	    }
	  };

	  return {
	    set: function set(prop, value, masked) {
	      factors[prop] = {
	        label: prop.toString(),
	        value: value,
	        masked: masked
	      };
	    },
	    get: function get(prop) {
	      return factors[prop].value;
	    },
	    isMasked: function isMasked(prop) {
	      return factors[prop].masked;
	    },

	    factors: factors
	  };
	}();

	/**
	 * Constructor function representing the degree-of-interest (DOI)
	 * components for BaseNode.
	 * @param node The encapsulating node.
	 * @constructor
	 */
	function DoiComponents(node) {
	  this.node = node;

	  /* API: General interest. */
	  /* ********************** */

	  /* The latest execution time of a node is more important
	   * than earlier executions.
	   */
	  this.doiTime = 0;

	  /* For weak layering, analyses are layered without considering the number
	   * of subanlayses, inputs or outputs. Therefore a diff in those three
	   * categories may occur. The number of nodes carrying a diff in relation
	   * to the number of layered nodes.
	   */

	  this.doiLayerDiff = 0;

	  /* For layered nodes: Workflow parameters, files or topology changes over
	   * time.
	   */
	  this.change = {
	    wfParams: d3.map(),
	    files: d3.map(),
	    topology: d3.map()
	  };

	  /* Corresponds to the node type: Node, subanalysis, analysis.*/
	  this.relationship = 0;

	  /* The overall graph width and height influences node appearances.*/
	  this.graphMetrics = {
	    width: -1,
	    height: -1
	  };

	  /* UI: Interest derived from user actions. */
	  /* *************************************** */

	  /* A node is in the result set of filter actions. */
	  this.doiFiltered = 0;

	  /* A node is selected by user actions. */
	  this.doiSelected = 0;

	  /* A node is part of a node-link path highlighted. */
	  this.doiHighlighted = 0;

	  /* Distance. */
	  /* ********* */

	  /* A node's neighborhood directly influences it's DOI value through
	   * link weight and fallout function.
	   */
	  this.neighborhoodDoiFactor = 1;

	  /* Computation. */
	  /* ************ */

	  /* A node's dominant component is represented by the minimum or maximum
	   * value throughout all components.
	   */
	  this.doiMinMax = -1;

	  /* A node's average DOI value is calculated by the sum of all weighted
	   * single DOI component values.
	   */
	  this.doiWeightedSum = -1;
	}

	/**
	 * Look up filtered attribute for encapsulating node.
	 * A node is within the filter results.
	 */
	DoiComponents.prototype.filteredChanged = function () {
	  this.doiFiltered = this.node.filtered ? 1 : 0.5;
	  this.computeWeightedSum();
	};

	/**
	 * A node can be selected for further actions or detailed information.
	 */
	DoiComponents.prototype.selectedChanged = function () {
	  this.doiSelected = this.node.selected ? 1 : 0;
	  this.computeWeightedSum();
	};

	/**
	 * A path containing nodes may be highlighted.
	 */
	DoiComponents.prototype.highlightedChanged = function () {
	  this.doiHighlighted = this.node.highlighted ? 1 : 0;
	  this.computeWeightedSum();
	};

	/**
	 * Based on the time frame, calculate component weight.
	 * @param factor The analysis start time scaled between 0 and 1.
	 */
	DoiComponents.prototype.initTimeComponent = function (factor) {
	  this.doiTime = factor;
	  this.computeWeightedSum();
	};

	/**
	 * Based on amount of nodes with a diff within a layer, calculate component
	 * weight.
	 * @param factor The accumulated diffs scaled between 0 and 1.
	 */
	DoiComponents.prototype.initLayerDiffComponent = function (factor) {
	  this.doiLayerDiff = factor;
	  this.computeWeightedSum();
	};

	/**
	 * Calculates the dominant doi component.
	 */
	DoiComponents.prototype.computeMinMax = function () {
	  /* TODO: Based on heuristics, find dominant component.*/
	  this.doiMinMax = -1;
	};

	/**
	 * Calculates a weighted doi value among all doi components considering
	 * component weights.
	 */
	DoiComponents.prototype.computeWeightedSum = function () {
	  this.doiWeightedSum = (this.doiFiltered * DoiFactors.factors.filtered.value + this.doiSelected * DoiFactors.factors.selected.value + this.doiHighlighted * DoiFactors.factors.highlighted.value + this.doiTime * DoiFactors.factors.time.value + this.doiLayerDiff * DoiFactors.factors.diff.value).toFixed(2);
	};

	/**
	 * Constructor function of the super node inherited by Node, Analysis and
	 * Subanalysis.
	 *
	 * @param id
	 * @param nodeType
	 * @param parent
	 * @param hidden
	 * @constructor
	 */
	function BaseNode(id, nodeType, parent, hidden) {
	  this.id = id;
	  this.nodeType = nodeType;
	  this.parent = parent;
	  this.hidden = hidden;

	  this.preds = d3.map();
	  this.succs = d3.map();
	  this.predLinks = d3.map();
	  this.succLinks = d3.map();
	  this.children = d3.map();
	  this.x = 0;
	  this.y = 0;

	  /* Layout specific. */
	  this.l = {

	    /* Top sort markings [Kahn 1962]. */
	    ts: {
	      removed: false
	    },

	    /* Graph attributes. */
	    width: 0,
	    depth: 0,

	    bcOrder: -1
	  };

	  BaseNode.numInstances = (BaseNode.numInstances || 0) + 1;
	  this.autoId = BaseNode.numInstances;

	  this.doi = new DoiComponents(this);
	  this.selected = false;
	  this.filtered = true;
	}

	/**
	 * Constructor function for the node data structure.
	 *
	 * @param id
	 * @param nodeType
	 * @param parent
	 * @param hidden
	 * @param name
	 * @param fileType
	 * @param study
	 * @param assay
	 * @param parents
	 * @param analysis
	 * @param subanalysis
	 * @param uuid
	 * @param fileUrl
	 * @constructor
	 */
	function Node(id, nodeType, parent, hidden, name, fileType, study, assay, parents, analysis, subanalysis, uuid, fileUrl) {
	  BaseNode.call(this, id, nodeType, parent, hidden);

	  this.name = name;
	  this.label = '';
	  this.fileType = fileType;
	  this.study = study;
	  this.assay = assay;
	  this.parents = parents;
	  this.analysis = analysis;
	  this.subanalysis = subanalysis;
	  this.uuid = uuid;
	  this.fileUrl = fileUrl;

	  this.attributes = d3.map();
	}

	Node.prototype = Object.create(BaseNode.prototype);
	Node.prototype.constructor = Node;

	/**
	 * Constructor function for the analysis node data structure.
	 *
	 * @param id
	 * @param parent
	 * @param hidden
	 * @param uuid
	 * @param wfUuid
	 * @param analysis
	 * @param start
	 * @param end
	 * @param created
	 * @constructor
	 */
	function Analysis(id, parent, hidden, uuid, wfUuid, analysis, start, end, created) {
	  BaseNode.call(this, id, 'analysis', parent, hidden);

	  this.uuid = uuid;
	  this.wfUuid = wfUuid;
	  this.analysis = analysis;
	  this.start = start;
	  this.end = end;
	  this.created = created;

	  this.inputs = d3.map();
	  this.outputs = d3.map();
	  this.links = d3.map();

	  this.wfName = '';
	  this.wfCode = '';

	  this.layer = '';
	  this.motif = '';

	  this.exaggerated = false;

	  this.motifDiff = {
	    numIns: 0,
	    numOuts: 0,
	    wfUuid: this.wfUuid,
	    numSubanalyses: 0
	  };
	}

	Analysis.prototype = Object.create(BaseNode.prototype);
	Analysis.prototype.constructor = Analysis;

	/**
	 * Constructor function for the subanalysis node data structure.
	 *
	 * @param id
	 * @param parent
	 * @param hidden
	 * @param subanalysis
	 * @constructor
	 */
	function Subanalysis(id, parent, hidden, subanalysis) {
	  BaseNode.call(this, id, 'subanalysis', parent, hidden);

	  this.subanalysis = subanalysis;

	  this.wfUuid = '';
	  this.inputs = d3.map();
	  this.outputs = d3.map();
	  this.links = d3.map();
	}

	Subanalysis.prototype = Object.create(BaseNode.prototype);
	Subanalysis.prototype.constructor = Subanalysis;

	/**
	 * Constructor function for the motif data structure.
	 *
	 * @constructor
	 */
	function Motif() {
	  this.preds = d3.map();
	  this.succs = d3.map();
	  this.numIns = 0;
	  this.numOuts = 0;
	  this.wfUuid = '';
	  this.numSubanalyses = 0;
	  this.file = '';

	  Motif.numInstances = (Motif.numInstances || 0) + 1;
	  this.autoId = Motif.numInstances;
	}

	/**
	 * Constructor function for the provenance layered node data structure.
	 *
	 * @param id
	 * @param parent
	 * @param hidden
	 * @constructor
	 */
	function Layer(id, motif, parent, hidden) {
	  BaseNode.call(this, id, 'layer', parent, hidden);

	  this.inputs = d3.map();
	  this.outputs = d3.map();
	  this.links = d3.map();

	  this.motif = motif;
	  this.wfName = '';
	}

	Layer.prototype = Object.create(BaseNode.prototype);
	Layer.prototype.constructor = Layer;

	/**
	 * Constructor function for the link data structure.
	 *
	 * @param id
	 * @param source
	 * @param target
	 * @param hidden
	 * @constructor
	 */
	function Link(id, source, target, hidden) {
	  this.id = id;
	  this.source = source;
	  this.target = target;
	  this.hidden = hidden;
	  this.highlighted = false;
	  this.filtered = true;

	  /* Layout computation specific flags. */
	  this.l = {

	    /* Top sort markings [Kahn 1962]. */
	    ts: {
	      removed: false
	    }
	  };

	  Link.numInstances = (Link.numInstances || 0) + 1;
	  this.autoId = Link.numInstances;
	}

	/**
	 * Constructor function for the provenance visualization.
	 *
	 * @param parentDiv
	 * @param zoom
	 * @param data
	 * @param url
	 * @param canvas
	 * @param rect
	 * @param margin
	 * @param width
	 * @param height
	 * @param radius
	 * @param color
	 * @param graph
	 * @param cell
	 * @param layerMethod
	 * @constructor
	 */
	function ProvVis(parentDiv, zoom, data, url, canvas, rect, margin, width, height, radius, color, graph, cell, layerMethod) {
	  this._parentDiv = parentDiv;
	  this.zoom = zoom;
	  this._data = data;
	  this._url = url;

	  this.canvas = canvas;
	  this.rect = rect;
	  this.margin = margin;
	  this.width = width;
	  this.height = height;
	  this.radius = radius;
	  this.color = color;
	  this.graph = graph;
	  this.cell = cell;
	  this.layerMethod = layerMethod;
	}

	/**
	 * Constructor function for the provenance graph.
	 *
	 * @param dataset
	 * @param nodes
	 * @param links
	 * @param aLinks
	 * @param iNodes
	 * @param oNodes
	 * @param aNodes
	 * @param saNodes
	 * @param analysisWorkflowMap
	 * @param nodeMap
	 * @param analysisData
	 * @param workflowData
	 * @param nodeData
	 * @constructor
	 */
	function ProvGraph(dataset, nodes, links, aLinks, iNodes, oNodes, aNodes, saNodes, analysisWorkflowMap, nodeMap, analysisData, workflowData, nodeData) {
	  this.dataset = dataset;
	  this.nodes = nodes;
	  this.links = links;
	  this.aLinks = aLinks;
	  this.iNodes = iNodes;
	  this.oNodes = oNodes;
	  this.aNodes = aNodes;
	  this.saNodes = saNodes;
	  this.bclgNodes = [];

	  this.analysisWorkflowMap = analysisWorkflowMap;
	  this.nodeMap = nodeMap;
	  this.analysisData = analysisData;
	  this.workflowData = workflowData;
	  this.nodeData = nodeData;

	  /* Layout specific. */
	  this.l = {
	    width: 0,
	    depth: 0
	  };

	  this.lNodes = d3.map();
	  this.lLinks = d3.map();
	}

	/**
	 * Module for init.
	 */

	/* Initialize node-link arrays. */
	var nodes = [];
	var links = [];
	var aLinks = [];
	var iNodes = [];
	var oNodes = [];
	var aNodes = [];
	var saNodes = [];
	var nodeAttributeList = [];
	var nodeMap = d3.map();
	var analysisWorkflowMap = d3.map();
	var workflowData = d3.map();
	var analysisData = d3.map();
	var nodeData = d3.map();

	var dataset = Object.create(null);

	/**
	 * Assign node types.
	 * @param n Current raw node.
	 * @returns {string} The CSS class corresponding to the type of the node.
	 */
	function assignNodeType(n) {
	  var nodeType = '';

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
	function createNode(n, type, id) {
	  var study = n.study !== null ? n.study.replace(/\/api\/v1\/study\//g, '').replace(/\//g, '') : '';
	  var assay = n.assay !== null ? n.assay.replace(/\/api\/v1\/assay\//g, '').replace(/\//g, '') : '';
	  var parents = n.parents.map(function (y) {
	    return y.replace(/\/api\/v1\/node\//g, '').replace(/\//g, '');
	  });
	  var analysis = n.analysis_uuid !== null ? n.analysis_uuid : 'dataset';

	  /* Fix for datasets which nodes might not contain a name attribute. */
	  var nodeName = 'undefined';
	  if (typeof n.name !== 'undefined') {
	    nodeName = n.name;
	  }

	  return new Node(id, type, Object.create(null), true, nodeName, n.type, study, assay, parents, analysis, n.subanalysis, n.uuid, n.file_url);
	}

	/**
	 * Extract nodes.
	 * @param datasetJsonObj Analysis dataset of type JSON.
	 */
	function extractNodes(datasetJsonObj) {
	  d3.values(datasetJsonObj.value).forEach(function (n, i) {
	    /* Assign class string for node types. */
	    var nodeType = assignNodeType(n);

	    /* Extract node properties from api and create Node. */
	    var newNode = createNode(n, nodeType, i);
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
	function createLink(lId, source, target) {
	  return new Link(lId, source, target, true);
	}

	/**
	 * Extract links.
	 */
	function extractLinks() {
	  var lId = 0;

	  nodes.forEach(function (n) {
	    if (typeof n.uuid !== 'undefined') {
	      if (typeof n.parents !== 'undefined') {
	        /* For each parent entry. */
	        n.parents.forEach(function (puuid) {
	          /* n -> target; p -> source */
	          if (typeof nodeMap.get(puuid) !== 'undefined') {
	            /* ExtractLinkProperties. */
	            links.push(createLink(lId, nodeMap.get(puuid), n));
	            lId++;
	          } else {
	            console.log('ERROR: Dataset might be corrupt - parent: ' + puuid + ' of node with uuid: ' + n.uuid + ' does not exist.');
	          }
	        });
	      } else {
	        console.log('Error: Parents array of node with uuid: ' + n.uuid + ' is undefined!');
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
	function createNodeLinkMapping() {
	  links.forEach(function (l) {
	    l.source.succs.set(l.target.autoId, l.target);
	    l.source.succLinks.set(l.autoId, l);
	    l.target.preds.set(l.source.autoId, l.source);
	    l.target.predLinks.set(l.autoId, l);
	  });

	  /* Set input and output nodes. */
	  nodes.forEach(function (n) {
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
	function markSubanalyses() {
	  var subanalysis = 0;

	  /**
	   * Traverse graph back when the node has two or more predecessors.
	   * @param n Current node.
	   * @param subanalysis Current subanalysis.
	   */
	  var traverseBackSubanalysis = function traverseBackSubanalysis(n, currentSubAnalysis) {
	    n.subanalysis = currentSubAnalysis;
	    n.preds.values().forEach(function (pn) {
	      if (pn.subanalysis === null) {
	        traverseBackSubanalysis(pn, currentSubAnalysis);
	      }
	    });

	    n.succs.values().forEach(function (sn) {
	      if (sn.subanalysis === null) {
	        // Need to disable ESLint here because of a circular dependency
	        traverseDataset(sn, currentSubAnalysis); // eslint-disable-line no-use-before-define
	      }
	    });
	  };

	  /**
	   * Traverse graph in a DFS fashion.
	   * @param n Current node.
	   * @param subanalysis Current subanalysis.
	   */
	  function traverseDataset(n, _currentSubAnalysis_) {
	    var currentSubAnalysis = _currentSubAnalysis_;

	    n.subanalysis = currentSubAnalysis;

	    if (n.preds.size() > 1) {
	      n.preds.values().forEach(function (pn) {
	        if (pn.subanalysis === null) {
	          traverseBackSubanalysis(pn, currentSubAnalysis);
	        }
	      });
	    }

	    n.succs.values().forEach(function (sn) {
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
	  }

	  /* For each subanalysis in the dataset. */
	  iNodes.forEach(function (n) {
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
	function createAnalysisNode(a, i) {
	  var initTime = {
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

	  return new Analysis(i, Object.create(null), true, a.uuid, a.workflow__uuid, i, initTime.start, initTime.end, initTime.created);
	}

	/**
	 * Extracts workflow uuid with its workflow data.
	 * @param analysesData analyses object extracted from global refinery
	 * variable.
	 */
	function extractWorkflows(analysesData) {
	  analysesData.forEach(function (a) {
	    /* Prepare for json format. */
	    var prepareJSON = function prepareJSON(wfCpy) {
	      var text = wfCpy.replace(/u'/g, '"');
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
	      text = text.replace(/null,/g, ''); // TODO: temp fix
	      text = text.replace(/,\s{1}}/g, '}');

	      return text;
	    };

	    /* Transform to JSON object. */
	    var text = prepareJSON(a.workflow_copy);
	    var wfData = JSON.parse(text);
	    var wfObj = wfData;
	    workflowData.set(a.workflow__uuid, wfObj);
	  });
	}

	/**
	 * Extracts analyses nodes as well as maps it to their corresponding
	 * workflows.
	 * @param analysesData analyses object extracted from global refinery
	 * variable.
	 */
	function extractAnalyses(analysesData) {
	  /* Datasets have no date information. */
	  var initDate = d3.time.format.iso(new Date(0));
	  if (analysesData.length > 0) {
	    initDate = d3.min(analysesData, function (d) {
	      return new Date(d.time_start);
	    });
	    initDate.setSeconds(initDate.getSeconds() - 1);
	    initDate = d3.time.format.iso(initDate);
	  }

	  /* Fix to remove Z at the end of the date string. */
	  initDate = initDate.substr(0, initDate.length - 1);

	  /* Create analysis for dataset. */
	  dataset = new Analysis(0, Object.create(null), true, 'dataset', 'dataset', 0, initDate, initDate, initDate);
	  aNodes.push(dataset);
	  analysisWorkflowMap.set('dataset', 'dataset');

	  /* Create remaining analyses. */
	  analysesData.forEach(function (a, i) {
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
	function createSubanalysisNode(sanId, an, subanalysis) {
	  return new Subanalysis(sanId, an, true, subanalysis);
	}

	/**
	 * For each analysis the corresponding nodes as well as specifically in- and
	 * output nodes are mapped to it.
	 */
	function createAnalysisNodeMapping() {
	  /* Subanalysis. */

	  /* Create subanalysis node. */
	  var sanId = 0;
	  aNodes.forEach(function (an) {
	    nodes.filter(function (n) {
	      return n.analysis === an.uuid;
	    }).forEach(function (n) {
	      if (!an.children.has(n.subanalysis)) {
	        var san = createSubanalysisNode(sanId, an, n.subanalysis);
	        saNodes.push(san);
	        an.children.set(n.subanalysis, san);
	        sanId++;
	      }
	    });
	  });

	  saNodes.forEach(function (san) {
	    /* Set child nodes for subanalysis. */
	    nodes.filter(function (n) {
	      return san.parent.uuid === n.analysis && n.subanalysis === san.subanalysis;
	    }).forEach(function (cn) {
	      return san.children.set(cn.autoId, cn);
	    });

	    /* Set subanalysis parent for nodes. */
	    san.children.values().forEach(function (n) {
	      n.parent = san;
	    });

	    /* Set input nodes for subanalysis. */
	    san.children.values().filter(function (n) {
	      return n.preds.values().some(function (p) {
	        return p.analysis !== san.parent.uuid;
	      }) || n.preds.empty();
	    })
	    /* If no src analyses exists. */
	    .forEach(function (inn) {
	      return san.inputs.set(inn.autoId, inn);
	    });

	    /* Set output nodes for subanalysis. */
	    san.children.values().filter(function (n) {
	      return n.succs.empty() || n.succs.values().some(function (s) {
	        return s.analysis !== san.parent.uuid;
	      });
	    }).forEach(function (onn) {
	      san.outputs.set(onn.autoId, onn);
	    });
	  });

	  saNodes.forEach(function (san) {
	    /* Set predecessor subanalyses. */
	    san.inputs.values().forEach(function (n) {
	      n.preds.values().forEach(function (pn) {
	        if (!san.preds.has(pn.parent.autoId)) {
	          san.preds.set(pn.parent.autoId, pn.parent);
	        }
	      });
	    });

	    /* Set successor subanalyses. */
	    san.outputs.values().forEach(function (n) {
	      n.succs.values().forEach(function (sn) {
	        if (!san.succs.has(sn.parent.autoId)) {
	          san.succs.set(sn.parent.autoId, sn.parent);
	        }
	      });
	    });
	  });

	  /* Set link references for subanalyses. */
	  saNodes.forEach(function (san) {
	    san.inputs.values().forEach(function (sain) {
	      sain.predLinks.values().forEach(function (l) {
	        san.predLinks.set(l.autoId, l);
	      });
	    });

	    san.outputs.values().forEach(function (saon) {
	      saon.succLinks.values().forEach(function (l) {
	        san.succLinks.set(l.autoId, l);
	      });
	    });
	  });

	  /* Set links for subanalysis. */
	  saNodes.forEach(function (san) {
	    links.filter(function (l) {
	      return l !== null && san.parent.uuid === l.source.analysis && l.source.subanalysis === san.subanalysis;
	    }).forEach(function (ll) {
	      if (san.parent.uuid === ll.target.analysis) {
	        san.links.set(ll.autoId, ll);
	      } else {
	        /* Set links between analyses. */
	        aLinks.push(ll);
	      }
	    });
	  });

	  /* Analysis. */
	  aNodes.forEach(function (an) {
	    /* Children are set already. */
	    an.children.values().forEach(function (san) {
	      /* Set input nodes. */
	      san.inputs.entries().forEach(function (sani) {
	        an.inputs.set(sani.key, sani.value);
	      });

	      /* Set output nodes. */
	      san.outputs.entries().forEach(function (sano) {
	        an.outputs.set(sano.key, sano.value);
	      });

	      /* Set subanalysis wfUuid. */
	      san.wfUuid = an.wfUuid;
	    });

	    /* Set workflow name. */
	    var wfObj = workflowData.get(an.wfUuid);
	    an.wfName = typeof wfObj === 'undefined' ? 'dataset' : wfObj.name;

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

	  aNodes.forEach(function (an) {
	    /* Set predecessor analyses. */
	    an.children.values().forEach(function (san) {
	      san.preds.values().forEach(function (psan) {
	        if (!an.preds.has(psan.parent.autoId)) {
	          an.preds.set(psan.parent.autoId, psan.parent);
	        }
	      });
	    });

	    /* TODO: Bug when deleting a successful analysis
	     * through django admin gui. */

	    /* Set successor analyses. */
	    an.children.values().forEach(function (san) {
	      san.succs.values().forEach(function (ssan) {
	        if (!an.succs.has(ssan.parent.autoId)) {
	          an.succs.set(ssan.parent.autoId, ssan.parent);
	        }
	      });
	    });
	  });

	  /* Set analysis links. */
	  aNodes.forEach(function (an) {
	    an.children.values().forEach(function (san) {
	      san.links.values().forEach(function (sanl) {
	        an.links.set(sanl.autoId, sanl);
	      });
	    });
	  });

	  /* Set predLinks and succLinks. */
	  aNodes.forEach(function (an) {
	    an.inputs.values().forEach(function (ain) {
	      ain.predLinks.values().forEach(function (l) {
	        an.predLinks.set(l.autoId, l);
	      });
	    });
	    an.outputs.values().forEach(function (aon) {
	      aon.succLinks.values().forEach(function (l) {
	        an.succLinks.set(l.autoId, l);
	      });
	    });
	  });
	}

	/**
	 * Temporarily facet node attribute extraction.
	 * @param solrResponse Facet filter information on node attributes.
	 */
	function extractFacetNodeAttributesPrivate(solrResponse) {
	  if (solrResponse instanceof SolrResponse) {
	    solrResponse.getDocumentList().forEach(function (d) {
	      /* Set facet attributes to all nodes for the subanalysis of the selected
	       * node.
	       */
	      var selNode = nodeMap.get(d.uuid);
	      var rawFacetAttributes = d3.entries(d);

	      rawFacetAttributes.forEach(function (fa) {
	        var attrNameEndIndex = fa.key.indexOf('_Characteristics_');
	        var attrName = '';

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
	function createFacetNodeAttributeList(solrResponse) {
	  /* Extract attributes. */
	  if (solrResponse instanceof SolrResponse && solrResponse.getDocumentList().length > 0) {
	    var sampleNode = solrResponse.getDocumentList()[0];
	    var rawAttrSet = d3.entries(sampleNode);

	    rawAttrSet.forEach(function (fa) {
	      var attrNameEndIndex = fa.key.indexOf('_Characteristics_');
	      var attrName = '';

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
	  nodeAttributeList.forEach(function (na) {
	    $('<li/>', {
	      id: 'prov-ctrl-visible-attribute-list-' + na,
	      style: 'padding-left: 5px',
	      html: '<a href="#" class="field-name"><label class="radio" ' + 'style="text-align: start;margin-top: 0px;margin-bottom: 0px;">' + '<input type="radio">' + na + '</label></a>'
	    }).appendTo('#prov-ctrl-visible-attribute-list');
	  });

	  /* Initially set name attribute checked. */
	  $('#prov-ctrl-visible-attribute-list-name').find('input').prop('checked', true);
	}

	/**
	 * Sets the parent objects for analysis nodes.
	 * @param graph The provenance graph.
	 */
	function setAnalysisParent(graph) {
	  graph.aNodes.forEach(function (an) {
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
	function runInitPrivate(data, analysesData, solrResponse) {
	  /* Extract raw objects. */
	  var obj = d3.entries(data)[1];

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
	  var graph = new ProvGraph(dataset, nodes, links, aLinks, iNodes, oNodes, aNodes, saNodes, analysisWorkflowMap, nodeMap, analysisData, workflowData, nodeData);

	  /* Set parent objects for analysis nodes. */
	  setAnalysisParent(graph);

	  return graph;
	}

	/**
	 * Publish module function.
	 */
	function run$1(data, analysesData, solrResponse) {
	  return runInitPrivate(data, analysesData, solrResponse);
	}

	/**
	 * Module for layout.
	 */

	/**
	 * Generic implementation for the linear time topology sort [Kahn 1962]
	 * (http://en.wikipedia.org/wiki/Topological_sorting).
	 * @param startNodes Array containing the starting nodes.
	 * @param nodesLength Size of the nodes array.
	 * @param parent The parent node.
	 * @returns {Array} Topology sorted array of nodes.
	 */
	function topSortNodes(startNodes, nodesLength, parent) {
	  var sortedNodes = [];

	  /* For each successor node. */
	  function handleSuccessorNodes(_curNode_) {
	    var curNode = _curNode_;

	    /* When the analysis layout is computed, links occur between Nodes or
	     * analyses. */
	    if (curNode instanceof Node && parent instanceof ProvGraph) {
	      curNode = curNode.parent.parent;
	    }

	    /* Get successors. */
	    curNode.succs.values().filter(function (s) {
	      return s.parent === null || s.parent === parent;
	    }).forEach(function (_succNode_) {
	      var succNode = _succNode_;

	      if (succNode instanceof Node && parent instanceof ProvGraph) {
	        succNode = succNode.parent.parent;
	      }

	      /* Mark edge as removed. */
	      succNode.predLinks.values().forEach(function (predLink) {
	        /* The source node directly is an analysis. */
	        var predLinkNode = null;
	        if (curNode instanceof Analysis) {
	          if (predLink.source instanceof Analysis) {
	            predLinkNode = predLink.source;
	          } else {
	            predLinkNode = predLink.source.parent.parent;
	          }
	        } else if (curNode instanceof Node) {
	          predLinkNode = predLink.source;
	        }

	        if (predLinkNode && predLinkNode.autoId === curNode.autoId) {
	          predLink.l.ts.removed = true;
	        }
	      });

	      /* When successor node has no other incoming edges,
	       insert successor node into result set. */
	      if (!succNode.predLinks.values().some(function (predLink) {
	        return !predLink.l.ts.removed;
	      }) && !succNode.l.ts.removed) {
	        startNodes.push(succNode);
	        succNode.l.ts.removed = true;
	      }
	    });
	  }

	  /* While the input set is not empty. */
	  var i = 0;
	  while (i < startNodes.length && i < nodesLength) {
	    /* Remove first item. */
	    var curNode = startNodes[i];

	    /* And push it into result set. */
	    sortedNodes.push(curNode);
	    curNode.l.ts.removed = true;

	    /* Get successor nodes for current node. */
	    handleSuccessorNodes(curNode);
	    i++;
	  }

	  /* Handle cyclic graphs. */
	  if (startNodes.length > nodesLength) {
	    return null;
	  }
	  return sortedNodes;
	}

	/**
	 * Assign layers.
	 * @param tsNodes Topology sorted nodes.
	 * @param parent The parent node.
	 */
	function layerNodes(tsNodes, parent) {
	  var layer = 0;
	  var preds = [];

	  tsNodes.forEach(function (n) {
	    /* Get incoming predecessors. */
	    n.preds.values().forEach(function (p) {
	      if (p.parent === parent) {
	        preds.push(p);
	      } else if (p instanceof Node && parent instanceof ProvGraph) {
	        preds.push(p.parent.parent);
	      }
	    });

	    if (preds.length === 0) {
	      n.col = layer;
	    } else {
	      (function () {
	        var minLayer = layer;
	        preds.forEach(function (p) {
	          if (p.col > minLayer) {
	            minLayer = p.col;
	          }
	        });
	        n.col = minLayer + 1;
	      })();
	    }
	  });
	}

	/**
	 * Group nodes by layers into a 2d array.
	 * @param tsNodes Topology sorted nodes.
	 * @returns {Array} Layer grouped nodes.
	 */
	function groupNodes(tsNodes) {
	  var layer = 0;
	  var lgNodes = [];

	  lgNodes.push([]);

	  var k = 0;
	  tsNodes.forEach(function (n) {
	    if (n.col === layer) {
	      lgNodes[k].push(n);
	    } else if (n.col < layer) {
	      lgNodes[n.col].push(n);
	    } else {
	      k++;
	      layer++;
	      lgNodes.push([]);
	      lgNodes[k].push(n);
	    }
	  });

	  return lgNodes;
	}

	/**
	 * Reorder subanalysis layout to minimize edge crossings.
	 * @param bclgNodes Barcyenter sorted, layered and grouped analysis nodes.
	 * @param cell Width and height of a workflow node.
	 */
	function reorderSubanalysisNodes(bclgNodes, cell) {
	  /* Initializations. */
	  var degree = 1;
	  var accCoords = 0;
	  var usedCoords = [];
	  var delta = 0;
	  var colList = [];

	  bclgNodes.forEach(function (l) {
	    l.forEach(function (an) {
	      usedCoords = [];
	      an.children.values().forEach(function (san, j) {
	        degree = 1;
	        accCoords = 0;
	        delta = 0;

	        /* Initialize subanalysis col and row attributes.
	         * Only one column does exist in this view. */
	        san.x = 0;
	        san.y = j * cell.height;

	        /* The preceding analysis marks the fixed layer. */
	        if (!san.preds.empty()) {
	          degree = san.preds.size();

	          /* Accumulate san y-coord as well as an y-coord for each pred. */
	          san.preds.values().forEach(function (psan) {
	            accCoords += psan.y + psan.parent.y;
	          });

	          /* If any subanalysis within the analysis has the same barycenter
	           * value, increase it by a small value. */
	          if (usedCoords.indexOf(accCoords / degree) === -1) {
	            san.l.bcOrder = accCoords / degree;
	            usedCoords.push(accCoords / degree);
	          } else {
	            delta += 0.01;
	            san.l.bcOrder = accCoords / degree + delta;
	            usedCoords.push(accCoords / degree + delta);
	          }

	          /* Push into array to reorder afterwards. */
	          colList.push(san);
	        }
	      });

	      /* Sort and reorder subanalysis nodes. */
	      colList.sort(function (a, b) {
	        return a.l.bcOrder - b.l.bcOrder;
	      }).forEach(function (d, j) {
	        d.y = j * cell.height;
	      });

	      /* Reset reorder list. */
	      colList = [];
	    });
	  });

	  delta = 0;

	  var looseSAn = [];

	  /* Reorder most left layer based on the second most left layer. */
	  bclgNodes[0][0].children.values().forEach(function (san, j) {
	    /* Only one column does exist in this view. */
	    san.x = 0;
	    san.y = j * cell.height;
	    accCoords = 0;
	    degree = 0;

	    /* Accumulate san y-coord as well as an y-coord for each pred.
	     * Take analysis, subanalysis and workflow coordinates into account. */
	    san.succs.values().forEach(function (ssan) {
	      ssan.inputs.values().forEach(function (ni) {
	        if (ni.preds.values().some(function (pni) {
	          return pni.parent === san;
	        })) {
	          /* Prioritize subanalysis ordering over workflow node ordering. */
	          accCoords += ssan.parent.y + ssan.y + ssan.y / cell.height / 10 + ni.y;
	          degree++;
	        }
	      });
	    });

	    /* Avoid zero division. */
	    if (degree !== 0) {
	      /* If any subanalysis within the analysis has the same barycenter value,
	       * increase it by a small value. */
	      if (usedCoords.indexOf(accCoords / degree) === -1) {
	        san.l.bcOrder = accCoords / degree;
	        usedCoords.push(accCoords / degree);
	      } else {
	        delta += 0.01;
	        san.l.bcOrder = accCoords / degree + delta;
	        usedCoords.push(accCoords / degree + delta);
	      }
	    } else {
	      san.l.bcOrder = 0;
	      looseSAn.push(san);
	    }

	    /* Push into array to reorder afterwards. */
	    colList.push(san);
	  });

	  /* Sort and reorder subanalysis nodes. */
	  colList.sort(function (a, b) {
	    return a.l.bcOrder - b.l.bcOrder;
	  });

	  for (var i = 0; i < looseSAn.length / 2; i++) {
	    colList.push(colList.shift());
	  }

	  colList.forEach(function (d, j) {
	    d.y = j * cell.height;
	  });
	}

	/**
	 * Dagre layout for subanalysis.
	 * @param graph The provenance graph.
	 * @param cell Width and height of a workflow node.
	 */
	function dagreWorkflowLayout(graph, cell) {
	  graph.saNodes.forEach(function (san) {
	    /* Init graph. */
	    var g = new dagre.graphlib.Graph();
	    g.setGraph({
	      rankdir: 'LR',
	      nodesep: 0,
	      edgesep: 0,
	      ranksep: 0,
	      marginx: 0,
	      marginy: 0
	    });
	    g.setDefaultEdgeLabel(function () {
	      return {};
	    });

	    /* Add nodes. */
	    san.children.values().forEach(function (n) {
	      g.setNode(n.autoId, {
	        label: n.autoId,
	        width: cell.width,
	        height: cell.height
	      });
	    });

	    /* Add edges. */
	    san.links.values().forEach(function (l) {
	      g.setEdge(l.source.autoId, l.target.autoId, {
	        minlen: 0,
	        weight: 1,
	        width: 0,
	        height: 0,
	        labelpos: 'r',
	        labeloffset: 10
	      });
	    });

	    /* Compute layout. */
	    dagre.layout(g);

	    /* Init workflow node coords. */
	    d3.entries(g._nodes).forEach(function (n) {
	      /* TODO: Revise potential refinery database bug. */
	      if (san.children.has(n.key)) {
	        san.children.get(n.key).x = parseInt(n.value.x - cell.width / 2, 10);
	        san.children.get(n.key).y = parseInt(n.value.y - cell.height / 2, 10);
	      }
	    });
	  });
	}

	/**
	 * Dagre layout for analysis.
	 * @param graph The provenance Graph.
	 * @param cell Grid cell.
	 */
	function dagreGraphLayout(graph, cell) {
	  /* Init graph. */
	  var g = new dagre.graphlib.Graph();
	  g.setGraph({
	    rankdir: 'LR',
	    nodesep: 0,
	    edgesep: 0,
	    ranksep: 0,
	    marginx: 0,
	    marginy: 0
	  });

	  g.setDefaultEdgeLabel(function () {
	    return {};
	  });

	  /* Add nodes. */
	  graph.aNodes.forEach(function (an) {
	    g.setNode(an.autoId, {
	      label: an.autoId,
	      width: cell.width,
	      height: cell.height
	    });
	  });

	  /* Add edges. */
	  graph.aLinks.forEach(function (l) {
	    g.setEdge(l.source.parent.parent.autoId, l.target.parent.parent.autoId, {
	      minlen: 1,
	      weight: 1,
	      width: 0,
	      height: 0,
	      labelpos: 'r',
	      labeloffset: 10
	    });
	  });

	  /* Compute layout. */
	  dagre.layout(g);

	  var dlANodes = d3.entries(g._nodes);
	  graph.aNodes.forEach(function (an) {
	    an.x = parseInt(dlANodes.filter(function (d) {
	      return d.key === an.autoId.toString();
	    })[0].value.x - cell.width / 2, 10);
	    an.y = parseInt(dlANodes.filter(function (d) {
	      return d.key === an.autoId.toString();
	    })[0].value.y - cell.height / 2, 10);
	  });
	}

	/**
	 * Main layout module function.
	 * @param graph The main graph object of the provenance visualization.
	 * @param cell Width and height of a workflow node.
	 */
	function runLayoutPrivate(graph, cell) {
	  /* Graph layout. */
	  dagreGraphLayout(graph, cell);

	  /* Workflow layout. */
	  dagreWorkflowLayout(graph, cell);

	  /* Analysis layout:
	   * Topology sort first, followed by layering and the creation of a 2d-array.
	   * Subanalysis may then be reorderd based on their preceding analysis node
	   * positions. */
	  var bclgNodes = [];
	  var startANodes = [];
	  startANodes.push(graph.dataset);
	  var tsANodes = topSortNodes(startANodes, graph.aNodes.length, graph);

	  if (tsANodes !== null) {
	    layerNodes(tsANodes, graph);

	    startANodes = [];
	    startANodes.push(graph.dataset);
	    graph.aNodes.forEach(function (an) {
	      an.l.ts.removed = false;
	    });
	    graph.aLinks.forEach(function (al) {
	      al.l.ts.removed = false;
	    });
	    tsANodes = topSortNodes(startANodes, graph.aNodes.length, graph);
	    layerNodes(tsANodes, graph);

	    bclgNodes = groupNodes(tsANodes);

	    /* Analysis layout. */
	    reorderSubanalysisNodes(bclgNodes, cell);
	  } else {
	    throw new Error('Graph is not acyclic.');
	  }
	  return bclgNodes;
	}

	/**
	 * Publish module function.
	 */
	function run$2(graph, cell) {
	  return runLayoutPrivate(graph, cell);
	}

	/**
	 * Helper function collection for the provvis module.
	 */

	/**
	 * Set hidden attribute for object and class for css of BaseNode.
	 * @param n BaseNode.
	 */
	function hideChildNodes(n) {
	  if (!n.children.empty()) {
	    n.children.values().forEach(function (cn) {
	      cn.hidden = true;
	      d3.selectAll('#nodeId-' + cn.autoId).classed({
	        selectedNode: false,
	        hiddenNode: true
	      });
	      if (!cn.children.empty()) {
	        hideChildNodes(cn);
	      }
	    });
	  }
	}

	/**
	 * Set selected attribute for object of BaseNode.
	 * @param n BaseNode.
	 * @param selected Node may be selected or not.
	 */
	function propagateNodeSelection(n, selected) {
	  if (!n.children.empty()) {
	    n.children.values().forEach(function (cn) {
	      cn.selected = selected;
	      cn.doi.selectedChanged();
	      // d3.selectAll("#nodeId-" + cn.autoId).classed({"selectedNode":
	      // selected});
	      if (!cn.children.empty()) {
	        propagateNodeSelection(cn, selected);
	      }
	    });
	  }
	}

	/**
	 * Helper function to parse a date with the declated time format.
	 * @returns {*} Returns the custom time format.
	 */
	function customTimeFormat(date) {
	  return d3.time.format('%Y-%m-%d %H:%M:%S %p')(date);
	}

	/**
	 * Parses a string into the ISO time format.
	 * @param value The time in the string format.
	 * @returns {*} The value in the ISO time format.
	 */
	function parseISOTimeFormat(value) {
	  return d3.time.format('%Y-%m-%dT%H:%M:%S.%L').parse(value);
	}

	/**
	 * Helper function to compare two d3.map() objects.
	 * @param a
	 * @param b
	 * @returns {boolean}
	 */
	function compareMaps(a, b) {
	  var equal = true;
	  if (a.size() === b.size()) {
	    a.keys().forEach(function (k) {
	      if (!b.has(k)) {
	        equal = false;
	      }
	    });
	  } else {
	    equal = false;
	  }
	  return equal;
	}

	/**
	 * Get layer child analysis predecessor link count.
	 * @param ln Layer node.
	 */
	function getLayerPredCount(ln) {
	  return ln.children.values().map(function (an) {
	    return an.predLinks.size();
	  }).reduce(function (acc, pls) {
	    return acc + pls;
	  });
	}

	/**
	 * Get layer child analysis successor link count.
	 * @param ln Layer node.
	 */
	function getLayerSuccCount(ln) {
	  return ln.children.values().map(function (an) {
	    return an.succLinks.size();
	  }).reduce(function (acc, pls) {
	    return acc + pls;
	  });
	}

	/**
	 * Module for motif discovery and injection.
	 */

	/* TODO: May refine algorithm. */
	/**
	 * Find and mark sequential and parallel analysis steps.
	 * @param graph The provenance graph.
	 * @param layerMethod Strict or weak layering, changing the condition analyses
	 * are layered together.
	 * @returns {*} Layered nodes.
	 */
	function createLayerNodes(graph, layerMethod) {
	  var layers = [];
	  var lNodes = d3.map();
	  var layerId = 0;

	  /* Iterate breath first search. */
	  graph.bclgNodes.forEach(function (l, i) {
	    var motifs = d3.map();

	    /* For each depth-level. */
	    l.sort(function (a, b) {
	      return parseISOTimeFormat(a.start) - parseISOTimeFormat(b.start);
	    }).forEach(function (an) {
	      var foundMotif = false;
	      var thisMotif = null;
	      var anPreds = d3.map();
	      var anSuccs = d3.map();

	      an.predLinks.values().forEach(function (pl) {
	        anPreds.set(pl.source.autoId, pl.source);
	      });
	      an.succLinks.values().forEach(function (sl) {
	        anSuccs.set(sl.target.autoId, sl.target);
	      });

	      /* Check if the current analysis conforms to a motif already created. */
	      motifs.values().forEach(function (m) {
	        /* Strict or weak layering. */
	        if (m.wfUuid === an.wfUuid && layerMethod === 'weak' || m.wfUuid === an.wfUuid && layerMethod === 'strict' && m.numSubanalyses === an.children.size() && an.predLinks.size() === m.numIns && an.succLinks.size() === m.numOuts) {
	          if (an.preds.values()[0].uuid === 'dataset' && compareMaps(anPreds, m.preds) || an.preds.values()[0].uuid !== 'dataset') {
	            foundMotif = true;
	            thisMotif = m;
	          }
	        }
	      });

	      /* Create new motif. */
	      if (!foundMotif) {
	        (function () {
	          var motif = new Motif();
	          an.predLinks.values().forEach(function (pl) {
	            motif.preds.set(pl.source.autoId, pl.source);
	          });
	          an.succLinks.values().forEach(function (sl) {
	            motif.succs.set(sl.target.autoId, sl.target);
	          });
	          motif.numIns = an.predLinks.size();
	          motif.numOuts = an.succLinks.size();
	          motif.wfUuid = an.wfUuid;
	          motif.numSubanalyses = an.children.size();
	          motifs.set(motif.autoId, motif);
	          an.motif = motif;
	        })();
	      } else {
	        an.motif = thisMotif;
	      }
	    });

	    layers.push(d3.map());

	    /* Group the same motifs into a layer. */
	    l.forEach(function (an) {
	      var keyStr = an.preds.values().map(function (pan) {
	        return pan.motif.autoId;
	      });
	      var layer = Object.create(null);

	      /* Check topology of pred motifs and actual motif. */

	      /* Create new layer. */
	      if (!layers[i].has(keyStr + '-' + an.motif.autoId)) {
	        layer = new Layer(layerId, an.motif, graph, false);
	        layer.children.set(an.autoId, an);
	        an.layer = layer;
	        lNodes.set(layer.autoId, an.layer);
	        layerId++;

	        layers[i].set(keyStr + '-' + an.motif.autoId, layer.autoId);

	        /* Add to existing layer. */
	      } else {
	          layer = lNodes.get(layers[i].get(keyStr + '-' + an.motif.autoId));
	          layer.children.set(an.autoId, an);
	          an.layer = layer;
	        }
	    });
	  });
	  return lNodes;
	}

	/**
	 * For each layer the corresponding analyses, preceding and succeeding links
	 * as well as specifically in- and output nodes are mapped to it.
	 * @param graph The provenance graph.
	 */
	function createLayerAnalysisMapping(graph) {
	  /* Layer children are set already. */
	  graph.lNodes.values().forEach(function (ln) {
	    ln.children.values().forEach(function (an) {
	      /* Set analysis parent. */
	      an.parent = an.layer;

	      /* Set input nodes. */
	      an.inputs.values().forEach(function (n) {
	        ln.inputs.set(n.autoId, n);
	      });
	      /* Set output nodes. */
	      an.outputs.values().forEach(function (n) {
	        ln.outputs.set(n.autoId, n);
	      });
	    });

	    /* Set workflow name. */
	    var wfName = 'dataset';
	    if (typeof graph.workflowData.get(ln.motif.wfUuid) !== 'undefined') {
	      wfName = graph.workflowData.get(ln.motif.wfUuid).name;
	    }
	    ln.wfName = wfName.toString();
	    ln.wfCode = ln.children.values()[0].wfCode;

	    /* Set layer parent. */
	    ln.parent = graph;

	    /* Set layer visibility. */
	    if (ln.children.size() <= 1) {
	      ln.hidden = true;
	    }
	    /* Set child analysis visibility. */
	    if (ln.children.size() === 1) {
	      ln.children.values()[0].hidden = false;

	      /* Set link visibility. */
	      ln.children.values()[0].predLinks.values().forEach(function (pl) {
	        pl.hidden = false;
	      });
	      ln.children.values()[0].succLinks.values().forEach(function (sl) {
	        sl.hidden = false;
	      });
	    }
	  });

	  graph.lNodes.values().forEach(function (ln) {
	    /* Set predecessor layers. */
	    ln.children.values().forEach(function (an) {
	      an.preds.values().forEach(function (pan) {
	        if (!ln.preds.has(pan.layer.autoId)) {
	          ln.preds.set(pan.layer.autoId, pan.layer);
	        }
	      });
	    });

	    /* Set successor layers. */
	    ln.children.values().forEach(function (an) {
	      an.succs.values().forEach(function (san) {
	        if (!ln.succs.has(san.layer.autoId)) {
	          ln.succs.set(san.layer.autoId, san.layer);
	        }
	      });
	    });
	  });

	  /* Set layer links. */
	  graph.lNodes.values().forEach(function (ln) {
	    ln.children.values().forEach(function (an) {
	      an.links.values().forEach(function (anl) {
	        ln.links.set(anl.autoId, anl);
	      });
	    });
	  });

	  /* Set layer links. */
	  var linkId = 0;
	  graph.lNodes.values().forEach(function (pl) {
	    pl.succs.values().forEach(function (sl) {
	      var layerLink = new Link(linkId, pl, sl, pl.hidden || sl.hidden);
	      graph.lLinks.set(layerLink.autoId, layerLink);
	      pl.succLinks.set(layerLink.autoId, layerLink);
	      sl.predLinks.set(layerLink.autoId, layerLink);
	      linkId++;
	    });
	  });
	}

	/**
	 * Compute difference between motif and analysis.
	 * @param graph The provenance graph.
	 */
	function computeAnalysisMotifDiff(graph) {
	  /* Compute motif analysis change*/
	  graph.aNodes.sort(function (a, b) {
	    return parseISOTimeFormat(a.start) - parseISOTimeFormat(b.start);
	  }).forEach(function (an) {
	    /* TODO: Fix as some new layers with a single analysis may have the motif
	     * of the last layer created. */
	    if (an.parent.children.size() !== 1) {
	      an.motifDiff.numSubanalyses = an.children.size() - an.motif.numSubanalyses;
	      an.motifDiff.numIns = an.predLinks.size() - an.motif.numIns;
	      an.motifDiff.numOuts = an.succLinks.size() - an.motif.numOuts;
	    }
	  });
	}

	/**
	 * Clear all layer information from analyses.
	 * @param graph The provenance graph.
	 */
	function cleanLayerAnalysisMapping(graph) {
	  graph.aNodes.forEach(function (an) {
	    an.layer = Object.create(null);
	    an.motif = Object.create(null);
	    an.parent = graph;
	    an.motifDiff = {
	      numIns: 0,
	      numOuts: 0,
	      wfUuid: an.wfUuid,
	      numSubanalyses: 0
	    };
	  });
	  graph.lNodes = d3.map();
	  graph.lLinks = d3.map();
	}

	/**
	 * Main motif discovery and injection module function.
	 * @param graph The main graph object of the provenance visualization.
	 * @param layerMethod Strict or weak layering, changing the condition analyses
	 * are layered together.
	 */
	function runMotifsPrivate(graph, layerMethod) {
	  cleanLayerAnalysisMapping(graph);
	  graph.lNodes = createLayerNodes(graph, layerMethod);
	  createLayerAnalysisMapping(graph);
	  computeAnalysisMotifDiff(graph);
	}

	/**
	 * Publish module function.
	 */
	function run$3(graph, cell) {
	  return runMotifsPrivate(graph, cell);
	}

	/* Simple tooltips by NG. */
	var tooltip = d3.select('body').append('div').attr('class', 'refinery-tooltip').style('position', 'absolute').style('z-index', '10').style('visibility', 'hidden');

	/**
	 * Make tooltip visible and align it to the events position.
	 * @param label Inner html code appended to the tooltip.
	 * @param event E.g. mouse event.
	 */
	function showTooltip(tooltip, label, event) {
	  tooltip.html(label);
	  tooltip.style('visibility', 'visible');
	  tooltip.style('top', event.pageY + 10 + 'px');
	  tooltip.style('left', event.pageX + 10 + 'px');
	}

	/**
	 * Hide tooltip.
	 */
	function hideTooltip(tooltip) {
	  tooltip.style('visibility', 'hidden');
	}

	/**
	 * For a node, get first visible parent node coords.
	 * @param curN Node to start traversing to its parents.
	 * @returns {{x: number, y: number}} X and y coordinates of the first visible
	 * parent node.
	 */
	function getVisibleNodeCoords(_curN_) {
	  var curN = _curN_;
	  var x = 0;
	  var y = 0;

	  while (curN.hidden && !(curN instanceof Layer)) {
	    curN = curN.parent;
	  }

	  if (curN instanceof Layer) {
	    x = curN.x;
	    y = curN.y;
	  } else {
	    while (!(curN instanceof Layer)) {
	      x += curN.x;
	      y += curN.y;
	      curN = curN.parent;
	    }
	  }

	  return { x: x, y: y };
	}

	/**
	 * Compute bounding box for expanded analysis nodes.
	 * @param an Analysis node.
	 * @param offset Cell offset.
	 * @returns {{x: {min: number, max: number}, y: {min: number, max: number}}}
	 * Min and max x, y coords.
	 */
	function getABBoxCoords(an, cell, _offset_) {
	  var offset = _offset_;

	  if (!offset) {
	    offset = 0;
	  }

	  var minX = !an.hidden ? an.x : d3.min(an.children.values(), function (san) {
	    return !san.hidden ? an.x + san.x : d3.min(san.children.values(), function (cn) {
	      return !cn.hidden ? an.x + san.x + cn.x : an.x;
	    });
	  });
	  var maxX = !an.hidden ? an.x : d3.max(an.children.values(), function (san) {
	    return !san.hidden ? an.x + san.x : d3.max(san.children.values(), function (cn) {
	      return !cn.hidden ? an.x + san.x + cn.x : an.x;
	    });
	  });
	  var minY = !an.hidden ? an.y : d3.min(an.children.values(), function (san) {
	    return !san.hidden ? an.y + san.y : d3.min(san.children.values(), function (cn) {
	      return !cn.hidden ? an.y + san.y + cn.y : an.y;
	    });
	  });
	  var maxY = !an.hidden ? an.y : d3.max(an.children.values(), function (san) {
	    return !san.hidden ? an.y + san.y : d3.max(san.children.values(), function (cn) {
	      return !cn.hidden ? an.y + san.y + cn.y : an.y;
	    });
	  });

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

	/**
	 * Concats an array of dom elements.
	 * @param domArr An array of dom class selector strings.
	 */
	function concatDomClassElements(domArr) {
	  var domClassStr = '';
	  domArr.forEach(function (d) {
	    domClassStr += '.' + d + ',';
	  });

	  return d3.selectAll(domClassStr.substr(0, domClassStr.length - 1));
	}

	/**
	 * Compute doi weight based on nodes initially set as filtered.
	 * @param lNodes Layer nodes.
	 */
	function initDoiFilterComponent(lNodes) {
	  lNodes.values().forEach(function (ln) {
	    ln.filtered = true;
	    ln.doi.filteredChanged();

	    ln.children.values().forEach(function (an) {
	      an.filtered = true;
	      an.doi.filteredChanged();

	      an.children.values().forEach(function (san) {
	        san.filtered = true;
	        san.doi.filteredChanged();

	        san.children.values().forEach(function (n) {
	          n.filtered = true;
	          n.doi.filteredChanged();
	        });
	      });
	    });
	  });
	}

	/**
	 * Compute doi weight based on analysis start time.
	 * @param aNodes Analysis nodes.
	 */
	function initDoiTimeComponent(aNodes, vis) {
	  var min = d3.time.format.iso(new Date(0));
	  var max = d3.time.format.iso(new Date(0));

	  if (aNodes.length > 1) {
	    min = d3.min(aNodes, function (d) {
	      return parseISOTimeFormat(d.start);
	    });
	    max = d3.max(aNodes, function (d) {
	      return parseISOTimeFormat(d.start);
	    });
	  }

	  var doiTimeScale = d3.time.scale().domain([min, max]).range([0.0, 1.0]);

	  aNodes.forEach(function (an) {
	    an.doi.initTimeComponent(doiTimeScale(parseISOTimeFormat(an.start)));
	    an.children.values().forEach(function (san) {
	      san.doi.initTimeComponent(doiTimeScale(parseISOTimeFormat(an.start)));
	      san.children.values().forEach(function (n) {
	        n.doi.initTimeComponent(doiTimeScale(parseISOTimeFormat(an.start)));
	      });
	    });
	  });

	  vis.graph.lNodes.values().forEach(function (l) {
	    l.doi.initTimeComponent(d3.mean(l.children.values(), function (an) {
	      return doiTimeScale(parseISOTimeFormat(an.start));
	    }));
	  });
	}

	/**
	 * Compute bounding box for child nodes.
	 * @param n BaseNode.
	 * @param offset Cell offset.
	 * @returns {{x: {min: *, max: *}, y: {min: *, max: *}}} Min and
	 * max x, y coords.
	 */
	function getWFBBoxCoords(n, cell, offset) {
	  var minX = void 0;
	  var minY = void 0;
	  var maxX = void 0;
	  var maxY = 0;

	  if (n.children.empty() || !n.hidden) {
	    minX = -cell.width / 2 + offset;
	    maxX = cell.width / 2 - offset;
	    minY = -cell.width / 2 + offset;
	    maxY = cell.width / 2 - offset;
	  } else {
	    minX = d3.min(n.children.values(), function (d) {
	      return d.x - cell.width / 2 + offset;
	    });
	    maxX = d3.max(n.children.values(), function (d) {
	      return d.x + cell.width / 2 - offset;
	    });
	    minY = d3.min(n.children.values(), function (d) {
	      return d.y - cell.height / 2 + offset;
	    });
	    maxY = d3.max(n.children.values(), function (d) {
	      return d.y + cell.height / 2 - offset;
	    });
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

	/**
	 * Dagre layout including layer nodes.
	 * @param graph The provenance graph.
	 */
	function dagreLayerLayout(graph, cell, updateNodeAndLink) {
	  var g = new dagre.graphlib.Graph();

	  g.setGraph({
	    rankdir: 'LR',
	    nodesep: 0,
	    edgesep: 0,
	    ranksep: 0,
	    marginx: 0,
	    marginy: 0
	  });

	  g.setDefaultEdgeLabel({});

	  var curWidth = 0;
	  var curHeight = 0;

	  graph.lNodes.values().forEach(function (ln) {
	    curWidth = cell.width;
	    curHeight = cell.height;

	    g.setNode(ln.autoId, {
	      label: ln.autoId,
	      width: curWidth,
	      height: curHeight
	    });
	  });

	  graph.lLinks.values().forEach(function (l) {
	    g.setEdge(l.source.autoId, l.target.autoId, {
	      minlen: 1,
	      weight: 1,
	      width: 0,
	      height: 0,
	      labelpos: 'r',
	      labeloffset: 0
	    });
	  });

	  dagre.layout(g);

	  var dlLNodes = d3.entries(g._nodes);
	  graph.lNodes.values().forEach(function (ln) {
	    curWidth = cell.width;
	    curHeight = cell.height;

	    ln.x = dlLNodes.filter(function (d) {
	      return d.key === ln.autoId.toString();
	    })[0].value.x - curWidth / 2;

	    ln.y = dlLNodes.filter(function (d) {
	      return d.key === ln.autoId.toString();
	    })[0].value.y - curHeight / 2;

	    updateNodeAndLink(ln, d3.select('#gNodeId-' + ln.autoId));
	  });
	}

	/**
	 * Sets the drag events for nodes.
	 * @param nodeType The dom nodeset to allow dragging.
	 */
	function applyDragBehavior(domDragSet, dragStart, dragging, dragEnd) {
	  /* Drag and drop node enabled. */
	  var drag = d3.behavior.drag().origin(function (d) {
	    return d;
	  }).on('dragstart', dragStart).on('drag', dragging).on('dragend', dragEnd);

	  /* Invoke dragging behavior on nodes. */
	  domDragSet.call(drag);
	}

	/**
	 * Path generator for straight link.
	 * @param l Link.
	 * @param srcX Source x coordinate.
	 * @param srcY Source y coordinate.
	 * @param tarX Target x coordinate.
	 * @param tarY Target y coordinate.
	 * @returns {*} Path for link.
	 */
	function drawStraightLink(l, srcX, srcY, tarX, tarY) {
	  var pathSegment = ' M' + srcX + ',' + srcY;
	  pathSegment = pathSegment.concat(' L' + tarX + ',' + tarY);
	  return pathSegment;
	}

	/**
	 * Drag start listener support for nodes.
	 */
	function dragStart() {
	  d3.event.sourceEvent.stopPropagation();
	}

	/**
	 * Module for render.
	 */
	var vis$1 = Object.create(null);
	var cell = Object.create(null);

	/* Initialize dom elements. */
	var lNode = Object.create(null);
	var aNode = Object.create(null);
	var saNode = Object.create(null);
	var node = Object.create(null);
	var domNodeset = [];
	var link = Object.create(null);
	var aLink = Object.create(null);
	var saLink = Object.create(null);
	var analysis = Object.create(null);
	var subanalysis = Object.create(null);
	var layer = Object.create(null);
	var hLink = Object.create(null);
	var lLink = Object.create(null);
	var saBBox = Object.create(null);
	var aBBox = Object.create(null);
	var lBBox = Object.create(null);

	var timeColorScale = Object.create(null);
	var filterAction = Object.create(null);
	var filterMethod = 'timeline';
	var timeLineGradientScale = Object.create(null);

	var lastSolrResponse = Object.create(null);

	var selectedNodeSet = d3.map();

	var draggingActive = false;

	var nodeLinkTransitionTime = 1000;

	var aNodesBAK = [];
	var saNodesBAK = [];
	var nodesBAK = [];
	var aLinksBAK = [];
	var lLinksBAK = d3.map();
	var lNodesBAK = d3.map();

	var scaleFactor = 0.75;

	var layoutCols = d3.map();

	var linkStyle = 'bezier1';

	var colorStrokes = '#136382';
	var colorHighlight = '#ed7407';

	var fitToWindow = true;

	var doiDiffScale = Object.create(null);

	var doiAutoUpdate = false;

	/**
	 * Update filtered links.
	 */
	function updateLinkFilter() {
	  saLink.classed('filteredLink', false);

	  saNode.each(function (san) {
	    if (!san.filtered) {
	      san.links.values().forEach(function (l) {
	        d3.selectAll('#linkId-' + l.autoId + ', #hLinkId-' + l.autoId).classed('filteredLink', false);
	        if (filterAction === 'blend') {
	          d3.selectAll('#linkId-' + l.autoId + ', #hLinkId-' + l.autoId).classed('blendedLink', true);
	        } else {
	          d3.selectAll('#linkId-' + l.autoId + ', #hLinkId-' + l.autoId).classed('blendedLink', false);
	        }
	      });
	    } else {
	      san.links.values().forEach(function (l) {
	        d3.selectAll('#linkId-' + l.autoId + ', #hLinkId-' + l.autoId).classed({
	          filteredLink: true,
	          blendedLink: false
	        });
	      });
	    }
	  });
	}

	/**
	 * Update node coordinates through translation.
	 * @param dom Node dom element.
	 * @param n Node object element.
	 * @param x The current x-coordinate for the node.
	 * @param y The current y-coordinate for the node.
	 */
	function updateNode(dom, n, x, y) {
	  /* Set selected node coordinates. */
	  dom.transition().duration(draggingActive ? 0 : nodeLinkTransitionTime).attr('transform', 'translate(' + x + ',' + y + ')');
	}

	/* TODO: On facet filter reset button, reset filter as well. */
	/**
	 * Update filtered nodes.
	 */
	function updateNodeFilter() {
	  var _this = this;

	  /* Hide or blend (un)selected nodes. */

	  /* Layers. */
	  layer.each(function (ln) {
	    var self = d3.select(_this).select('#nodeId-' + ln.autoId);
	    if (!ln.filtered) {
	      /* Blend/Hide layer node. */
	      self.classed('filteredNode', false).classed('blendedNode', filterAction === 'blend');
	      d3.select('#BBoxId-' + ln.autoId).classed('hiddenBBox', true);
	    } else {
	      self.classed('filteredNode', true).classed('blendedNode', false);
	      if (!ln.hidden) {
	        d3.select('#BBoxId-' + ln.autoId).classed('hiddenBBox', false);
	      }
	    }
	  });

	  /* Analyses and child nodes. */
	  analysis.each(function (an) {
	    var self = d3.select(_this).select('#nodeId-' + an.autoId);
	    if (!an.filtered) {
	      /* Blend/Hide analysis. */
	      self.classed('filteredNode', false).classed('blendedNode', filterAction === 'blend');
	      d3.select('#BBoxId-' + an.autoId).classed('hiddenBBox', true);

	      /* Update child nodes. */
	      an.children.values().forEach(function (san) {
	        d3.select('#nodeId-' + san.autoId).classed('filteredNode', false).classed('blendedNode', filterAction === 'blend');

	        san.children.values().forEach(function (n) {
	          d3.select('#nodeId-' + n.autoId).classed('filteredNode', false).classed('blendedNode', filterAction === 'blend');
	        });
	      });
	    } else {
	      /* Update child nodes. */
	      an.children.values().forEach(function (san) {
	        d3.select('#nodeId-' + san.autoId).classed('filteredNode', true).classed('blendedNode', false);
	        san.children.values().forEach(function (n) {
	          if (n.filtered) {
	            d3.select('#nodeId-' + n.autoId).classed('filteredNode', true).classed('blendedNode', false);
	          } else {
	            d3.select('#nodeId-' + n.autoId).classed('filteredNode', false).classed('blendedNode', false);
	          }
	        });

	        if (an.children.values().some(function (sann) {
	          return !sann.hidden;
	        }) || an.children.values().some(function (sann) {
	          return sann.children.values().some(function (n) {
	            return !n.hidden;
	          });
	        })) {
	          d3.select('#BBoxId-' + an.autoId).classed('hiddenBBox', false);
	        }
	      });

	      if (!an.hidden) {
	        d3.select('#BBoxId-' + an.autoId).classed('hiddenBBox', false);
	      }

	      /* Display analysis. */
	      self.classed('filteredNode', true).classed('blendedNode', false);
	    }
	  });
	}

	/**
	 * Update link through translation while dragging or on dragend.
	 * @param n Node object element.
	 */
	function updateLink(n) {
	  var predLinks = d3.map();
	  var succLinks = d3.map();

	  /* Get layer and/or analysis links. */
	  switch (n.nodeType) {
	    case 'layer':
	      n.predLinks.values().forEach(function (pl) {
	        predLinks.set(pl.autoId, pl);
	      });
	      n.succLinks.values().forEach(function (sl) {
	        succLinks.set(sl.autoId, sl);
	      });
	      n.children.values().forEach(function (an) {
	        an.predLinks.values().forEach(function (pl) {
	          predLinks.set(pl.autoId, pl);
	        });
	        an.succLinks.values().forEach(function (sl) {
	          succLinks.set(sl.autoId, sl);
	        });
	      });
	      break;
	    case 'analysis':
	      n.predLinks.values().forEach(function (pl) {
	        predLinks.set(pl.autoId, pl);
	      });
	      n.succLinks.values().forEach(function (sl) {
	        succLinks.set(sl.autoId, sl);
	      });
	      break;
	  }

	  /* Get input links and update coordinates for x2 and y2. */
	  predLinks.values().forEach(function (l) {
	    d3.selectAll('#linkId-' + l.autoId + ', #hLinkId-' + l.autoId).classed('link-transition', true).transition().duration(draggingActive ? 0 : nodeLinkTransitionTime).attr('d', function (ll) {
	      var srcCoords = getVisibleNodeCoords(ll.source);
	      var tarCoords = getVisibleNodeCoords(ll.target);

	      if (linkStyle === 'bezier1') {
	        return drawBezierLink(ll, srcCoords.x, srcCoords.y, tarCoords.x, tarCoords.y);
	      }
	      return drawStraightLink(ll, srcCoords.x, srcCoords.y, tarCoords.x, tarCoords.y);
	    });

	    setTimeout(function () {
	      d3.selectAll('#linkId-' + l.autoId + ', #hLinkId-' + l.autoId).classed('link-transition', false);
	    }, nodeLinkTransitionTime);
	  });

	  /* Get output links and update coordinates for x1 and y1. */
	  succLinks.values().forEach(function (l) {
	    d3.selectAll('#linkId-' + l.autoId + ', #hLinkId-' + l.autoId).classed('link-transition', true).transition().duration(draggingActive ? 0 : nodeLinkTransitionTime).attr('d', function (ll) {
	      var tarCoords = getVisibleNodeCoords(ll.target);
	      var srcCoords = getVisibleNodeCoords(ll.source);

	      if (linkStyle === 'bezier1') {
	        return drawBezierLink(ll, srcCoords.x, srcCoords.y, tarCoords.x, tarCoords.y);
	      }
	      return drawStraightLink(ll, srcCoords.x, srcCoords.y, tarCoords.x, tarCoords.y);
	    });

	    setTimeout(function () {
	      d3.selectAll('#linkId-' + l.autoId + ', #hLinkId-' + l.autoId).classed('link-transition', false);
	    }, nodeLinkTransitionTime);
	  });
	}

	/* TODO: Code cleanup. */
	/* TODO: Add transitions to bounding boxes. */
	/**
	 * Sets the visibility of links and (a)nodes when collapsing or expanding
	 * analyses.
	 * @param d Node.
	 * @param keyStroke Keystroke being pressed at mouse click.
	 * @param trigger Function triggered by user interaction or automatic
	 * doi-function.
	 */
	function handleCollapseExpandNode(d, keyStroke, _trigger_) {
	  var trigger = typeof _trigger_ !== 'undefined' ? _trigger_ : 'user';

	  var anBBoxCoords = Object.create(null);
	  var wfBBoxCoords = Object.create(null);
	  var siblings = [];

	  /* Expand. */
	  if (keyStroke === 'e' && (d.nodeType === 'layer' || d.nodeType === 'analysis' || d.nodeType === 'subanalysis')) {
	    /* Set node visibility. */
	    d3.select('#nodeId-' + d.autoId).classed('hiddenNode', true);
	    d.hidden = true;
	    d.children.values().forEach(function (cn) {
	      d3.select('#nodeId-' + cn.autoId).classed('hiddenNode', false);
	      cn.hidden = false;
	      hideChildNodes(cn);
	    });

	    /* Set link visibility. */
	    if (d.nodeType === 'subanalysis') {
	      d.links.values().forEach(function (l) {
	        l.hidden = false;
	        d3.select('#linkId-' + l.autoId).classed('hiddenLink', false);
	        if (l.highlighted) {
	          d3.select('#hLinkId-' + l.autoId).classed('hiddenLink', false);
	        }
	      });
	    } else if (d.nodeType === 'analysis') {
	      d.children.values().forEach(function (san) {
	        san.links.values().forEach(function (l) {
	          l.hidden = true;
	          d3.select('#linkId-' + l.autoId).classed('hiddenLink', true);
	          if (l.highlighted) {
	            d3.select('#hLinkId-' + l.autoId).classed('hiddenLink', true);
	          }
	        });
	      });
	    } else {
	      /* Hide layer links. */
	      d.predLinks.values().forEach(function (pl) {
	        pl.hidden = true;
	        d3.select('#linkId-' + pl.autoId).classed('hiddenLink', true);
	        if (pl.highlighted) {
	          d3.select('#hLinkId-' + pl.autoId).classed('hiddenLink', true);
	        }
	      });
	      d.succLinks.values().forEach(function (sl) {
	        sl.hidden = true;
	        d3.select('#linkId-' + sl.autoId).classed('hiddenLink', true);
	        if (sl.highlighted) {
	          d3.select('#hLinkId-' + sl.autoId).classed('hiddenLink', true);
	        }
	      });
	    }

	    /* Set analysis/layer connecting links visibility. */
	    d.inputs.values().forEach(function (sain) {
	      sain.predLinks.values().forEach(function (l) {
	        d3.select('#linkId-' + l.autoId).classed('hiddenLink', false);
	        if (l.highlighted) {
	          d3.select('#hLinkId-' + l.autoId).classed('hiddenLink', false);
	        }
	        l.hidden = false;
	      });
	    });
	    d.outputs.values().forEach(function (saon) {
	      saon.succLinks.values().forEach(function (l) {
	        d3.select('#linkId-' + l.autoId).classed('hiddenLink', false);
	        if (l.highlighted) {
	          d3.select('#hLinkId-' + l.autoId).classed('hiddenLink', false);
	        }
	        l.hidden = false;
	      });
	    });

	    if (d.nodeType === 'subanalysis') {
	      /* Set saBBox visibility. */
	      d3.select('#BBoxId-' + d.autoId).classed('hiddenBBox', false);

	      /* Update. */
	      wfBBoxCoords = getWFBBoxCoords(d, cell, 0);
	      d.x = 0;
	      updateLink(d.parent);
	      updateNode(d3.select('#gNodeId-' + d.autoId), d, d.x, d.y);

	      /* Shift sibling subanalyses vertical. */
	      siblings = d.parent.children.values().filter(function (san) {
	        return san !== d && san.y > d.y;
	      });
	      siblings.forEach(function (san) {
	        san.y += wfBBoxCoords.y.max - wfBBoxCoords.y.min - cell.height;
	        updateNode(d3.select('#gNodeId-' + san.autoId), san, san.x, san.y);
	      });

	      /* Adjust analysis bounding box. */
	      anBBoxCoords = getABBoxCoords(d.parent, cell, 0);
	      d3.selectAll('#BBoxId-' + d.parent.autoId + ', #aBBClipId-' + d.parent.autoId).selectAll('rect').attr('width', anBBoxCoords.x.max - anBBoxCoords.x.min).attr('height', anBBoxCoords.y.max - anBBoxCoords.y.min);

	      /* Center non-expanded subanalyses horizontally. */
	      d.parent.children.values().filter(function (san) {
	        return !san.hidden;
	      }).forEach(function (san) {
	        san.x = (anBBoxCoords.x.max - anBBoxCoords.x.min) / 2 - vis$1.cell.width / 2;
	        updateNode(d3.select('#gNodeId-' + san.autoId), san, san.x, san.y);
	      });
	      updateNode(d3.select('#gNodeId-' + d.autoId), d, d.x, d.y);
	    } else if (d.nodeType === 'analysis') {
	      /* Adjust analysis bounding box. */
	      anBBoxCoords = getABBoxCoords(d, cell, 0);
	      d3.select('#BBoxId-' + d.autoId).select('rect').attr('width', anBBoxCoords.x.max - anBBoxCoords.x.min).attr('height', anBBoxCoords.y.max - anBBoxCoords.y.min);

	      /* Update. */
	      updateLink(d);
	      updateNode(d3.select('#gNodeId-' + d.autoId), d, d.x, d.y);
	    } else {
	      d.children.values().filter(function (an) {
	        return an.filtered;
	      }).forEach(function (an) {
	        d3.select('#BBoxId-' + an.autoId).classed('hiddenBBox', false);

	        /* Hide workflow links. */
	        an.links.values().forEach(function (l) {
	          d3.selectAll('#linkId-' + l.autoId + ',#hLinkId-' + l.autoId).classed('hiddenLink', true);
	        });

	        /* Hide workflow bounding box. */
	        an.children.values().forEach(function (san) {
	          d3.select('#BBoxId-' + san.autoId).classed('hiddenBBox', true);
	        });

	        /* Adjust bounding box. */
	        anBBoxCoords = getABBoxCoords(an, cell, 0);
	        d3.selectAll('#BBoxId-' + an.autoId + ', #aBBClipId-' + an.autoId).select('rect').attr('width', cell.width).attr('height', cell.height);
	      });

	      /* Update. */
	      updateLink(d);
	      updateNode(d3.select('#gNodeId-' + d.autoId), d, d.x, d.y);
	    }
	  } else if (keyStroke === 'c' && d.nodeType !== 'layer') {
	    /* Collapse. */
	    /* Collapse subanalyses. */
	    if (d.nodeType === 'subanalysis') {
	      d.parent.children.values().forEach(function (san) {
	        d3.select('#BBoxId-' + san.autoId).classed('hiddenBBox', true);
	      });
	    } else if (d.nodeType === 'analysis') {
	      d.parent.children.values().forEach(function (an) {
	        d3.select('#BBoxId-' + an.autoId).classed('hiddenBBox', true);
	        an.exaggerated = false;
	      });

	      /* Set layer label and bounding box. */
	      d3.select('#nodeId-' + d.parent.autoId).select('g.labels').select('.lLabel').text(d.children.size() + '/' + d.children.size());

	      /* Hide bounding boxes. */
	      d3.select('#BBoxId-' + d.parent.autoId).classed('hiddenBBox', false);
	      d.parent.children.values().forEach(function (an) {
	        an.children.values().forEach(function (san) {
	          d3.select('#BBoxId-' + san.autoId).classed('hiddenBBox', true);
	        });
	      });
	    } else {
	      /* Collapse workflow. */
	      if (d.hidden === false) {
	        /* Shift sibling subanalyses vertical. */
	        wfBBoxCoords = getWFBBoxCoords(d.parent, cell, 0);
	        siblings = d.parent.parent.children.values().filter(function (san) {
	          return san !== d.parent && san.y > d.parent.y;
	        });
	        siblings.forEach(function (san) {
	          san.y -= wfBBoxCoords.y.max - wfBBoxCoords.y.min - cell.height;
	          updateNode(d3.select('#gNodeId-' + san.autoId), san, san.x, san.y);
	        });

	        if (d.parent.parent.children.values().filter(function (san) {
	          return san !== d.parent;
	        }).some(function (san) {
	          return san.hidden;
	        })) {
	          anBBoxCoords = getABBoxCoords(d.parent.parent, cell, 0);
	          d.parent.x = (anBBoxCoords.x.max - anBBoxCoords.x.min) / 2 - vis$1.cell.width / 2;
	          updateNode(d3.select('#gNodeId-' + d.parent.autoId), d.parent, d.parent.x, d.parent.y);
	        }

	        if (d.parent.parent.children.values().filter(function (san) {
	          return san !== d.parent;
	        }).every(function (san) {
	          return !san.hidden;
	        })) {
	          d.parent.parent.children.values().forEach(function (san) {
	            san.x = 0;
	            updateNode(d3.select('#gNodeId-' + san.autoId), san, san.x, san.y);
	          });
	        }
	      }
	    }

	    /* Set node visibility. */
	    d.parent.hidden = false;
	    d3.select('#nodeId-' + d.parent.autoId).classed('hiddenNode', false);
	    hideChildNodes(d.parent);

	    /* Set saBBox visibility. */
	    if (d.nodeType === 'subanalysis') {
	      d3.select('#BBoxId-' + d.autoId).classed('hiddenBBox', true);
	    } else if (d.nodeType === 'analysis') {
	      if (!d.parent.filtered) {
	        d3.select('#BBoxId-' + d.parent.autoId).classed('hiddenBBox', true);
	      }
	    } else {
	      d3.select('#BBoxId-' + d.parent.autoId).classed('hiddenBBox', true);
	    }

	    /* Set link visibility. */
	    d.parent.links.values().forEach(function (l) {
	      d3.selectAll('#linkId-' + l.autoId + ', #hLinkId-' + l.autoId).classed('hiddenLink', true);
	      l.hidden = true;
	    });
	    d.parent.inputs.values().forEach(function (sain) {
	      sain.predLinks.values().forEach(function (l) {
	        d3.select('#linkId-' + l.autoId).classed('hiddenLink', false);
	        if (l.highlighted) {
	          d3.select('#hLinkId-' + l.autoId).classed('hiddenLink', false);
	        }
	        l.hidden = false;
	      });
	    });
	    d.parent.outputs.values().forEach(function (saon) {
	      saon.succLinks.values().forEach(function (l) {
	        d3.select('#linkId-' + l.autoId).classed('hiddenLink', false);
	        if (l.highlighted) {
	          d3.select('#hLinkId-' + l.autoId).classed('hiddenLink', false);
	        }
	        l.hidden = false;
	      });
	    });

	    if (d.nodeType === 'subanalysis') {
	      /* Resize analysis bounding box. */
	      d3.selectAll('#BBoxId-' + d.parent.autoId + ', #aBBClipId-' + d.parent.autoId).selectAll('rect').attr('width', cell.width).attr('height', cell.height);

	      /* Update links. */
	      updateLink(d.parent);
	    } else if (d.nodeType === 'analysis') {
	      /* Check layer Links. */
	      d.parent.predLinks.values().forEach(function (pl) {
	        if (!pl.source.hidden) {
	          pl.hidden = false;
	        }
	      });
	      d.parent.succLinks.values().forEach(function (sl) {
	        if (!sl.target.hidden) {
	          sl.hidden = false;
	        }
	      });

	      updateLink(d.parent);
	      updateNode(d3.select('#gNodeId-' + d.parent.autoId), d.parent, d.parent.x, d.parent.y);
	    } else {
	      /* Set saBBox visibility. */
	      d3.select('#BBoxId-' + d.parent.autoId).classed('hiddenBBox', true);

	      /* Update. */
	      updateLink(d.parent.parent);
	      updateNode(d3.select('#gNodeId-' + d.parent.parent.autoId), d.parent.parent, d.parent.parent.x, d.parent.parent.y);

	      /* Compute bounding box for analysis child nodes. */
	      anBBoxCoords = getABBoxCoords(d.parent.parent, cell, 0);

	      /* Adjust analysis bounding box. */
	      d3.selectAll('#BBoxId-' + d.parent.parent.autoId + ', #aBBClipId-' + d.parent.parent.autoId).selectAll('rect').attr('width', anBBoxCoords.x.max - anBBoxCoords.x.min).attr('height', anBBoxCoords.y.max - anBBoxCoords.y.min);

	      /* If the selected subanalysis is the last remaining to collapse,
	       adjust bounding box and clippath. */
	      if (!d.parent.parent.children.values().some(function (san) {
	        return san.hidden;
	      })) {
	        /* Compute bounding box for analysis child nodes. */
	        anBBoxCoords = getABBoxCoords(d.parent.parent, cell, 0);

	        /* Adjust analysis bounding box. */
	        d3.select('#BBoxId-' + d.parent.parent.autoId).select('rect').attr('width', anBBoxCoords.x.max - anBBoxCoords.x.min).attr('height', anBBoxCoords.y.max - anBBoxCoords.y.min);

	        /* Adjust clippath. */
	        d3.select('#aBBClipId-' + d.parent.parent.autoId).select('rect').attr('width', cell.width).attr('height', cell.height + 2 * scaleFactor * vis$1.radius).attr('rx', cell.width / 7).attr('ry', cell.height / 7);
	      }
	      /* Update links. */
	      updateLink(d.parent.parent);
	    }
	  }

	  if (trigger === 'user') {
	    /* Recompute layout. */
	    dagreDynamicLayerLayout(vis$1.graph);

	    if (fitToWindow) {
	      fitGraphToWindow(nodeLinkTransitionTime);
	    }
	  }
	}

	/* TODO: Code cleanup. */
	/**
	 * On doi change, update node doi labels.
	 */
	function updateNodeDoi() {
	  /**
	   * Helper function to check whether every parent node is hidden.
	   * @param n BaseNode
	   * @returns {boolean} Returns true if any parent node is visible.
	   */
	  function allParentsHidden(n) {
	    var cur = n;

	    while (!(cur instanceof Layer)) {
	      if (!(cur instanceof Layer) && !cur.parent.hidden) {
	        return false;
	      }
	      cur = cur.parent;
	    }

	    return true;
	  }

	  /* Update node doi label. */
	  domNodeset.select('.nodeDoiLabel').text(function (d) {
	    return d.doi.doiWeightedSum;
	  });

	  /* On layer doi. */
	  vis$1.graph.lNodes.values().forEach(function (ln) {
	    if (ln.doi.doiWeightedSum >= 1 / 4 && !ln.hidden && ln.filtered) {
	      /* Expand. */
	      handleCollapseExpandNode(ln, 'e', 'auto');
	    }
	  });

	  /* On analysis doi. */
	  vis$1.graph.aNodes.forEach(function (an) {
	    if (an.doi.doiWeightedSum >= 2 / 4 && !an.hidden && an.filtered) {
	      /* Expand. */
	      handleCollapseExpandNode(an, 'e', 'auto');
	    } else if (an.doi.doiWeightedSum < 1 / 4 && !an.hidden && an.parent.children.size() > 1) {
	      /* Collapse. */
	      handleCollapseExpandNode(an, 'c', 'auto');

	      if (an.parent.filtered) {
	        /* Only collapse those analysis nodes into the layered node which
	         * are below the threshold. */
	        an.parent.children.values().forEach(function (d) {
	          if (d.doi.doiWeightedSum >= 1 / 4) {
	            d.exaggerated = true;

	            d.hidden = false;
	            d3.select('#nodeId-' + d.autoId).classed('hiddenNode', false);
	            updateLink(d);

	            if (d.doi.doiWeightedSum >= 2 / 4 && !d.hidden && d.filtered) {
	              /* Expand. */
	              handleCollapseExpandNode(d, 'e', 'auto');
	            }
	          } else {
	            d.exaggerated = false;
	            d.hidden = true;
	            d3.select('#nodeId-' + an.autoId).classed('hiddenNode', true);
	          }
	        });
	      }
	    }
	  });

	  /* On node doi. */
	  vis$1.graph.saNodes.forEach(function (san) {
	    var maxDoi = d3.max(san.children.values(), function (n) {
	      return n.doi.doiWeightedSum;
	    });
	    if (maxDoi < 3 / 4 && (allParentsHidden(san.children.values()[0]) || san.parent.exaggerated)) {
	      /* Collapse. */
	      handleCollapseExpandNode(san.children.values()[0], 'c', 'auto');
	    }
	  });

	  /* On subanalysis doi. */
	  vis$1.graph.saNodes.forEach(function (san) {
	    var maxDoi = d3.max(san.parent.children.values(), function (cn) {
	      return cn.doi.doiWeightedSum;
	    });

	    if (san.doi.doiWeightedSum >= 3 / 4 && !san.hidden && san.filtered) {
	      /* Expand. */
	      handleCollapseExpandNode(san, 'e', 'auto');
	    } else if (maxDoi < 2 / 4 && (allParentsHidden(san) || san.parent.exaggerated)) {
	      /* Collapse. */
	      handleCollapseExpandNode(san, 'c', 'auto');
	    }
	  });

	  /* Recompute layout. */
	  dagreDynamicLayerLayout(vis$1.graph);

	  if (fitToWindow) {
	    fitGraphToWindow(nodeLinkTransitionTime);
	  }
	}

	/**
	 * Path generator for bezier link.
	 * @param l Link.
	 * @param srcX Source x coordinate.
	 * @param srcY Source y coordinate.
	 * @param tarX Target x coordinate.
	 * @param tarY Target y coordinate.
	 * @returns {*} Path for link.
	 */
	function drawBezierLink(l, srcX, srcY, tarX, tarY) {
	  var pathSegment = 'M' + srcX + ',' + srcY;

	  if (tarX - srcX > vis$1.cell.width * 1.5) {
	    (function () {
	      /* Extend links in expanded columns. */
	      var curN = l.source;
	      var hLineSrc = srcX;

	      if (l.source instanceof Layer || l.target instanceof Layer || l.source.parent !== l.target.parent) {
	        while (!(curN instanceof Analysis) && !(curN instanceof Layer)) {
	          curN = curN.parent;
	        }

	        if (curN instanceof Analysis && !curN.parent.hidden && l.source.hidden) {
	          curN = curN.parent;
	        }

	        /* TODO: Revise. */
	        if (l.source instanceof Layer && l.source.hidden) {
	          hLineSrc = srcX + vis$1.cell.width / 2;
	        } else {
	          hLineSrc = getABBoxCoords(curN, cell, 0).x.max - vis$1.cell.width / 2;
	        }

	        /* LayoutCols provides the maximum width of any potential expanded node
	         * within the column of the graph. An the width difference is calculated
	         * as offset and added as horizontal line to the link. */
	        layoutCols.values().forEach(function (c) {
	          if (c.nodes.indexOf(curN.autoId) !== -1) {
	            var curWidth = getABBoxCoords(curN, cell, 0).x.max - getABBoxCoords(curN, cell, 0).x.min;
	            var offset = (c.width - curWidth) / 2 + vis$1.cell.width / 2;
	            if (curWidth < c.width) {
	              hLineSrc = srcX + offset;
	            }
	          }
	        });

	        pathSegment = pathSegment.concat(' H' + hLineSrc);
	      }

	      pathSegment = pathSegment.concat(' C' + (hLineSrc + cell.width / 3) + ',' + srcY + ' ' + (hLineSrc + cell.width / 2 - cell.width / 3) + ',' + tarY + ' ' + (hLineSrc + cell.width / 2) + ',' + tarY + ' ' + 'H' + tarX);
	    })();
	  } else {
	    pathSegment = pathSegment.concat(' C' + (srcX + cell.width) + ',' + srcY + ' ' + (tarX - cell.width) + ',' + tarY + ' ' + tarX + ',' + tarY + ' ');
	  }

	  return pathSegment;
	}

	/**
	 * Drag listener.
	 * @param n Node object.
	 */
	function dragging(n) {
	  var self = d3.select(this);

	  /* While dragging, hide tooltips. */
	  hideTooltip(tooltip);

	  var deltaY = d3.event.y - n.y;

	  /* Set coords. */
	  n.x = d3.event.x;
	  n.y = d3.event.y;

	  /* Drag selected node. */
	  updateNode(self, n, d3.event.x, d3.event.y);

	  /* Drag adjacent links. */
	  updateLink(n);

	  if (n instanceof Layer) {
	    n.children.values().forEach(function (an) {
	      an.x = n.x - (getABBoxCoords(an, cell, 0).x.max - getABBoxCoords(an, cell, 0).x.min) / 2 + vis$1.cell.width / 2;
	      an.y += deltaY;
	      updateNode(d3.select('#gNodeId-' + an.autoId), an, an.x, an.y);
	      updateLink(an);
	    });
	  }

	  draggingActive = true;
	}

	/**
	 * Update node and link.
	 * @param n Node.
	 * @param dom Node as dom object.
	 */
	function updateNodeAndLink(n, dom) {
	  var self = dom;

	  /* Align selected node. */
	  updateNode(self, n, n.x, n.y);

	  /* Align adjacent links. */
	  updateLink(n);

	  if (n instanceof Layer) {
	    n.children.values().forEach(function (an) {
	      updateNode(d3.select('#gNodeId-' + an.autoId), an, an.x, an.y);
	      updateLink(an);
	    });
	  }
	}

	/**
	 * Drag end listener.
	 */
	function dragEnd(n) {
	  if (draggingActive) {
	    var self = d3.select(this);

	    /* Update node and adjacent links. */
	    updateNodeAndLink(n, self);

	    /* Prevent other mouseevents during dragging. */
	    setTimeout(function () {
	      draggingActive = false;
	    }, 200);
	  }
	}

	/* TODO: Update to incorporate facet filtering and adjust link visibility
	 * on loose graphs. */
	/**
	 * Filter analyses by time gradient timeline view.
	 * @param lowerTimeThreshold The point of time where analyses executed before
	 * are hidden.
	 * @param upperTimeThreshold The point of time where analyses executed after
	 * are hidden.
	 * @param vis The provenance visualization root object.
	 */
	function filterAnalysesByTime(lowerTimeThreshold, upperTimeThreshold, _vis_) {
	  _vis_.graph.lNodes = lNodesBAK;
	  _vis_.graph.aNodes = aNodesBAK;
	  _vis_.graph.saNodes = saNodesBAK;
	  _vis_.graph.nodes = nodesBAK;
	  _vis_.graph.aLinks = aLinksBAK;
	  _vis_.graph.lLinks = lLinksBAK;

	  var selAnalyses = _vis_.graph.aNodes.filter(function (an) {
	    upperTimeThreshold.setSeconds(upperTimeThreshold.getSeconds() + 1);
	    return parseISOTimeFormat(an.start) >= lowerTimeThreshold && parseISOTimeFormat(an.start) <= upperTimeThreshold;
	  });

	  /* Set (un)filtered analyses. */
	  _vis_.graph.aNodes.forEach(function (an) {
	    if (selAnalyses.indexOf(an) === -1) {
	      an.filtered = false;
	      an.children.values().forEach(function (san) {
	        san.filtered = false;
	        san.children.values().forEach(function (n) {
	          n.filtered = false;
	        });
	      });
	    } else {
	      an.filtered = true;
	      an.children.values().forEach(function (san) {
	        san.filtered = true;
	        san.children.values().forEach(function (n) {
	          n.filtered = true;
	        });
	      });
	    }
	  });

	  /* Update analysis filter attributes. */
	  _vis_.graph.aNodes.forEach(function (an) {
	    if (an.children.values().some(function (san) {
	      return san.filtered;
	    })) {
	      an.filtered = true;
	    } else {
	      an.filtered = false;
	    }
	    an.doi.filteredChanged();
	  });

	  /* Update layer filter attributes. */
	  _vis_.graph.lNodes.values().forEach(function (ln) {
	    if (ln.children.values().some(function (an) {
	      return an.filtered;
	    })) {
	      ln.filtered = true;
	    } else {
	      ln.filtered = false;
	    }
	    ln.doi.filteredChanged();
	  });

	  /* Update analysis link filter attributes. */
	  _vis_.graph.aLinks.forEach(function (al) {
	    al.filtered = false;
	  });
	  _vis_.graph.aLinks.filter(function (al) {
	    return al.source.parent.parent.filtered && al.target.parent.parent.filtered;
	  }).forEach(function (al) {
	    al.filtered = true;
	  });
	  _vis_.graph.lLinks.values().forEach(function (ll) {
	    ll.filtered = false;
	  });
	  _vis_.graph.lLinks.values().filter(function (ll) {
	    return ll.source.filtered && ll.target.filtered;
	  }).forEach(function (ll) {
	    ll.filtered = true;
	  });

	  /* On filter action 'hide', splice and recompute graph. */
	  if (filterAction === 'hide') {
	    (function () {
	      /* Update filtered nodesets. */
	      var cpyLNodes = d3.map();
	      _vis_.graph.lNodes.entries().forEach(function (ln) {
	        if (ln.value.filtered) {
	          cpyLNodes.set(ln.key, ln.value);
	        }
	      });
	      _vis_.graph.lNodes = cpyLNodes;
	      _vis_.graph.aNodes = _vis_.graph.aNodes.filter(function (an) {
	        return an.filtered;
	      });
	      _vis_.graph.saNodes = _vis_.graph.saNodes.filter(function (san) {
	        return san.filtered;
	      });
	      _vis_.graph.nodes = _vis_.graph.nodes.filter(function (n) {
	        return n.filtered;
	      });

	      /* Update filtered linksets. */
	      _vis_.graph.aLinks = _vis_.graph.aLinks.filter(function (al) {
	        return al.filtered;
	      });

	      /* Update layer links. */
	      var cpyLLinks = d3.map();
	      _vis_.graph.lLinks.entries().forEach(function (ll) {
	        if (ll.value.filtered) {
	          cpyLLinks.set(ll.key, ll.value);
	        }
	      });
	      _vis_.graph.lLinks = cpyLLinks;
	    })();
	  }

	  dagreDynamicLayerLayout(_vis_.graph);

	  if (fitToWindow) {
	    fitGraphToWindow(nodeLinkTransitionTime);
	  }

	  updateNodeFilter();
	  updateLinkFilter();
	  updateAnalysisLinks(_vis_.graph);
	  updateLayerLinks(_vis_.graph.lLinks);

	  _vis_.graph.aNodes.forEach(function (an) {
	    updateLink(an);
	  });
	  _vis_.graph.lNodes.values().forEach(function (ln) {
	    updateLink(ln);
	  });

	  /* TODO: Temporarily enabled. */
	  if (doiAutoUpdate) {
	    recomputeDOI();
	  }
	}

	/**
	 * Draws the timeline view.
	 * @param vis The provenance visualization root object.
	 */
	function drawTimelineView(_vis_) {
	  var _this3 = this;

	  var svg = d3.select('#provenance-timeline-view').select('svg').append('g').append('g').attr('transform', 'translate(20,0)');

	  var tlHeight = 50;
	  var tlWidth = 250;

	  var x = d3.scale.linear().domain([0, tlWidth]).range([0, tlWidth]);

	  var y = d3.scale.linear().domain([5, 0]).range([0, tlHeight - 10]);

	  timeLineGradientScale = d3.time.scale().domain([Date.parse(timeColorScale.domain()[0]), Date.parse(timeColorScale.domain()[1])]).range([0, tlWidth]).nice();

	  var xAxis = d3.svg.axis().scale(timeLineGradientScale).orient('bottom').ticks(5);

	  var yAxis = d3.svg.axis().scale(y).orient('left').ticks(7);

	  var tlTickCoords = d3.map();

	  aNodesBAK.forEach(function (an) {
	    tlTickCoords.set(an.autoId, timeLineGradientScale(parseISOTimeFormat(an.start)));
	  });

	  /**
	   * Drag start listener support for time lines.
	   */
	  function dragLineStart() {
	    d3.event.sourceEvent.stopPropagation();
	  }

	  /**
	   * Get lower and upper date threshold date in timeline view.
	   * @param l Time line.
	   * @returns {Array} An array of size 2 containing both the lower and upper
	   * threshold date.
	   */
	  function getTimeLineThresholds(l) {
	    var lowerTimeThreshold = Object.create(null);
	    var upperTimeThreshold = Object.create(null);

	    if (l.className === 'startTimeline') {
	      lowerTimeThreshold = l.time;
	      upperTimeThreshold = d3.select('.endTimeline').data()[0].time;
	    } else {
	      lowerTimeThreshold = d3.select('.startTimeline').data()[0].time;
	      upperTimeThreshold = l.time;
	    }

	    return [lowerTimeThreshold, upperTimeThreshold];
	  }

	  /**
	   * Update lower and upper date threshold label in timeline view.
	   * @param l Time line.
	   */
	  function updateTimelineLabels(l) {
	    var _this2 = this;

	    var tlThreshold = getTimeLineThresholds(l);
	    tlThreshold[1].setSeconds(tlThreshold[1].getSeconds() + 1);

	    var labelStart = customTimeFormat(tlThreshold[0]);
	    var labelEnd = customTimeFormat(tlThreshold[1]);

	    d3.select('#tlThresholdStart').html('Start: ' + labelStart);
	    d3.select('#tlThresholdEnd').html('End: ' + labelEnd);

	    d3.selectAll('.tlAnalysis').each(function (an) {
	      if (parseISOTimeFormat(an.start) < tlThreshold[0] || parseISOTimeFormat(an.start) > tlThreshold[1]) {
	        d3.select(_this2).classed('blendedTLAnalysis', true);
	      } else {
	        d3.select(_this2).classed('blendedTLAnalysis', false);
	      }
	    });
	  }

	  /**
	   * Drag listener.
	   * @param l Time line.
	   */
	  function draggingLine(l) {
	    /* Check borders. */
	    if (d3.event.x < 0) {
	      l.x = 0;
	    } else if (d3.event.x > tlWidth) {
	      l.x = tlWidth;
	    } else {
	      l.x = d3.event.x;
	    }
	    l.time = new Date(timeLineGradientScale.invert(l.x));

	    /* Update lines. */
	    d3.select(this).attr('transform', 'translate(' + x(l.x) + ',0)');

	    /* Update labels. */
	    updateTimelineLabels(l);

	    /* TODO: Temporarily disabled live filtering as it does not scale
	     * well with big graphs. */

	    /* On hover filter update. */
	    /* if (d3.entries(tlTickCoords).some(function (t) {
	      if (l.className === "startTimeline") {
	      */
	    /* Left to right. */
	    /*
	     if (l.x > l.lastX) {
	     if (x(l.x) - x(t.value) > 0 && x(l.x) - x(t.value) <= 1) {
	     return true;
	     } else {
	     return false;
	     }
	     */
	    /* Right to left. */
	    /*
	     } else {
	     if (x(l.x) - x(t.value) >= -1 && x(l.x) - x(t.value) < 0) {
	     return true;
	     } else {
	     return false;
	     }
	     }
	     } else {
	     */
	    /* Right to left. */
	    /*
	     if (l.x < l.lastX) {
	      */
	    /* TODO: Small bug, time scale is off by 30 seconds. */
	    /*
	     if (x(l.x) - x(t.value) >= -5 && x(l.x) - x(t.value) < 0) {
	     return true;
	     } else {
	     return false;
	     }
	     */
	    /* Left to right. */
	    /*
	     } else {
	     if (x(l.x) - x(t.value) > 0 && x(l.x) - x(t.value) <= 1) {
	     return true;
	     } else {
	     return false;
	     }
	     }
	     }
	     })) {
	     filterAnalysesByTime(getTimeLineThresholds(l)[0],
	     getTimeLineThresholds(l)[1], vis);
	     }*/

	    /* Remember last drag x coord. */
	    l.lastX = l.x;
	  }

	  /**
	   * Drag end listener.
	   * @param l Time line.
	   */
	  function dragLineEnd(l) {
	    l.time = new Date(timeLineGradientScale.invert(l.x));

	    /* Update labels. */
	    updateTimelineLabels(l);

	    /* Filter action. */
	    filterAnalysesByTime(getTimeLineThresholds(l)[0], getTimeLineThresholds(l)[1], _vis_);

	    filterMethod = 'timeline';
	  }

	  /**
	   * Sets the drag events for time lines.
	   * @param nodeType The dom lineset to allow dragging.
	   */
	  function applyTimeLineDragBehavior(domDragSet) {
	    /* Drag and drop line enabled. */
	    var dragLine = d3.behavior.drag().origin(function (d) {
	      return d;
	    }).on('dragstart', dragLineStart).on('drag', draggingLine).on('dragend', dragLineEnd);

	    /* Invoke dragging behavior on nodes. */
	    domDragSet.call(dragLine);
	  }

	  /* Geometric zoom. */
	  function redrawTimeline() {
	    /* Translations. */
	    svg.selectAll('.tlAnalysis').attr('x1', function (an) {
	      return x(timeLineGradientScale(parseISOTimeFormat(an.start)));
	    }).attr('x2', function (an) {
	      return x(timeLineGradientScale(parseISOTimeFormat(an.start)));
	    });

	    svg.selectAll('.startTimeline, .endTimeline').attr('transform', function (d) {
	      return 'translate(' + x(d.x) + ',' + 0 + ')';
	    });

	    svg.select('#timelineView').attr('x', x(0)).attr('width', x(tlWidth) - x(0));

	    svg.select('#tlxAxis').attr('transform', 'translate(' + x(0) + ',' + tlHeight + ')');

	    svg.select('#tlxAxis').selectAll('.tick').attr('transform', function (d) {
	      return 'translate(' + (x(timeLineGradientScale(d)) - d3.event.translate[0]) + ',' + 0 + ')';
	    });

	    svg.select('#tlxAxis').select('path').attr('d', 'M0,6V0H' + tlWidth * d3.event.scale + 'V6');

	    svg.select('#tlyAxis').attr('transform', 'translate(' + x(0) + ',' + 10 + ')');
	  }

	  /* Timeline zoom behavior. */
	  var timelineZoom = d3.behavior.zoom().x(x).scaleExtent([1, 10]).on('zoom', redrawTimeline);

	  timelineZoom(svg);

	  var gradient = svg.append('defs').append('linearGradient').attr('id', 'gradientGrayscale');

	  gradient.append('stop').attr('offset', '0%').attr('stop-color', '#fff').attr('stop-opacity', 1);

	  gradient.append('stop').attr('offset', '100%').attr('stop-color', '#000').attr('stop-opacity', 1);

	  svg.append('rect').attr('id', 'timelineView').attr('x', 0).attr('y', 10).attr('width', tlWidth).attr('height', tlHeight - 10).style({
	    fill: 'url(#gradientGrayscale)',
	    stroke: 'white',
	    'stroke-width': '1px'
	  });

	  svg.append('g').classed({
	    x: true,
	    axis: true
	  }).attr('id', 'tlxAxis').attr('transform', 'translate(0,' + tlHeight + ')').call(xAxis);

	  svg.append('g').classed({
	    y: true,
	    axis: true
	  }).attr('id', 'tlyAxis').attr('transform', 'translate(0,' + 10 + ')').call(yAxis);

	  d3.select('#tlyAxis').selectAll('.tick').each(function (d) {
	    if (d === 5) {
	      d3.select(_this3).select('text').text('>5');
	    }
	  });

	  var startTime = {
	    className: 'startTimeline',
	    x: 0,
	    lastX: -1,
	    time: new Date(timeLineGradientScale.invert(0))
	  };
	  var endTime = {
	    className: 'endTimeline',
	    x: tlWidth,
	    lastX: tlWidth + 1,
	    time: new Date(timeLineGradientScale.invert(tlWidth))
	  };

	  var timeLineThreshold = svg.selectAll('.line').data([startTime, endTime]).enter().append('g').attr('transform', function (d) {
	    return 'translate(' + d.x + ',0)';
	  }).attr('class', function (d) {
	    return d.className;
	  });

	  timeLineThreshold.append('line').attr('x1', 0).attr('y1', 0).attr('x2', 0).attr('y2', tlHeight);

	  timeLineThreshold.append('polygon').classed('timeMarker', true).attr('points', '0,50 5,60 -5,60');
	  timeLineThreshold.append('polygon').classed('timeMarker', true).attr('points', '0,10 5,0 -5,0');

	  svg.selectAll('.line').data(_vis_.graph.aNodes).enter().append('line').attr('id', function (an) {
	    return 'tlAnalysisId-' + an.autoId;
	  }).classed('tlAnalysis', true).attr('x1', function (an) {
	    return timeLineGradientScale(parseISOTimeFormat(an.start));
	  }).attr('y1', function (an) {
	    return an.children.size() >= 5 ? 10 : parseInt(tlHeight - (tlHeight - 10) / 5 * an.children.size(), 10);
	  }).attr('x2', function (an) {
	    return timeLineGradientScale(parseISOTimeFormat(an.start));
	  }).attr('y2', tlHeight);

	  d3.selectAll('.startTimeline, .endTimeline').on('mouseover', function () {
	    d3.select(_this3).classed('mouseoverTimeline', true);
	  });

	  applyTimeLineDragBehavior(d3.selectAll('.startTimeline, .endTimeline'));

	  updateTimelineLabels(startTime);
	}

	/**
	 * Recomputes the DOI for every node
	 */
	function recomputeDOI() {
	  vis$1.graph.lNodes.values().forEach(function (l) {
	    l.doi.computeWeightedSum();
	    l.children.values().forEach(function (an) {
	      an.doi.computeWeightedSum();
	      an.children.values().forEach(function (san) {
	        san.doi.computeWeightedSum();
	        san.children.values().forEach(function (n) {
	          n.doi.computeWeightedSum();
	        });
	      });
	    });
	  });
	  updateNodeDoi();
	}

	/* TODO: Code cleanup. */
	/**
	 * Draws the DOI view.
	 */
	function drawDoiView() {
	  var _this4 = this;

	  var innerSvg = d3.select('#provenance-doi-view').select('svg').select('g').select('g').attr('transform', 'translate(0,0)').select('g');

	  var doiFactors = d3.values(DoiFactors.factors);
	  var doiColorScale = d3.scale.category10();

	  function updateDoiView(data) {
	    var rectOffset = 0;
	    var labelOffset = 30;
	    var labelsStart = (300 - data.length * labelOffset) / 2;

	    /* Data join. */
	    var dComp = innerSvg.selectAll('g').data(data);

	    /* Update. */
	    var gDCompUpdate = dComp.attr('id', function (d, i) {
	      return 'doiCompId-' + i;
	    }).classed('doiComp', true);

	    gDCompUpdate.select('.doiCompRect').classed('doiCompRect', true).attr('x', 0).attr('y', function (d) {
	      rectOffset += d.value * 300;
	      return rectOffset - d.value * 300;
	    }).attr('width', 40).attr('height', function (d) {
	      return d.value * 300;
	    });

	    gDCompUpdate.select('.doiCompHandle').classed('doiCompHandle', true).attr('x', 40 + labelOffset).attr('y', function (d, i) {
	      return labelsStart + labelOffset * i;
	    }).attr('width', labelOffset).attr('height', labelOffset).style('fill', function (d, i) {
	      return doiColorScale(10 - i);
	    });

	    rectOffset = 0;

	    gDCompUpdate.select('.doiCompLine', true).attr('x1', 40).attr('y1', function (d) {
	      rectOffset += d.value * 300;
	      return rectOffset - d.value * 300 / 2;
	    }).attr('x2', 40 + labelOffset).attr('y2', function (d, i) {
	      return labelsStart + labelOffset * i + labelOffset / 2;
	    }).style({
	      stroke: function stroke(d, i) {
	        return doiColorScale(10 - i);
	      },
	      'stroke-opacity': 0.7,
	      'stroke-width': '2px'
	    });

	    /* Enter. */
	    var gDCompEnter = dComp.enter().append('g').attr('id', function (d, i) {
	      return 'doiCompId-' + i;
	    }).classed('doiComp', true);

	    gDCompEnter.append('rect').classed('doiCompRect', true).attr('x', 0).attr('y', function (d) {
	      rectOffset += d.value * 300;
	      return rectOffset - d.value * 300;
	    }).attr('width', 40).attr('height', function (d) {
	      return d.value * 300;
	    }).style('fill', function (d, i) {
	      return doiColorScale(10 - i);
	    });

	    rectOffset = 0;

	    gDCompEnter.append('rect').classed('doiCompHandle', true).attr('x', 40 + labelOffset).attr('y', function (d, i) {
	      return labelsStart + labelOffset * i;
	    }).attr('width', labelOffset).attr('height', labelOffset).style('fill', function (d, i) {
	      return doiColorScale(10 - i);
	    });

	    rectOffset = 0;

	    gDCompEnter.append('line').classed('doiCompLine', true).attr('x1', 40).attr('y1', function (d) {
	      rectOffset += d.value * 300;
	      return rectOffset - d.value * 300 / 2;
	    }).attr('x2', 40 + labelOffset).attr('y2', function (d, i) {
	      return labelsStart + labelOffset * i + labelOffset / 2;
	    }).style({
	      stroke: function stroke(d, i) {
	        return doiColorScale(10 - i);
	      },
	      'stroke-opacity': 0.7,
	      'stroke-width': '2px'
	    });

	    dComp.exit().remove();

	    $('#doiSpinners').css('padding-top', labelsStart);
	  }

	  updateDoiView(doiFactors);

	  doiFactors.forEach(function (dc, i) {
	    $('<div/>', {
	      id: 'dc-form-' + i,
	      class: 'form dc-form',
	      style: 'height: 30px; position: absolute; left: 75px; top: ' + parseInt((10 - doiFactors.length) / 2 * 30 + (i + 1) * 30 - 1, 10) + 'px;'
	    }).appendTo('#' + 'doiVis');

	    $('<input/>', {
	      id: 'dc-checkbox-' + i,
	      class: 'dc-checkbox',
	      type: 'checkbox',
	      checked: 'true',
	      style: 'margin-top: 0px; margin-right: 2px; vertical-align: middle;'
	    }).appendTo('#' + 'dc-form-' + i);

	    $('<input/>', {
	      id: 'dc-input-' + i,
	      type: 'text',
	      class: 'form-control dc-input',
	      value: dc.value,
	      style: 'display: inline; width: 27px; height: 30px; margin-bottom:' + ' 0px;' + 'margin-right: 2px; text-align: left; padding: 0; margin-left: 2px;' + ' border-radius: 0px;'
	    }).appendTo('#' + 'dc-form-' + i);

	    $('<div/>', {
	      id: 'btn-group-wrapper-' + i,
	      class: 'btn-group',
	      style: 'height: 32px'
	    }).appendTo('#' + 'dc-form-' + i);

	    $('<div/>', {
	      id: 'dc-btn-group-' + i,
	      class: 'input-group-btn-vertical',
	      style: 'margin-right: 2px;'
	    }).appendTo('#' + 'btn-group-wrapper-' + i);

	    $('<button/>', {
	      id: 'dc-carret-up-' + i,
	      class: 'refinery-base btn btn-default',
	      html: '<i class=\'fa fa-caret-up\'></i>'
	    }).appendTo('#' + 'dc-btn-group-' + i);

	    $('<button/>', {
	      id: 'dc-carret-down-' + i,
	      class: 'refinery-base btn btn-default',
	      html: '<i class=\'fa fa-caret-down\'></i>'
	    }).appendTo('#' + 'dc-btn-group-' + i);

	    $('<span/>', {
	      id: 'dc-label-' + i,
	      class: 'label dc-label',
	      html: dc.label,
	      style: 'margin-left: 2px; opacity: 0.7; background-color: ' + doiColorScale(10 - i) + ';'
	    }).appendTo('#' + 'dc-form-' + i);
	  });

	  $('<a/>', {
	    id: 'prov-doi-view-reset',
	    href: '#',
	    html: 'Redistribute',
	    style: 'width: 25px; position: absolute; left: 90px; top: ' + parseInt((10 - doiFactors.length) / 2 * 30 + (doiFactors.length + 1) * 30 + 10, 10) + 'px;'
	  }).appendTo('#' + 'doiVis');

	  /* TODO: Code cleanup. */
	  /**
	   * Toggle doi components.
	   */
	  function toggleDoiComps() {
	    var numMaskedComps = d3.values(DoiFactors.factors).filter(function (dc) {
	      return DoiFactors.isMasked(dc.label);
	    }).length;

	    if (numMaskedComps > 0) {
	      (function () {
	        var accVal = d3.values(DoiFactors.factors).filter(function (dc) {
	          return DoiFactors.isMasked(dc.label);
	        }).map(function (dc) {
	          return dc.value;
	        }).reduce(function (_accVal_, cur) {
	          return _accVal_ + cur;
	        });

	        var tar = 1.0;

	        d3.values(DoiFactors.factors).forEach(function (dc, i) {
	          if (DoiFactors.isMasked(dc.label)) {
	            var isMasked = $('#dc-checkbox-' + i)[0].checked;
	            if (accVal === 0) {
	              DoiFactors.set(d3.keys(DoiFactors.factors)[i], 1 / numMaskedComps, isMasked);
	              $('#dc-input-' + i).val(1 / numMaskedComps);
	            } else {
	              DoiFactors.set(d3.keys(DoiFactors.factors)[i], dc.value / accVal * tar, isMasked);
	              $('#dc-input-' + i).val(dc.value / accVal * tar);
	            }
	          }
	        });
	      })();
	    }
	    updateDoiView(d3.values(DoiFactors.factors));
	  }

	  /* Toggle component on svg click. */
	  d3.selectAll('.doiComp').on('click', function () {
	    var dcId = d3.select(_this4).attr('id').substr(d3.select(_this4).attr('id').length - 1, 1);
	    var val = 0.0;
	    if ($('#dc-checkbox-' + dcId)[0].checked) {
	      $('#dc-checkbox-' + dcId).prop('checked', false);
	      $('#dc-label-' + dcId).css('opacity', 0.3);
	      d3.select('#doiCompId-' + dcId).select('.doiCompHandle').classed('blendedDoiComp', true);
	      d3.select('#doiCompId-' + dcId).select('.doiCompLine').style('display', 'none');
	      $('#dc-input-' + dcId).val(val);
	      DoiFactors.set(d3.keys(DoiFactors.factors)[dcId], val, false);
	    } else {
	      $($('#dc-checkbox-' + dcId)).prop('checked', true);
	      $('#dc-label-' + dcId).css('opacity', 0.7);
	      d3.select('#doiCompId-' + dcId).select('.doiCompHandle').classed('blendedDoiComp', false);
	      d3.select('#doiCompId-' + dcId).select('.doiCompLine').style('display', 'inline');
	      DoiFactors.set(d3.keys(DoiFactors.factors)[dcId], val, true);
	    }
	    toggleDoiComps();
	  });

	  /* Toggle component on checkbox click. */
	  $('.dc-checkbox').click(function () {
	    var dcId = $(this)[0].id[$(this)[0].id.length - 1];
	    var val = 0.0;
	    if ($(this)[0].checked) {
	      $(this.parentNode).find('.dc-label').css('opacity', 0.7);
	      d3.select('#doiCompId-' + dcId).select('.doiCompHandle').classed('blendedDoiComp', false);
	      d3.select('#doiCompId-' + dcId).select('.doiCompLine').style('display', 'inline');
	      val = 0.0;
	      DoiFactors.set(d3.keys(DoiFactors.factors)[dcId], val, true);
	    } else {
	      $(this.parentNode).find('.dc-label').css('opacity', 0.3);
	      d3.select('#doiCompId-' + dcId).select('.doiCompHandle').classed('blendedDoiComp', true);
	      d3.select('#doiCompId-' + dcId).select('.doiCompLine').style('display', 'none');
	      val = 0.0;
	      $('#dc-input-' + dcId).val(val);
	      DoiFactors.set(d3.keys(DoiFactors.factors)[dcId], val, false);
	    }

	    toggleDoiComps();
	  });

	  /* TODO: Clean up code duplication. */

	  /* Increase component's influence. */
	  $('.dc-form .btn:first-of-type').on('click', function () {
	    var dcId = $(_this4)[0].id[$(_this4)[0].id.length - 1];
	    var val = parseFloat($('#dc-input-' + dcId).val()) + 0.01;
	    if ($('#dc-checkbox-' + dcId)[0].checked && val <= 1) {
	      (function () {
	        $('#dc-input-' + dcId).val(val);
	        DoiFactors.set(d3.keys(DoiFactors.factors)[dcId], val, true);

	        var accVal = d3.values(DoiFactors.factors).filter(function (dc, i) {
	          return i !== dcId && DoiFactors.isMasked(dc.label);
	        }).map(function (dc) {
	          return dc.value;
	        }).reduce(function (_accVal_, cur) {
	          return _accVal_ + cur;
	        });

	        var tar = parseFloat(1 - val);

	        d3.values(DoiFactors.factors).forEach(function (dc, i) {
	          if (i !== dcId && DoiFactors.isMasked(dc.label)) {
	            var isMasked = $('#dc-checkbox-' + i)[0].checked;
	            DoiFactors.set(d3.keys(DoiFactors.factors)[i], dc.value / accVal * tar, isMasked);
	            $('#dc-input-' + i).val(dc.value / accVal * tar);
	          }
	        });
	        updateDoiView(d3.values(DoiFactors.factors));
	      })();
	    }
	  });

	  /* Decrease component's influence. */
	  $('.dc-form .btn:last-of-type').on('click', function () {
	    var dcId = $(_this4)[0].id[$(_this4)[0].id.length - 1];
	    var val = parseFloat($('#dc-input-' + dcId).val()) - 0.01;
	    if ($('#dc-checkbox-' + dcId)[0].checked && val >= 0) {
	      (function () {
	        $('#dc-input-' + dcId).val(val);
	        DoiFactors.set(d3.keys(DoiFactors.factors)[dcId], val, true);

	        var accVal = d3.values(DoiFactors.factors).filter(function (dc, i) {
	          return i !== dcId && DoiFactors.isMasked(dc.label);
	        }).map(function (dc) {
	          return dc.value;
	        }).reduce(function (_accVal_, cur) {
	          return _accVal_ + cur;
	        });

	        var tar = parseFloat(1 - val);

	        d3.values(DoiFactors.factors).forEach(function (dc, i) {
	          if (i !== dcId && DoiFactors.isMasked(dc.label)) {
	            var isMasked = $('#dc-checkbox-' + i)[0].checked;
	            DoiFactors.set(d3.keys(DoiFactors.factors)[i], dc.value / accVal * tar, isMasked);
	            $('#dc-input-' + i).val(dc.value / accVal * tar);
	          }
	        });
	        updateDoiView(d3.values(DoiFactors.factors));
	      })();
	    }
	  });

	  $('.dc-input').keypress(function (e) {
	    var _this5 = this;

	    if (e.which === 13) {
	      (function () {
	        var dcId = $(_this5)[0].id[$(_this5)[0].id.length - 1];
	        var val = parseFloat($('#dc-input-' + dcId).val());

	        if (val > 1) {
	          val = 1;
	        } else if (val < 0) {
	          val = 0;
	        }

	        $(_this5).val(val);
	        $($('#dc-checkbox-' + dcId)).prop('checked', true);
	        $('#doiCompId-' + dcId).find('.dc-label').css('opacity', 0.7);
	        d3.select('#doiCompId-' + dcId).select('.doiCompHandle').classed('blendedDoiComp', false);
	        d3.select('#doiCompId-' + dcId).select('.doiCompLine').style('display', 'inline');
	        DoiFactors.set(d3.keys(DoiFactors.factors)[dcId], val, true);

	        var accVal = d3.values(DoiFactors.factors).filter(function (dc, i) {
	          return i !== dcId && DoiFactors.isMasked(dc.label);
	        }).map(function (dc) {
	          return dc.value;
	        }).reduce(function (_accVal_, cur) {
	          return _accVal_ + cur;
	        });

	        var tar = parseFloat(1 - val);

	        d3.values(DoiFactors.factors).forEach(function (dc, i) {
	          if (i !== dcId && DoiFactors.isMasked(dc.label)) {
	            var isMasked = $('#dc-checkbox-' + i)[0].checked;
	            DoiFactors.set(d3.keys(DoiFactors.factors)[i], dc.value / accVal * tar, isMasked);
	            $('#dc-input-' + i).val(dc.value / accVal * tar);
	          }
	        });
	        updateDoiView(d3.values(DoiFactors.factors));
	      })();
	    }
	  });

	  $('#prov-doi-view-apply').on('click', function () {
	    /* Recompute doi. */
	    recomputeDOI();
	  });

	  $('#prov-doi-view-reset').on('click', function () {
	    var val = parseFloat(1 / d3.values(DoiFactors.factors).filter(function (dc) {
	      return DoiFactors.isMasked(dc.label);
	    }).length);

	    d3.values(DoiFactors.factors).forEach(function (dc, i) {
	      if (!DoiFactors.isMasked(dc.label)) {
	        $('#dc-input-' + i).val(0.0);
	        DoiFactors.set(d3.keys(DoiFactors.factors)[i], 0.0, false);
	      } else {
	        $('#dc-input-' + i).val(val);
	        DoiFactors.set(d3.keys(DoiFactors.factors)[i], val, true);
	      }
	    });
	    updateDoiView(d3.values(DoiFactors.factors));
	  });

	  /* Toggle DOI auto update. */
	  $('#prov-doi-trigger').click(function () {
	    if ($(this).find('input[type=\'checkbox\']').prop('checked')) {
	      doiAutoUpdate = true;
	    } else {
	      doiAutoUpdate = false;
	    }
	  });

	  /* Show and hide doi labels. */
	  $('#prov-doi-view-show').click(function () {
	    if ($(this).find('input[type=\'checkbox\']').prop('checked')) {
	      d3.selectAll('.nodeDoiLabel').style('display', 'inline');
	    } else {
	      d3.selectAll('.nodeDoiLabel').style('display', 'none');
	    }
	  });
	}

	/**
	 * Reset css for all links.
	 */
	function clearHighlighting() {
	  hLink.classed('hiddenLink', true);
	  link.each(function (l) {
	    l.highlighted = false;
	  });

	  domNodeset.each(function (n) {
	    n.highlighted = false;
	    n.doi.highlightedChanged();
	  });
	}

	/* TODO: Layer link highlighting. */
	/**
	 * Get predecessing nodes for highlighting the path by the current
	 * node selection.
	 * @param n BaseNode extending constructor function.
	 */
	function highlightPredPath(n) {
	  /* Current node is highlighted. */
	  n.highlighted = true;
	  n.doi.highlightedChanged();

	  /* Parent nodes are highlighted too. */
	  var pn = n.parent;
	  while (pn instanceof BaseNode === true) {
	    pn.highlighted = true;
	    pn.doi.highlightedChanged();
	    pn = pn.parent;
	  }

	  if (n instanceof Layer) {
	    n.children.values().forEach(function (an) {
	      an.predLinks.values().forEach(function (l) {
	        l.highlighted = true;
	        l.hidden = false;
	        d3.select('#hLinkId-' + l.autoId).classed('hiddenLink', false);

	        highlightPredPath(l.source);
	      });
	    });
	  } else {
	    /* Get svg link element, and for each predecessor call recursively. */
	    n.predLinks.values().forEach(function (l) {
	      l.highlighted = true;
	      if (!l.hidden) {
	        d3.select('#hLinkId-' + l.autoId).classed('hiddenLink', false);
	      }
	      highlightPredPath(l.source);
	    });
	  }
	}

	/**
	 * Get succeeding nodes for highlighting the path by the current
	 * node selection.
	 * @param n BaseNode extending constructor function.
	 */
	function highlightSuccPath(n) {
	  /* Current node is highlighted. */
	  n.highlighted = true;
	  n.doi.highlightedChanged();

	  /* Parent nodes are highlighted too. */
	  var pn = n.parent;
	  while (pn instanceof BaseNode === true) {
	    pn.highlighted = true;
	    pn.doi.highlightedChanged();
	    pn = pn.parent;
	  }

	  if (n instanceof Layer) {
	    n.children.values().forEach(function (an) {
	      an.succLinks.values().forEach(function (l) {
	        l.highlighted = true;
	        l.hidden = false;
	        d3.select('#hLinkId-' + l.autoId).classed('hiddenLink', false);

	        highlightSuccPath(l.target);
	      });
	    });
	  } else {
	    /* Get svg link element, and for each successor call recursively. */
	    n.succLinks.values().forEach(function (l) {
	      l.highlighted = true;
	      if (!l.hidden) {
	        d3.select('#hLinkId-' + l.autoId).classed('hiddenLink', false);
	      }

	      highlightSuccPath(l.target);
	    });
	  }
	}

	/**
	 * Update analysis links.
	 * @param graph The provenance graph.
	 */
	function updateAnalysisLinks(graph) {
	  /* Data join. */
	  var ahl = vis$1.canvas.select('g.aHLinks').selectAll('.hLink').data(graph.aLinks);

	  /* Enter. */
	  ahl.enter().append('path').classed({
	    hLink: true
	  }).classed('blendedLink', filterAction === 'blend').classed('filteredLink', function (l) {
	    return l.filtered;
	  }).classed('hiddenLink', function (l) {
	    return !l.highlighted;
	  }).attr('id', function (l) {
	    return 'hLinkId-' + l.autoId;
	  });

	  /* Enter and update. */
	  ahl.attr('d', function (l) {
	    var srcCoords = getVisibleNodeCoords(l.source);
	    var tarCoords = getVisibleNodeCoords(l.target);
	    if (linkStyle === 'bezier1') {
	      return drawBezierLink(l, srcCoords.x, srcCoords.y, tarCoords.x, tarCoords.y);
	    }
	    return drawStraightLink(l, srcCoords.x, srcCoords.y, tarCoords.x, tarCoords.y);
	  }).classed('blendedLink', function (l) {
	    return !l.filtered && filterAction === 'blend';
	  }).classed('filteredLink', function (l) {
	    return l.filtered;
	  }).classed('hiddenLink', function (l) {
	    return !l.highlighted;
	  }).attr('id', function (l) {
	    return 'hLinkId-' + l.autoId;
	  });

	  /* Exit. */
	  ahl.exit().remove();

	  /* Set dom elements. */
	  hLink = d3.selectAll('.hLink');

	  /* Data join */
	  var al = vis$1.canvas.select('g.aLinks').selectAll('.link').data(graph.aLinks);

	  /* Enter. */
	  al.enter().append('path').classed({
	    link: true,
	    aLink: true
	  }).classed('blendedLink', function (l) {
	    return !l.filtered && filterAction === 'blend';
	  }).classed('filteredLink', function (l) {
	    return l.filtered;
	  }).classed('hiddenLink', function (l) {
	    return l.hidden;
	  }).attr('id', function (l) {
	    return 'linkId-' + l.autoId;
	  });

	  /* Enter and update. */
	  al.attr('d', function (l) {
	    var srcCoords = getVisibleNodeCoords(l.source);
	    var tarCoords = getVisibleNodeCoords(l.target);
	    if (linkStyle === 'bezier1') {
	      return drawBezierLink(l, srcCoords.x, srcCoords.y, tarCoords.x, tarCoords.y);
	    }
	    return drawStraightLink(l, srcCoords.x, srcCoords.y, tarCoords.x, tarCoords.y);
	  }).classed('blendedLink', function (l) {
	    return !l.filtered && filterAction === 'blend';
	  }).classed('filteredLink', function (l) {
	    return l.filtered;
	  }).classed('hiddenLink', function (l) {
	    return l.hidden;
	  }).attr('id', function (l) {
	    return 'linkId-' + l.autoId;
	  });

	  /* Exit. */
	  al.exit().remove();

	  /* Set dom elements. */
	  aLink = d3.selectAll('.aLink');
	  link = d3.selectAll('.link');
	}

	/**
	 * Creates a linear time scale ranging from the first to the last analysis
	 * created.
	 * @param aNodes Analysis nodes.
	 * @param range Linear color scale for domain values.
	 */
	function createAnalysistimeColorScale(aNodes, range) {
	  var min = d3.min(aNodes, function (d) {
	    return parseISOTimeFormat(d.start);
	  });
	  var max = d3.max(aNodes, function (d) {
	    return parseISOTimeFormat(d.start);
	  });

	  return d3.time.scale().domain([min, max]).range([range[0], range[1]]);
	}

	/**
	 * Draw layered nodes.
	 * @param lNodes Layer nodes.
	 */
	function updateLayerNodes(lNodes) {
	  var _this6 = this;

	  /* Data join. */
	  var ln = vis$1.canvas.select('g.layers').selectAll('.layer').data(lNodes.values());

	  /* Enter. */
	  var lEnter = ln.enter().append('g').classed({
	    layer: true
	  });

	  lEnter.attr('id', function (d) {
	    return 'gNodeId-' + d.autoId;
	  }).attr('transform', function (d) {
	    return 'translate(' + d.x + ',' + d.y + ')';
	  });

	  /* Adjust gradient start and stop position as well as steps based on min,
	   * max and occurrences of analyses at a specific time. */
	  var gradient = lEnter.append('defs').append('linearGradient').attr('id', function (d) {
	    return 'layerGradientId-' + d.autoId;
	  }).attr('x1', '0%').attr('y1', '100%').attr('x2', '0%').attr('y2', '0%');

	  gradient.append('stop').attr('offset', '0%').attr('stop-color', function (l) {
	    var latestDate = d3.min(l.children.values(), function (d) {
	      return d.start;
	    });
	    return timeColorScale(parseISOTimeFormat(latestDate));
	  }).attr('stop-opacity', 1);

	  gradient.append('stop').attr('offset', '100%').attr('stop-color', function (l) {
	    var earliestDate = d3.max(l.children.values(), function (d) {
	      return d.start;
	    });
	    return timeColorScale(parseISOTimeFormat(earliestDate));
	  }).attr('stop-opacity', 1);

	  /* Draw bounding box. */
	  lBBox = lEnter.append('g').attr('id', function (lln) {
	    return 'BBoxId-' + lln.autoId;
	  }).classed({
	    lBBox: true,
	    BBox: true,
	    hiddenBBox: false
	  }).attr('transform', 'translate(' + -cell.width / 2 + ',' + -cell.height / 2 + ')');

	  lBBox.append('rect').attr('y', -0.6 * scaleFactor * vis$1.radius).attr('width', cell.width).attr('height', cell.height).attr('rx', cell.width / 7).attr('ry', cell.height / 7);

	  /* Add a clip-path to restrict labels within the cell area. */
	  lBBox.append('defs').append('clipPath').attr('id', function (lln) {
	    return 'lBBClipId-' + lln.autoId;
	  }).append('rect').attr('y', -0.6 * scaleFactor * vis$1.radius).attr('width', cell.width).attr('height', cell.height + 2 * scaleFactor * vis$1.radius).attr('rx', cell.width / 7).attr('ry', cell.height / 7);

	  /* Time as label. */
	  lBBox.append('g').classed('labels', true).attr('clip-path', function (lln) {
	    return 'url(#lBBClipId-' + lln.autoId + ')';
	  }).append('text').attr('transform', 'translate(' + 1 * scaleFactor * vis$1.radius + ',' + 0.5 * scaleFactor * vis$1.radius + ')').text(function (d) {
	    return '' + ' ' + d.wfCode;
	  }).classed('lBBoxLabel', true).style('font-family', 'FontAwesome');

	  var lDiff = lBBox.append('g').classed('lDiff', true).attr('transform', 'translate(' + 0 + ',' + 0 + ')');

	  lDiff.each(function (lln) {
	    if (lln.children.values().some(function (an) {
	      return an.motifDiff.numIns !== 0 || an.motifDiff.numOuts !== 0 || an.motifDiff.numSubanalyses !== 0;
	    })) {
	      d3.select(_this6).append('text').text('').classed('diff-node-type-icon', true).style('font-family', 'FontAwesome');
	    }
	  });

	  var layerNode = lEnter.append('g').attr('id', function (l) {
	    return 'nodeId-' + l.autoId;
	  }).classed({
	    lNode: true,
	    filteredNode: true,
	    blendedNode: false,
	    selectedNode: false,
	    hiddenNode: function hiddenNode(an) {
	      return an.hidden;
	    }
	  });

	  lEnter.append('g').classed({
	    children: true
	  });

	  var lGlyph = layerNode.append('g').classed({
	    glyph: true
	  });
	  var lLabels = layerNode.append('g').classed({
	    labels: true
	  });

	  /* TODO: Aggregate hidden analysis nodes into a single layer glyph.
	   * Glyph dimensions depend on the amount of analysis children the layer has
	   * as well as how many analyses of them are hidden. */

	  lGlyph.append('defs').append('clipPath').attr('id', function (l) {
	    return 'bbClipId-' + l.autoId;
	  }).append('rect').attr('x', -2 * scaleFactor * vis$1.radius).attr('y', -2 * scaleFactor * vis$1.radius).attr('rx', 1).attr('ry', 1).attr('width', 4 * scaleFactor * vis$1.radius).attr('height', 4 * scaleFactor * vis$1.radius);

	  lGlyph.each(function (lln) {
	    if (getLayerPredCount(lln) > 0) {
	      d3.select(_this6).append('g').classed('glAnchor', true).append('path').attr('d', 'm' + -2 * scaleFactor * vis$1.radius + ' ' + -0.5 * scaleFactor * vis$1.radius + ' ' + 'h' + -0.8 * scaleFactor * vis$1.radius + ' ' + 'a' + -0.5 * scaleFactor * vis$1.radius + ' ' + 0.5 * scaleFactor * vis$1.radius + ' 0 0 0 ' + '0 ' + 1 * scaleFactor * vis$1.radius + ' ' + 'h' + +0.8 * scaleFactor * vis$1.radius + ' ' + 'z').classed('llAnchor', true);
	    }
	  });

	  lGlyph.each(function (lln) {
	    if (getLayerSuccCount(lln) > 0) {
	      d3.select(_this6).append('g').classed('grAnchor', true).append('path').attr('d', 'm' + 2 * scaleFactor * vis$1.radius + ' ' + -0.5 * scaleFactor * vis$1.radius + ' ' + 'h' + 0.8 * scaleFactor * vis$1.radius + ' ' + 'a' + 0.5 * scaleFactor * vis$1.radius + ' ' + 0.5 * scaleFactor * vis$1.radius + ' 0 0 1 ' + '0 ' + 1 * scaleFactor * vis$1.radius + ' ' + 'h' + -0.8 * scaleFactor * vis$1.radius + ' ' + 'z').classed('rlAnchor', true);
	    }
	  });

	  lGlyph.each(function (lln) {
	    if (getLayerPredCount(lln) > 1) {
	      d3.select(_this6).select('g.glAnchor').append('text').attr('transform', 'translate(' + -2.8 * scaleFactor * vis$1.radius + ',' + 0.5 + ')').text(getLayerPredCount(ln)).attr('class', 'lLabel');
	    }
	  });

	  lGlyph.each(function (lln) {
	    if (getLayerSuccCount(lln) > 1) {
	      d3.select(_this6).select('g.grAnchor').append('text').attr('transform', 'translate(' + 2.8 * scaleFactor * vis$1.radius + ',' + 0.5 + ')').text(getLayerSuccCount(ln)).attr('class', 'lLabel');
	    }
	  });

	  lGlyph.append('rect').attr('x', -2.25 * scaleFactor * vis$1.radius).attr('y', -1 * scaleFactor * vis$1.radius).attr('rx', 1).attr('ry', 1).attr('width', 4.5 * scaleFactor * vis$1.radius).attr('height', 2 * scaleFactor * vis$1.radius).style('fill', function (d) {
	    return 'url(#layerGradientId-' + d.autoId + ')';
	  }).classed('lGlyph', true);

	  /* Add text labels. */
	  lLabels.append('text').text(function (d) {
	    return d.doi.doiWeightedSum;
	  }).attr('class', 'nodeDoiLabel').style('display', 'none');

	  lLabels.append('g').classed('wfLabel', true).attr('clip-path', function (l) {
	    return 'url(#bbClipId-' + l.autoId + ')';
	  });

	  lLabels.append('text').attr('transform', 'translate(' + -1.1 * scaleFactor * vis$1.radius + ',' + 0 * scaleFactor * vis$1.radius + ')').text('').classed('l-node-type-icon', true).style('fill', function (l) {
	    var latestDate = d3.min(l.children.values(), function (d) {
	      return d.start;
	    });
	    return timeColorScale(parseISOTimeFormat(latestDate)) < '#888888' ? '#ffffff' : '#000000';
	  });

	  lLabels.append('text').attr('transform', 'translate(' + 0.8 * scaleFactor * vis$1.radius + ',' + '0.25)').text(function (d) {
	    return d.children.size();
	  }).attr('class', 'lnLabel glyphNumeral').style('fill', function (l) {
	    var latestDate = d3.min(l.children.values(), function (d) {
	      return d.start;
	    });
	    return timeColorScale(parseISOTimeFormat(latestDate)) < '#888888' ? '#ffffff' : '#000000';
	  });

	  /* Enter and update. */
	  ln.attr('id', function (d) {
	    return 'gNodeId-' + d.autoId;
	  }).attr('transform', function (d) {
	    return 'translate(' + d.x + ',' + d.y + ')';
	  });

	  /* TODO: Implements update parameters. */

	  /* Exit. */
	  ln.exit().remove();

	  /* Set dom elements. */
	  layer = vis$1.canvas.select('g.layers').selectAll('.layer');
	  lNode = d3.selectAll('.lNode');
	  lBBox = d3.selectAll('.lBBox');
	}

	/**
	 * Draw layered nodes.
	 * @param lLinks Layer links.
	 */
	function updateLayerLinks(lLinks) {
	  /* Data join. */
	  var ln = vis$1.canvas.select('g.lLinks').selectAll('.link').data(lLinks.values());

	  /* Enter. */
	  ln.enter().append('path').classed({
	    link: true,
	    lLink: true
	  }).attr('id', function (d) {
	    return 'linkId-' + d.autoId;
	  }).classed('blendedLink', function (l) {
	    return !l.filtered && filterAction === 'blend';
	  }).classed('filteredLink', function (l) {
	    return l.filtered;
	  }).classed('hiddenLink', function (l) {
	    return l.hidden;
	  }).attr('id', function (l) {
	    return 'linkId-' + l.autoId;
	  });

	  /* Enter and update. */
	  ln.attr('d', function (l) {
	    var srcCoords = getVisibleNodeCoords(l.source);
	    var tarCoords = getVisibleNodeCoords(l.target);

	    if (linkStyle === 'bezier1') {
	      return drawBezierLink(l, srcCoords.x, srcCoords.y, tarCoords.x, tarCoords.y);
	    }
	    return drawStraightLink(l, srcCoords.x, srcCoords.y, tarCoords.x, tarCoords.y);
	  }).classed({
	    link: true,
	    lLink: true
	  }).attr('id', function (d) {
	    return 'linkId-' + d.autoId;
	  }).classed('blendedLink', function (l) {
	    return !l.filtered && filterAction === 'blend';
	  }).classed('filteredLink', function (l) {
	    return l.filtered;
	  }).classed('hiddenLink', function (l) {
	    return l.hidden;
	  }).attr('id', function (l) {
	    return 'linkId-' + l.autoId;
	  });

	  /* Exit. */
	  ln.exit().remove();

	  /* Set dom elements. */
	  lLink = vis$1.canvas.select('g.lLinks').selectAll('.link');
	}

	/**
	 * Draw analysis nodes.
	 */
	function updateAnalysisNodes() {
	  var _this7 = this;

	  /* Data join. */
	  var lAnalysis = d3.select('g.analyses').selectAll('.analysis').data(vis$1.graph.aNodes.sort(function (a, b) {
	    return parseISOTimeFormat(a.start) - parseISOTimeFormat(b.start);
	  }));

	  /* Enter and update. */
	  var anUpdate = lAnalysis.attr('id', function (d) {
	    return 'gNodeId-' + d.autoId;
	  });

	  anUpdate.attr('transform', function (d) {
	    return 'translate(' + d.x + ',' + d.y + ')';
	  }).style('fill', function (d) {
	    return timeColorScale(parseISOTimeFormat(d.start));
	  });

	  /* Add a clip-path to restrict labels within the cell area. */
	  anUpdate.select('defs').select('clipPath').attr('id', function (an) {
	    return 'bbClipId-' + an.autoId;
	  }).select('rect').attr('transform', 'translate(' + -cell.width / 2 + ',' + -cell.height / 2 + ')').attr('y', -scaleFactor * vis$1.radius).attr('width', cell.width).attr('height', cell.height).attr('rx', cell.width / 7).attr('ry', cell.height / 7);

	  /* Draw bounding box. */
	  var analysisBBox = anUpdate.select('g').attr('id', function (an) {
	    return 'BBoxId-' + an.autoId;
	  }).classed({
	    aBBox: true,
	    BBox: true,
	    hiddenBBox: true
	  }).attr('transform', 'translate(' + -cell.width / 2 + ',' + -cell.height / 2 + ')');

	  analysisBBox.select('rect').attr('y', -0.6 * scaleFactor * vis$1.radius).attr('width', function () {
	    return cell.width;
	  }).attr('height', function () {
	    return cell.height;
	  }).attr('rx', cell.width / 7).attr('ry', cell.height / 7);

	  /* Add a clip-path to restrict labels within the cell area. */
	  analysisBBox.select('defs').select('clipPath').attr('id', function (an) {
	    return 'aBBClipId-' + an.autoId;
	  }).select('rect').attr('y', -scaleFactor * vis$1.radius).attr('width', cell.width).attr('height', cell.height).attr('rx', cell.width / 7).attr('ry', cell.height / 7);

	  /* Time as label. */
	  analysisBBox.select('g').classed('labels', true).attr('clip-path', function (an) {
	    return 'url(#aBBClipId-' + an.autoId + ')';
	  }).select('text').attr('transform', 'translate(' + 1 * scaleFactor * vis$1.radius + ',' + 0 * scaleFactor * vis$1.radius + ')').text(function (d) {
	    return '' + ' ' + d.wfCode;
	  }).classed('aBBoxLabel', true).style('font-family', 'FontAwesome');

	  /* Draw analysis node. */
	  analysisNode = anUpdate.select('g').attr('id', function (an) {
	    return 'nodeId-' + an.autoId;
	  }).classed({
	    aNode: true,
	    filteredNode: true,
	    blendedNode: false,
	    selectedNode: false
	  }).classed('hiddenNode', function (an) {
	    return an.hidden;
	  });

	  anUpdate.select('g').classed('children', true);

	  aGlyph = analysisNode.select('g.glyph');
	  aLabels = analysisNode.select('g.labels').attr('clip-path', function (an) {
	    return 'url(#bbClipId-' + an.autoId + ')';
	  });

	  scaleFactor = 0.75;

	  aGlyph.each(function (an) {
	    if (an.predLinks.size() > 0) {
	      d3.select(_this7).select('g.glAnchor').select('path').attr('d', 'm' + -2 * scaleFactor * vis$1.radius + ' ' + -0.5 * scaleFactor * vis$1.radius + ' ' + 'h' + -0.8 * scaleFactor * vis$1.radius + ' ' + 'a' + -0.5 * scaleFactor * vis$1.radius + ' ' + 0.5 * scaleFactor * vis$1.radius + ' 0 0 0 ' + '0 ' + 1 * scaleFactor * vis$1.radius + ' ' + 'h' + +0.8 * scaleFactor * vis$1.radius + ' ' + 'z');
	    }
	  });

	  aGlyph.each(function (an) {
	    if (an.predLinks.size() > 1) {
	      aGlyph.select('g.grAnchor').select('text').attr('transform', 'translate(' + -2.8 * scaleFactor * vis$1.radius + ',' + 0.5 + ')').text(function (d) {
	        return d.predLinks.size();
	      }).attr('class', 'aLabel').style('display', 'inline');
	    }
	  });

	  aGlyph.each(function (an) {
	    if (an.succLinks.size() > 0) {
	      d3.select(_this7).select('path').attr('d', 'm' + 2 * scaleFactor * vis$1.radius + ' ' + -0.5 * scaleFactor * vis$1.radius + ' ' + 'h' + 0.8 * scaleFactor * vis$1.radius + ' ' + 'a' + 0.5 * scaleFactor * vis$1.radius + ' ' + 0.5 * scaleFactor * vis$1.radius + ' 0 0 1 ' + '0 ' + 1 * scaleFactor * vis$1.radius + ' ' + 'h' + -0.8 * scaleFactor * vis$1.radius + ' ' + 'z');
	    }
	  });

	  aGlyph.each(function (an) {
	    if (an.succLinks.size() > 1) {
	      d3.select(_this7).select('text').attr('transform', 'translate(' + 2.8 * scaleFactor * vis$1.radius + ',' + 0.5 + ')').text(function (d) {
	        return d.succLinks.size();
	      }).attr('class', 'aLabel').style('display', 'inline');
	    }
	  });

	  aGlyph.select('rect').attr('x', -2 * scaleFactor * vis$1.radius).attr('y', -1.5 * scaleFactor * vis$1.radius).attr('rx', 1).attr('ry', 1).attr('width', 4 * scaleFactor * vis$1.radius).attr('height', 3 * scaleFactor * vis$1.radius);

	  /* Add text labels. */
	  aLabels.select('text').text(function (d) {
	    return d.doi.doiWeightedSum;
	  }).attr('class', 'nodeDoiLabel').style('display', 'none');

	  /* Enter. */
	  var anEnter = lAnalysis.enter().append('g').classed('analysis', true).attr('id', function (d) {
	    return 'gNodeId-' + d.autoId;
	  });

	  anEnter.attr('transform', function (d) {
	    return 'translate(' + d.x + ',' + d.y + ')';
	  }).style('fill', function (d) {
	    return timeColorScale(parseISOTimeFormat(d.start));
	  });

	  /* Add a clip-path to restrict labels within the cell area. */
	  anEnter.append('defs').append('clipPath').attr('id', function (an) {
	    return 'bbClipId-' + an.autoId;
	  }).append('rect').attr('transform', 'translate(' + -cell.width / 2 + ',' + -cell.height / 2 + ')').attr('y', -scaleFactor * vis$1.radius).attr('width', cell.width).attr('height', cell.height + 2 * scaleFactor * vis$1.radius).attr('rx', cell.width / 7).attr('ry', cell.height / 7);

	  /* Draw bounding box. */
	  analysisBBox = anEnter.append('g').attr('id', function (an) {
	    return 'BBoxId-' + an.autoId;
	  }).classed({
	    aBBox: true,
	    BBox: true,
	    hiddenBBox: true
	  }).attr('transform', 'translate(' + -cell.width / 2 + ',' + -cell.height / 2 + ')');

	  analysisBBox.append('rect').attr('y', -0.6 * scaleFactor * vis$1.radius).attr('width', function () {
	    return cell.width;
	  }).attr('height', function () {
	    return cell.height;
	  }).attr('rx', cell.width / 7).attr('ry', cell.height / 7);

	  var aDiff = analysisBBox.append('g').classed('aDiff', true).attr('transform', 'translate(' + 0 + ',' + 0 + ')');

	  aDiff.each(function (an) {
	    if (an.motifDiff.numIns !== 0 || an.motifDiff.numOuts !== 0 || an.motifDiff.numSubanalyses !== 0) {
	      d3.select(_this7).append('text').text('').classed('diff-node-type-icon', true).style('font-family', 'FontAwesome');
	    }
	  });

	  /* Add a clip-path to restrict labels within the cell area. */
	  analysisBBox.append('defs').append('clipPath').attr('id', function (an) {
	    return 'aBBClipId-' + an.autoId;
	  }).append('rect').attr('y', -scaleFactor * vis$1.radius).attr('width', cell.width).attr('height', cell.height).attr('rx', cell.width / 7).attr('ry', cell.height / 7);

	  /* Workflow as label. */
	  analysisBBox.append('g').classed('labels', true).attr('clip-path', function (an) {
	    return 'url(#aBBClipId-' + an.autoId + ')';
	  }).append('text').attr('transform', 'translate(' + 1 * scaleFactor * vis$1.radius + ',' + 0 * scaleFactor * vis$1.radius + ')').text(function (d) {
	    return '' + ' ' + d.wfCode;
	  }).classed('aBBoxLabel', true).style('font-family', 'FontAwesome');

	  /* Draw analysis node. */
	  var analysisNode = anEnter.append('g').attr('id', function (an) {
	    return 'nodeId-' + an.autoId;
	  }).classed({
	    aNode: true,
	    filteredNode: true,
	    blendedNode: false,
	    selectedNode: false
	  }).classed('hiddenNode', function (an) {
	    return an.hidden;
	  });

	  anEnter.append('g').classed('children', true);

	  var aGlyph = analysisNode.append('g').classed('glyph', true);

	  var aLabels = analysisNode.append('g').classed('labels', true).attr('clip-path', function (an) {
	    return 'url(#bbClipId-' + an.autoId + ')';
	  });

	  aGlyph.each(function (an) {
	    if (an.predLinks.size() > 0) {
	      d3.select(_this7).append('g').classed('glAnchor', true).append('path').attr('d', 'm' + -2 * scaleFactor * vis$1.radius + ' ' + -0.5 * scaleFactor * vis$1.radius + ' ' + 'h' + -0.8 * scaleFactor * vis$1.radius + ' ' + 'a' + -0.5 * scaleFactor * vis$1.radius + ' ' + 0.5 * scaleFactor * vis$1.radius + ' 0 0 0 ' + '0 ' + 1 * scaleFactor * vis$1.radius + ' ' + 'h' + +0.8 * scaleFactor * vis$1.radius + ' ' + 'z').classed('laAnchor', true);
	    }
	  });

	  aGlyph.each(function (an) {
	    if (an.predLinks.size() > 1) {
	      d3.select(_this7).select('g.glAnchor').append('text').attr('transform', 'translate(' + -2.8 * scaleFactor * vis$1.radius + ',' + 0.5 + ')').text(function (d) {
	        return d.predLinks.size();
	      }).attr('class', 'aLabel').style('display', 'inline');
	    }
	  });

	  aGlyph.each(function (an) {
	    if (an.succLinks.size() > 0) {
	      d3.select(_this7).append('g').classed('grAnchor', true).append('path').attr('d', 'm' + 2 * scaleFactor * vis$1.radius + ' ' + -0.5 * scaleFactor * vis$1.radius + ' ' + 'h' + 0.8 * scaleFactor * vis$1.radius + ' ' + 'a' + 0.5 * scaleFactor * vis$1.radius + ' ' + 0.5 * scaleFactor * vis$1.radius + ' 0 0 1 ' + '0 ' + 1 * scaleFactor * vis$1.radius + ' ' + 'h' + -0.8 * scaleFactor * vis$1.radius + ' ' + 'z').classed('raAnchor', true);
	    }
	  });

	  aGlyph.each(function (an) {
	    if (an.succLinks.size() > 1) {
	      d3.select(_this7).select('g.grAnchor').append('text').attr('transform', 'translate(' + 2.8 * scaleFactor * vis$1.radius + ',' + 0.5 + ')').text(function (d) {
	        return d.succLinks.size();
	      }).attr('class', 'aLabel').style('display', 'inline');
	    }
	  });

	  aGlyph.append('rect').attr('x', -2.25 * scaleFactor * vis$1.radius).attr('y', -1.0 * scaleFactor * vis$1.radius).attr('rx', 1).attr('ry', 1).attr('width', 4.5 * scaleFactor * vis$1.radius).attr('height', 2 * scaleFactor * vis$1.radius).classed('aGlyph', true);

	  /* Add text labels. */
	  aLabels.append('text').text(function (d) {
	    return d.doi.doiWeightedSum;
	  }).attr('class', 'nodeDoiLabel').style('display', 'none');

	  aLabels.append('text').attr('transform', 'translate(' + -1.1 * scaleFactor * vis$1.radius + ',0)').text('').classed('an-node-type-icon', true).style('fill', function (an) {
	    return timeColorScale(parseISOTimeFormat(an.start)) < '#888888' ? '#ffffff' : '#000000';
	  });

	  aLabels.append('text').attr('transform', 'translate(' + 1.0 * scaleFactor * vis$1.radius + ',0.25)').text(function (d) {
	    return d.children.size();
	  }).attr('class', 'anLabel glyphNumeral').style('fill', function (an) {
	    return timeColorScale(parseISOTimeFormat(an.start)) < '#888888' ? '#ffffff' : '#000000';
	  });

	  /* Exit. */
	  lAnalysis.exit().remove();

	  /* Set dom elements. */
	  analysis = vis$1.canvas.select('g.analyses').selectAll('.analysis');
	  aNode = d3.selectAll('.aNode');
	  aBBox = d3.selectAll('.aBBox');
	}

	/**
	 * Draws the subanalalysis containing links.
	 * @param san Subanalysis node.
	 */
	function drawSubanalysisLinks(san) {
	  /* Draw highlighting links. */
	  /* Data join. */
	  var sahl = d3.select('#gNodeId-' + san.autoId).select('g.saHLinks').selectAll('.hLink').data(san.links.values());

	  /* Enter and update. */
	  sahl.attr('d', function (l) {
	    if (linkStyle === 'bezier1') {
	      return drawBezierLink(l, l.source.x, l.source.y, l.target.x, l.target.y);
	    }
	    return drawStraightLink(l, l.source.x, l.source.y, l.target.x, l.target.y);
	  }).classed({
	    hLink: true,
	    hiddenLink: true
	  }).attr('id', function (l) {
	    return 'hLinkId-' + l.autoId;
	  });

	  /* Enter. */
	  sahl.enter().append('path').attr('d', function (l) {
	    if (linkStyle === 'bezier1') {
	      return drawBezierLink(l, l.source.x, l.source.y, l.target.x, l.target.y);
	    }
	    return drawStraightLink(l, l.source.x, l.source.y, l.target.x, l.target.y);
	  }).classed({
	    hLink: true,
	    hiddenLink: true
	  }).attr('id', function (l) {
	    return 'hLinkId-' + l.autoId;
	  });

	  /* Exit. */
	  sahl.exit().remove();

	  /* Draw normal links. */
	  /* Data join. */
	  var sal = d3.select('#gNodeId-' + san.autoId).select('g.saLinks').selectAll('.Link').data(san.links.values());

	  /* Enter and update. */
	  sal.attr('d', function (l) {
	    if (linkStyle === 'bezier1') {
	      return drawBezierLink(l, l.source.x, l.source.y, l.target.x, l.target.y);
	    }
	    return drawStraightLink(l, l.source.x, l.source.y, l.target.x, l.target.y);
	  }).classed({
	    link: true,
	    saLink: true,
	    hiddenLink: true
	  }).attr('id', function (l) {
	    return 'linkId-' + l.autoId;
	  });

	  /* Enter. */
	  sal.enter().append('path').attr('d', function (l) {
	    if (linkStyle === 'bezier1') {
	      return drawBezierLink(l, l.source.x, l.source.y, l.target.x, l.target.y);
	    }
	    return drawStraightLink(l, l.source.x, l.source.y, l.target.x, l.target.y);
	  }).classed({
	    link: true,
	    saLink: true,
	    hiddenLink: true
	  }).attr('id', function (l) {
	    return 'linkId-' + l.autoId;
	  });

	  /* Exit. */
	  sal.exit().remove();
	}

	/**
	 * Draw subanalysis nodes.
	 * @param saNodes Subanalysis nodes.
	 */
	function drawSubanalysisNodes() {
	  var _this8 = this;

	  analysis.each(function (an) {
	    /* Data join. */
	    subanalysis = d3.select(_this8).select('.children').selectAll('.subanalysis').data(an.children.values());

	    var saEnter = subanalysis.enter().append('g').classed('subanalysis', true).attr('id', function (d) {
	      return 'gNodeId-' + d.autoId;
	    }).attr('transform', function (d) {
	      return 'translate(' + d.x + ',' + d.y + ')';
	    });

	    saEnter.each(function (san) {
	      var self = d3.select(_this8);
	      /* Draw links for each subanalysis. */

	      d3.select('#gNodeId-' + san.autoId).append('g').classed('saHLinks', true);
	      d3.select('#gNodeId-' + san.autoId).append('g').classed('saLinks', true);
	      drawSubanalysisLinks(san);

	      /* Compute bounding box for subanalysis child nodes. */
	      var saBBoxCoords = getWFBBoxCoords(san, cell, 0);

	      /* Add a clip-path to restrict labels within the cell area. */
	      self.append('defs').append('clipPath').attr('id', 'bbClipId-' + san.autoId).append('rect').attr('transform', 'translate(' + -cell.width / 2 + ',' + -cell.height / 2 + ')').attr('width', cell.width).attr('height', cell.height);

	      /* Draw bounding box. */
	      var subanalysisBBox = self.append('g').attr('id', 'BBoxId-' + san.autoId).classed({
	        saBBox: true,
	        BBox: true,
	        hiddenBBox: true
	      }).attr('transform', 'translate(' + -cell.width / 2 + ',' + -cell.height / 2 + ')');

	      /* Add a clip-path to restrict labels within the cell area. */
	      subanalysisBBox.append('defs').attr('x', scaleFactor * vis$1.radius).attr('y', -0.5 * scaleFactor * vis$1.radius).append('clipPath').attr('id', 'saBBClipId-' + san.autoId).append('rect').attr('width', saBBoxCoords.x.max - saBBoxCoords.x.min - scaleFactor * vis$1.radius).attr('height', cell.height);

	      subanalysisBBox.append('rect').attr('x', scaleFactor * vis$1.radius).attr('y', scaleFactor * vis$1.radius).attr('width', saBBoxCoords.x.max - saBBoxCoords.x.min - 2 * scaleFactor * vis$1.radius).attr('height', saBBoxCoords.y.max - saBBoxCoords.y.min - 2 * scaleFactor * vis$1.radius).attr('rx', cell.width / 7).attr('ry', cell.height / 7);

	      /* Draw subanalysis node. */
	      var subanalysisNode = self.append('g').attr('id', 'nodeId-' + san.autoId).classed({
	        saNode: true,
	        filteredNode: true,
	        blendedNode: false,
	        selectedNode: false
	      }).classed('hiddenNode', function (sann) {
	        return sann.hidden;
	      });

	      self.append('g').classed('children', true);

	      var saGlyph = subanalysisNode.append('g').classed('glyph', true);
	      var saLabels = subanalysisNode.append('g').classed('labels', true).attr('clip-path', 'url(#bbClipId-' + san.autoId + ')');

	      saGlyph.each(function (sann) {
	        if (sann.predLinks.size() > 0) {
	          d3.select(_this8).append('g').classed('glAnchor', true).append('path').attr('d', 'm' + -2 * scaleFactor * vis$1.radius + ' ' + -0.5 * scaleFactor * vis$1.radius + ' ' + 'h' + -0.8 * scaleFactor * vis$1.radius + ' ' + 'a' + -0.5 * scaleFactor * vis$1.radius + ' ' + 0.5 * scaleFactor * vis$1.radius + ' 0 0 0 ' + '0 ' + 1 * scaleFactor * vis$1.radius + ' ' + 'h' + +0.8 * scaleFactor * vis$1.radius + ' ' + 'z').classed('lsaAnchor', true);
	        }
	      });

	      saGlyph.each(function (sann) {
	        if (sann.predLinks.size() > 1) {
	          d3.select(_this8).select('g.glAnchor').append('text').attr('transform', 'translate(' + -2.8 * scaleFactor * vis$1.radius + ',' + 0.5 + ')').text(function (d) {
	            return d.predLinks.size();
	          }).attr('class', 'saLabel').style('display', 'inline');
	        }
	      });

	      saGlyph.each(function (sann) {
	        if (sann.succLinks.size() > 0) {
	          saGlyph.append('g').classed('grAnchor', true).append('path').attr('d', 'm' + 2 * scaleFactor * vis$1.radius + ' ' + -0.5 * scaleFactor * vis$1.radius + ' ' + 'h' + 0.8 * scaleFactor * vis$1.radius + ' ' + 'a' + 0.5 * scaleFactor * vis$1.radius + ' ' + 0.5 * scaleFactor * vis$1.radius + ' 0 0 1 ' + '0 ' + 1 * scaleFactor * vis$1.radius + ' ' + 'h' + -0.8 * scaleFactor * vis$1.radius + ' ' + 'z').classed('rsaAnchor', true);
	        }
	      });

	      saGlyph.each(function (sann) {
	        if (sann.succLinks.size() > 1) {
	          d3.select(_this8).select('g.grAnchor').append('text').attr('transform', 'translate(' + 2.8 * scaleFactor * vis$1.radius + ',' + 0.5 + ')').text(function (d) {
	            return d.succLinks.size();
	          }).attr('class', 'saLabel').style('display', 'inline');
	        }
	      });

	      saGlyph.append('rect').attr('x', -2.25 * scaleFactor * vis$1.radius).attr('y', -1 * scaleFactor * vis$1.radius).attr('rx', 1).attr('ry', 1).attr('width', 4.5 * scaleFactor * vis$1.radius).attr('height', 2 * scaleFactor * vis$1.radius);

	      /* Add text labels. */
	      saLabels.append('text').text(function (d) {
	        return d.doi.doiWeightedSum;
	      }).attr('class', 'nodeDoiLabel').style('display', 'none');

	      saLabels.append('text').attr('transform', 'translate(' + -1.1 * scaleFactor * vis$1.radius + ',0)').text('').classed('san-node-type-icon', true).style('fill', function (sann) {
	        return timeColorScale(parseISOTimeFormat(sann.parent.start)) < '#888888' ? '#ffffff' : '#000000';
	      });

	      saLabels.append('text').attr('transform', 'translate(' + 1.0 * scaleFactor * vis$1.radius + ',0.25)').text(function (d) {
	        return d.wfUuid !== 'dataset' ? d.children.values().filter(function (cn) {
	          return cn.nodeType === 'dt';
	        }).length : d.children.size();
	      }).attr('class', 'sanLabel glyphNumeral').style('fill', function (sann) {
	        return timeColorScale(parseISOTimeFormat(sann.parent.start)) < '#888888' ? '#ffffff' : '#000000';
	      });
	    });
	  });

	  /* Set dom elements. */
	  saNode = d3.selectAll('.saNode');
	  subanalysis = d3.selectAll('.subanalysis');
	  saBBox = d3.selectAll('.saBBox');

	  saLink = d3.selectAll('.saLink');
	  link = d3.selectAll('.link');
	  hLink = d3.selectAll('.hLink');
	}

	/**
	 * Draw nodes.
	 * @param nodes All nodes within the graph.
	 */
	function drawNodes() {
	  var _this9 = this;

	  subanalysis.each(function (san) {
	    node = d3.select(_this9).select('.children').selectAll('.node').data(san.children.values()).enter().append('g').classed('node', true).attr('id', function (d) {
	      return 'gNodeId-' + d.autoId;
	    }).attr('transform', function (d) {
	      return 'translate(' + d.x + ',' + d.y + ')';
	    });

	    node.each(function (d) {
	      var self = d3.select(_this9);
	      self.attr('class', function (dd) {
	        return 'node ' + dd.nodeType + 'Node';
	      }).attr('id', function (dd) {
	        return 'nodeId-' + dd.autoId;
	      }).classed('blendedNode', function (l) {
	        return !l.filtered && filterAction === 'blend';
	      }).classed('filteredNode', function (l) {
	        return l.filtered;
	      }).classed('hiddenNode', function (l) {
	        return l.hidden;
	      });

	      /* Add a clip-path to restrict labels within the cell area. */
	      self.append('defs').append('clipPath').attr('id', 'bbClipId-' + d.autoId).append('rect').attr('transform', 'translate(' + -1.5 * scaleFactor * vis$1.radius + ',' + -cell.height * 3 / 4 + ')').attr('width', cell.width - 2 * scaleFactor * vis$1.radius).attr('height', cell.height + 1 * scaleFactor * vis$1.radius);

	      var nGlyph = self.append('g').classed('glyph', true);
	      var nLabels = self.append('g').classed('labels', true).attr('clip-path', 'url(#bbClipId-' + d.autoId + ')');

	      nGlyph.each(function (n) {
	        if (n.predLinks.size() > 0) {
	          d3.select(_this9).append('g').classed('glAnchor', true).append('path').attr('d', 'm' + 0 + ' ' + -0.5 * scaleFactor * vis$1.radius + ' ' + 'h' + -1 * scaleFactor * vis$1.radius + ' ' + 'a' + -0.5 * scaleFactor * vis$1.radius + ' ' + 0.5 * scaleFactor * vis$1.radius + ' 0 0 0 ' + '0 ' + 1 * scaleFactor * vis$1.radius + ' ' + 'h' + +1 * scaleFactor * vis$1.radius + ' ' + 'z').classed('lnAnchor', true);
	        }
	      });

	      nGlyph.each(function (n) {
	        if (n.succLinks.size() > 0) {
	          nGlyph.append('g').classed('grAnchor', true).append('path').attr('d', 'm' + 0 + ' ' + -0.5 * scaleFactor * vis$1.radius + ' ' + 'h' + 1 * scaleFactor * vis$1.radius + ' ' + 'a' + 0.5 * scaleFactor * vis$1.radius + ' ' + 0.5 * scaleFactor * vis$1.radius + ' 0 0 1 ' + '0 ' + 1 * scaleFactor * vis$1.radius + ' ' + 'h' + -1 * scaleFactor * vis$1.radius + ' ' + 'z').classed('rnAnchor', true);
	        }
	      });

	      if (d.nodeType === 'raw' || d.nodeType === 'intermediate' || d.nodeType === 'stored') {
	        nGlyph.append('circle').attr('r', function (dd) {
	          return dd.nodeType === 'intermediate' ? 3 * scaleFactor * vis$1.radius / 4 : 5 * scaleFactor * vis$1.radius / 6;
	        });
	      } else {
	        if (d.nodeType === 'special') {
	          nGlyph.append('rect').attr('transform', 'translate(' + -3 * scaleFactor * vis$1.radius / 4 + ',' + -3 * scaleFactor * vis$1.radius / 4 + ')').attr('width', 1.5 * scaleFactor * vis$1.radius).attr('height', 1.5 * scaleFactor * vis$1.radius);
	        } else if (d.nodeType === 'dt') {
	          nGlyph.append('rect').attr('transform', 'translate(' + -1.25 * scaleFactor * vis$1.radius / 2 + ',' + -1.25 * scaleFactor * vis$1.radius / 2 + ')' + 'rotate(45 ' + 1.25 * scaleFactor * vis$1.radius / 2 + ',' + 1.25 * scaleFactor * vis$1.radius / 2 + ')').attr('width', 1.25 * scaleFactor * vis$1.radius).attr('height', 1.25 * scaleFactor * vis$1.radius);
	        }
	      }

	      nLabels.append('text').text(function (dd) {
	        return dd.doi.doiWeightedSum;
	      }).attr('class', 'nodeDoiLabel').style('display', 'none');

	      nLabels.each(function () {
	        d3.select(_this9).append('text').attr('transform', 'translate(' + -1.5 * scaleFactor * vis$1.radius + ',' + -1.5 * scaleFactor * vis$1.radius + ')').text(function (ddd) {
	          var nodeAttrLabel = '';

	          if (ddd.nodeType === 'stored') {
	            nodeAttrLabel = ddd.attributes.get('name');
	          } else {
	            /* Trim data transformation node names for
	             testtoolshed repo.*/
	            if (ddd.nodeType === 'dt') {
	              if (ddd.name.indexOf(': ') > 0) {
	                var firstPart = ddd.name.substr(ddd.name.indexOf(': ') + 2, ddd.name.length - ddd.name.indexOf(': ') - 2);
	                ddd.label = firstPart;
	                var secondPart = ddd.name.substr(0, ddd.name.indexOf(': '));
	                ddd.name = firstPart + ' (' + secondPart + ')';
	                nodeAttrLabel = ddd.label;
	              }
	            } else {
	              nodeAttrLabel = ddd.name;
	            }
	          }
	          return nodeAttrLabel;
	        }).attr('class', 'nodeAttrLabel');
	      });

	      nLabels.each(function (dd) {
	        if (dd.nodeType === 'stored') {
	          d3.select(_this9).append('text').text('').classed('stored-node-type-icon', true).style('fill', function (n) {
	            return timeColorScale(parseISOTimeFormat(n.parent.parent.start)) < '#888888' ? '#ffffff' : '#000000';
	          });
	        }
	      });
	    });
	  });
	  /* Set node dom element. */
	  node = d3.selectAll('.node');
	}

	/* TODO: Code cleanup. */
	/**
	 * Dynamic Dagre layout.
	 * @param graph The provenance Graph.
	 */
	function dagreDynamicLayerLayout(graph) {
	  /* Initializations. */
	  var g = new dagre.graphlib.Graph();
	  g.setGraph({
	    rankdir: 'LR',
	    nodesep: 1 * scaleFactor * vis$1.radius,
	    edgesep: 0,
	    ranksep: 4 * scaleFactor * vis$1.radius,
	    marginx: 0,
	    marginy: 0
	  });
	  g.setDefaultEdgeLabel({});
	  var anBBoxCoords = {};
	  var curWidth = 0;
	  var curHeight = 0;
	  var exNum = 0;
	  var accY = 0;

	  /* Add layer or analysis nodes with a dynamic bounding box size
	   * (based on visible child nodes). */
	  graph.lNodes.values().forEach(function (ln) {
	    d3.select('#BBoxId-' + ln.autoId).classed('hiddenBBox', true);
	    if (!ln.hidden) {
	      (function () {
	        if (ln.filtered) {
	          d3.select('#BBoxId-' + ln.autoId).classed('hiddenBBox', false);
	        }
	        curWidth = vis$1.cell.width;
	        curHeight = vis$1.cell.height;

	        /* Check exaggerated layer children. */
	        /* Add visible dimensions to layer node without bounding boxes. */
	        /* Based on current y-coord order, the stack of nodes will be drawn
	         vertically. */
	        /* Child nodes inherit x-coord of layer node and y-coord will be
	         computed based on the statement above.*/
	        /* Layer node number labels may be updated. */
	        /* Maybe add a bounding box for layered node and exaggerated nodes.*/

	        exNum = 0;
	        accY = ln.y + vis$1.cell.height;
	        ln.children.values().filter(function (an) {
	          return an.filtered || filterAction === 'blend';
	        }).sort(function (a, b) {
	          return a.y - b.y;
	        }).forEach(function (an) {
	          if (an.exaggerated && an.filtered) {
	            exNum++;
	            an.x = an.parent.x;
	            an.y = accY;
	            accY += getABBoxCoords(an, cell, 0).y.max - getABBoxCoords(an, cell, 0).y.min;

	            updateNodeAndLink(an, d3.select('#gNodeId-' + an.autoId));
	            d3.select('#BBoxId-' + ln.autoId).classed('hiddenBBox', false);
	            d3.select('#BBoxId-' + an.autoId).classed('hiddenBBox', false);
	          } else {
	            an.x = an.parent.x;
	            an.y = an.parent.y;
	          }
	        });

	        /* Set layer label and bounding box. */
	        var numChildren = ln.children.values().filter(function (an) {
	          return an.filtered || filterAction === 'blend';
	        }).length;

	        d3.select('#nodeId-' + ln.autoId).select('g.labels').select('.lnLabel').text(numChildren - exNum + '/' + ln.children.size());

	        /* Get potential expanded bounding box size. */
	        var accHeight = curHeight;
	        var accWidth = curWidth;
	        ln.children.values().filter(function (an) {
	          return an.filtered || filterAction === 'blend';
	        }).forEach(function (an) {
	          if (an.exaggerated) {
	            anBBoxCoords = getABBoxCoords(an, cell, 0);
	            if (anBBoxCoords.x.max - anBBoxCoords.x.min > accWidth) {
	              accWidth = anBBoxCoords.x.max - anBBoxCoords.x.min;
	            }
	            accHeight += anBBoxCoords.y.max - anBBoxCoords.y.min;
	          }
	        });

	        d3.select('#lBBClipId-' + ln.autoId).select('rect').attr('width', accWidth).attr('height', accHeight);

	        d3.select('#BBoxId-' + ln.autoId).attr('transform', 'translate(' + -accWidth / 2 + ',' + -vis$1.cell.height / 2 + ')').select('rect').attr('width', accWidth).attr('height', accHeight);

	        g.setNode(ln.autoId, {
	          label: ln.autoId,
	          width: accWidth,
	          height: accHeight
	        });
	      })();
	    } else {
	      ln.children.values().filter(function (an) {
	        return an.filtered || filterAction === 'blend';
	      }).forEach(function (an) {
	        anBBoxCoords = getABBoxCoords(an, cell, 0);
	        curWidth = anBBoxCoords.x.max - anBBoxCoords.x.min;
	        curHeight = anBBoxCoords.y.max - anBBoxCoords.y.min;
	        g.setNode(an.autoId, {
	          label: an.autoId,
	          width: curWidth,
	          height: curHeight
	        });
	      });
	    }
	  });

	  /* Add layer-to-layer links. */
	  graph.lLinks.values().forEach(function (ll) {
	    if (!ll.hidden) {
	      g.setEdge(ll.source.autoId, ll.target.autoId, {
	        minlen: 1,
	        weight: 1,
	        width: 0,
	        height: 0,
	        labelpos: 'r',
	        labeloffset: 0
	      });
	    }
	  });

	  /* Add analysis-mixed links. */
	  graph.aLinks.forEach(function (l) {
	    if (!l.hidden) {
	      /* Either the layer or the analysis is visible and therefore
	       virtual links are created.*/
	      var src = l.source.parent.parent.parent.autoId;
	      var tar = l.target.parent.parent.parent.autoId;
	      if (l.source.parent.parent.parent.hidden) {
	        src = l.source.parent.parent.autoId;
	      }
	      if (l.target.parent.parent.parent.hidden) {
	        tar = l.target.parent.parent.autoId;
	      }

	      g.setEdge(src, tar, {
	        minlen: 1,
	        weight: 1,
	        width: 0,
	        height: 0,
	        labelpos: 'r',
	        labeloffset: 0
	      });
	    }
	  });

	  /* Compute layout. */
	  dagre.layout(g);

	  /* Set layer and analysis coords. */
	  layoutCols = d3.map();
	  var accWidth = 0;
	  var accHeight = 0;

	  /* Assign x and y coords for layers or analyses. Check filter action
	   as well as exaggerated nodes. */
	  d3.map(g._nodes).values().forEach(function (n) {
	    if (typeof n !== 'undefined') {
	      if (graph.lNodes.has(n.label) && (graph.lNodes.get(n.label).filtered || filterAction === 'blend')) {
	        (function () {
	          var ln = graph.lNodes.get(n.label);
	          accHeight = vis$1.cell.height;
	          accWidth = vis$1.cell.width;

	          ln.children.values().filter(function (an) {
	            return an.filtered || filterAction === 'blend';
	          }).forEach(function (an) {
	            if (an.exaggerated) {
	              anBBoxCoords = getABBoxCoords(an, cell, 0);
	              if (anBBoxCoords.x.max - anBBoxCoords.x.min > accWidth) {
	                accWidth = anBBoxCoords.x.max - anBBoxCoords.x.min;
	              }
	              accHeight += anBBoxCoords.y.max - anBBoxCoords.y.min;
	            }
	          });

	          ln.x = n.x - vis$1.cell.width / 2;
	          ln.y = n.y - accHeight / 2;

	          exNum = 0;
	          accY = ln.y + vis$1.cell.height;
	          ln.children.values().filter(function (an) {
	            return an.filtered || filterAction === 'blend';
	          }).sort(function (a, b) {
	            return a.y - b.y;
	          }).forEach(function (an) {
	            anBBoxCoords = getABBoxCoords(an, cell, 0);
	            curWidth = anBBoxCoords.x.max - anBBoxCoords.x.min;
	            an.x = ln.x - curWidth / 2 + vis$1.cell.width / 2;

	            if (an.exaggerated) {
	              an.y = accY;
	              accY += getABBoxCoords(an, cell, 0).y.max - getABBoxCoords(an, cell, 0).y.min;
	            } else {
	              an.y = an.parent.y;
	            }
	          });
	        })();
	      } else {
	        var an = graph.aNodes.filter(function (ann) {
	          return ann.autoId === n.label && (ann.filtered || filterAction === 'blend');
	        })[0];

	        if (an && typeof an !== 'undefined') {
	          anBBoxCoords = getABBoxCoords(an, cell, 0);
	          accWidth = anBBoxCoords.x.max - anBBoxCoords.x.min;
	          accHeight = anBBoxCoords.y.max - anBBoxCoords.y.min;

	          an.x = n.x - accWidth / 2;
	          an.y = n.y - accHeight / 2;
	        }
	      }

	      /* Compute layouted columns. */
	      if (layoutCols.has(n.x)) {
	        layoutCols.get(n.x).nodes.push(n.label);
	      } else {
	        layoutCols.set(n.x, {
	          nodes: [],
	          width: 0
	        });
	        layoutCols.get(n.x).nodes.push(n.label);
	      }
	      if (accWidth > layoutCols.get(n.x).width) {
	        layoutCols.get(n.x).width = accWidth;
	      }
	    }
	  });

	  /* Update graph dom elements. */
	  vis$1.graph.lNodes.values().forEach(function (ln) {
	    updateNodeAndLink(ln, d3.select('#gNodeId-' + ln.autoId));
	  });

	  /* Reorder node columns by y-coords. */
	  layoutCols.values().forEach(function (c) {
	    c.nodes = c.nodes.sort(function (a, b) {
	      return a.y - b.y;
	    });
	  });
	}

	/**
	 * Path highlighting.
	 * @param d Node.
	 * @param keyStroke Keystroke being pressed at mouse click.
	 */
	function handlePathHighlighting(d, keyStroke) {
	  var _this10 = this;

	  /* Clear any highlighting. */
	  clearHighlighting();

	  if (keyStroke === 's') {
	    /* Highlight path. */
	    highlightSuccPath(d);
	  } else if (keyStroke === 'p') {
	    /* Highlight path. */
	    highlightPredPath(d);
	  }

	  d3.select('.aHLinks').selectAll('.hLink').each(function (l) {
	    if (l.highlighted) {
	      l.hidden = false;
	      d3.select(_this10).classed('hiddenLink', false);
	    }
	  });

	  /* TODO: Temporarily enabled. */
	  if (doiAutoUpdate) {
	    recomputeDOI();
	  }
	}

	/* TODO: Revise. */
	/**
	 * Fit visualization onto free windows space.
	 * @param transitionTime The time in milliseconds for the duration of the
	 * animation.
	 */
	function fitGraphToWindow(transitionTime) {
	  var _this11 = this;

	  var min = [0, 0];
	  var max = [0, 0];

	  vis$1.graph.aNodes.forEach(function (an) {
	    var anBBox = getABBoxCoords(an, cell, 0);
	    if (anBBox.x.min < min[0]) {
	      min[0] = anBBox.x.min;
	    }
	    if (anBBox.x.max > max[0]) {
	      max[0] = anBBox.x.max;
	    }
	    if (anBBox.y.min < min[1]) {
	      min[1] = anBBox.y.min;
	    }
	    if (anBBox.y.max > max[1]) {
	      max[1] = anBBox.y.max;
	    }
	  });

	  /* TODO: Fix for temporary sidebar overlap. */
	  var sidebarOverlap = $('#provenance-sidebar').width() - $('#solr-facet-view').width() - parseFloat($('#main-area').css('margin-left').replace('px', ''));

	  var delta = [max[0] - min[0], max[1] - min[1]];
	  var factor = [vis$1.width / delta[0], vis$1.height / delta[1]];
	  var newScale = d3.min(factor.concat([3])) * 0.9;
	  var newPos = [(sidebarOverlap > 0 ? sidebarOverlap : 0) + vis$1.margin.left * 2 * newScale, (vis$1.height - delta[1] * newScale) / 2 + vis$1.margin.top * 2];

	  vis$1.canvas.transition().duration(transitionTime).attr('transform', 'translate(' + newPos + ')scale(' + newScale + ')');

	  vis$1.zoom.translate(newPos);
	  vis$1.zoom.scale(newScale);

	  /* Semantic zoom. */
	  setTimeout(function () {
	    if (newScale < 1) {
	      d3.selectAll('.BBox').classed('hiddenNode', true);
	      d3.selectAll('.lDiff, .aDiff').classed('hiddenNode', true);
	    } else {
	      d3.selectAll('.BBox').classed('hiddenNode', false);
	      d3.selectAll('.lDiff, .aDiff').classed('hiddenNode', false);
	    }

	    if (newScale < 1.7) {
	      vis$1.canvas.selectAll('.anLabel, .sanLabel, .lnLabel, ' + '.nodeAttrLabel, .stored-node-type-icon, .an-node-type-icon, ' + '.san-node-type-icon, .l-node-type-icon, .lBBoxLabel, ' + '.aBBoxLabel, .nodeDoiLabel').classed('hiddenLabel', true);
	      d3.selectAll('.glAnchor, .grAnchor').classed('hiddenNode', true);
	    } else {
	      vis$1.canvas.selectAll('.anLabel, .sanLabel, .lnLabel, ' + '.nodeAttrLabel, .stored-node-type-icon, .an-node-type-icon, ' + '.san-node-type-icon, .l-node-type-icon, .lBBoxLabel, ' + '.aBBoxLabel, .nodeDoiLabel').classed('hiddenLabel', false);
	      d3.selectAll('.glAnchor, .grAnchor').classed('hiddenNode', false);
	    }
	  }, transitionTime);

	  /* Background rectangle fix. */
	  vis$1.rect.attr('transform', 'translate(' + -newPos[0] / newScale + ',' + -newPos[1] / newScale + ')' + ' ' + 'scale(' + 1 / newScale + ')');

	  /* Quick fix to exclude scale from text labels. */
	  vis$1.canvas.selectAll('.lBBoxLabel').transition().duration(transitionTime).attr('transform', 'translate(' + 1 * scaleFactor * vis$1.radius + ',' + 0.5 * scaleFactor * vis$1.radius + ') ' + 'scale(' + 1 / newScale + ')');

	  vis$1.canvas.selectAll('.aBBoxLabel').transition().duration(transitionTime).attr('transform', 'translate(' + 1 * scaleFactor * vis$1.radius + ',' + 0 * scaleFactor * vis$1.radius + ') ' + 'scale(' + 1 / newScale + ')');

	  vis$1.canvas.selectAll('.nodeDoiLabel').transition().duration(transitionTime).attr('transform', 'translate(' + 0 + ',' + 1.6 * scaleFactor * vis$1.radius + ') ' + 'scale(' + 1 / newScale + ')');

	  vis$1.canvas.selectAll('.nodeAttrLabel').transition().duration(transitionTime).attr('transform', 'translate(' + -1.5 * scaleFactor * vis$1.radius + ',' + -1.5 * scaleFactor * vis$1.radius + ') ' + 'scale(' + 1 / newScale + ')');

	  /* Trim nodeAttrLabel */
	  /* Get current node label pixel width. */
	  var maxLabelPixelWidth = (cell.width - 2 * scaleFactor * vis$1.radius) * d3.transform(d3.select('.canvas').select('g').select('g').attr('transform')).scale[0];

	  /* Get label text. */
	  d3.selectAll('.node').select('.nodeAttrLabel').each(function (d) {
	    var attrText = d.label === '' ? d.name : d.label;
	    if (d.nodeType === 'stored') {
	      var selAttrName = '';
	      $('#prov-ctrl-visible-attribute-list > li').each(function () {
	        if ($(this).find('input[type=\'radio\']').prop('checked')) {
	          selAttrName = $(this).find('label').text();
	        }
	      });
	      attrText = d.attributes.get(selAttrName);
	    }

	    /* Set label text. */
	    if (typeof attrText !== 'undefined') {
	      d3.select(_this11).text(attrText);
	      var trimRatio = parseInt(attrText.length * (maxLabelPixelWidth / _this11.getComputedTextLength()), 10);
	      if (trimRatio < attrText.length) {
	        d3.select(_this11).text(attrText.substr(0, trimRatio - 3) + '...');
	      }
	    }
	  });
	}

	/**
	 * Clears node selection.
	 */
	function clearNodeSelection() {
	  var _this12 = this;

	  domNodeset.each(function (d) {
	    d.selected = false;
	    d.doi.selectedChanged();
	    d3.select('#nodeId-' + d.autoId).classed('selectedNode', false);
	    $('#nodeId-' + d.autoId).find('.glyph').find('rect, circle').css('stroke', colorStrokes);
	  });

	  $('#nodeInfoTitle').html('Select a node: - ');
	  $('#nodeInfoTitleLink').html('');
	  $('#' + 'provenance-nodeInfo-content').html('');

	  selectedNodeSet = d3.map();

	  $('.filteredNode').hover(function () {
	    $(this).find('rect, circle').css('stroke', colorHighlight);
	  }, function () {
	    $(_this12).find('rect, circle').css('stroke', colorStrokes);
	  });
	}

	/**
	 * Left click on a node to select and reveal additional details.
	 * @param d Node
	 */
	function handleNodeSelection(d) {
	  var _this13 = this;

	  clearNodeSelection();
	  d.selected = true;
	  propagateNodeSelection(d, true);
	  selectedNodeSet.set(d.autoId, d);
	  d3.select('#nodeId-' + d.autoId).classed('selectedNode', d.selected).select('.glyph').select('rect, circle').style('stroke', colorHighlight);

	  $('#nodeId-' + d.autoId).hover(function () {
	    $(this).find('rect, circle').css('stroke', colorHighlight);
	  }, function () {
	    $(_this13).find('rect, circle').css('stroke', colorHighlight);
	  });

	  d.doi.selectedChanged();
	  if (doiAutoUpdate) {
	    recomputeDOI();
	  }
	}

	/* TODO: Clean up. */
	/* TODO: May add bounding box color. */
	/**
	 * Colorcoding view.
	 */
	function drawColorcodingView() {
	  var wfColorScale = d3.scale.category10();
	  var wfColorData = d3.map();

	  wfColorData.set('dataset', 0);
	  var wfIndex = 1;
	  vis$1.graph.workflowData.values().forEach(function (wf) {
	    var wfName = wf.name;
	    if (wf.name.substr(0, 15) === 'Test workflow: ') {
	      wfName = wf.name.substr(15, wf.name.length - 15);
	    }
	    if (wfName.indexOf('(') > 0) {
	      wfName = wfName.substr(0, wfName.indexOf('('));
	    }
	    if (wfName.indexOf('-') > 0) {
	      wfName = wfName.substr(0, wfName.indexOf('-'));
	    }
	    if (!wfColorData.has(wfName)) {
	      wfColorData.set(wfName, wfIndex);
	      wfIndex++;
	    }
	    wf.code = wfName;
	  });

	  wfColorData.entries().forEach(function (wf, i) {
	    var wfName = wf.key;

	    $('<tr/>', {
	      id: 'provvis-cc-wf-tr-' + i
	    }).appendTo('#prov-ctrl-cc-workflow-content');

	    $('<td/>', {
	      id: 'provvis-cc-wf-td-' + i
	    }).appendTo('#provvis-cc-wf-tr-' + i);

	    $('<label/>', {
	      id: 'provvis-cc-wf-label-' + i,
	      class: 'provvis-cc-label',
	      html: '<input id="provvis-cc-wf-color-' + i + '" type="text">' + wfName
	    }).appendTo('#provvis-cc-wf-td-' + i);

	    $('<em/>', {
	      id: 'provvis-cc-wf-hex-' + i,
	      class: 'provvis-cc-hide-hex',
	      html: wfColorScale(wf.value)
	    }).appendTo('#provvis-cc-wf-label-' + i);

	    /* Change event. */
	    $('#provvis-cc-wf-color-' + i).spectrum({
	      color: wfColorScale(wf.value),
	      showAlpha: false,
	      change: function change(color) {
	        $('#provvis-cc-wf-hex-' + i).text(color.toHexString());
	        switchColorScheme('workflow');
	      }
	    });
	  });

	  function updateStrokesColor(color) {
	    $('#provvis-cc-strokes-hex').text(color);
	    link.style({
	      stroke: color
	    });
	    domNodeset.style({
	      stroke: color
	    });
	    $('.glAnchor, .grAnchor').css({
	      stroke: color,
	      fill: color
	    });
	  }

	  function updateHighlightColor(color) {
	    var _this14 = this;

	    $('#provvis-cc-highlight-hex').text(color);
	    hLink.style({
	      stroke: color
	    });

	    $('.filteredNode').hover(function () {
	      $(this).find('rect, circle').css({
	        stroke: color
	      });
	    }, function () {
	      $(_this14).find('rect, circle').css({
	        stroke: colorStrokes
	      });
	    });

	    $('.glAnchor, .grAnchor').hover(function () {
	      $(this).css({
	        stroke: color,
	        fill: color
	      });
	    }, function () {
	      $(_this14).css({
	        stroke: colorStrokes,
	        fill: colorStrokes
	      });
	    });
	  }

	  /* Change events. */
	  $('#provvis-cc-strokes').spectrum({
	    color: '#136382',
	    showAlpha: true,
	    change: function change(color) {
	      colorStrokes = color.toHexString();
	      updateStrokesColor(colorStrokes);
	      updateHighlightColor(colorHighlight);
	    }
	  });

	  $('#provvis-cc-highlight').spectrum({
	    color: '#ed7407',
	    showAlpha: true,
	    change: function change(color) {
	      colorHighlight = color.toHexString();
	      updateHighlightColor(colorHighlight);
	    }
	  });

	  $('#provvis-cc-layer').spectrum({
	    color: '#1f77b4',
	    showAlpha: true,
	    change: function change(color) {
	      $('#provvis-cc-layer-hex').text(color.toHexString());
	      switchColorScheme('nodetype');
	    }
	  });

	  $('#provvis-cc-analysis').spectrum({
	    color: '#2ca02c',
	    showAlpha: true,
	    change: function change(color) {
	      $('#provvis-cc-analysis-hex').text(color.toHexString());
	      switchColorScheme('nodetype');
	    }
	  });

	  $('#provvis-cc-subanalysis').spectrum({
	    color: '#d62728',
	    showAlpha: true,
	    change: function change(color) {
	      $('#provvis-cc-subanalysis-hex').text(color.toHexString());
	      switchColorScheme('nodetype');
	    }
	  });

	  $('#provvis-cc-special').spectrum({
	    color: '#17becf',
	    showAlpha: true,
	    change: function change(color) {
	      $('#provvis-cc-special-hex').text(color.toHexString());
	      switchColorScheme('nodetype');
	    }
	  });

	  $('#provvis-cc-dt').spectrum({
	    color: '#7f7f7f',
	    showAlpha: true,
	    change: function change(color) {
	      $('#provvis-cc-dt-hex').text(color.toHexString());
	      switchColorScheme('nodetype');
	    }
	  });

	  $('#provvis-cc-intermediate').spectrum({
	    color: '#bcbd22',
	    showAlpha: true,
	    change: function change(color) {
	      $('#provvis-cc-intermediate-hex').text(color.toHexString());
	      switchColorScheme('nodetype');
	    }
	  });

	  $('#provvis-cc-stored').spectrum({
	    color: '#8c564b',
	    showAlpha: true,
	    change: function change(color) {
	      $('#provvis-cc-stored-hex').text(color.toHexString());
	      switchColorScheme('nodetype');
	    }
	  });

	  /* On accordion header click. */
	  $('[id^=prov-ctrl-cc-none-]').on('click', function () {
	    switchColorScheme('none');
	  });

	  $('[id^=prov-ctrl-cc-time-]').on('click', function () {
	    switchColorScheme('time');
	  });

	  $('[id^=prov-ctrl-cc-workflow-]').on('click', function () {
	    switchColorScheme('workflow');
	  });

	  $('[id^=prov-ctrl-cc-nodetype-]').on('click', function () {
	    switchColorScheme('nodetype');
	  });

	  /**
	   * Helper function to switch color scheme.
	   * @param checkedColor Color scheme.
	   */
	  function switchColorScheme(checkedColor) {
	    switch (checkedColor) {
	      case 'none':
	        domNodeset.select('.glyph').selectAll('rect, circle').style('fill', '#ffffff');
	        domNodeset.selectAll('.anLabel, .sanLabel, .anwfLabel, ' + '.sanwfLabel, .an-node-type-icon, .san-node-type-icon').style('fill', '#000000');
	        lNode.selectAll('.lnLabel, .wfLabel, .l-node-type-icon').style('fill', '#000000');
	        break;
	      case 'time':
	        lNode.each(function (l) {
	          d3.select('#nodeId-' + l.autoId).select('.glyph').selectAll('rect').style('fill', 'url(#layerGradientId-' + l.autoId + ')');
	        });
	        lNode.selectAll('.lnLabel, .wfLabel, .l-node-type-icon').style('fill', function (l) {
	          var latestDate = d3.min(l.children.values(), function (d) {
	            return d.start;
	          });
	          return timeColorScale(parseISOTimeFormat(latestDate)) < '#888888' ? '#ffffff' : '#000000';
	        });

	        aNode.select('.glyph').selectAll('rect, circle').style('fill', function (d) {
	          return timeColorScale(parseISOTimeFormat(d.start));
	        });
	        aNode.selectAll('.anLabel, .anwfLabel, .an-node-type-icon').style('fill', function (an) {
	          return timeColorScale(parseISOTimeFormat(an.start)) < '#888888' ? '#ffffff' : '#000000';
	        });

	        saNode.select('.glyph').selectAll('rect, circle').style('fill', function (d) {
	          return timeColorScale(parseISOTimeFormat(d.parent.start));
	        });

	        saNode.selectAll('.sanLabel, .sanwfLabel, .san-node-type-icon').style('fill', function (san) {
	          return timeColorScale(parseISOTimeFormat(san.parent.start)) < '#888888' ? '#ffffff' : '#000000';
	        });

	        node.select('.glyph').selectAll('rect, circle').style('fill', function (d) {
	          return timeColorScale(parseISOTimeFormat(d.parent.parent.start));
	        });

	        node.selectAll('.stored-node-type-icon').style('fill', function (n) {
	          return timeColorScale(parseISOTimeFormat(n.parent.parent.start)) < '#888888' ? '#ffffff' : '#000000';
	        });
	        break;
	      case 'workflow':
	        {
	          var _ret9 = function () {
	            var wfc = function wfc(i) {
	              return $('#provvis-cc-wf-hex-' + i).text();
	            };

	            domNodeset.each(function (d) {
	              var cur = d;
	              while (!(cur instanceof Layer)) {
	                cur = cur.parent;
	              }
	              d3.select('#nodeId-' + d.autoId).select('.glyph').selectAll('rect, circle').style('fill', wfc(wfColorData.get(cur.wfCode)));
	            });
	            domNodeset.selectAll('.anLabel, .sanLabel, .anwfLabel, ' + '.sanwfLabel, .an-node-type-icon, .san-node-type-icon').style('fill', '#000000');
	            lNode.selectAll('.lnLabel, .wfLabel, .l-node-type-icon').style('fill', '#000000');
	            return 'break';
	          }();

	          if (_ret9 === 'break') break;
	        }
	      case 'nodetype':
	        {
	          var _ret10 = function () {
	            var nt = function nt(t) {
	              return $('#provvis-cc-' + t + '-hex').text();
	            };

	            domNodeset.each(function (d) {
	              d3.select('#nodeId-' + d.autoId).select('.glyph').selectAll('rect, circle').style('fill', nt(d.nodeType));
	            });
	            domNodeset.selectAll('.anLabel, .sanLabel, .anwfLabel, ' + '.sanwfLabel, .an-node-type-icon, .san-node-type-icon').style('fill', '#000000');
	            lNode.selectAll('.lnLabel, .wfLabel, .l-node-type-icon').style('fill', '#000000');
	            node.selectAll('.stored-node-type-icon').style('fill', '#ffffff');
	            return 'break';
	          }();

	          if (_ret10 === 'break') break;
	        }
	    }
	  }
	}

	/* TODO: Left clicking on href links doesn't trigger the download. */
	/**
	 * Update node info tab on node selection.
	 * @param selNode Selected node.
	 */
	function updateNodeInfoTab(selNode) {
	  var title = ' - ';
	  var titleLink = ' - ';
	  var data = Object.create(null);
	  var nodeDiff = d3.map();
	  var diffNegIns = 0;
	  var diffPosIns = 0;
	  var diffNegSA = 0;
	  var diffPosSA = 0;
	  var diffNegOuts = 0;
	  var diffPosOuts = 0;

	  switch (selNode.nodeType) {
	    case 'raw':
	    case 'special':
	    case 'intermediate':
	    case 'stored':
	      data = vis$1.graph.nodeData.get(selNode.uuid);
	      if (typeof data !== 'undefined') {
	        title = '<i class="fa fa-sitemap rotate-icon-90"></i>&nbsp;' + selNode.fileType;
	        if (data.file_url !== null) {
	          /* TODO: Trigger download without window.open. */
	          titleLink = '<a title="Download linked file" href="' + data.file_url + '" onclick=window.open("' + data.file_url + '")>' + '<i class="fa fa-arrow-circle-o-down"></i>&nbsp;' + data.name + '</a>';
	        } else {
	          titleLink = ' - ';
	        }
	      }
	      break;

	    case 'dt':
	      /* TODO: Add tool_state parameters column. */
	      /* From parent workflow steps attribute, extract step by id.
	       * let steps = vis.graph.workflowData
	       * .get(selNode.parent.wfUuid).steps; */

	      data = vis$1.graph.nodeData.get(selNode.uuid);
	      if (typeof data !== 'undefined') {
	        title = '<i class="fa fa-sitemap rotate-icon-90"></i>&nbsp;' + selNode.fileType;
	        if (data.file_url !== null) {
	          /* TODO: Trigger download without window.open. */
	          titleLink = '<a title="Download linked file" href="' + data.file_url + '" onclick=window.open("' + data.file_url + '")>' + '<i class="fa fa-arrow-circle-o-down"></i>&nbsp;' + data.name + '</a>';
	        }
	      }
	      break;

	    case 'subanalysis':
	      data = vis$1.graph.workflowData.get(selNode.parent.wfUuid);
	      if (typeof data !== 'undefined') {
	        title = '<i class="fa fa-cog"></i>&nbsp; Analysis Group';
	        titleLink = '<a href=/workflows/' + selNode.wfUuid + ' target="_blank">' + selNode.parent.wfName + '</a>';
	      } else {
	        title = '<i class="fa fa-cog"></i>&nbsp; Dataset';
	      }

	      if (selNode.parent.motifDiff.numIns !== 0 || selNode.parent.motifDiff.numOuts !== 0 || selNode.parent.motifDiff.numSubanalyses !== 0) {
	        if (selNode.parent.motifDiff.numIns < 0) {
	          diffNegIns += selNode.parent.motifDiff.numIns;
	        } else {
	          diffPosIns += selNode.parent.motifDiff.numIns;
	        }
	        if (selNode.parent.motifDiff.numSubanalyses < 0) {
	          diffNegSA += selNode.parent.motifDiff.numSubanalyses;
	        } else {
	          diffPosSA += selNode.parent.motifDiff.numSubanalyses;
	        }
	        if (selNode.parent.motifDiff.numOuts < 0) {
	          diffNegOuts += selNode.parent.motifDiff.numOuts;
	        } else {
	          diffPosOuts += selNode.parent.motifDiff.numOuts;
	        }
	      }
	      break;

	    case 'analysis':
	      data = vis$1.graph.analysisData.get(selNode.uuid);
	      if (typeof data !== 'undefined') {
	        title = '<i class="fa fa-cogs"></i>&nbsp; Analysis';
	        titleLink = '<a href=/workflows/' + selNode.wfUuid + ' target="_blank">' + selNode.wfName + '</a>';
	      } else {
	        title = '<i class="fa fa-cogs"></i>&nbsp; Dataset';
	      }
	      if (selNode.motifDiff.numIns !== 0 || selNode.motifDiff.numOuts !== 0 || selNode.motifDiff.numSubanalyses !== 0) {
	        if (selNode.motifDiff.numIns < 0) {
	          diffNegIns += selNode.motifDiff.numIns;
	        } else {
	          diffPosIns += selNode.motifDiff.numIns;
	        }
	        if (selNode.motifDiff.numSubanalyses < 0) {
	          diffNegSA += selNode.motifDiff.numSubanalyses;
	        } else {
	          diffPosSA += selNode.motifDiff.numSubanalyses;
	        }
	        if (selNode.motifDiff.numOuts < 0) {
	          diffNegOuts += selNode.motifDiff.numOuts;
	        } else {
	          diffPosOuts += selNode.motifDiff.numOuts;
	        }
	      }
	      break;

	    case 'layer':
	      data = {
	        aggregation_count: selNode.children.size(),
	        workflow: selNode.wfName,
	        subanalysis_count: selNode.motif.numSubanalyses,
	        wfUuid: selNode.motif.wfUuid
	      };

	      if (typeof data !== 'undefined') {
	        title = '<i class="fa fa-bars"></i>&nbsp; Layer';
	        titleLink = '<a href=/workflows/' + data.wfUuid + ' target="_blank">' + data.workflow + '</a>';
	      }
	      if (selNode.children.values().some(function (an) {
	        return an.motifDiff.numIns !== 0 || an.motifDiff.numOuts !== 0 || an.motifDiff.numSubanalyses !== 0;
	      })) {
	        selNode.children.values().forEach(function (an) {
	          if (an.motifDiff.numIns < 0) {
	            diffNegIns += an.motifDiff.numIns;
	          } else {
	            diffPosIns += an.motifDiff.numIns;
	          }
	          if (an.motifDiff.numSubanalyses < 0) {
	            diffNegSA += an.motifDiff.numSubanalyses;
	          } else {
	            diffPosSA += an.motifDiff.numSubanalyses;
	          }
	          if (an.motifDiff.numOuts < 0) {
	            diffNegOuts += an.motifDiff.numOuts;
	          } else {
	            diffPosOuts += an.motifDiff.numOuts;
	          }
	        });
	      }
	      break;
	  }

	  /* Add diff info to data. */
	  if (diffNegIns !== 0 || diffPosIns !== 0) {
	    nodeDiff.set('Diff: Inputs', diffNegIns + ' ' + diffPosIns);
	  }
	  if (diffNegSA !== 0 || diffPosSA !== 0) {
	    nodeDiff.set('Diff: Subanalyses', diffNegSA + ' ' + diffPosSA);
	  }
	  if (diffNegOuts !== 0 || diffPosOuts !== 0) {
	    nodeDiff.set('Diff: Outputs', diffNegOuts + ' ' + diffPosOuts);
	  }

	  $('#nodeInfoTitle').html(title);
	  $('#nodeInfoTitleLink').html(titleLink);

	  $('#' + 'provenance-nodeInfo-content').html('');
	  nodeDiff.entries().forEach(function (d) {
	    $('<div/>', {
	      class: 'refinery-subheader',
	      html: '<h4>' + d.key + '</h4>'
	    }).appendTo('#' + 'provenance-nodeInfo-content');
	    $('<p/>', {
	      class: 'provvisNodeInfoValue provvisNodeInfoDiff',
	      html: '<i><b>' + d.value + '</b></i>'
	    }).appendTo('#' + 'provenance-nodeInfo-content');
	  });

	  d3.entries(data).forEach(function (d) {
	    $('<div/>', {
	      class: 'refinery-subheader',
	      html: '<h4>' + d.key + '</h4>'
	    }).appendTo('#' + 'provenance-nodeInfo-content');
	    $('<p/>', {
	      class: 'provvisNodeInfoValue',
	      html: '<i>' + d.value + '</i>'
	    }).appendTo('#' + 'provenance-nodeInfo-content');
	  });
	}

	/**
	 * Get workflow name string.
	 * @param n Node of type BaseNode.
	 * @returns {string} The name string.
	 */
	function getWfNameByNode(n) {
	  var wfName = 'dataset';
	  var an = n;
	  while (!(an instanceof Analysis)) {
	    an = an.parent;
	  }
	  if (typeof vis$1.graph.workflowData.get(an.wfUuid) !== 'undefined') {
	    wfName = vis$1.graph.workflowData.get(an.wfUuid).name;
	  }
	  return wfName.toString();
	}

	/**
	 * Adds tooltips to nodes.
	 */
	function handleTooltips() {
	  var _this15 = this;

	  /**
	   * Helper function for tooltip creation.
	   * @param key Property name.
	   * @param value Property value.
	   * @returns {string} Inner html code.
	   */
	  function createHTMLKeyValuePair(key, value) {
	    return '<b>' + key + ': ' + '</b>' + value;
	  }

	  /* Node tooltips. */
	  node.on('mouseover', function (d) {
	    var self = d3.select(_this15);
	    var ttStr = createHTMLKeyValuePair('Name', d.name) + '<br>' + createHTMLKeyValuePair('Type', d.fileType) + '<br>' + createHTMLKeyValuePair('File Url', d.fileUrl) + '<br>' + createHTMLKeyValuePair('UUID', d.uuid) + '<br>';
	    d.attributes.forEach(function (key, value) {
	      ttStr += createHTMLKeyValuePair(key, value) + '<br>';
	    });
	    showTooltip(tooltip, ttStr, event);

	    d.parent.parent.parent.children.values().forEach(function (sibling) {
	      d3.select('#BBoxId-' + sibling.autoId).style('stroke-opacity', 0.3);
	    });
	    d3.select('#BBoxId-' + d.parent.autoId).classed('mouseoverBBox', true);
	    self.select('.labels').attr('clip-path', '');

	    /* Get current node label pixel width. */
	    var attrText = d.label === '' ? d.name : d.label;
	    if (d.nodeType === 'stored') {
	      var selAttrName = '';
	      $('#prov-ctrl-visible-attribute-list > li').each(function () {
	        if ($(_this15).find('input[type=\'radio\']').prop('checked')) {
	          selAttrName = $(_this15).find('label').text();
	        }
	      });
	      attrText = d.attributes.get(selAttrName);
	    }

	    /* Set label text. */
	    self.select('.nodeAttrLabel').text(attrText);

	    d3.selectAll('.node:not(#nodeId-' + d.autoId + ')').selectAll('.nodeAttrLabel').transition().duration(nodeLinkTransitionTime).attr('opacity', 0);
	  }).on('mousemove', function (d) {
	    var ttStr = createHTMLKeyValuePair('Name', d.name) + '<br>' + createHTMLKeyValuePair('Type', d.fileType) + '<br>' + createHTMLKeyValuePair('File Url', d.fileUrl) + '<br>' + createHTMLKeyValuePair('UUID', d.uuid) + '<br>';
	    d.attributes.forEach(function (key, value) {
	      ttStr += createHTMLKeyValuePair(key, value) + '<br>';
	    });
	    d3.select('#BBoxId-' + d.parent.autoId).classed('mouseoverBBox', true);
	    showTooltip(tooltip, ttStr, event);
	  }).on('mouseout', function (d) {
	    var self = d3.select(_this15);
	    hideTooltip(tooltip);

	    d.parent.parent.parent.children.values().forEach(function (sibling) {
	      d3.select('#BBoxId-' + sibling.autoId).style('stroke-opacity', 0.0);
	    });
	    d3.select('#BBoxId-' + d.parent.autoId).classed('mouseoverBBox', false);
	    self.select('.labels').attr('clip-path', 'url(#bbClipId-' + d.autoId + ')');

	    /* Get current node label pixel width. */
	    var maxLabelPixelWidth = (cell.width - 2 * scaleFactor * vis$1.radius) * d3.transform(d3.select('.canvas').select('g').select('g').attr('transform')).scale[0];
	    var attrText = d.label === '' ? d.name : d.label;
	    if (d.nodeType === 'stored') {
	      var selAttrName = '';
	      $('#prov-ctrl-visible-attribute-list > li').each(function () {
	        if ($(_this15).find('input[type=\'radio\']').prop('checked')) {
	          selAttrName = $(_this15).find('label').text();
	        }
	      });
	      attrText = d.attributes.get(selAttrName);
	    }

	    /* Set label text. */
	    if (typeof attrText !== 'undefined') {
	      self.select('.nodeAttrLabel').text(attrText);
	      var trimRatio = parseInt(attrText.length * (maxLabelPixelWidth / self.select('.nodeAttrLabel').node().getComputedTextLength()), 10);
	      if (trimRatio < attrText.length) {
	        self.select('.nodeAttrLabel').text(attrText.substr(0, trimRatio - 3) + '...');
	      }
	    }

	    d3.selectAll('.nodeAttrLabel').transition().duration(nodeLinkTransitionTime).attr('opacity', 1);
	  });

	  /* Subanalysis tooltips. */
	  saNode.on('mouseover', function (d) {
	    var self = d3.select(_this15);
	    self.select('.labels').attr('clip-path', '');
	    d.parent.parent.children.values().forEach(function (sibling) {
	      d3.select('#BBoxId-' + sibling.autoId).style('stroke-opacity', 0.3);
	    });
	  }).on('mouseout', function (d) {
	    var self = d3.select(_this15);
	    self.select('.labels').attr('clip-path', 'url(#bbClipId-' + d.autoId + ')');
	    d.parent.parent.children.values().forEach(function (sibling) {
	      d3.select('#BBoxId-' + sibling.autoId).style('stroke-opacity', 0.0);
	    });
	  });

	  /* Analysis tolltips. */
	  aNode.on('mouseover', function (d) {
	    var self = d3.select(_this15);
	    self.select('.labels').attr('clip-path', '');
	    d.parent.children.values().forEach(function (sibling) {
	      d3.select('#BBoxId-' + sibling.autoId).style('stroke-opacity', 0.3);
	    });
	  }).on('mouseout', function (d) {
	    var self = d3.select(_this15);
	    self.select('.labels').attr('clip-path', 'url(#bbClipId-' + d.autoId + ')');
	    d.parent.children.values().forEach(function (sibling) {
	      d3.select('#BBoxId-' + sibling.autoId).style('stroke-opacity', 0.0);
	    });
	  });

	  /* Layer . */
	  lNode.on('mouseover', function () {
	    var self = d3.select(_this15);
	    self.select('.labels').select('.wfLabel').attr('clip-path', '');
	  }).on('mouseout', function (d) {
	    var self = d3.select(_this15);
	    self.select('.labels').select('.wfLabel').attr('clip-path', 'url(#bbClipId-' + d.autoId + ')');
	  });

	  /* On mouseover subanalysis bounding box. */
	  saBBox.on('mouseover', function (d) {
	    var self = d3.select(_this15);
	    self.classed('mouseoverBBox', true);
	    d.parent.parent.children.values().forEach(function (sibling) {
	      d3.select('#BBoxId-' + sibling.autoId).style('stroke-opacity', 0.3);
	    });
	    self.select('.labels').attr('clip-path', '');
	  }).on('mouseout', function (d) {
	    var self = d3.select(_this15);
	    self.classed('mouseoverBBox', false);
	    d.parent.parent.children.values().forEach(function (sibling) {
	      d3.select('#BBoxId-' + sibling.autoId).style('stroke-opacity', 0.0);
	    });
	    self.select('.labels').attr('clip-path', 'url(#saBBClipId-' + d.autoId + ')');
	  });

	  /* On mouseover analysis bounding box. */
	  aBBox.on('mouseover', function (an) {
	    var self = d3.select(_this15);
	    self.select('.labels').attr('clip-path', '');
	    an.parent.children.values().forEach(function (sibling) {
	      d3.select('#BBoxId-' + sibling.autoId).style('stroke-opacity', 0.3);
	    });
	  }).on('mouseout', function (an) {
	    var self = d3.select(_this15);
	    self.select('.labels').attr('clip-path', 'url(#aBBClipId-' + an.autoId + ')');
	    an.parent.children.values().forEach(function (sibling) {
	      d3.select('#BBoxId-' + sibling.autoId).style('stroke-opacity', 0.0);
	    });
	  });

	  /* On mouseover layer bounding box. */
	  lBBox.on('mouseover', function () {
	    var self = d3.select(_this15);
	    self.select('.labels').attr('clip-path', '');
	  }).on('mouseout', function (ln) {
	    var self = d3.select(_this15);
	    self.select('.labels').attr('clip-path', 'url(#lBBClipId-' + ln.autoId + ')');
	  });

	  /* On mouseover timeline analysis lines. */
	  d3.selectAll('.tlAnalysis').on('mouseover', function (an) {
	    showTooltip(tooltip, createHTMLKeyValuePair('Created', parseISOTimeFormat(an.start)) + '<br>' + createHTMLKeyValuePair('Workflow', getWfNameByNode(an)) + '<br>', event);
	    d3.select('#BBoxId-' + an.autoId).classed('mouseoverTlBBox', true);
	  }).on('mousemove', function (an) {
	    showTooltip(tooltip, createHTMLKeyValuePair('Created', parseISOTimeFormat(an.start)) + '<br>' + createHTMLKeyValuePair('Workflow', getWfNameByNode(an)) + '<br>', event);
	  }).on('mouseout', function (an) {
	    hideTooltip(tooltip);
	    d3.select('#BBoxId-' + an.autoId).classed('mouseoverTlBBox', false);
	  });
	}

	/**
	 * Expand all analsyes into workflow nodes.
	 */
	function showAllWorkflows() {
	  var _this16 = this;

	  /* Set node visibility. */
	  lNode.each(function (ln) {
	    ln.hidden = true;
	  });
	  lNode.classed('hiddenNode', true);
	  aNode.each(function (an) {
	    an.hidden = true;
	  });
	  aNode.classed('hiddenNode', true);
	  saNode.each(function (san) {
	    san.hidden = true;
	  });
	  saNode.classed('hiddenNode', true);
	  node.each(function (n) {
	    n.hidden = false;
	  });
	  node.classed('hiddenNode', false);

	  /* Bounding box visibility. */
	  saBBox.each(function (san) {
	    if (san.filtered && san.children.values().some(function (cn) {
	      return !cn.hidden;
	    })) {
	      d3.select(_this16).classed('hiddenBBox', false);
	    } else {
	      d3.select(_this16).classed('hiddenBBox', true);
	    }
	  });

	  /* Layer exaggeration label control. */
	  aBBox.each(function (an) {
	    if (an.filtered && an.parent.hidden) {
	      d3.select(_this16).classed('hiddenBBox', false);
	      d3.select(_this16).select('text').classed('hiddenLabel', false);
	    }
	  });

	  aNode.each(function (an) {
	    /* Adjust dataset subanalysis coords. */
	    if (an.uuid === 'dataset') {
	      (function () {
	        var yOffset = 0;
	        an.children.values().sort(function (a, b) {
	          return a.y - b.y;
	        }).forEach(function (san) {
	          var wfBBoxCoords = getWFBBoxCoords(san, cell, 0);
	          san.y = yOffset;
	          yOffset += wfBBoxCoords.y.max - wfBBoxCoords.y.min;
	          san.x = 0;
	          /* TODO: May cause problems. Revise! */
	          updateNode(d3.select('#gNodeId-' + san.autoId), san, san.x, san.y);
	        });
	      })();
	    } else {
	      (function () {
	        /* Adjust subanalysis coords. */
	        var wfBBoxCoords = getWFBBoxCoords(an.children.values()[0], cell, 0);
	        an.children.values().sort(function (a, b) {
	          return a.y - b.y;
	        }).forEach(function (san, i) {
	          san.y = i * (wfBBoxCoords.y.max - wfBBoxCoords.y.min);
	          san.x = 0;
	          /* TODO: May cause problems. Revise! */
	          updateNode(d3.select('#gNodeId-' + san.autoId), san, san.x, san.y);
	        });
	      })();
	    }

	    /* Adjust analysis bounding box. */
	    var anBBoxCoords = getABBoxCoords(an, cell, 0);
	    d3.selectAll('#BBoxId-' + an.autoId + ', #aBBClipId-' + an.autoId).selectAll('rect').attr('width', anBBoxCoords.x.max - anBBoxCoords.x.min).attr('height', anBBoxCoords.y.max - anBBoxCoords.y.min);
	    d3.select('#BBoxId-' + an.autoId).classed('hiddenBBox', false);

	    if (!an.filtered) {
	      d3.select('#BBoxId-' + an.autoId).classed('hiddenBBox', true);
	    }
	  });

	  /* Set link visibility. */
	  link.each(function (l) {
	    l.hidden = false;
	  });
	  link.classed('hiddenLink', false);

	  link.each(function (l) {
	    if (l.filtered) {
	      l.hidden = false;
	      if (l.highlighted) {
	        d3.select('#hLinkId-' + l.autoId).classed('hiddenLink', false);
	      }
	    } else {
	      if (filterAction === 'hide') {
	        l.hidden = true;
	        d3.select('#hLinkId-' + l.autoId).classed('hiddenLink', true);
	      } else {
	        l.hidden = false;
	        if (l.highlighted) {
	          d3.select('#hLinkId-' + l.autoId).classed('hiddenLink', false);
	        }
	      }
	    }
	  });

	  lLink.each(function (l) {
	    l.hidden = true;
	  });
	  lLink.classed('hiddenLink', true);
	}

	/**
	 * Collapse all analyses into single subanalysis nodes.
	 */
	function showAllSubanalyses() {
	  /* Set node visibility. */
	  lNode.each(function (ln) {
	    ln.hidden = true;
	  });
	  lNode.classed('hiddenNode', true);
	  aNode.each(function (an) {
	    an.hidden = true;
	  });
	  aNode.classed('hiddenNode', true);
	  saNode.each(function (san) {
	    san.hidden = false;
	  });
	  saNode.classed('hiddenNode', false);
	  node.each(function (n) {
	    n.hidden = true;
	  });
	  node.classed('hiddenNode', true);

	  /* Bounding box visibility. */
	  saBBox.classed('hiddenBBox', true);

	  aNode.each(function (an) {
	    /* Adjust subanalysis coords. */
	    an.children.values().sort(function (a, b) {
	      return a.y - b.y;
	    }).forEach(function (san, i) {
	      san.y = i * vis$1.cell.height;
	      san.x = 0;
	      updateNode(d3.select('#gNodeId-' + san.autoId), san, san.x, san.y);
	    });

	    /* Adjust analysis bounding box. */
	    var anBBoxCoords = getABBoxCoords(an, cell, 0);
	    d3.selectAll('#BBoxId-' + an.autoId + ', #aBBClipId-' + an.autoId).selectAll('rect').attr('width', vis$1.cell.width).attr('height', anBBoxCoords.y.max - anBBoxCoords.y.min);
	    d3.select('#BBoxId-' + an.autoId).classed('hiddenBBox', false);

	    if (!an.filtered) {
	      d3.select('#BBoxId-' + an.autoId).classed('hiddenBBox', true);
	    }
	  });

	  /* Link visibility. */
	  aNode.each(function (an) {
	    an.links.values().forEach(function (l) {
	      d3.selectAll('#linkId-' + l.autoId + ', #hLinkId-' + l.autoId).classed('hiddenLink', true);
	      l.hidden = true;
	    });
	    an.inputs.values().forEach(function (ain) {
	      ain.predLinks.values().forEach(function (l) {
	        d3.select('#linkId-' + l.autoId).classed('hiddenLink', false);
	        l.hidden = false;
	      });
	    });
	  });

	  lLink.each(function (l) {
	    l.hidden = true;
	  });
	  lLink.classed('hiddenLink', true);
	}

	/**
	 * Collapse all analyses into single analysis nodes.
	 */
	function showAllAnalyses() {
	  /* Node visibility. */
	  lNode.each(function (ln) {
	    ln.hidden = true;
	  });
	  lNode.classed('hiddenNode', true);

	  aNode.each(function (an) {
	    an.hidden = false;
	    hideChildNodes(an);

	    /* Filtered visibility. */
	    if (an.filtered) {
	      d3.select('#BBoxId-' + an.autoId).classed('hiddenBBox', false);
	    }

	    /* Bounding box size. */
	    d3.selectAll('#BBoxId-' + an.autoId + ', #aBBClipId-' + an.autoId).select('rect').attr('width', vis$1.cell.width).attr('height', vis$1.cell.height);

	    /* Adjust subanalysis coords. */
	    an.children.values().sort(function (a, b) {
	      return a.y - b.y;
	    }).forEach(function (san, i) {
	      san.y = i * vis$1.cell.height;
	      san.x = 0;
	      updateNode(d3.select('#gNodeId-' + san.autoId), san, san.x, san.y);
	    });
	  });
	  aNode.classed('hiddenNode', false);

	  /* Bounding box visibility. */
	  saBBox.classed('hiddenBBox', true);

	  /* Link visibility. */
	  aNode.each(function (an) {
	    an.links.values().forEach(function (l) {
	      d3.selectAll('#linkId-' + l.autoId + ', #hLinkId-' + l.autoId).classed('hiddenLink', true);
	      l.hidden = true;
	    });
	    an.inputs.values().forEach(function (ain) {
	      ain.predLinks.values().forEach(function (l) {
	        d3.select('#linkId-' + l.autoId).classed('hiddenLink', false);
	        l.hidden = false;
	      });
	    });
	  });

	  lLink.each(function (l) {
	    l.hidden = true;
	  });
	  lLink.classed('hiddenLink', true);
	}

	/**
	 * Collapse all nodes into single layer nodes.
	 */
	function showAllLayers() {
	  var _this17 = this;

	  /* Node visibility. */
	  lNode.each(function (ln) {
	    ln.hidden = false;
	    hideChildNodes(ln);

	    /* Layer exaggeration reset. */
	    ln.children.values().forEach(function (an) {
	      an.exaggerated = false;
	    });

	    /* Filtered visibility. */
	    if (ln.filtered) {
	      d3.select('BBoxId-' + ln.autoId).classed('hiddenBBox', false);
	    }
	  });
	  lNode.classed('hiddenNode', false);

	  /* Bounding box visibility. */
	  saBBox.classed('hiddenBBox', true);
	  aBBox.classed('hiddenBBox', true);

	  /* Link visibility. */
	  aNode.each(function (an) {
	    an.links.values().forEach(function (l) {
	      d3.selectAll('#linkId-' + l.autoId + ', #hLinkId-' + l.autoId).classed('hiddenLink', true);
	      l.hidden = true;
	    });

	    /* Adjust subanalysis coords. */
	    an.children.values().sort(function (a, b) {
	      return a.y - b.y;
	    }).forEach(function (san, i) {
	      san.y = i * vis$1.cell.height;
	      san.x = 0;
	      updateNode(d3.select('#gNodeId-' + san.autoId), san, san.x, san.y);
	    });
	  });

	  aLink.each(function (l) {
	    l.hidden = true;
	  });
	  aLink.classed('hiddenLink', true);

	  lLink.each(function (l) {
	    l.hidden = false;
	  });
	  lLink.classed('hiddenLink', false);

	  /* Show highlighted alinks. */
	  d3.select('.aHLinks').selectAll('.hLink').each(function (l) {
	    if (l.highlighted) {
	      l.hidden = false;
	      d3.select(_this17).classed('hiddenLink', false);
	    }
	  });
	}

	/**
	 * Handle interaction controls.
	 * @param graph Provenance graph object.
	 */
	function handleToolbar(graph) {
	  var _this18 = this;

	  $('#prov-ctrl-layers-click').click(function () {
	    showAllLayers();
	    dagreDynamicLayerLayout(graph);
	    if (fitToWindow) {
	      fitGraphToWindow(nodeLinkTransitionTime);
	    }
	  });

	  $('#prov-ctrl-analyses-click').click(function () {
	    showAllAnalyses();
	    dagreDynamicLayerLayout(graph);
	    if (fitToWindow) {
	      fitGraphToWindow(nodeLinkTransitionTime);
	    }
	  });

	  $('#prov-ctrl-subanalyses-click').click(function () {
	    showAllSubanalyses();
	    dagreDynamicLayerLayout(graph);
	    if (fitToWindow) {
	      fitGraphToWindow(nodeLinkTransitionTime);
	    }
	  });

	  $('#prov-ctrl-workflows-click').click(function () {
	    showAllWorkflows();
	    dagreDynamicLayerLayout(graph);
	    if (fitToWindow) {
	      fitGraphToWindow(nodeLinkTransitionTime);
	    }
	  });

	  /* Switch filter action. */
	  $('#prov-ctrl-filter-action > label').click(function () {
	    filterAction = $(_this18).find('input[type=\'radio\']').prop('value');
	    if (filterMethod === 'timeline') {
	      filterAnalysesByTime(d3.select('.startTimeline').data()[0].time, d3.select('.endTimeline').data()[0].time, vis$1);
	    } else {
	      runRenderUpdatePrivate(vis$1, lastSolrResponse);
	    }
	  });

	  /* Choose visible node attribute. */
	  $('[id^=prov-ctrl-visible-attribute-list-]').click(function () {
	    /* Set and get chosen attribute as active. */
	    $(_this18).find('input[type=\'radio\']').prop('checked', true);
	    var selAttrName = $(_this18).find('label').text();

	    /* On click, set current to active and unselect others. */
	    $('#prov-ctrl-visible-attribute-list > li').each(function (idx, li) {
	      var item = $(li);
	      if (item[0].id !== 'prov-ctrl-visible-attribute-list-' + selAttrName) {
	        item.find('input[type=\'radio\']').prop('checked', false);
	      }
	    });

	    /* Change attribute label on every node. */
	    graph.nodes.filter(function (d) {
	      return d.nodeType === 'stored';
	    }).forEach(function (n) {
	      var self = d3.select('#nodeId-' + n.autoId);

	      var maxLabelPixelWidth = (cell.width - 2 * scaleFactor * vis$1.radius) * d3.transform(d3.select('.canvas').select('g').select('g').attr('transform')).scale[0];
	      var attrText = n.name;
	      if (n.nodeType === 'stored') {
	        var selAttrNamee = '';
	        $('#prov-ctrl-visible-attribute-list > li').each(function () {
	          if ($(_this18).find('input[type=\'radio\']').prop('checked')) {
	            selAttrNamee = $(_this18).find('label').text();
	          }
	        });
	        attrText = n.attributes.get(selAttrNamee);
	      }

	      /* Set label text. */
	      if (typeof attrText !== 'undefined') {
	        self.select('.nodeAttrLabel').text(attrText);
	        var trimRatio = parseInt(attrText.length * (maxLabelPixelWidth / self.select('.nodeAttrLabel').node().getComputedTextLength()), 10);
	        if (trimRatio < attrText.length) {
	          self.select('.nodeAttrLabel').text(attrText.substr(0, trimRatio - 3) + '...');
	        }
	      }
	    });
	  });

	  /* Switch sidebar on or off. */
	  $('#prov-ctrl-toggle-sidebar').click(function () {
	    if (!$('#prov-ctrl-toggle-sidebar')[0].checked) {
	      $('#provenance-sidebar').animate({
	        left: '-355'
	      }, nodeLinkTransitionTime);
	    } else {
	      $('#provenance-sidebar').animate({
	        left: '20'
	      }, nodeLinkTransitionTime);

	      /* TODO: Temporary fix for sidbear div. */
	      $('#provvis-sidebar-content').css('height', vis$1.canvas.height);
	    }
	  });

	  /* Switch fit to screen on or off. */
	  $('#prov-ctrl-toggle-fit').click(function () {
	    if (!$('#prov-ctrl-toggle-fit')[0].checked) {
	      fitToWindow = false;
	    } else {
	      fitToWindow = true;
	    }
	  });
	}

	/* TODO: Recompute layout only after all nodes were collapsed/expanded. */

	/**
	 * Handle events.
	 * @param graph Provenance graph object.
	 */
	function handleEvents(graph) {
	  handleToolbar(graph);

	  /* Handle click separation on nodes. */
	  var domNodesetClickTimeout = void 0;
	  domNodeset.on('mousedown', function (d) {
	    if (d3.event.defaultPrevented) {
	      return;
	    }
	    clearTimeout(domNodesetClickTimeout);

	    /* Click event is executed after 100ms unless the double click event
	     below clears the click event timeout.*/
	    domNodesetClickTimeout = setTimeout(function () {
	      if (!draggingActive) {
	        handleNodeSelection(d);
	        updateNodeInfoTab(d);
	      }
	    }, 200);
	  });

	  domNodeset.on('dblclick', function (d) {
	    if (d3.event.defaultPrevented) {
	      return;
	    }
	    clearTimeout(domNodesetClickTimeout);

	    /* Double click event is executed when this event is triggered before
	     the click timeout has finished. */
	    handleCollapseExpandNode(d, 'e');
	  });

	  /* Handle click separation on other dom elements. */
	  var bRectClickTimeout = void 0;
	  d3.selectAll('.brect, .link, .hLink, .vLine, .hLine', '.cell').on('click', function () {
	    if (d3.event.defaultPrevented) {
	      return;
	    }
	    clearTimeout(bRectClickTimeout);

	    /* Click event is executed after 100ms unless the double click event
	     below clears the click event timeout.*/
	    bRectClickTimeout = setTimeout(function () {
	      clearHighlighting(graph.links);
	      clearNodeSelection();

	      /* TODO: Temporarily enabled. */
	      if (doiAutoUpdate) {
	        recomputeDOI();
	      }
	    }, 200);
	  });

	  d3.selectAll('.brect, .link, .hLink, .vLine, .hLine, .cell').on('dblclick', function () {
	    if (d3.event.defaultPrevented) {
	      return;
	    }
	    clearTimeout(bRectClickTimeout);

	    /* Double click event is executed when this event is triggered
	     before the click timeout has finished. */
	    fitGraphToWindow(1000);
	  });

	  /* Handle tooltips. */
	  handleTooltips();
	  /* TODO: Currently disabled. */
	  // handleDebugTooltips();

	  /* Collapse on bounding box click.*/
	  saBBox.on('click', function (d) {
	    if (!draggingActive) {
	      handleCollapseExpandNode(d.children.values()[0], 'c');

	      /* TODO: Temporarily disabled. */
	      /* Deselect. */
	      // clearNodeSelection();

	      /* Update node doi. */
	      // updateNodeDoi();
	    }
	  });

	  /* Collapse on bounding box click.*/
	  var aBBoxClickTimeout = void 0;
	  aBBox.on('click', function (d) {
	    if (d3.event.defaultPrevented) {
	      return;
	    }
	    clearTimeout(aBBoxClickTimeout);

	    aBBoxClickTimeout = setTimeout(function () {
	      if (!draggingActive) {
	        if (d.hidden) {
	          if (d.children.values().some(function (san) {
	            return san.hidden;
	          })) {
	            d.children.values().forEach(function (san) {
	              handleCollapseExpandNode(san.children.values()[0], 'c');
	            });
	          } else {
	            handleCollapseExpandNode(d.children.values()[0], 'c');
	          }
	        } else {
	          handleCollapseExpandNode(d, 'c');
	        }
	      }
	    }, 200);
	  });

	  aBBox.on('dblclick', function (d) {
	    if (d3.event.defaultPrevented) {
	      return;
	    }
	    clearTimeout(aBBoxClickTimeout);

	    if (!draggingActive) {
	      d.children.values().forEach(function (san) {
	        handleCollapseExpandNode(san.children.values()[0], 'c');
	      });
	      handleCollapseExpandNode(d.children.values()[0], 'c');
	      handleCollapseExpandNode(d, 'c');
	    }
	  });

	  /* Collapse to layer node. */
	  lBBox.on('click', function (d) {
	    if (d3.event.defaultPrevented) {
	      return;
	    }

	    if (!draggingActive) {
	      d.children.values().forEach(function (an) {
	        an.children.values().forEach(function (san) {
	          handleCollapseExpandNode(san.children.values()[0], 'c');
	        });
	        handleCollapseExpandNode(an.children.values()[0], 'c');
	      });
	      handleCollapseExpandNode(d.children.values()[0], 'c');

	      /* TODO: Temporarily disabled. */
	      /* Deselect. */
	      // clearNodeSelection();
	      /* Update node doi. */
	      // updateNodeDoi();
	    }
	  });

	  /* Handle path highlighting. */
	  d3.selectAll('.glAnchor').on('click', function (d) {
	    handlePathHighlighting(d, 'p');
	  }).on('mousedown', d3.event.stopPropagation);

	  d3.selectAll('.grAnchor').on('click', function (d) {
	    handlePathHighlighting(d, 's');
	  }).on('mousedown', d3.event.stopPropagation);
	}

	/**
	 * Compute doi weight based on the motif diff.
	 * @param lNodes Layer nodes.
	 * @param aNodes Analysis nodes.
	 */
	function initDoiLayerDiffComponent(lNodes, aNodes) {
	  var doiDiffMin = 0;
	  var doiDiffMax = d3.max(aNodes, function (an) {
	    return d3.max([Math.abs(an.motifDiff.numIns), Math.abs(an.motifDiff.numSubanalyses), Math.abs(an.motifDiff.numOuts)], function (d) {
	      return d;
	    });
	  });

	  doiDiffScale = d3.scale.linear().domain([doiDiffMin, doiDiffMax]).range([0.0, 1.0]);

	  /* Init analysis nodes with a factor in relation to the highes diff in
	   the whole graph. */
	  aNodes.forEach(function (an) {
	    an.doi.initLayerDiffComponent(doiDiffScale(Math.abs(an.motifDiff.numIns) + Math.abs(an.motifDiff.numOuts) + Math.abs(an.motifDiff.numSubanalyses)));
	    an.children.values().forEach(function (san) {
	      san.doi.initLayerDiffComponent(an.doi.doiLayerDiff);
	      san.children.values().forEach(function (cn) {
	        cn.doi.initLayerDiffComponent(an.doi.doiLayerDiff);
	      });
	    });
	  });

	  /* Init layer nodes with max value from child nodes. */
	  lNodes.values().forEach(function (ln) {
	    var anMax = d3.max(ln.children.values(), function (an) {
	      return an.doi.doiLayerDiff;
	    });
	    ln.doi.initLayerDiffComponent(anMax);
	  });
	}

	/**
	 * Main render module function.
	 * @param provVis The provenance visualization root object.
	 */
	function runRenderPrivate(provVis) {
	  /* Save vis object to module scope. */
	  vis$1 = provVis;
	  cell = provVis.cell;

	  lNodesBAK = vis$1.graph.lNodes;
	  aNodesBAK = vis$1.graph.aNodes;
	  saNodesBAK = vis$1.graph.saNodes;
	  nodesBAK = vis$1.graph.nodes;
	  lLinksBAK = vis$1.graph.lLinks;
	  aLinksBAK = vis$1.graph.aLinks;

	  // width = vis.graph.l.width;
	  // depth = vis.graph.l.depth;

	  timeColorScale = createAnalysistimeColorScale(vis$1.graph.aNodes, ['white', 'black']);
	  initDoiTimeComponent(vis$1.graph.aNodes, vis$1);

	  /* Init all nodes filtered. */
	  initDoiFilterComponent(vis$1.graph.lNodes);
	  filterAction = 'blend';

	  /* Init all nodes with the motif diff. */
	  initDoiLayerDiffComponent(vis$1.graph.lNodes, vis$1.graph.aNodes);

	  /* Draw analysis links. */
	  vis$1.canvas.append('g').classed('aHLinks', true);
	  vis$1.canvas.append('g').classed('aLinks', true);
	  updateAnalysisLinks(vis$1.graph);

	  /* Draw layer nodes and links. */
	  dagreLayerLayout(vis$1.graph, vis$1.cell, updateNodeAndLink);
	  vis$1.canvas.append('g').classed('lLinks', true);
	  vis$1.canvas.append('g').classed('layers', true);
	  updateLayerLinks(vis$1.graph.lLinks);
	  updateLayerNodes(vis$1.graph.lNodes);

	  /* Draw analysis nodes. */
	  vis$1.canvas.append('g').classed('analyses', true);
	  updateAnalysisNodes();

	  /* Draw subanalysis nodes. */
	  drawSubanalysisNodes();

	  /* Draw nodes. */
	  drawNodes();

	  /* Concat aNode, saNode and node. */
	  domNodeset = concatDomClassElements(['lNode', 'aNode', 'saNode', 'node']);

	  /* Add dragging behavior to nodes. */
	  applyDragBehavior(layer, dragStart, dragging, dragEnd);
	  applyDragBehavior(analysis, dragStart, dragging, dragEnd);

	  /* Initiate doi. */
	  vis$1.graph.aNodes.forEach(function (an) {
	    handleCollapseExpandNode(an, 'c', 'auto');
	  });
	  updateNodeFilter();
	  updateLinkFilter();
	  updateNodeDoi();

	  /* Draw timeline view. */
	  drawTimelineView(vis$1);

	  /* Draw doi view. */
	  drawDoiView();

	  /* Draw colorcoding view. */
	  drawColorcodingView();

	  /* Event listeners. */
	  handleEvents(vis$1.graph);

	  /* Set initial graph position. */
	  fitGraphToWindow(0);
	}

	/**
	 * On attribute filter change, the provenance visualization will be updated.
	 * @param vis The provenance visualization root object.
	 * @param solrResponse Query response object holding information about
	 * attribute filter changed.
	 */
	function runRenderUpdatePrivate(_vis_, solrResponse) {
	  var selNodes = [];

	  filterMethod = 'facet';

	  if (solrResponse instanceof SolrResponse) {
	    _vis_.graph.lNodes = lNodesBAK;
	    _vis_.graph.aNodes = aNodesBAK;
	    _vis_.graph.saNodes = saNodesBAK;
	    _vis_.graph.nodes = nodesBAK;
	    _vis_.graph.aLinks = aLinksBAK;
	    _vis_.graph.lLinks = lLinksBAK;

	    /* Copy filtered nodes. */
	    solrResponse.getDocumentList().forEach(function (d) {
	      selNodes.push(_vis_.graph.nodeMap.get(d.uuid));
	    });

	    /* Update subanalysis and workflow filter attributes. */
	    _vis_.graph.nodes.forEach(function (n) {
	      if (selNodes.map(function (d) {
	        return d.parent;
	      }).indexOf(n.parent) === -1) {
	        n.parent.children.values().forEach(function (cn) {
	          cn.filtered = false;
	        });
	        n.parent.filtered = false;
	        n.parent.links.values().forEach(function (l) {
	          l.filtered = false;
	        });
	      } else {
	        (function () {
	          /* Filter pred path. */
	          var filterPredPath = function filterPredPath(curN) {
	            curN.filtered = true;
	            curN.predLinks.values().forEach(function (l) {
	              l.filtered = true;
	              if (l.source.parent === curN.parent) {
	                filterPredPath(l.source);
	              }
	            });
	          };
	          filterPredPath(n);

	          n.parent.filtered = true;
	          n.parent.links.values().forEach(function (l) {
	            l.filtered = true;
	          });
	        })();
	      }

	      /* Filtered attribute changed. */
	      n.parent.children.values().forEach(function (cn) {
	        cn.doi.filteredChanged();
	      });
	      n.parent.doi.filteredChanged();
	    });

	    /* Update analysis filter attributes. */
	    _vis_.graph.aNodes.forEach(function (an) {
	      if (an.children.values().some(function (san) {
	        return san.filtered;
	      })) {
	        an.filtered = true;
	      } else {
	        an.filtered = false;
	      }
	      an.doi.filteredChanged();
	    });

	    /* Update layer filter attributes. */
	    _vis_.graph.lNodes.values().forEach(function (ln) {
	      if (ln.children.values().some(function (an) {
	        return an.filtered;
	      })) {
	        ln.filtered = true;
	      } else {
	        ln.filtered = false;
	      }
	      ln.doi.filteredChanged();
	    });

	    /* Update analysis link filter attributes. */
	    _vis_.graph.aLinks.forEach(function (al) {
	      al.filtered = false;
	    });
	    _vis_.graph.aLinks.filter(function (al) {
	      return al.source.parent.parent.filtered && al.target.parent.parent.filtered;
	    }).forEach(function (al) {
	      al.filtered = true;
	    });

	    _vis_.graph.lLinks.values().forEach(function (ll) {
	      ll.filtered = false;
	    });

	    _vis_.graph.lLinks.values().filter(function (ll) {
	      return ll.source.filtered && ll.target.filtered;
	    }).forEach(function (ll) {
	      ll.filtered = true;
	    });

	    /* On filter action 'hide', splice and recompute graph. */
	    if (filterAction === 'hide') {
	      (function () {
	        /* Update filtered nodesets. */
	        var cpyLNodes = d3.map();
	        _vis_.graph.lNodes.entries().forEach(function (ln) {
	          if (ln.value.filtered) {
	            cpyLNodes.set(ln.key, ln.value);
	          }
	        });
	        _vis_.graph.lNodes = cpyLNodes;
	        _vis_.graph.aNodes = _vis_.graph.aNodes.filter(function (an) {
	          return an.filtered;
	        });
	        _vis_.graph.saNodes = _vis_.graph.saNodes.filter(function (san) {
	          return san.filtered;
	        });
	        _vis_.graph.nodes = _vis_.graph.nodes.filter(function (n) {
	          return n.filtered;
	        });

	        /* Update filtered linksets. */
	        _vis_.graph.aLinks = _vis_.graph.aLinks.filter(function (al) {
	          return al.filtered;
	        });

	        /* Update layer links. */
	        var cpyLLinks = d3.map();
	        _vis_.graph.lLinks.entries().forEach(function (ll) {
	          if (ll.value.filtered) {
	            cpyLLinks.set(ll.key, ll.value);
	          }
	        });
	        _vis_.graph.lLinks = cpyLLinks;
	      })();
	    }

	    dagreDynamicLayerLayout(_vis_.graph);
	    if (fitToWindow) {
	      fitGraphToWindow(nodeLinkTransitionTime);
	    }

	    updateNodeFilter();
	    updateLinkFilter();
	    updateAnalysisLinks(_vis_.graph);
	    updateLayerLinks(_vis_.graph.lLinks);

	    _vis_.graph.aNodes.forEach(function (an) {
	      updateLink(an);
	    });
	    _vis_.graph.lNodes.values().forEach(function (ln) {
	      updateLink(ln);
	    });

	    /* TODO: Currently enabled. */
	    if (doiAutoUpdate) {
	      recomputeDOI();
	    }
	  }
	  lastSolrResponse = solrResponse;
	}

	/**
	 * Publish module function.
	 */
	function run$4(_vis_) {
	  runRenderPrivate(_vis_);
	}

	function update$1(_vis_, solrResponse) {
	  runRenderUpdatePrivate(_vis_, solrResponse);
	}

	/**
	 * The refinery provenance graph visualization.
	 *
	 * @author sluger Stefan Luger https://github.com/sluger
	 * @exports runProvVis The published function to run the visualization.
	 */

	var vis = Object.create(null);

	/* TODO: Rewrite in angular template. */
	/**
	 * Timeline view only showing analysis within a time-gradient background.
	 * @param divId Div id.
	 */
	function createTimelineView(divId) {
	  /* New timeline view content. */
	  var timelineContainer = d3.select('#' + divId);

	  $('<p/>', {
	    id: 'tlTitle',
	    html: 'Analysis Timeline'
	  }).appendTo(timelineContainer);

	  $('<p/>', {
	    id: 'tlThresholdStart',
	    class: 'tlThreshold'
	  }).appendTo(timelineContainer);

	  $('<p/>', {
	    id: 'tlCanvas'
	  }).appendTo(timelineContainer);

	  d3.select('#tlCanvas').append('svg').attr('height', 80).attr('width', 275).style({
	    'margin-top': '0px',
	    'margin-bottom': '0px',
	    padding: '0px'
	  }).attr('pointer-events', 'all');

	  $('<p/>', {
	    id: 'tlThresholdEnd',
	    class: 'tlThreshold'
	  }).appendTo(timelineContainer);
	}

	/* TODO: Rewrite in angular template. */
	/**
	 * DOI view.
	 * @param divId Div id.
	 */
	function createDOIView(divId) {
	  /* New DOI view content. */
	  var doiContainer = d3.select('#' + divId);

	  $('<p/>', {
	    id: 'doiTitle',
	    html: 'Degree-Of-Interest'
	  }).appendTo(doiContainer);

	  $('<div/>', {
	    id: 'doiVis',
	    style: 'width: 100%; height: 300px;'
	  }).appendTo(doiContainer);

	  $('<div/>', {
	    id: 'doiCanvas',
	    style: 'width: 70px; float: left;'
	  }).appendTo('#doiVis');

	  d3.select('#doiCanvas').append('svg').attr('height', 300).attr('width', 100).style({
	    'margin-top': '0px',
	    'margin-left': '0px',
	    padding: '0px'
	  }).attr('pointer-events', 'all').append('g').append('g').attr('transform', 'translate(0,0)').append('g');

	  $('<button/>', {
	    id: 'prov-doi-view-apply',
	    class: 'btn btn-primary',
	    type: 'button',
	    html: 'Apply',
	    style: 'position: absolute; left: 0px; top: 340px;'
	  }).appendTo(doiContainer);

	  $('<label/>', {
	    id: 'prov-doi-trigger',
	    class: 'prov-doi-view-show-checkbox',
	    style: 'display: flex; position: absolute; left: 75px; top: 340px; ' + 'margin-top: 5px;',
	    html: '<input id="prov-doi-view-trigger-input" type="checkbox" ' + 'style="margin-right: 3px;">Auto Update'
	  }).appendTo(doiContainer);

	  $('<label/>', {
	    id: 'prov-doi-view-show',
	    class: 'prov-doi-view-show-checkbox',
	    style: 'display: flex; position: absolute; left: 180px; top: 340px; ' + 'margin-top: 5px;',
	    html: '<input id="prov-doi-view-show-input" type="checkbox" ' + 'style="margin-right: 3px;">Show DOI'
	  }).appendTo(doiContainer);
	}

	/**
	 * Layer reload view.
	 * @param divId Div id.
	 */
	function createChangeLayersView(divId) {
	  /* New DOI view content. */
	  var layerContainer = d3.select('#' + divId);

	  $('<p/>', {
	    id: 'changeLayerTitle',
	    html: 'Change Layering'
	  }).appendTo(layerContainer);

	  $('<div/>', {
	    id: 'prov-layering-method',
	    class: 'btn-group',
	    'data-toggle': 'buttons-radio'
	  }).appendTo(layerContainer);

	  $('<button/>', {
	    id: 'prov-layering-strict',
	    class: 'btn btn-primary',
	    type: 'button',
	    value: 'strict',
	    html: 'Hard'
	  }).appendTo('#prov-layering-method');

	  $('<button/>', {
	    id: 'prov-layering-weak',
	    class: 'active btn btn-primary',
	    type: 'button',
	    value: 'weak',
	    html: 'Soft'
	  }).appendTo('#prov-layering-method');
	}

	/**
	 * Display a spinning loader icon div while the provenance
	 * visualization is loading.
	 */
	function showProvvisLoaderIcon() {
	  $('#provvis-loader').css('display', 'inline-block');
	}

	/**+
	 * Hide the loader icon again.
	 */
	function hideProvvisLoaderIcon() {
	  $('#provvis-loader').css('display', 'none');
	}

	/**
	 * Refinery injection for the provenance visualization.
	 * @param studyUuid The serialized unique identifier referencing a study.
	 * @param studyAnalyses Analyses objects from the refinery scope.
	 * @param solrResponse Facet filter information on node attributes.
	 */
	function runProvVisPrivate(studyUuid, studyAnalyses, solrResponse) {
	  showProvvisLoaderIcon();

	  /* Only allow one instance of ProvVis. */
	  if (vis instanceof ProvVis === false) {
	    (function () {
	      var url = '/api/v1/node?study__uuid=' + studyUuid + '&format=json&limit=0';
	      var analysesData = studyAnalyses.filter(function (a) {
	        return a.status === 'SUCCESS';
	      });

	      /* Parse json. */
	      d3.json(url, function (error, data) {
	        /* Declare d3 specific properties. */
	        var zoom = Object.create(null);
	        var canvas = Object.create(null);
	        var rect = Object.create(null);

	        /* Initialize margin conventions */
	        var margin = {
	          top: 20,
	          right: 10,
	          bottom: 20,
	          left: 10
	        };

	        /* Set drawing constants. */
	        var r = 7;
	        var color = d3.scale.category20();

	        /* Declare graph. */
	        var graph = Object.create(null);

	        /* Timeline view div. */
	        createTimelineView('provenance-timeline-view');

	        /* DOI view div. */
	        createDOIView('provenance-doi-view');

	        /* Layer view div. */
	        createChangeLayersView('provenance-layer-change-view');

	        /* Init node cell dimensions. */
	        var cell = {
	          width: r * 5,
	          height: r * 3
	        };

	        /* Initialize canvas dimensions. */
	        var width = $('div#provenance-visualization').width() - 10;
	        var height = $('div#solr-table-view').height() - 25;

	        /* TODO: Temp fix for sidebar height. */
	        $('#provenance-sidebar').css('height', height);
	        /* TODO: Temp fix for sidebar max height. */
	        $('#provvis-sidebar-content').css('max-height', height - 13);

	        var scaleFactor = 0.75;

	        var layerMethod = 'weak';
	        /* weak | strict */

	        /* Create vis and add graph. */
	        vis = new ProvVis('provenance-visualization', zoom, data, url, canvas, rect, margin, width, height, r, color, graph, cell, layerMethod);

	        /* Geometric zoom. */
	        var redraw = function redraw() {
	          /* Translation and scaling. */
	          vis.canvas.attr('transform', 'translate(' + d3.event.translate + ')' + ' scale(' + d3.event.scale + ')');

	          /* Semantic zoom. */
	          if (d3.event.scale < 1) {
	            d3.selectAll('.BBox').classed('hiddenNode', true);
	            d3.selectAll('.lDiff, .aDiff').classed('hiddenNode', true);
	          } else {
	            d3.selectAll('.BBox').classed('hiddenNode', false);
	            d3.selectAll('.lDiff, .aDiff').classed('hiddenNode', false);
	          }

	          if (d3.event.scale < 1.7) {
	            vis.canvas.selectAll('.anLabel, .sanLabel, .lnLabel, ' + '.nodeAttrLabel, .stored-node-type-icon, .an-node-type-icon, ' + '.san-node-type-icon, .l-node-type-icon, .lBBoxLabel, ' + '.aBBoxLabel, .nodeDoiLabel').classed('hiddenLabel', true);
	            d3.selectAll('.glAnchor, .grAnchor').classed('hiddenNode', true);
	          } else {
	            vis.canvas.selectAll('.anLabel, .sanLabel, .lnLabel, ' + '.nodeAttrLabel, .stored-node-type-icon, .an-node-type-icon, ' + '.san-node-type-icon, .l-node-type-icon, .lBBoxLabel, ' + '.aBBoxLabel, .nodeDoiLabel').classed('hiddenLabel', false);
	            d3.selectAll('.glAnchor, .grAnchor').classed('hiddenNode', false);
	          }

	          /* Fix for rectangle getting translated too - doesn't work after
	           * window resize.
	           */
	          vis.rect.attr('transform', 'translate(' + -(d3.event.translate[0] + vis.margin.left) / d3.event.scale + ',' + -(d3.event.translate[1] + vis.margin.top) / d3.event.scale + ')' + ' scale(' + +1 / d3.event.scale + ')');

	          /* Fix to exclude zoom scale from text labels. */
	          vis.canvas.selectAll('.lBBoxLabel').attr('transform', 'translate(' + 1 * scaleFactor * vis.radius + ',' + 0.5 * scaleFactor * vis.radius + ')' + 'scale(' + +1 / d3.event.scale + ')');

	          vis.canvas.selectAll('.aBBoxLabel').attr('transform', 'translate(' + 1 * scaleFactor * vis.radius + ',' + 0 * scaleFactor * vis.radius + ')' + 'scale(' + +1 / d3.event.scale + ')');

	          vis.canvas.selectAll('.nodeDoiLabel').attr('transform', 'translate(' + 0 + ',' + 1.6 * scaleFactor * vis.radius + ')' + 'scale(' + +1 / d3.event.scale + ')');

	          vis.canvas.selectAll('.nodeAttrLabel').attr('transform', 'translate(' + -1.5 * scaleFactor * vis.radius + ',' + -1.5 * scaleFactor * vis.radius + ')' + 'scale(' + +1 / d3.event.scale + ')');

	          /* Trim nodeAttrLabel */
	          /* Get current node label pixel width. */
	          var maxLabelPixelWidth = (cell.width - 2 * scaleFactor * vis.radius) * d3.event.scale;

	          /* Get label text. */
	          d3.selectAll('.node').select('.nodeAttrLabel').each(function (d) {
	            var attrText = d.label === '' ? d.name : d.label;
	            if (d.nodeType === 'stored') {
	              var selAttrName = '';
	              $('#prov-ctrl-visible-attribute-list > li').each(function () {
	                if ($(this).find('input[type=\'radio\']').prop('checked')) {
	                  selAttrName = $(this).find('label').text();
	                }
	              });
	              attrText = d.attributes.get(selAttrName);
	            }

	            /* Set label text. */
	            if (typeof attrText !== 'undefined') {
	              d3.select(this).text(attrText);
	              var trimRatio = parseInt(attrText.length * (maxLabelPixelWidth / this.getComputedTextLength()), 10);
	              if (trimRatio < attrText.length) {
	                d3.select(this).text(attrText.substr(0, trimRatio - 3) + '...');
	              }
	            }
	          });
	        };

	        /* Main canvas drawing area. */
	        vis.canvas = d3.select('#provenance-canvas').append('svg').attr('width', width).attr('height', height).attr('pointer-events', 'all').classed('canvas', true).append('g').call(vis.zoom = d3.behavior.zoom().on('zoom', redraw)).on('dblclick.zoom', null).append('g');

	        /* Helper rectangle to support pan and zoom. */
	        vis.rect = vis.canvas.append('svg:rect').attr('width', width).attr('height', height).classed('brect', true);

	        /* Production mode exception handling. */
	        // try {
	        //   /* Extract graph data. */
	        //   vis.graph = init(data, analysesData, solrResponse);
	        //   try {
	        //     /* Compute layout. */
	        //     vis.graph.bclgNodes = layout(vis.graph, vis.cell);
	        //     try {
	        //       /* Discover and and inject motifs. */
	        //       motifs(vis.graph, layerMethod);
	        //       try {
	        //         /* Render graph. */
	        //         render.run(vis);
	        //       }
	        //       catch (err) {
	        //         $('#provenance-canvas > svg').remove();
	        //         document.getElementById('provenance-canvas').innerHTML +=
	        //             'Render Module Error: ' + err.message + '<br>';
	        //       }
	        //     }
	        //     catch (err) {
	        //       $('#provenance-canvas > svg').remove();
	        //       document.getElementById('provenance-canvas').innerHTML +=
	        //           'Motif Module Error: ' + err.message + '<br>';
	        //     }
	        //   }
	        //   catch (err) {
	        //     $('#provenance-canvas > svg').remove();
	        //     document.getElementById('provenance-canvas').innerHTML +=
	        //         'Layout Module Error: ' + err.message + '<br>';
	        //   }
	        // }
	        // catch (err) {
	        //   $('#provenance-canvas > svg').remove();
	        //   document.getElementById('provenance-canvas').innerHTML =
	        //       'Init Module Error: ' + err.message + '<br>';
	        // } finally {
	        //   hideProvvisLoaderIcon();
	        // }

	        /* Uncomment in development mode. */
	        vis.graph = run$1(data, analysesData, solrResponse);
	        vis.graph.bclgNodes = run$2(vis.graph, vis.cell);
	        run$3(vis.graph, layerMethod);
	        run$4(vis);
	        hideProvvisLoaderIcon();

	        try {
	          /* TODO: Refine to only redraw affected canvas components. */
	          /* Switch filter action. */
	          $('#prov-layering-method > button').click(function () {
	            layerMethod = $(this).prop('value');

	            showProvvisLoaderIcon();

	            $('.aHLinks').remove();
	            $('.aLinks').remove();
	            $('.lLinks').remove();
	            $('.lLink').remove();
	            $('.layers').remove();
	            $('.analyses').remove();

	            $('#provenance-timeline-view').children().remove();
	            $('#provenance-doi-view').children().remove();

	            createTimelineView('provenance-timeline-view');

	            DoiFactors.set('filtered', 0.2, true);
	            DoiFactors.set('selected', 0.2, true);
	            DoiFactors.set('highlighted', 0.2, true);
	            DoiFactors.set('time', 0.2, true);
	            DoiFactors.set('diff', 0.2, true);

	            createDOIView('provenance-doi-view');

	            /* Discover and and inject motifs. */
	            run$3(vis.graph, layerMethod);

	            /* Render graph. */
	            run$4(vis);

	            hideProvvisLoaderIcon();
	          });
	        } catch (err) {
	          document.getElementById('provenance-canvas').innerHTML += 'Layering Error: ' + err.message + '<br>';
	        }
	      });
	    })();
	  }
	}

	/**
	 * On attribute filter change, the provenance visualization will be updated.
	 * @param solrResponse Query response object holding information
	 * about attribute filter changed.
	 */
	function runProvVisUpdatePrivate(solrResponse) {
	  update$1(vis, solrResponse);
	}

	/**
	 * Visualization instance getter.
	 * @returns {null} The provvis instance.
	 */
	function getProvVisPrivate() {
	  return vis;
	}

	/**
	 * Publishable module functions.
	 */
	function run(studyUuid, studyAnalyses, solrResponse) {
	  runProvVisPrivate(studyUuid, studyAnalyses, solrResponse);
	}

	function update(solrResponse) {
	  runProvVisUpdatePrivate(solrResponse);
	}

	function get() {
	  return getProvVisPrivate();
	}

	var index = {
	  version: version,
	  run: run,
	  update: update,
	  get: get
	};

	return index;

}($,d3,SolrResponse,dagre));