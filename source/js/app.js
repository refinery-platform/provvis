// External
import * as $ from '$';
import * as d3 from 'd3';

// Internal
import init from './init';
import layout from './layout';
import * as models from './models';
import motifs from './motifs';
import * as render from './render';

/**
 * The refinery provenance graph visualization.
 *
 * @author sluger Stefan Luger https://github.com/sluger
 * @exports runProvVis The published function to run the visualization.
 */

let vis = Object.create(null);

/* TODO: Rewrite in angular template. */
/**
 * Timeline view only showing analysis within a time-gradient background.
 * @param divId Div id.
 */
function createTimelineView (divId) {
  /* New timeline view content. */
  const timelineContainer = d3.select('#' + divId);

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

  d3.select('#tlCanvas').append('svg')
    .attr('height', 80)
    .attr('width', 275)
    .style({
      'margin-top': '0px',
      'margin-bottom': '0px',
      padding: '0px'
    })
    .attr('pointer-events', 'all');

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
function createDOIView (divId) {
  /* New DOI view content. */
  const doiContainer = d3.select('#' + divId);

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

  d3.select('#doiCanvas')
    .append('svg')
    .attr('height', 300)
    .attr('width', 100)
    .style({
      'margin-top': '0px',
      'margin-left': '0px',
      padding: '0px'
    })
    .attr('pointer-events', 'all')
    .append('g')
    .append('g')
    .attr('transform', 'translate(0,0)')
    .append('g');

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
    style: 'display: flex; position: absolute; left: 75px; top: 340px; ' +
      'margin-top: 5px;',
    html: '<input id="prov-doi-view-trigger-input" type="checkbox" ' +
      'style="margin-right: 3px;">Auto Update'
  }).appendTo(doiContainer);

  $('<label/>', {
    id: 'prov-doi-view-show',
    class: 'prov-doi-view-show-checkbox',
    style: 'display: flex; position: absolute; left: 180px; top: 340px; ' +
      'margin-top: 5px;',
    html: '<input id="prov-doi-view-show-input" type="checkbox" ' +
      'style="margin-right: 3px;">Show DOI'
  }).appendTo(doiContainer);
}

/**
 * Layer reload view.
 * @param divId Div id.
 */
function createChangeLayersView (divId) {
  /* New DOI view content. */
  const layerContainer = d3.select('#' + divId);

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
function showProvvisLoaderIcon () {
  $('#provvis-loader').css('display', 'inline-block');
}

/**+
 * Hide the loader icon again.
 */
function hideProvvisLoaderIcon () {
  $('#provvis-loader').css('display', 'none');
}

/**
 * Refinery injection for the provenance visualization.
 * @param studyUuid The serialized unique identifier referencing a study.
 * @param studyAnalyses Analyses objects from the refinery scope.
 * @param solrResponse Facet filter information on node attributes.
 */
function runProvVisPrivate (studyUuid, studyAnalyses, solrResponse) {
  showProvvisLoaderIcon();

  /* Only allow one instance of ProvVis. */
  if (vis instanceof models.ProvVis === false) {
    const url = '/api/v1/node?study__uuid=' + studyUuid +
      '&format=json&limit=0';
    const analysesData = studyAnalyses.filter(a => a.status === 'SUCCESS');

    /* Parse json. */
    d3.json(url, (error, data) => {
      /* Declare d3 specific properties. */
      const zoom = Object.create(null);
      const canvas = Object.create(null);
      const rect = Object.create(null);

      /* Initialize margin conventions */
      const margin = {
        top: 20,
        right: 10,
        bottom: 20,
        left: 10
      };

      /* Set drawing constants. */
      const r = 7;
      const color = d3.scale.category20();

      /* Declare graph. */
      const graph = Object.create(null);

      /* Timeline view div. */
      createTimelineView('provenance-timeline-view');

      /* DOI view div. */
      createDOIView('provenance-doi-view');

      /* Layer view div. */
      createChangeLayersView('provenance-layer-change-view');

      /* Init node cell dimensions. */
      const cell = {
        width: r * 5,
        height: r * 3
      };

      /* Initialize canvas dimensions. */
      const width = $('div#provenance-visualization').width() - 10;
      const height = $('div#solr-table-view').height() - 25;

      /* TODO: Temp fix for sidebar height. */
      $('#provenance-sidebar').css('height', height);
      /* TODO: Temp fix for sidebar max height. */
      $('#provvis-sidebar-content').css('max-height', height - 13);

      const scaleFactor = 0.75;

      let layerMethod = 'weak';
      /* weak | strict */

      /* Create vis and add graph. */
      vis = new models.ProvVis('provenance-visualization', zoom, data, url,
        canvas, rect, margin, width, height, r, color, graph, cell,
        layerMethod);

      /* Geometric zoom. */
      const redraw = function () {
        /* Translation and scaling. */
        vis.canvas.attr('transform', 'translate(' + d3.event.translate + ')' +
          ' scale(' + d3.event.scale + ')');

        /* Semantic zoom. */
        if (d3.event.scale < 1) {
          d3.selectAll('.BBox').classed('hiddenNode', true);
          d3.selectAll('.lDiff, .aDiff').classed('hiddenNode', true);
        } else {
          d3.selectAll('.BBox').classed('hiddenNode', false);
          d3.selectAll('.lDiff, .aDiff').classed('hiddenNode', false);
        }

        if (d3.event.scale < 1.7) {
          vis.canvas.selectAll('.anLabel, .sanLabel, .lnLabel, ' +
            '.nodeAttrLabel, .stored-node-type-icon, .an-node-type-icon, ' +
            '.san-node-type-icon, .l-node-type-icon, .lBBoxLabel, ' +
            '.aBBoxLabel, .nodeDoiLabel')
            .classed('hiddenLabel', true);
          d3.selectAll('.glAnchor, .grAnchor').classed('hiddenNode', true);
        } else {
          vis.canvas.selectAll('.anLabel, .sanLabel, .lnLabel, ' +
            '.nodeAttrLabel, .stored-node-type-icon, .an-node-type-icon, ' +
            '.san-node-type-icon, .l-node-type-icon, .lBBoxLabel, ' +
            '.aBBoxLabel, .nodeDoiLabel')
            .classed('hiddenLabel', false);
          d3.selectAll('.glAnchor, .grAnchor').classed('hiddenNode', false);
        }

        /* Fix for rectangle getting translated too - doesn't work after
         * window resize.
         */
        vis.rect.attr('transform', 'translate(' +
          (-(d3.event.translate[0] + vis.margin.left) / d3.event.scale) +
          ',' + (-(d3.event.translate[1] +
          vis.margin.top) / d3.event.scale) +
          ')' + ' scale(' + (+1 / d3.event.scale) + ')');

        /* Fix to exclude zoom scale from text labels. */
        vis.canvas.selectAll('.lBBoxLabel')
          .attr('transform', 'translate(' +
            1 * scaleFactor * vis.radius + ',' +
            0.5 * scaleFactor * vis.radius + ')' +
            'scale(' + (+1 / d3.event.scale) + ')');

        vis.canvas.selectAll('.aBBoxLabel')
          .attr('transform', 'translate(' +
            1 * scaleFactor * vis.radius + ',' +
            0 * scaleFactor * vis.radius + ')' +
            'scale(' + (+1 / d3.event.scale) + ')');

        vis.canvas.selectAll('.nodeDoiLabel')
          .attr('transform', 'translate(' +
            0 + ',' + (1.6 * scaleFactor * vis.radius) + ')' +
            'scale(' + (+1 / d3.event.scale) + ')');

        vis.canvas.selectAll('.nodeAttrLabel')
          .attr('transform', 'translate(' +
            (-1.5 * scaleFactor * vis.radius) + ',' +
            (-1.5 * scaleFactor * vis.radius) + ')' +
            'scale(' + (+1 / d3.event.scale) + ')');

        /* Trim nodeAttrLabel */
        /* Get current node label pixel width. */
        const maxLabelPixelWidth = (cell.width - 2 * scaleFactor * vis.radius) *
        d3.event.scale;

        /* Get label text. */
        d3.selectAll('.node').select('.nodeAttrLabel').each(function (d) {
          let attrText = (d.label === '') ? d.name : d.label;
          if (d.nodeType === 'stored') {
            let selAttrName = '';
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
            const trimRatio = parseInt(attrText.length *
              (maxLabelPixelWidth / this.getComputedTextLength()), 10);
            if (trimRatio < attrText.length) {
              d3.select(this).text(attrText.substr(0, trimRatio - 3) + '...');
            }
          }
        });
      };

      /* Main canvas drawing area. */
      vis.canvas = d3.select('#provenance-canvas')
        .append('svg')
        .attr('width', width)
        .attr('height', height)
        .attr('pointer-events', 'all')
        .classed('canvas', true)
        .append('g')
        .call(vis.zoom = d3.behavior.zoom()
          .on('zoom', redraw))
        .on('dblclick.zoom', null)
        .append('g');

      /* Helper rectangle to support pan and zoom. */
      vis.rect = vis.canvas.append('svg:rect')
        .attr('width', width)
        .attr('height', height)
        .classed('brect', true);


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
      vis.graph = init(data, analysesData, solrResponse);
      vis.graph.bclgNodes = layout(vis.graph, vis.cell);
      motifs(vis.graph, layerMethod);
      render.run(vis);
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

          models.DoiFactors.set('filtered', 0.2, true);
          models.DoiFactors.set('selected', 0.2, true);
          models.DoiFactors.set('highlighted', 0.2, true);
          models.DoiFactors.set('time', 0.2, true);
          models.DoiFactors.set('diff', 0.2, true);

          createDOIView('provenance-doi-view');

          /* Discover and and inject motifs. */
          motifs(vis.graph, layerMethod);

          /* Render graph. */
          render.run(vis);

          hideProvvisLoaderIcon();
        });
      } catch (err) {
        document.getElementById('provenance-canvas')
          .innerHTML += 'Layering Error: ' + err.message + '<br>';
      }
    });
  }
}

/**
 * On attribute filter change, the provenance visualization will be updated.
 * @param solrResponse Query response object holding information
 * about attribute filter changed.
 */
function runProvVisUpdatePrivate (solrResponse) {
  render.update(vis, solrResponse);
}

/**
 * Visualization instance getter.
 * @returns {null} The provvis instance.
 */
function getProvVisPrivate () {
  return vis;
}

/**
 * Publishable module functions.
 */
function run (studyUuid, studyAnalyses, solrResponse) {
  runProvVisPrivate(studyUuid, studyAnalyses, solrResponse);
}

function update (solrResponse) {
  runProvVisUpdatePrivate(solrResponse);
}

function get () {
  return getProvVisPrivate();
}

export { run, update, get };
