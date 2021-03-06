/*
 * Copyright (C) 2010-2016 Structr GmbH
 *
 * This file is part of Structr <http://structr.org>.
 *
 * Structr is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 *
 * Structr is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with Structr.  If not, see <http://www.gnu.org/licenses/>.
 */
var canvas, instance, res, nodes = {}, rels = {}, localStorageSuffix = '_schema_' + port, undefinedRelType = 'UNDEFINED_RELATIONSHIP_TYPE', initialRelType = undefinedRelType;
var radius = 20, stub = 30, offset = 0, maxZ = 0, reload = false;
var connectorStyle = LSWrapper.getItem(localStorageSuffix + 'connectorStyle') || 'Flowchart';
var zoomLevel = parseFloat(LSWrapper.getItem(localStorageSuffix + 'zoomLevel')) || 1.0;
var remotePropertyKeys = [];
var hiddenSchemaNodes = [];
var hiddenSchemaNodesKey = 'structrHiddenSchemaNodes_' + port;
var selectedRel, relHighlightColor = 'red';
var selectionInProgress = false;
var mouseDownCoords = {x:0, y:0};
var mouseUpCoords = {x:0, y:0};
var selectBox, nodeDragStartpoint;
var selectedNodes = [];
var showSchemaOverlaysKey = 'structrShowSchemaOverlays_' + port;

$(document).ready(function() {

	Structr.registerModule('schema', _Schema);
	Structr.classes.push('schema');
});

var _Schema = {
	type_icon: 'icon/database_table.png',
	schemaLoading: false,
	schemaLoaded: false,
	cnt: 0,
	reload: function() {
		if (reload) {
			return;
		}
		var x = window.scrollX;
		var y = window.scrollY;
		reload = true;
		_Schema.storePositions();
		main.empty();
		_Schema.init({x: x, y: y});
		_Schema.resize();

	},
	storePositions: function() {
		$.each($('#schema-graph .node'), function(i, n) {
			var node = $(n);
			var type = node.text();
			var obj = {position: node.position()};
			obj.position.left /= zoomLevel;
			obj.position.top = (obj.position.top - canvas.offset().top) / zoomLevel;
			LSWrapper.setItem(type + localStorageSuffix + 'node-position', JSON.stringify(obj));
		});
	},
	getPosition: function(type) {
		var n = JSON.parse(LSWrapper.getItem(type + localStorageSuffix + 'node-position'));
		return n ? n.position : undefined;
	},
	init: function(scrollPosition) {

		_Schema.schemaLoading = false;
		_Schema.schemaLoaded = false;
		_Schema.schema = [];
		_Schema.keys = [];

		main.append('<div class="schema-input-container"></div>');

		var schemaContainer = $('.schema-input-container');

		Structr.ensureIsAdmin(schemaContainer, function() {

			schemaContainer.append('<div class="input-and-button"><input class="schema-input" id="type-name" type="text" size="10" placeholder="New type"><button id="create-type" class="btn"><img src="icon/add.png"> Add</button></div>');
			schemaContainer.append('<div class="input-and-button"><input class="schema-input" id="ggist-url" type="text" size="20" placeholder="Enter GraphGist URL"><button id="gg-import" class="btn">Start Import</button></div>');
			$('#gg-import').on('click', function(e) {
				var btn = $(this);
				var text = btn.text();
				btn.attr('disabled', 'disabled').addClass('disabled').html(text + ' <img src="img/al.gif">');
				e.preventDefault();
				_Schema.importGraphGist($('#ggist-url').val(), text);
			});

			var styles = ['Flowchart', 'Bezier', 'StateMachine', 'Straight'];

			schemaContainer.append('<select id="connector-style"></select>');
			$.each(styles, function(i, style) {
				$('#connector-style').append('<option value="' + style + '" ' + (style === connectorStyle ? 'selected="selected"' : '') + '>' + style + '</option>');
			});
			$('#connector-style').on('change', function() {
				var newStyle = $(this).val();
				connectorStyle = newStyle;
				LSWrapper.setItem(localStorageSuffix + 'connectorStyle', newStyle);
				_Schema.reload();
			});

			schemaContainer.append('<div id="zoom-slider" style="display:inline-block; width:100px; margin-left:10px"></div>');
			$( "#zoom-slider" ).slider({
				min:0.25,
				max:1,
				step:0.05,
				value:zoomLevel,
				slide: function( event, ui ) {
					var newZoomLevel = ui.value;
					zoomLevel = newZoomLevel;
					LSWrapper.setItem(localStorageSuffix + 'zoomLevel', newZoomLevel);
					_Schema.setZoom(newZoomLevel, instance, [0,0], $('#schema-graph')[0]);
					if (selectedNodes.length > 0) {
						_Schema.updateSelectedNodes();
					}
					_Schema.resize();
				}
			});

			schemaContainer.append('<button class="btn" id="admin-tools"><img src="icon/wrench.png"> Tools</button>');
			$('#admin-tools').on('click', function() {
				_Schema.openAdminTools();
			});

			schemaContainer.append('<button class="btn" id="sync-schema"><img src="icon/page_white_get.png"> Sync schema</button>');
			$('#sync-schema').on('click', function() {
				_Schema.syncSchemaDialog();
			});

			schemaContainer.append('<button class="btn" id="show-snapshots"><img src="icon/database.png"> Snapshots</button>');
			$('#show-snapshots').on('click', function() {
				_Schema.snapshotsDialog();
			});

			schemaContainer.append('<button class="btn" id="schema-display-options"><img src="icon/pencil.png"> Display Options</button>');
			$('#schema-display-options').on('click', function() {
				_Schema.openSchemaDisplayOptions();
			});

			schemaContainer.append('<input type="checkbox" id="schema-show-overlays" name="schema-show-overlays" style="margin-left:10px"><label for="schema-show-overlays"> Show relationship labels</label>');
			$('#schema-show-overlays').on('change', function() {
				_Schema.updateOverlayVisibility($(this).prop('checked'));
			});

			$('#type-name').on('keyup', function(e) {

				if (e.keyCode === 13) {
					e.preventDefault();
					if ($('#type-name').val().length) {
						$('#create-type').click();
					}
					return false;
				}

			});
			$('#create-type').on('click', function() {
				_Schema.createNode($('#type-name').val());
			});

			jsPlumb.ready(function() {
				main.append('<div class="canvas" id="schema-graph"></div>');

				canvas = $('#schema-graph');

				instance = jsPlumb.getInstance({
					//Connector: "StateMachine",
					PaintStyle: {
						lineWidth: 5,
						strokeStyle: "#81ce25"
					},
					Endpoint: ["Dot", {radius: 6}],
					EndpointStyle: {
						fillStyle: "#aaa"
					},
					Container: "schema-graph",
					ConnectionOverlays: [
						["PlainArrow", {
								location: 1,
								width: 15,
								length: 12
							}
						]
					]
				});

				_Schema.loadSchema(function() {

					$('.node').css({zIndex: ++maxZ});

					instance.bind('connection', function(info) {
						_Schema.connect(Structr.getIdFromPrefixIdString(info.sourceId, 'id_'), Structr.getIdFromPrefixIdString(info.targetId, 'id_'));
					});
					instance.bind('connectionDetached', function(info) {
						Structr.confirmation('<h3>Delete schema relationship?</h3>',
								function() {
									$.unblockUI({
										fadeOut: 25
									});
									_Schema.detach(info.connection.scope);
									_Schema.reload();
								});
						_Schema.reload();
					});
					reload = false;

					_Schema.setZoom(zoomLevel, instance, [0,0], $('#schema-graph')[0]);

					$('._jsPlumb_connector').click(function(e) {
						e.stopPropagation();
						_Schema.selectRel($(this));
					});

					canvas.on('mousedown', function(e) {
						if (e.which === 1) {
							_Schema.clearSelection();
							_Schema.selectionStart(e);
						}
					});

					canvas.on('mousemove', function (e) {
						if (e.which === 1) {
							_Schema.selectionDrag(e);
						}
					});

					canvas.on('mouseup', function (e) {
						_Schema.selectionStop();
					});

					_Schema.resize();

					Structr.unblockMenu(500);

					var showSchemaOverlays = LSWrapper.getItem(showSchemaOverlaysKey) === null ? true : LSWrapper.getItem(showSchemaOverlaysKey);
					_Schema.updateOverlayVisibility(showSchemaOverlays);

					if (scrollPosition) {
						window.scrollTo(scrollPosition.x, scrollPosition.y);
					}
				});

			});

			_Schema.resize();
		});

	},
	selectRel: function ($rel) {
		_Schema.clearSelection();

		selectedRel = $rel;
		selectedRel.css({zIndex: ++maxZ});
		selectedRel.nextAll('._jsPlumb_overlay').slice(0, 3).css({zIndex: ++maxZ, borderColor:relHighlightColor});
		pathElements = selectedRel.find('path');
		pathElements.css({stroke: relHighlightColor});
		$(pathElements[1]).css({fill: relHighlightColor});
	},
	clearSelection: function() {
		// deselect selected node
		$('.node', canvas).removeClass('selected');
		_Schema.selectionStop();

		// deselect selected Relationship
		if (selectedRel) {
			selectedRel.nextAll('._jsPlumb_overlay').slice(0, 3).css({borderColor:''});
			pathElements = selectedRel.find('path');
			pathElements.css('stroke', '');
			$(pathElements[1]).css('fill', '');
			selectedRel = undefined;
		}
	},
	selectionStart: function (e) {
		canvas.addClass('noselect');
		selectionInProgress = true;
		var schemaOffset = canvas.offset();
		mouseDownCoords.x = e.pageX - schemaOffset.left;
		mouseDownCoords.y = e.pageY - schemaOffset.top;
	},
	selectionDrag: function (e) {
		if (selectionInProgress === true) {
			var schemaOffset = canvas.offset();
			mouseUpCoords.x = e.pageX - schemaOffset.left;
			mouseUpCoords.y = e.pageY - schemaOffset.top;
			_Schema.drawSelectElem();
		}
	},
	selectionStop: function () {
		selectionInProgress = false;
		if (selectBox) {
			selectBox.remove();
			selectBox = undefined;
		}
		_Schema.updateSelectedNodes();
		canvas.removeClass('noselect');
	},
	updateSelectedNodes: function() {
		selectedNodes = [];
		var canvasOffset = canvas.offset();
		$('.node.selected', canvas).each(function (idx, el) {
			$el = $(el);
			var elementOffset = $el.offset();
			selectedNodes.push({
				nodeId: $el.attr('id'),
				name: $el.children('b').text(),
				pos: {
					top:  (elementOffset.top  - canvasOffset.top ),
					left: (elementOffset.left - canvasOffset.left)
				}
			});
		});
	},
	drawSelectElem: function () {
		if (!selectBox || !selectBox.length) {
			canvas.append('<svg id="schema-graph-select-box"><path version="1.1" xmlns="http://www.w3.org/1999/xhtml" fill="none" stroke="#aaa" stroke-width="5"></path></svg>');
			selectBox = $('#schema-graph-select-box');
		}
		var cssRect = {
			position: 'absolute',
			top:    Math.min(mouseDownCoords.y, mouseUpCoords.y)  / zoomLevel,
			left:   Math.min(mouseDownCoords.x, mouseUpCoords.x)  / zoomLevel,
			width:  Math.abs(mouseDownCoords.x - mouseUpCoords.x) / zoomLevel,
			height: Math.abs(mouseDownCoords.y - mouseUpCoords.y) / zoomLevel
		};
		selectBox.css(cssRect);
		selectBox.find('path').attr('d', 'm 0 0 h ' + cssRect.width + ' v ' + cssRect.height + ' h ' + (-cssRect.width) + ' v ' + (-cssRect.height) + ' z');
		_Schema.selectNodesInRect(cssRect);
	},
	selectNodesInRect: function (selectionRect) {
		var selectedElements = [];

		$('.node', canvas).each(function (idx, el) {
			var $el = $(el);
			if (_Schema.isElemInSelection($el, selectionRect)) {
				selectedElements.push($el);
				$el.addClass('selected');
			} else {
				$el.removeClass('selected');
			}
		});
	},
	isElemInSelection: function ($el, selectionRect) {
		var elPos = $el.offset();
		elPos.top /= zoomLevel;
		elPos.left /= zoomLevel;
		var schemaOffset = canvas.offset();
		return !(
			(elPos.top) > (selectionRect.top + schemaOffset.top / zoomLevel + selectionRect.height) ||
			elPos.left > (selectionRect.left + schemaOffset.left / zoomLevel + selectionRect.width) ||
			(elPos.top + $el.innerHeight()) < (selectionRect.top + schemaOffset.top / zoomLevel) ||
			(elPos.left + $el.innerWidth()) < (selectionRect.left + schemaOffset.left / zoomLevel)
		);
	},
	onload: function() {
		_Schema.init();
		$('#main-help a').attr('href', 'http://docs.structr.org/frontend-user-guide#Schema');

		$(window).off('resize');
		$(window).on('resize', function() {
			_Schema.resize();
		});
	},
	/**
	 * Read the schema from the _schema REST resource and call 'callback'
	 * after the complete schema is loaded.
	 */
	loadSchema: function(callback) {
		// Avoid duplicate loading of schema
		if (_Schema.schemaLoading) {
			return;
		}
		_Schema.schemaLoading = true;

		_Schema.loadNodes(function() {
			_Schema.loadRels(callback);
		});

	},
	isSchemaLoaded: function() {
		var all = true;
		if (!_Schema.schemaLoaded) {
			$.each(_Schema.types, function(t, type) {
				all &= (_Schema.schema[type] && _Schema.schema[type] !== null);
			});
		}
		_Schema.schemaLoaded = all;
		return _Schema.schemaLoaded;
	},
	loadNodes: function(callback) {
		var url = rootUrl + 'schema_nodes/ui';
		hiddenSchemaNodes = JSON.parse(LSWrapper.getItem(hiddenSchemaNodesKey)) || [];
		$.ajax({
			url: url,
			dataType: 'json',
			contentType: 'application/json; charset=utf-8',
			success: function(data) {

				$.each(data.result, function(i, entity) {

					if (hiddenSchemaNodes.length > 0 && hiddenSchemaNodes.indexOf(entity.id) > -1) { return; }

					var isBuiltinType = entity.isBuiltinType;
					var id = 'id_' + entity.id;
					nodes[entity.id] = entity;
					canvas.append('<div class="schema node compact'
							+ (isBuiltinType ? ' light' : '')
							//+ '" id="' + id + '">' + (entity.icon ? '<img class="type-icon" src="' + entity.icon + '">' : '') + '<b>' + entity.name + '</b>'
							+ '" id="' + id + '"><b>' + entity.name + '</b>'
							+ '<img class="icon delete" src="icon/delete' + (isBuiltinType ? '_gray' : '') + '.png">'
							+ '<img class="icon edit" src="icon/pencil.png">'
							+ '</div>');


					var node = $('#' + id);

					if (!isBuiltinType) {
						node.children('b').on('click', function() {
							_Schema.makeAttrEditable(node, 'name');
						});
					}

					node.on('mousedown', function() {
						node.css({zIndex: ++maxZ});
					});

					if (!isBuiltinType) {
						node.children('.delete').on('click', function() {
							Structr.confirmation('<h3>Delete schema node \'' + entity.name + '\'?</h3><p>This will delete all incoming and outgoing schema relationships as well, but no data will be removed.</p>',
									function() {
										$.unblockUI({
											fadeOut: 25
										});
										_Schema.deleteNode(entity.id);
									});
						});
					}

					var storedPosition = _Schema.getPosition(entity.name);
					node.offset({
						left: storedPosition ? storedPosition.left : i * 100 + 25,
						top: storedPosition ? storedPosition.top : i * 40 + 131
					});

					$('.edit', node).on('click', function(e) {

						e.stopPropagation();
						var id = Structr.getId($(this).closest('.schema.node'));

						if (!id) {
							return false;
						}

						_Schema.openEditDialog(id);

						return false;
					});

					nodes[entity.id + '_top'] = instance.addEndpoint(id, {
						//anchor: [ "Perimeter", { shape: "Square" } ],
						anchor: "Top",
						maxConnections: -1,
						//isSource: true,
						isTarget: true,
						deleteEndpointsOnDetach: false
					});
					nodes[entity.id + '_bottom'] = instance.addEndpoint(id, {
						//anchor: [ "Perimeter", { shape: "Square" } ],
						anchor: "Bottom",
						maxConnections: -1,
						isSource: true,
						deleteEndpointsOnDetach: false
								//isTarget: true
					});

					instance.draggable(id, {
						containment: true,
						start: function (ui) {
							var nodeOffset   = $(ui.el).offset();
							var canvasOffset = canvas.offset();
							nodeDragStartpoint = {
								top:  (nodeOffset.top  - canvasOffset.top ),
								left: (nodeOffset.left - canvasOffset.left)
							};
						},
						drag: function (ui) {

							var $element = $(ui.el);

							if (!$element.hasClass('selected')) {

								_Schema.clearSelection();

							} else {

								var nodeOffset = $element.offset();
								var canvasOffset = canvas.offset();

								var posDelta = {
									top:  (nodeDragStartpoint.top  - nodeOffset.top ),
									left: (nodeDragStartpoint.left - nodeOffset.left)
								};

								selectedNodes.forEach(function (selectedNode) {
									if (selectedNode.nodeId !== $element.attr('id')) {
										$('#' + selectedNode.nodeId).offset({
											top:  (selectedNode.pos.top  - posDelta.top  > canvasOffset.top ) ? (selectedNode.pos.top  - posDelta.top ) : canvasOffset.top,
											left: (selectedNode.pos.left - posDelta.left > canvasOffset.left) ? (selectedNode.pos.left - posDelta.left) : canvasOffset.left
										});
									}
								});

								instance.repaintEverything();

							}
						},
						stop: function() {
							_Schema.storePositions();
							_Schema.resize();
						}
					});
				});

				if (callback) {
					callback();
				}

			}
		});
	},
	openEditDialog: function(id, targetView, callback) {

		Command.get(id, function(entity) {

			var title = 'Edit schema node';
			var method = _Schema.loadNode;

			if (entity.type === "SchemaRelationshipNode") {
				title = 'Edit schema relationship';
				method = _Schema.loadRelationship;
			}

			Structr.dialog(title, function() {
			}, function() {
				if (callback) {
					callback();
				}
				instance.repaintEverything();
			});

			method(entity, dialogHead, dialogText, targetView);

		});

	},
	loadRels: function(callback) {
		var url = rootUrl + 'schema_relationship_nodes';
		$.ajax({
			url: url,
			dataType: 'json',
			contentType: 'application/json; charset=utf-8',
			success: function(data) {

				var relCnt = {};
				$.each(data.result, function(i, res) {

					var relIndex = res.sourceId + '-' + res.targetId;
					if (relCnt[relIndex] !== undefined) {
						relCnt[relIndex]++;
					} else {
						relCnt[relIndex] = 0;
					}

					radius = 20 + 10 * relCnt[relIndex];
					stub   = 30 + 80 * relCnt[relIndex];
					offset =     0.1 * relCnt[relIndex];

					if (!(nodes[res.sourceId] && nodes[res.targetId])) {
						return;
					}

					rels[res.id] = instance.connect({
						source: nodes[res.sourceId + '_bottom'],
						target: nodes[res.targetId + '_top'],
						deleteEndpointsOnDetach: false,
						scope: res.id,
						connector: [connectorStyle, {curviness: 200, cornerRadius: radius, stub: [stub, 30], gap: 6, alwaysRespectStubs: true }],
						paintStyle: { lineWidth: 5, strokeStyle: res.permissionPropagation !== 'None' ? "#ffad25" : "#81ce25" },
						overlays: [
							["Label", {
									cssClass: "label rel-type",
									label: _Schema.getRelationshipOverlayHtml(res, false),
									location: .5 + offset,
									id: "label",
									events: {
										click: function(overlay, evt) {
											evt.preventDefault();

											if (overlay.getLabel().substring(0, 6) !== '<input') {

												overlay.setLabel(_Schema.getRelationshipOverlayHtml(res, true));

												var saveEditedRelationship = function (relationship, $element) {

													var newRelData = {
														sourceMultiplicity: $('.source-mult-input', $element).val(),
														relationshipType: $('.rel-type-input', $element).val(),
														targetMultiplicity: $('.target-mult-input', $element).val()
													};

													if ((newRelData.sourceMultiplicity !== '*' && newRelData.sourceMultiplicity !== '1') || (newRelData.targetMultiplicity !== '*' && newRelData.targetMultiplicity !== '1')) {

														Structr.error('Multiplicity can only be 1 or *.');

													} else if (newRelData.relationshipType.match(/^[\w]+$/) === null) {

														Structr.error('RelType must use only alphanumeric characters and underscores.');

													} else {
														$('input', overlay.getElement()).attr('disabled', 'disabled');
														_Schema.editRelationship(relationship, newRelData, undefined, function (data) {
															Structr.errorFromResponse(data.responseJSON);
														});
													}

												};

												$('input', overlay.getElement()).first().focus();
												$('input', overlay.getElement()).keypress(function(e) {
													if (e.keyCode === 13) {
														e.preventDefault();
														saveEditedRelationship(res, overlay.getElement());
													}
												});

												$('.save', overlay.getElement()).on('click', function () {
													saveEditedRelationship(res, overlay.getElement());
												});

												$('.discard', overlay.getElement()).on('click', function () {
													overlay.setLabel(_Schema.getRelationshipOverlayHtml(res, false));
													_Schema.registerRelationshipOverlayButtonHandlers(res);
												});

												$('.icon', overlay.getElement()).show();
											}
										}
									}
								}
							]

						]
					});

					$('#rel_' + res.id).parent().on('mouseover', function(e) {
						//e.stopPropagation();
						$('#rel_' + res.id + ' .icon').show();
						$('#rel_' + res.id + ' .target-multiplicity').addClass('hover');
					});

					$('#rel_' + res.id).parent().on('mouseout', function(e) {
						//e.stopPropagation();
						$('#rel_' + res.id + ' .icon').hide();
						$('#rel_' + res.id + ' .target-multiplicity').removeClass('hover');
					});

					_Schema.registerRelationshipOverlayButtonHandlers(res);
				});


				if (callback) {
					callback();
				}

			}
		});
	},
	getRelationshipOverlayHtml: function(rel, editMode) {
		if (editMode === true) {
			return '<input class="source-mult-input" type="text" size="15" id="id_' + rel.id + '_sourceMultiplicity" value="' + (rel.sourceMultiplicity ? rel.sourceMultiplicity : '*') + '">'
					+ '<input class="rel-type-input" type="text" size="15" id="id_' + rel.id + '_relationshipType" value="' + (rel.relationshipType === initialRelType ? '&nbsp;' : rel.relationshipType) + '">'
					+ '<input class="target-mult-input" type="text" size="15" id="id_' + rel.id + '_targetMultiplicity" value="' + (rel.targetMultiplicity ? rel.targetMultiplicity : '*') + '">'
					+ ' <img title="Save changes" alt="Save changes" class="save icon" src="icon/tick.png">'
					+ ' <img title="Discard changes" alt="Discard changes" class="discard icon" src="icon/cross.png">';
		} else {
			return '<span id="rel_' + rel.id + '" data-name="' + rel.name + '" data-source-type="' + nodes[rel.sourceId].name + '" data-target-type="' + nodes[rel.targetId].name + '">'
					+ '<span class="source-multiplicity">' + (rel.sourceMultiplicity ? rel.sourceMultiplicity : '*') + '</span>'
					+ '<span class="rel-type-name">' + (rel.relationshipType === initialRelType ? '&nbsp;' : rel.relationshipType) + '</span>'
					+ '<span class="target-multiplicity">' + (rel.targetMultiplicity ? rel.targetMultiplicity : '*') + '</span>'
					+ ' <img title="Edit schema relationship" alt="Edit schema relationship" class="edit icon" src="icon/pencil.png">'
					+ ' <img title="Remove schema relationship" alt="Remove schema relationship" class="remove icon" src="icon/delete.png">'
					+ '</span>';
		}
	},
	registerRelationshipOverlayButtonHandlers: function (rel) {
		$('#rel_' + rel.id + ' .edit').on('click', function(e) {
			e.stopPropagation();

			_Schema.openEditDialog(rel.id);
		});

		$('#rel_' + rel.id + ' .remove').on('click', function(e) {
			e.stopPropagation();
			Structr.confirmation('<h3>Delete schema relationship \'' + rel.relationshipType + '\'?</h3>', function() {
				$.unblockUI({
					fadeOut: 25
				});
				_Schema.detach(rel.id);
				_Schema.reload();
			});
			return false;
		});
	},
	loadNode: function(entity, headEl, contentEl, targetView) {

		remotePropertyKeys = [];

		if (!targetView) {
			targetView = 'local';
		}

		var id = '___' + entity.id;
		headEl.append('<div id="' + id + '_head" class="schema-details"></div>');
		var headContentDiv = $('#' + id + '_head');

		headContentDiv.append('<b>' + entity.name + '</b>');

		if (!entity.isBuiltinType) {
			headContentDiv.append(' extends <select class="extends-class-select"></select>');
			headContentDiv.append(' <img id="edit-parent-class" class="icon edit" src="icon/pencil.png" alt="Edit parent class" title="Edit parent class">');

			$("#edit-parent-class", headContentDiv).click(function () {

				if ($(this).hasClass('disabled')) {
					return;
				}

				var typeName = $('.extends-class-select', headContentDiv).val().split('.').pop();

				Command.search(typeName, 'SchemaNode', function (results) {
					if (results.length === 1) {

						_Schema.openEditDialog(results[0].id, null, function () {

							window.setTimeout(function () {

								_Schema.openEditDialog(entity.id);

							}, 250);

						});

					} else if (results.length === 0) {

						new MessageBuilder().warning("Can not open entity edit dialog for class '" + typeName + "' - <b>no corresponding</b> schema node found").show();

					} else {

						new MessageBuilder().warning("Can not open entity edit dialog for class '" + typeName + "' - <b>multiple corresponding</b> schema node found").show();

					}
				});

			});

			if (entity.extendsClass && entity.extendsClass.indexOf('org.structr.dynamic.') === 0) {
				$("#edit-parent-class").removeClass('disabled');
			} else {
				$("#edit-parent-class").addClass('disabled');
			}
		}

		headContentDiv.append('<div id="tabs" style="margin-top:20px;"><ul></ul></div>');
		var mainTabs = $('#tabs', headContentDiv);

		contentEl.append('<div id="' + id + '_content" class="schema-details"></div>');
		var contentDiv = $('#' + id + '_content');

		_Entities.appendPropTab(entity, mainTabs, contentDiv, 'local', 'Local Attributes', targetView === 'local', function (c) {
			_Schema.appendLocalProperties(c, entity);
		});

		_Entities.appendPropTab(entity, mainTabs, contentDiv, 'views', 'Views', targetView === 'views', function (c) {
			_Schema.appendViews(c, 'schema_nodes', entity);
		});

		_Entities.appendPropTab(entity, mainTabs, contentDiv, 'methods', 'Methods', targetView === 'methods', function (c) {
			_Schema.appendMethods(c, entity);
		});

		_Entities.appendPropTab(entity, mainTabs, contentDiv, 'remote', 'Remote Attributes', targetView === 'remote', function (c) {
			_Schema.appendRemoteProperties(c, entity);
		});

		if (!entity.isBuiltinType) {

			headContentDiv.children('b').on('click', function() {
				_Schema.makeAttrEditable(headContentDiv, 'name');
			});

		}

		var classSelect = $('.extends-class-select', headEl);
		$.get(rootUrl + '_schema', function(data) {
			var result = data.result;
			var classNames = [];
			$.each(result, function(t, cls) {
				var type = cls.type;
				var fqcn = cls.className;
				if ( !type || type.startsWith('_') || fqcn.startsWith('org.structr.web.entity.html') || fqcn.endsWith('.' + entity.name) ) {
					return;
				}
				classNames.push(fqcn);
			});

			classNames.sort();

			classNames.forEach( function (classname) {
				classSelect.append('<option ' + (entity.extendsClass === classname ? 'selected="selected"' : '') + ' value="' + classname + '">' + classname + '</option>');
			});

			classSelect.chosen({ search_contains: true, width: '500px' });
		});

		classSelect.on('change', function() {
			var obj = {extendsClass: $(this).val()};
			_Schema.storeSchemaEntity('schema_properties', entity, JSON.stringify(obj), function () {
				// enable or disable the edit button
				if (obj.extendsClass.indexOf('org.structr.dynamic.') === 0) {
					$("#edit-parent-class").removeClass('disabled');
				} else {
					$("#edit-parent-class").addClass('disabled');
				}
			});
		});

		Structr.resize();
	},
	loadRelationship: function(entity, headEl, contentEl) {

		var id = '___' + entity.id;
		headEl.append('<div id="' + id + '_head" class="schema-details"></div>');
		var headContentDiv = $('#' + id + '_head');

		headContentDiv.append('<b>' + entity.relationshipType + '</b>');
		headContentDiv.append('<table id="relationship-options"><tr><td id="cascading-options"></td><td id="propagation-options"></td></tr></table>');

		var relationshipOptions = $('#cascading-options');
		relationshipOptions.append('<h3>Cascading Delete</h3>');
		relationshipOptions.append('<p>Direction of automatic removal of related nodes when a node is deleted</p>');
		relationshipOptions.append('<select id="cascading-delete-selector"><option value="0">NONE</option><option value="1">SOURCE_TO_TARGET</option><option value="2">TARGET_TO_SOURCE</option><option value="3">ALWAYS</option><option value="4">CONSTRAINT_BASED</option></select>');

		relationshipOptions.append('<h3>Automatic Creation of Related Nodes</h3>');
		relationshipOptions.append('<p>Direction of automatic creation of related nodes when a node is created</p>');
		relationshipOptions.append('<select id="autocreate-selector"><option value="0">NONE</option><option value="1">SOURCE_TO_TARGET</option><option value="2">TARGET_TO_SOURCE</option><option value="3">ALWAYS</option></select>');

		var propagationOptions = $('#propagation-options');
		propagationOptions.append('<h3>Permission Resolution</h3>');
		propagationOptions.append('<select id="propagation-selector"><option value="None">NONE</option><option value="Out">SOURCE_TO_TARGET</option><option value="In">TARGET_TO_SOURCE</option><option value="Both">ALWAYS</option></select>');
		propagationOptions.append('<table style="margin: 12px 0 0 0;"><tr id="propagation-table"></tr></table>');
		propagationOptions.append('<p style="margin-top:12px">Hidden properties</p><textarea id="masked-properties" />');

		var propagationTable = $('#propagation-table');
		propagationTable.append('<td class="selector"><p>Read</p><select id="read-selector"><option value="Add">Add</option><option value="Keep">Keep</option><option value="Remove">Remove</option></select></td>');
		propagationTable.append('<td class="selector"><p>Write</p><select id="write-selector"><option value="Add">Add</option><option value="Keep">Keep</option><option value="Remove">Remove</option></select></td>');
		propagationTable.append('<td class="selector"><p>Delete</p><select id="delete-selector"><option value="Add">Add</option><option value="Keep">Keep</option><option value="Remove">Remove</option></select></td>');
		propagationTable.append('<td class="selector"><p>AccessControl</p><select id="access-control-selector"><option value="Add">Add</option><option value="Keep">Keep</option><option value="Remove">Remove</option></select></td>');

		headContentDiv.append('<div id="tabs" style="margin-top:20px;"><ul></ul></div>');
		var mainTabs = $('#tabs', headContentDiv);

		contentEl.append('<div id="' + id + '_content" class="schema-details"></div>');
		var contentDiv = $('#' + id + '_content');

		_Entities.appendPropTab(entity, mainTabs, contentDiv, 'local', 'Local Attributes', true, function (c) {
			_Schema.appendLocalProperties(c, entity);
		});

		_Entities.appendPropTab(entity, mainTabs, contentDiv, 'views', 'Views', false, function (c) {
			_Schema.appendViews(c, 'schema_relationship_nodes', entity);
		});

		_Entities.appendPropTab(entity, mainTabs, contentDiv, 'methods', 'Methods', false, function (c) {
			_Schema.appendMethods(c, entity);
		});

		headContentDiv.children('b').on('click', function() {
			_Schema.makeAttrEditable(headContentDiv, 'relationshipType', true);
		});

		$.get(rootUrl + entity.id, function(data) {
			$('#cascading-delete-selector').val(data.result.cascadingDeleteFlag || 0);
			$('#autocreate-selector').val(data.result.autocreationFlag || 0);
			$('#propagation-selector').val(data.result.permissionPropagation || None);
			$('#read-selector').val(data.result.readPropagation || 'Remove');
			$('#write-selector').val(data.result.writePropagation || 'Remove');
			$('#delete-selector').val(data.result.deletePropagation || 'Remove');
			$('#access-control-selector').val(data.result.accessControlPropagation || 'Remove');
			$('#masked-properties').val(data.result.propertyMask);
		});

		$('#cascading-delete-selector').on('change', function() {
			var inp = $(this);
			_Schema.setRelationshipProperty(entity, 'cascadingDeleteFlag', parseInt(inp.val()),
			function() {
				blinkGreen(inp);
			},
			function() {
				blinkRed(inp);
			});
		});

		$('#autocreate-selector').on('change', function() {
			var inp = $(this);
			_Schema.setRelationshipProperty(entity, 'autocreationFlag', parseInt(inp.val()),
			function() {
				blinkGreen(inp);
			},
			function() {
				blinkRed(inp);
			});
		});

		$('#selector-feedback').on('click', function(e) {
			$('#propagation-selector').click();
		});

		$('#propagation-selector').on('change', function() {
			var inp = $(this);
			_Schema.setRelationshipProperty(entity, 'permissionPropagation', inp.val(),
			function() {
				blinkGreen($('#selector-feedback'));
			},
			function() {
				blinkRed($('#selector-feedback'));
			});
		});

		$('#read-selector').on('change', function() {
			var inp = $(this);
			_Schema.setRelationshipProperty(entity, 'readPropagation', inp.val(),
			function() {
				blinkGreen(inp);
			},
			function() {
				blinkRed(inp);
			});
		});

		$('#write-selector').on('change', function() {
			var inp = $(this);
			_Schema.setRelationshipProperty(entity, 'writePropagation', inp.val(),
			function() {
				blinkGreen(inp);
			},
			function() {
				blinkRed(inp);
			});
		});

		$('#delete-selector').on('change', function() {
			var inp = $(this);
			_Schema.setRelationshipProperty(entity, 'deletePropagation', inp.val(),
			function() {
				blinkGreen(inp);
			},
			function() {
				blinkRed(inp);
			});
		});

		$('#access-control-selector').on('change', function() {
			var inp = $(this);
			_Schema.setRelationshipProperty(entity, 'accessControlPropagation', inp.val(),
			function() {
				blinkGreen(inp);
			},
			function() {
				blinkRed(inp);
			});
		});

		$('#masked-properties').on('blur', function() {
			var inp = $(this);
			_Schema.setRelationshipProperty(entity, 'propertyMask', inp.val(),
			function() {
				blinkGreen(inp);
			},
			function() {
				blinkRed(inp);
			});
		});

		Structr.resize();
	},
	appendLocalProperties: function(el, entity) {

		el.append('<table class="local schema-props"><thead><th>JSON Name</th><th>DB Name</th><th>Type</th><th>Format/Code</th><th>Notnull</th><th>Uniq.</th><th>Idx</th><th>Default</th><th>Action</th></thead></table>');
		el.append('<img alt="Add local attribute" class="add-icon add-local-attribute" src="icon/add.png">');

		var propertiesTable = $('.local.schema-props', el);

		_Schema.sort(entity.schemaProperties);

		$.each(entity.schemaProperties, function(i, prop) {
			_Schema.appendLocalProperty(propertiesTable, prop);
		});

		// 2. Display builtin schema properties
		Command.listSchemaProperties(entity.id, 'ui', function(data) {

			// sort by name
			_Schema.sort(data);

			$.each(data, function(i, prop) {

				if (!prop.isDynamic) {

					var property = {
						name: prop.name,
						dbName: '',
						propertyType: prop.propertyType,
						isBuiltinProperty: true,
						notNull: prop.notNull,
						unique: prop.unique,
						indexed: prop.indexed
					};

					_Schema.appendLocalProperty(propertiesTable, property);
				}
			});
		});

		$('.add-local-attribute', el).on('click', function() {
			var rowClass = 'new' + (_Schema.cnt++);
			propertiesTable.append('<tr class="' + rowClass + '"><td><input size="15" type="text" class="property-name" placeholder="Enter JSON name" autofocus></td>'
					+ '<td><input size="15" type="text" class="property-dbname" placeholder="Enter DB name"></td>'
					+ '<td>' + typeOptions + '</td>'
					+ '<td><input size="15" type="text" class="property-format" placeholder="Enter format"></td>'
					+ '<td><input class="not-null" type="checkbox"></td>'
					+ '<td><input class="unique" type="checkbox"></td>'
					+ '<td><input class="indexed" type="checkbox"></td>'
					+ '<td><input class="property-default" size="10" type="text"></td>'
					+ '<td><img alt="Remove" class="remove-icon remove-property" src="icon/delete.png">'
					+ '</td></div>');

			$('.' + rowClass + ' .remove-property', propertiesTable).on('click', function() {
				var self = $(this);
				self.closest('tr').remove();
			});

			$('.' + rowClass + ' .property-name', propertiesTable).focus().on('blur', function() {
				_Schema.collectAndSaveNewLocalProperty(rowClass, propertiesTable, entity);
			});

			$('.' + rowClass + ' .property-type', propertiesTable).on('change', function() {
				_Schema.collectAndSaveNewLocalProperty(rowClass, propertiesTable, entity);
			});

			$('.' + rowClass + ' .property-format', propertiesTable).on('blur', function() {
				_Schema.collectAndSaveNewLocalProperty(rowClass, propertiesTable, entity);
			});

			$('.' + rowClass + ' .not-null', propertiesTable).on('change', function() {
				_Schema.collectAndSaveNewLocalProperty(rowClass, propertiesTable, entity);
			});

			$('.' + rowClass + ' .unique', propertiesTable).on('change', function() {
				_Schema.collectAndSaveNewLocalProperty(rowClass, propertiesTable, entity);
			});

			$('.' + rowClass + ' .indexed', propertiesTable).on('change', function() {
				_Schema.collectAndSaveNewLocalProperty(rowClass, propertiesTable, entity);
			});
		});
	},
	appendViews: function(el, resource, entity) {

		el.append('<table class="views schema-props"><thead><th>Name</th><th>Attributes</th><th>Action</th></thead></table>');
		el.append('<img alt="Add view" class="add-icon add-view" src="icon/add.png">');

		var viewsTable = $('.views.schema-props', el);
		var newSelectClass   = 'select-view-attrs-new';

		_Schema.sort(entity.schemaViews);

		$.each(entity.schemaViews, function(i, view) {
			_Schema.appendView(viewsTable, view, resource, entity);
		});

		$('.add-view', el).on('click', function() {
			viewsTable.append('<tr class="new"><td style="width:20%;"><input size="15" type="text" class="view property-name" placeholder="Enter view name"></td>'
					+ '<td class="' + newSelectClass + '"></td><td>' + ('<img alt="Remove" class="remove-icon remove-view" src="icon/delete.png">') + '</td>'
					+ '</div');

			_Schema.appendViewSelectionElement('.' + newSelectClass, {name: 'new'}, resource, entity);

			$('.new .property-attrs.view', el).on('change', function() {
				_Schema.createView(el, entity);
			});

			$('.new .remove-view', el).on('click', function() {
				var self = $(this);
				self.closest('tr').remove();
			});
		});
	},
	appendMethods: function(el, entity) {

		el.append('<table class="actions schema-props"><thead><th>JSON Name</th><th>Code</th><th>Comment</th><th>Action</th></thead></table>');
		el.append('<img alt="Add action" class="add-icon add-action-attribute" src="icon/add.png">');

		var actionsTable = $('.actions.schema-props', el);

		_Schema.sort(entity.schemaMethods);

		$.each(entity.schemaMethods, function(i, method) {
			_Schema.appendMethod(actionsTable, method);
		});

		$('.add-action-attribute', el).on('click', function() {
			actionsTable.append('<tr class="new"><td style="vertical-align:top;"><input size="15" type="text" class="action property-name" placeholder="Enter method name"></td>'
					+ '<td><textarea rows="4" class="action property-code" placeholder="Enter Code"></textarea></td><td><textarea rows="4" class="action property-comment" placeholder="Enter comment"></textarea></td>'
					+ '<td><img alt="Remove" class="remove-icon remove-action" src="icon/delete.png"></td>'
					+ '</div>');

			$('.new .property-code.action', el).on('blur', function() {
				_Schema.createMethod(el, entity);
			});

			$('.new .remove-action', el).on('click', function() {
				var self = $(this);
				self.closest('tr').remove();
			});
		});
	},
	appendRemoteProperties: function(el, entity) {

		el.append('<table class="related-attrs schema-props"><thead><th>JSON Name</th><th>Type, Direction and Remote type</th></thead></table>');

		var url = rootUrl + 'schema_relationship_nodes?sourceId=' + entity.id;
		$.ajax({
			url: url,
			dataType: 'json',
			contentType: 'application/json; charset=utf-8',
			success: function(data) {

				$.each(data.result, function(i, res) {

					_Schema.appendRelatedProperty($('.related-attrs', el), res, res.targetJsonName ? res.targetJsonName : res.oldTargetJsonName, true);
					instance.repaintEverything();

				});

			}
		});

		url = rootUrl + 'schema_relationship_nodes?targetId=' + entity.id;
		$.ajax({
			url: url,
			dataType: 'json',
			contentType: 'application/json; charset=utf-8',
			success: function(data) {

				$.each(data.result, function(i, res) {

					_Schema.appendRelatedProperty($('.related-attrs', el), res, res.sourceJsonName ? res.sourceJsonName : res.oldSourceJsonName, false);
					instance.repaintEverything();

				});

			}
		});

	},
	collectAndSaveNewLocalProperty: function(rowClass, el, entity) {

		var name = $('.' + rowClass + ' .property-name', el).val();
		var dbName = $('.' + rowClass + ' .property-dbname', el).val();
		var type = $('.' + rowClass + ' .property-type', el).val();
		var format = $('.' + rowClass + ' .property-format', el).val();
		var notNull = $('.' + rowClass + ' .not-null', el).is(':checked');
		var unique = $('.' + rowClass + ' .unique', el).is(':checked');
		var indexed = $('.' + rowClass + ' .indexed', el).is(':checked');
		var defaultValue = $('.' + rowClass + ' .property-default', el).val();

		if (name && name.length && type) {

			var obj = {};
			obj.schemaNode   =  { id: entity.id };
			if (name)         { obj.name = name; }
			if (dbName)       { obj.dbName = dbName; }
			if (type)         { obj.propertyType = type; }
			if (format)       { obj.format = format; }
			if (notNull)      { obj.notNull = notNull; }
			if (unique)       { obj.unique = unique; }
			if (indexed)      { obj.indexed = indexed; }
			if (defaultValue) { obj.defaultValue = defaultValue; }

			// store property definition with an empty property object
			_Schema.storeSchemaEntity('schema_properties', {}, JSON.stringify(obj), function(result) {

				if (result && result.result) {

					var id = result.result[0];

					$.ajax({
						url: rootUrl + id,
						type: 'GET',
						dataType: 'json',
						contentType: 'application/json; charset=utf-8',
						statusCode: {

							200: function(data) {

								var property = data.result;
								var name     = property.name;
								var row      = $('.' + rowClass, el);

								blinkGreen(row);

								_Schema.reload();

								_Schema.unbindEvents(name);

								row.removeClass(rowClass).addClass('local').addClass(name);
								row = $('.local.' + name, el);

								$('.remove-property', row).off('click');

								$('.remove-property', row).on('click', function() {
									_Schema.confirmRemoveSchemaEntity(property, 'Delete property', function() { _Schema.openEditDialog(property.schemaNode.id, 'local'); }, 'Property values will not be removed from data nodes.');
								});

								var $el = $("#tabView-views.propTabContent");
								$el.empty();
								_Schema.appendViews(
									$el,
									'schema_relationship_nodes',
									entity
								);
								_Schema.bindEvents(property);
							}
						}
					});
				}

			}, function(data) {
				Structr.errorFromResponse(data.responseJSON);

				blinkRed($('.' + rowClass, el));
				//_Schema.bindEvents(entity, type, key);
			});
		}
	},
	confirmRemoveSchemaEntity: function(entity, title, callback, hint) {

		Structr.confirmation(
			'<h3>' + title + ' ' + entity.name + '?</h3>' + (hint ? '<p>' + hint + '</p>' : ''),
			function() {
				$.unblockUI({
					fadeOut: 25
				});

				_Schema.removeSchemaEntity(entity, callback);
			},
			callback
		);

	},
	resize: function() {

		Structr.resize();

		var zoom = (instance ? instance.getZoom() : 1);

		var headerHeight = $('#header').outerHeight() + $('.schema-input-container').outerHeight() + 14;

		var canvasSize = {
			w: ($(window).width()) / zoom,
			h: ($(window).height() - headerHeight) / zoom
		};
		$('.node').each(function(i, elem) {
			$elem = $(elem);
			canvasSize.w = Math.max(canvasSize.w, (($elem.position().left + $elem.width()) / zoom));
			canvasSize.h = Math.max(canvasSize.h, (($elem.position().top + $elem.height() - headerHeight) / zoom));
		});

		if (canvas) {
			canvas.css({
				width: canvasSize.w + 'px',
				height: canvasSize.h + 'px'
			});
		}

//		$('#main').css({
//			height: ($(window).height() - $('#main').offset().top)
//		});

		$('body').css({
			position: 'relative'
//			background: '#fff'
		});

		$('html').css({
			background: '#fff'
		});

	},
	appendLocalProperty: function(el, property) {

		var key = property.name;

		el.append('<tr class="' + key + '"><td><input size="15" type="text" class="property-name" value="' + escapeForHtmlAttributes(property.name) + '"></td><td>'
				+ '<input size="15" type="text" class="property-dbname" value="' + escapeForHtmlAttributes(property.dbName) + '"></td><td>'
				+ typeOptions + '</td>'
				+ (property.propertyType !== 'Function' ?  '<td><input size="15" type="text" class="property-format" value="' + (property.format ? escapeForHtmlAttributes(property.format) : '') + '"></td>' : '<td><button class="edit-read-function">Read</button><button class="edit-write-function">Write</button></td>')
				+ '<td><input class="not-null" type="checkbox"'
				+ (property.notNull ? ' checked="checked"' : '') + '></td><td><input class="unique" type="checkbox"'
				+ (property.unique ? ' checked="checked"' : '') + '</td><td><input class="indexed" type="checkbox"'
				+ (property.indexed ? ' checked="checked"' : '') + '</td><td>'
				+ '<input type="text" size="10" class="property-default" value="' + escapeForHtmlAttributes(property.defaultValue) + '">' + '</td><td>'
				+ (property.isBuiltinProperty ? '' : '<img alt="Remove" class="remove-icon remove-property" src="icon/delete.png">')
				+ '</td></tr>');

		_Schema.bindEvents(property);

		if (property.isBuiltinProperty) {
			_Schema.disable(property);
		}

	},
	disable: function(property) {

		var key = property.name;
		var el  = $('.local.schema-props');

		$('.' + key + ' .property-type option[value="' + property.propertyType + '"]', el).prop('disabled', true);

		if (property.propertyType && property.propertyType !== '') {
			$('.' + key + ' .property-name', el).prop('disabled', true);
			$('.' + key + ' .property-dbname', el).prop('disabled', true);
		}

		$('.' + key + ' .property-type', el).prop('disabled', true);
		$('.' + key + ' .property-format', el).prop('disabled', true);
		$('.' + key + ' button', el).prop('disabled', true);
		$('.' + key + ' .not-null', el).prop('disabled', true);
		$('.' + key + ' .unique', el).prop('disabled', true);
		$('.' + key + ' .indexed', el).prop('disabled', true);
		$('.' + key + ' .property-default', el).prop('disabled', true);
		$('.' + key + ' .remove-property', el).prop('disabled', true);

		$('.local .' + key).css('background-color', '#eee');
	},
	bindEvents: function(property) {

		var key = property.name;
		var el  = $('.local.schema-props');

		$('.' + key + ' .property-type option[value="' + property.propertyType + '"]', el).attr('selected', true).prop('disabled', null);

		var typeField = $('.' + key + ' .property-type', el);
		$('.' + key + ' .property-type option[value=""]', el).remove();

		if (property.propertyType === 'String' && !property.isBuiltinProperty) {
			if (!$('input.content-type', typeField.parent()).length) {
				typeField.after('<input type="text" size="5" class="content-type">');
			}
			$('.' + key + ' .content-type', el).on('blur', function() {
				_Schema.savePropertyDefinition(property);
			}).prop('disabled', null).val(property.contentType);
		}

		if (property.propertyType === 'Function' && !property.isBuiltinProperty) {
			if (!$('button.edit-read-function', typeField.parent()).length) {
				$('.' + key + ' .property-format', el).replaceWith('<button class="edit-read-function">Read</button><button class="edit-write-function">Write</button>');
			}
			$('.' + key + ' .content-type', el).on('blur', function() {
				_Schema.savePropertyDefinition(property);
			}).prop('disabled', null).val(property.contentType);
		}

		if (property.propertyType && property.propertyType !== '') {
			$('.' + key + ' .property-name', el).on('change', function() {
				_Schema.savePropertyDefinition(property);
			}).prop('disabled', null).val(property.name);
			$('.' + key + ' .property-dbname', el).on('change', function() {
				_Schema.savePropertyDefinition(property);
			}).prop('disabled', null).val(property.dbName);
		}

		$('.' + key + ' .property-type', el).on('change', function() {
			_Schema.savePropertyDefinition(property);
		}).prop('disabled', null).val(property.propertyType);

		$('.' + key + ' .property-format', el).on('blur', function() {
			_Schema.savePropertyDefinition(property);
		}).prop('disabled', null).val(property.format);

		$('.' + key + ' .edit-read-function', el).on('click', function() {
			_Schema.openCodeEditor($(this), property.id, 'readFunction', function() { _Schema.openEditDialog(property.schemaNode.id, 'local'); });
		}).prop('disabled', null);

		$('.' + key + ' .edit-write-function', el).on('click', function() {
			_Schema.openCodeEditor($(this), property.id, 'writeFunction', function() { _Schema.openEditDialog(property.schemaNode.id, 'local'); });
		}).prop('disabled', null);

		$('.' + key + ' .not-null', el).on('change', function() {
			_Schema.savePropertyDefinition(property);
		}).prop('disabled', null).val(property.notNull);

		$('.' + key + ' .unique', el).on('change', function() {
			_Schema.savePropertyDefinition(property);
		}).prop('disabled', null).val(property.unique);

		$('.' + key + ' .indexed', el).on('change', function() {
			_Schema.savePropertyDefinition(property);
		}).prop('disabled', null).val(property.indexed);

		$('.' + key + ' .property-default', el).on('change', function() {
			_Schema.savePropertyDefinition(property);
		}).prop('disabled', null).val(property.defaultValue);

		$('.' + key + ' .remove-property', el).on('click', function() {
			_Schema.confirmRemoveSchemaEntity(property, 'Delete property', function() { _Schema.openEditDialog(property.schemaNode.id, 'local'); }, 'Property values will not be removed from data nodes.');
		}).prop('disabled', null);

	},
	unbindEvents: function(key) {

		var el = $('.local.schema-props');

		$('.' + key + ' .property-type', el).off('change').prop('disabled', 'disabled');
		$('.' + key + ' .content-type', el).off('change').prop('disabled', 'disabled');
		$('.' + key + ' .property-format', el).off('blur').prop('disabled', 'disabled');
		$('.' + key + ' .not-null', el).off('change').prop('disabled', 'disabled');
		$('.' + key + ' .unique', el).off('change').prop('disabled', 'disabled');
		$('.' + key + ' .indexed', el).off('change').prop('disabled', 'disabled');
		$('.' + key + ' .property-default', el).off('change').prop('disabled', 'disabled');
		$('.' + key + ' .remove-property', el).off('click').prop('disabled', 'disabled');
		$('.' + key + ' button', el).off('click').prop('disabled', 'disabled');

	},
	openCodeEditor: function(btn, id, key, callback) {

		Command.get(id, function(entity) {

			var title = 'Edit ' + key + ' of ' + entity.name;

			Structr.dialog(title, function() {}, function() {});

			_Schema.editCode(btn, entity, key, dialogText, function() {
				window.setTimeout(function () {
					callback();
				}, 250);
			});

		});

	},
	editCode: function(button, entity, key, element, callback) {

		var text = entity[key] || '';

		if (isDisabled(button)) {
			return;
		}
		var div = element.append('<div class="editor"></div>');
		_Logger.log(_LogType.SCHEMA, div);
		var contentBox = $('.editor', element);
		contentType = contentType ? contentType : entity.contentType;
		var text1, text2;

		var lineWrapping = LSWrapper.getItem(lineWrappingKey);

		// Intitialize editor
		editor = CodeMirror(contentBox.get(0), {
			value: text,
			mode: contentType,
			lineNumbers: true,
			lineWrapping: lineWrapping,
			extraKeys: {
				"'.'":        _Contents.autoComplete,
				"Ctrl-Space": _Contents.autoComplete
			},
			indentUnit: 4,
			tabSize:4,
			indentWithTabs: true
		});

		Structr.resize();

		dialogBtn.append('<button id="editorSave" disabled="disabled" class="disabled">Save</button>');
		dialogBtn.append('<button id="saveAndClose" disabled="disabled" class="disabled"> Save and close</button>');

		dialogSaveButton = $('#editorSave', dialogBtn);
		var saveAndClose = $('#saveAndClose', dialogBtn);

		saveAndClose.on('click', function(e) {
			e.stopPropagation();
			dialogSaveButton.click();
			setTimeout(function() {
				dialogSaveButton.remove();
				saveAndClose.remove();
				dialogCancelButton.click();
			}, 500);
		});

		editor.on('change', function(cm, change) {

			if (text === editor.getValue()) {
				dialogSaveButton.prop("disabled", true).addClass('disabled');
				saveAndClose.prop("disabled", true).addClass('disabled');
			} else {
				dialogSaveButton.prop("disabled", false).removeClass('disabled');
				saveAndClose.prop("disabled", false).removeClass('disabled');
			}

			$('#chars').text(editor.getValue().length);
			$('#words').text(editor.getValue().match(/\S+/g).length);
		});

		var scrollInfo = JSON.parse(LSWrapper.getItem(scrollInfoKey + '_' + entity.id));
		if (scrollInfo) {
			editor.scrollTo(scrollInfo.left, scrollInfo.top);
		}

		editor.on('scroll', function() {
			var scrollInfo = editor.getScrollInfo();
			LSWrapper.setItem(scrollInfoKey + '_' + entity.id, JSON.stringify(scrollInfo));
		});

		dialogCancelButton.on('click', function(e) {
			e.stopPropagation();
			e.preventDefault();
			if (callback) {
				callback();
			}
			return false;
		});

		dialogSaveButton.on('click', function(e) {
			e.stopPropagation();

			//var contentNode = Structr.node(entity.id)[0];

			text1 = text;
			text2 = editor.getValue();

			if (!text1)
				text1 = '';
			if (!text2)
				text2 = '';

			_Logger.consoleLog('text1', text1);
			_Logger.consoleLog('text2', text2);

			if (text1 === text2) {
				return;
			}

			Command.setProperty(entity.id, key, text2, false, function() {
				dialogMsg.html('<div class="infoBox success">Code saved.</div>');
				$('.infoBox', dialogMsg).delay(2000).fadeOut(200);
				_Schema.reload();
				dialogSaveButton.prop("disabled", true).addClass('disabled');
				saveAndClose.prop("disabled", true).addClass('disabled');
				Command.getProperty(entity.id, key, function(newText) {
					text = newText;
				});
			});

		});

		dialogMeta.append('<span class="editor-info"><label for="lineWrapping">Line Wrapping:</label> <input id="lineWrapping" type="checkbox"' + (lineWrapping ? ' checked="checked" ' : '') + '></span>');
		$('#lineWrapping').on('change', function() {
			var inp = $(this);
			if  (inp.is(':checked')) {
				LSWrapper.setItem(lineWrappingKey, "1");
				editor.setOption('lineWrapping', true);
			} else {
				LSWrapper.removeItem(lineWrappingKey);
				editor.setOption('lineWrapping', false);
			}
			blinkGreen(inp.parent());
			editor.refresh();
		});

		dialogMeta.append('<span class="editor-info">Characters: <span id="chars">' + editor.getValue().length + '</span></span>');
		dialogMeta.append('<span class="editor-info">Words: <span id="chars">' + editor.getValue().match(/\S+/g).length + '</span></span>');

		editor.id = entity.id;

		editor.focus();

	},

	appendRelatedProperty: function(el, rel, key, out) {
		remotePropertyKeys.push('_' + key);
		var relType = rel.relationshipType;
		relType = relType === undefinedRelType ? '' : relType;

		el.append('<tr class="' + key + '"><td><input size="15" type="text" class="property-name related" value="' + key + '"></td><td>'
				+ (out ? '-' : '&lt;-') + '[:' + relType + ']' + (out ? '-&gt;' : '-') + '</td></tr>');


		if (out) {

			Command.get(rel.targetId, function(targetSchemaNode) {
				$('.' + key + ' td:nth-child(2)', el).append(' <span class="remote-schema-node" id="target_' + targetSchemaNode.id + '">'+ targetSchemaNode.name + '</span>');

				$('#target_' + targetSchemaNode.id, el).on('click', function(e) {
					e.stopPropagation();
					_Schema.openEditDialog(targetSchemaNode.id);
					return false;
				});
			});

		} else {

			Command.get(rel.sourceId, function(sourceSchemaNode) {
				$('.' + key + ' td:nth-child(2)', el).append(' <span class="remote-schema-node" id="source_' + sourceSchemaNode.id + '">'+ sourceSchemaNode.name + '</span>');

				$('#target_' + sourceSchemaNode.id, el).on('click', function(e) {
					e.stopPropagation();
					_Schema.openEditDialog(sourceSchemaNode.id);
					return false;
				});
			});
		}

		$('.' + key + ' .property-name', el).on('blur', function() {

			var newName = $(this).val();

			if (newName === '') {
				newName = undefined;
			}

			if (out) {
				_Schema.setRelationshipProperty(rel, 'targetJsonName', newName, function() {
					blinkGreen($('.' + key, el));
					remotePropertyKeys.push('_' + newName);
					remotePropertyKeys = without('_' + key, remotePropertyKeys);
				}, function() {
					blinkRed($('.' + key, el));
				});
			} else {
				_Schema.setRelationshipProperty(rel, 'sourceJsonName', newName, function() {
					blinkGreen($('.' + key, el));
					remotePropertyKeys.push('_' + newName);
					remotePropertyKeys = without('_' + key, remotePropertyKeys);
				}, function() {
					blinkRed($('.' + key, el));
				});
			}
		});

	},
	appendMethod: function(el, method) {

		var key = method.name;

		// append default actions
		el.append('<tr class="' + key + '"><td style="vertical-align:top;"><input size="15" type="text" class="property-name action" value="'
				+ escapeForHtmlAttributes(method.name) + '"></td><td><textarea rows="4" class="property-code action">'
				+ escapeForHtmlAttributes(method.source) + '</textarea></td><td><textarea rows="4" class="property-comment action">'
				+ escapeForHtmlAttributes(method.comment || '') + '</textarea></td><td><img alt="Remove" title="Remove view" class="remove-icon remove-action" src="icon/delete.png"></td></tr>');

		$('.' + key + ' .property-name.action').on('blur', function() {
			_Schema.saveMethod(method);
		});

		$('.' + key + ' .property-code.action').on('blur', function() {
			_Schema.saveMethod(method);
		});

		$('.' + key + ' .property-comment.action').on('blur', function() {
			_Schema.saveMethod(method);
		});

		$('.' + key + ' .remove-action').on('click', function() {
			_Schema.confirmRemoveSchemaEntity(method, 'Delete method', function() { _Schema.openEditDialog(method.schemaNode.id, 'methods'); });
		});
	},
	appendView: function(el, view, resource, entity) {

		var key      = view.name;
		var selectId = 'select-' + key;

		el.append('<tr class="' + view.name + '"><td style="width:20%;"><input size="15" type="text" class="property-name view" value="' + escapeForHtmlAttributes(view.name) + '">'
				+ '</td><td id="' + selectId + '"></td><td>'
				+ (view.isBuiltinView ? '<img alt="Reset" title="Reset view" class="remove-icon reset-view" src="icon/arrow_undo.png">' : '<img alt="Remove" class="remove-icon remove-view" src="icon/delete.png">')
				+ '</td></tr>');

		_Schema.appendViewSelectionElement('#' + selectId, view, resource, entity);

		$('.' + key + ' .property-attrs.view').on('blur', function() {
			_Schema.saveView(view, entity);
		});

		$('.' + key + ' .property-name.view').on('blur', function() {
			_Schema.saveView(view, entity);
		});

		$('.' + key + ' .remove-view').on('click', function() {
			_Schema.confirmRemoveSchemaEntity(view, 'Delete view', function() { _Schema.openEditDialog(view.schemaNode.id, 'views'); });
		});

		$('.' + key + ' .reset-view').on('click', function() {
			_Schema.confirmRemoveSchemaEntity(view, 'Reset view', function() { _Schema.openEditDialog(view.schemaNode.id, 'views'); });
		});
	},
	appendViewSelectionElement: function(selector, view, resource, schemaEntity) {

		var el = $(selector).last();

		el.append('<select class="property-attrs view" multiple="multiple"></select>');
		var viewSelectElem = $('.property-attrs', el);

		if (view && view.id) {

			viewSelectElem.on('change', function() {
				_Schema.saveView(view, schemaEntity);
			});

			Command.listSchemaProperties(schemaEntity.id, view.name, function(data) {
				_Schema.appendViewOptions(viewSelectElem, view.name, data);
			});

		} else {

			Command.listSchemaProperties(schemaEntity.id, view.name, function(data) {
				_Schema.appendViewOptions(viewSelectElem, view.name, data);
			});
		}
	},
	appendViewOptions: function(viewSelectElem, viewName, properties) {

		properties.forEach(function(prop) {

			var name       = prop.name;
			var isSelected = prop.isSelected ? ' selected="selected"' : '';
			var isDisabled = (viewName === 'ui' || prop.isDisabled) ? ' disabled="disabled"' : '';

			viewSelectElem.append('<option value="' + name + '"' + isSelected + isDisabled + '>' + name + '</option>');
		});

		viewSelectElem.chosen({ search_contains: true, width: '100%' });

	},
	savePropertyDefinition: function(property) {

		var key = property.name;

		_Schema.unbindEvents(key);

		var name = $('.' + key + ' .property-name').val();
		var dbName = $('.' + key + ' .property-dbname').val();
		var type = $('.' + key + ' .property-type').val();
		var contentType = $('.' + key + ' .content-type').val();
		var format = $('.' + key + ' .property-format').val();
		var notNull = $('.' + key + ' .not-null').is(':checked');
		var unique = $('.' + key + ' .unique').is(':checked');
		var indexed = $('.' + key + ' .indexed').is(':checked');
		var defaultValue = $('.' + key + ' .property-default').val();

		if (name && name.length && type) {

			var obj = {};
			obj.name = name;
			obj.dbName = dbName;
			obj.propertyType = type;
			obj.contentType = contentType;
			obj.format = format;
			obj.notNull = notNull;
			obj.unique = unique;
			obj.indexed = indexed;
			obj.defaultValue = defaultValue;

			_Schema.storeSchemaEntity('schema_properties', property, JSON.stringify(obj), function() {

				blinkGreen($('.local .' + key));

				// accept values into property object
				property.name = obj.name;
				property.dbName = obj.dbName;
				property.propertyType = obj.propertyType;
				property.contentType = obj.contentType;
				property.format = obj.format;
				property.notNull = obj.notNull;
				property.unique = obj.unique;
				property.indexed = obj.indexed;
				property.defaultValue = obj.defaultValue;

				// update row class so that consequent changes can be applied
				$('.' + key).removeClass(key).addClass(property.name);
				_Schema.bindEvents(property);

			}, function(data) {

				Structr.errorFromResponse(data.responseJSON);

				blinkRed($('.local .' + key));
				_Schema.bindEvents(property);

			}, function() {

				_Schema.bindEvents(property);
			});
		}
	},
	createMethod: function(el, entity) {

		var key = 'new';

		_Schema.unbindEvents(key);

		var name    = $('.' + key + ' .action.property-name').val();
		var source  = $('.' + key + ' .action.property-code').val();
		var comment = $('.' + key + ' .action.property-comment').val();

		if (name && name.length) {

			var obj = {
				schemaNode: { id: entity.id },
				name:    name,
				source:  source,
				comment: comment
			};

			_Schema.storeSchemaEntity('schema_methods', {}, JSON.stringify(obj), function(result) {

				if (result && result.result) {

					var id = result.result[0];

					$.ajax({
						url: rootUrl + id,
						type: 'GET',
						dataType: 'json',
						contentType: 'application/json; charset=utf-8',
						statusCode: {

							200: function(data) {

								var method = data.result;
								var name   = method.name;
								var row    = $('.new', el);

								blinkGreen(row);

								_Schema.reload();

								_Schema.unbindEvents(name);

								row.removeClass('new').addClass('action').addClass(name);
								row = $('.action.' + name, el);

								$('.remove-action', row).off('click');

								$('.remove-action', row).on('click', function() {
									_Schema.confirmRemoveSchemaEntity(method, 'Delete method', function() { _Schema.openEditDialog(method.schemaNode.id, 'methods'); });
								});

								$('.' + name + ' .property-name.action').on('blur', function() {
									_Schema.saveMethod(method);
								});

								$('.' + name + ' .property-code.action').on('blur', function() {
									_Schema.saveMethod(method);
								});

								$('.' + name + ' .property-comment.action').on('blur', function() {
									_Schema.saveMethod(method);
								});

								_Schema.bindEvents(method);
							}
						}
					});
				}

			}, function() {

				blinkRed($('.actions .' + key));
				_Schema.bindEvents(method);

			}, function() {

				_Schema.bindEvents(method);
			});
		}

	},
	saveMethod: function(method) {

		var key = method.name;

		_Schema.unbindEvents(key);

		var name    = $('.' + key + ' .action.property-name').val();
		var source  = $('.' + key + ' .action.property-code').val();
		var comment = $('.' + key + ' .action.property-comment').val();

		if (name && name.length) {

			var obj = {
				name:    name,
				source:  source,
				comment: comment
			};

			_Schema.storeSchemaEntity('schema_methods', method, JSON.stringify(obj), function() {

				blinkGreen($('.actions .' + key));

				// accept values into property object
				method.name    = obj.name;
				method.source  = obj.source;
				method.comment = obj.comment;

				// update row class so that consequent changes can be applied
				$('.' + key).removeClass(key).addClass(method.name);

				_Schema.bindEvents(method);

			}, function(data) {

				Structr.errorFromResponse(data.responseJSON);

				blinkRed($('.actions .' + key));
				_Schema.bindEvents(method);

			}, function() {

				_Schema.bindEvents(method);
			});
		}
	},
	createView: function(el, entity) {

		var key = 'new';

		_Schema.unbindEvents(key);

		var name = $('.' + key + ' .view.property-name').val();
		var attrs = $('.' + key + ' .view.property-attrs').val();

		if (name && name.length) {

			var obj = {};
			obj.schemaNode         = { id: entity.id };
			obj.schemaProperties   = _Schema.findSchemaPropertiesByNodeAndName({}, entity, attrs);
			obj.nonGraphProperties = _Schema.findNonGraphProperties(entity, attrs);
			obj.name               = name;

			_Schema.storeSchemaEntity('schema_views', {}, JSON.stringify(obj), function(result) {

				if (result && result.result) {

					var id = result.result[0];

					$.ajax({
						url: rootUrl + id,
						type: 'GET',
						dataType: 'json',
						contentType: 'application/json; charset=utf-8',
						statusCode: {

							200: function(data) {

								var view = data.result;
								var name = view.name;
								var row  = $('.new', el);

								blinkGreen(row);

								_Schema.reload();

								_Schema.unbindEvents('new');

								row.removeClass('new').addClass('view').addClass(name);
								row = $('.view.' + name, el);

								$('.remove-view', row).off('click');

								$('.remove-view', row).on('click', function() {
									_Schema.confirmRemoveSchemaEntity(view, 'Delete view', function() { _Schema.openEditDialog(view.schemaNode.id, 'views'); } );
								});

								$('.' + name + ' .view.property-attrs').on('change', function() {
									_Schema.saveView(view, entity);
								});

								_Schema.bindEvents(view);
							}
						}
					});
				}

			}, function() {

				blinkRed($('.views .' + key));
				_Schema.bindEvents({name: key});

			}, function() {

				_Schema.bindEvents({name: key});
			});
		}
	},
	saveView: function(view, entity) {

		var key = view.name;

		_Schema.unbindEvents(key);

		var name = $('.' + key + ' .view.property-name').val();
		var attrs = $('.' + key + ' .view.property-attrs').val();

		// add disabled attributes as well
		$.each($('.' + key + ' .view.property-attrs').children(), function(i, child) {
			if (child.disabled && child.selected) {
				attrs.push(child.value);
			}
		});

		if (name && name.length) {

			var obj                = {};
			obj.schemaNode         = { id: entity.id };
			obj.schemaProperties   = _Schema.findSchemaPropertiesByNodeAndName(entity, attrs);
			obj.nonGraphProperties = _Schema.findNonGraphProperties(entity, attrs);
			obj.name               = name;

			_Schema.storeSchemaEntity('schema_views', view, JSON.stringify(obj), function() {

				blinkGreen($('.views .' + key));

				// accept values into property object
				view.schemaProperties = obj.schemaProperties;
				view.name             = obj.name;

				// update row class so that consequent changes can be applied
				$('.' + key).removeClass(key).addClass(view.name);

				_Schema.bindEvents(view);

			}, function(data) {

				Structr.errorFromResponse(data.responseJSON);

				blinkRed($('.views .' + key));
				_Schema.bindEvents(view);

			}, function() {

				_Schema.bindEvents(view);
			});
		}
	},
	findSchemaPropertiesByNodeAndName: function(entity, names) {

		var result = [];
		var props  = entity['schemaProperties'];

		if (names && names.length && props && props.length) {

			$.each(names, function(i, name) {

				$.each(props, function(i, prop) {

					if (prop.name === name) {
						result.push( { id: prop.id, name: prop.name } );
					}
				});
			});
		}

		return result;
	},
	findNonGraphProperties: function(entity, names) {

		var result = [];
		var props  = entity['schemaProperties'];

		if (names && names.length && props && props.length) {

			$.each(names, function(i, name) {

				var found = false;

				$.each(props, function(i, prop) {

					if (prop.name === name) {
						found = true;
						return;
					}
				});

				if (!found) {
					result.push(name);
				}
			});

		} else if (names) {

			result = names;
		}

		return result.join(', ');
	},
	removeSchemaEntity: function(entity, onSuccess, onError) {

		if (entity && entity.id) {
			$.ajax({
				url: rootUrl + entity.id,
				type: 'DELETE',
				dataType: 'json',
				contentType: 'application/json; charset=utf-8',
				statusCode: {
					200: function() {
						_Schema.reload();
						if (onSuccess) {
							onSuccess();
						}
					},
					422: function(data) {
						//Structr.errorFromResponse(data.responseJSON);
						if (onError) {
							onError(data);
						}
					}
				}
			});
		}
	},
	storeSchemaEntity: function(resource, entity, data, onSuccess, onError, onNoop) {

		var obj = JSON.parse(data);

		if (entity && entity.id) {

			// store existing property
			$.ajax({
				url: rootUrl + entity.id,
				type: 'GET',
				dataType: 'json',
				contentType: 'application/json; charset=utf-8',
				statusCode: {

					200: function(existingData) {

						var changed = false;
						Object.keys(obj).forEach(function(key) {

							if (existingData.result[key] !== obj[key]) {
								changed |= true;
							}
						});

						if (changed) {

							$.ajax({
								url: rootUrl + entity.id,
								type: 'PUT',
								dataType: 'json',
								contentType: 'application/json; charset=utf-8',
								data: JSON.stringify(obj),
								statusCode: {
									200: function() {
										_Schema.reload();
										if (onSuccess) {
											onSuccess();
										}
									},
									422: function(data) {
										//Structr.errorFromResponse(data.responseJSON);
										if (onError) {
											onError(data);
										}
									}
								}
							});

						} else {

							if (onNoop) {
								onNoop();
							}

						}

					}
				}
			});

		} else {

			$.ajax({
				url: rootUrl + resource,
				type: 'POST',
				dataType: 'json',
				contentType: 'application/json; charset=utf-8',
				data: JSON.stringify(obj),
				statusCode: {
					201: function(result) {
						if (onSuccess) {
							onSuccess(result);
						}
					},
					422: function(data) {
						if (onError) {
							onError(data);
						}
					}
				}
			});
		}
	},
	createNode: function(type) {
		var url = rootUrl + 'schema_nodes';
		$.ajax({
			url: url,
			type: 'POST',
			dataType: 'json',
			contentType: 'application/json; charset=utf-8',
			data: JSON.stringify({name: type}),
			statusCode: {
				201: function() {
					_Schema.reload();
				},
				422: function(data) {
					Structr.errorFromResponse(data.responseJSON);
				}
			}

		});
	},
	deleteNode: function(id) {
		var url = rootUrl + 'schema_nodes/' + id;
		$.ajax({
			url: url,
			type: 'DELETE',
			dataType: 'json',
			contentType: 'application/json; charset=utf-8',
			statusCode: {
				200: function() {
					_Schema.reload();
				},
				422: function(data) {
					Structr.errorFromResponse(data.responseJSON);
				}
			}

		});
	},
	createRelationshipDefinition: function(sourceId, targetId, relationshipType) {
		var data = {
			sourceId: sourceId,
			targetId: targetId,
			sourceMultiplicity: '*',
			targetMultiplicity: '*'
		};
		if (relationshipType && relationshipType.length) {
			data.relationshipType = relationshipType;
		}
		$.ajax({
			url: rootUrl + 'schema_relationship_nodes',
			type: 'POST',
			dataType: 'json',
			contentType: 'application/json; charset=utf-8',
			data: JSON.stringify(data),
			statusCode: {
				201: function() {
					_Schema.reload();
				},
				422: function(data) {
					Structr.errorFromResponse(data.responseJSON);
				}
			}
		});
	},
	removeRelationshipDefinition: function(id) {
		$.ajax({
			url: rootUrl + 'schema_relationship_nodes/' + id,
			type: 'DELETE',
			dataType: 'json',
			contentType: 'application/json; charset=utf-8',
			statusCode: {
				200: function(data, textStatus, jqXHR) {
					_Schema.reload();
				},
				422: function(data) {
					Structr.errorFromResponse(data.responseJSON);
				}
			}
		});
	},
	setRelationshipProperty: function(entity, key, value, onSuccess, onError) {
		var data = {};
		data[key] = cleanText(value);
		_Schema.editRelationship(entity, data, onSuccess, onError);
	},
	editRelationship: function(entity, newData, onSuccess, onError) {
		$.ajax({
			url: rootUrl + 'schema_relationship_nodes/' + entity.id,
			type: 'GET',
			contentType: 'application/json; charset=utf-8',
			statusCode: {
				200: function(existingData) {

					var changed = Object.keys(newData).some(function (key) {
						return (existingData.result[key] !== newData[key])
					});

					if (changed) {

						$.ajax({
							url: rootUrl + 'schema_relationship_nodes/' + entity.id,
							type: 'PUT',
							dataType: 'json',
							contentType: 'application/json; charset=utf-8',
							data: JSON.stringify(newData),
							statusCode: {
								200: function(data, textStatus, jqXHR) {
									if (onSuccess) {
										onSuccess();
									}
									_Schema.reload();
								},
								422: function(data) {
									if (onError) {
										onError(data);
									}
								}
							}
						});

					} else {
						// force a schema-reload so that we dont break the relationships
						_Schema.reload();
					}
				}
			}
		});
	},
	connect: function(sourceId, targetId) {
		//Structr.dialog('Enter relationship details');
		_Schema.createRelationshipDefinition(sourceId, targetId, initialRelType);

	},
	detach: function(relationshipId) {
		//Structr.dialog('Enter relationship details');
		_Schema.removeRelationshipDefinition(relationshipId);
	},
	makeAttrEditable: function(element, key, isRel) {
		//element.off('dblclick');

		// cut off three leading underscores and only use 32 characters (the UUID)
		var id = element.prop('id').substring(3,35);

		element.off('hover');
		element.children('b').hide();
		var oldVal = $.trim(element.children('b').text());
		var input = $('input.new-' + key, element);

		if (!input.length) {
			element.prepend('<input type="text" size="' + (oldVal.length + 8) + '" class="new-' + key + '" value="' + oldVal + '">');
			input = $('input.new-' + key, element);
		}

		input.show().focus().select();
		input.on('blur', function() {
			if (!id) {
				return false;
			}
			Command.get(id, function(entity) {
				_Schema.changeAttr(entity, element, input, key, oldVal, isRel);
			});
			return false;
		});

		input.keypress(function(e) {
			if (e.keyCode === 13 || e.keyCode === 9) {
				e.preventDefault();
				if (!id) {
					return false;
				}
				Command.get(id, function(entity) {
					_Schema.changeAttr(entity, element, input, key, oldVal, isRel);
				});
				return false;
			}
		});
		element.off('click');
	},
	changeAttr: function(entity, element, input, key, oldVal, isRel) {
		var newVal = input.val();
		input.hide();
		element.children('b').text(newVal).show();
		if (oldVal !== newVal) {
			var obj = {};
			obj[key] = newVal;
			_Schema.storeSchemaEntity('', entity, JSON.stringify(obj), null, function(data) {
				Structr.errorFromResponse(data.responseJSON);
				element.children('b').text(oldVal).show();
				element.children('input').val(oldVal);
			});
		}
	},
	importGraphGist: function(graphGistUrl, text) {
		$.ajax({
			url: rootUrl + 'maintenance/importGist',
			type: 'POST',
			data: JSON.stringify({'url': graphGistUrl}),
			contentType: 'application/json',
			statusCode: {
				200: function() {
					var btn = $('#import-ggist');
					btn.removeClass('disabled').attr('disabled', null);
					btn.html(text + ' <img src="icon/tick.png">');
					window.setTimeout(function() {
						$('img', btn).fadeOut();
						document.location.reload();
					}, 1000);
				}
			}
		});
	},
	syncSchemaDialog: function() {

		Structr.dialog('Sync schema to remote server', function() {},  function() {});

		var pushConf = JSON.parse(LSWrapper.getItem(pushConfigKey)) || {};

		dialog.append('To sync <b>all schema nodes and relationships</b> to the remote server, ');
		dialog.append('enter host, port, username and password of your remote instance and click Start.');

		dialog.append('<p><button class="btn" id="pull"">Click here</button> if you want to sync your local schema with schema nodes and relationships from the remote server.</p>');

		$('#pull', dialog).on('click', function(e) {
			e.stopPropagation();
			Structr.pullDialog('SchemaNode,SchemaRelationshipNode');
		});

		dialog.append('<table class="props push">'
				+ '<tr><td>Host</td><td><input id="push-host" type="text" length="20" value="' + (pushConf.host || '') + '"></td></tr>'
				+ '<tr><td>Port</td><td><input id="push-port" type="text" length="20" value="' + (pushConf.port || '') + '"></td></tr>'
				+ '<tr><td>Username</td><td><input id="push-username" type="text" length="20" value="' + (pushConf.username || '') + '"></td></tr>'
				+ '<tr><td>Password</td><td><input id="push-password" type="password" length="20" value="' + (pushConf.password || '') + '"></td></tr>'
				+ '</table>'
				+ '<button id="start-push">Start</button>');



		$('#start-push', dialog).on('click', function() {
			var host = $('#push-host', dialog).val();
			var port = parseInt($('#push-port', dialog).val());
			var username = $('#push-username', dialog).val();
			var password = $('#push-password', dialog).val();
			var key = 'key_push_schema';

			pushConf = {host: host, port: port, username: username, password: password};
			LSWrapper.setItem(pushConfigKey, JSON.stringify(pushConf));

			Command.pushSchema(host, port, username, password, key, function() {
				dialog.empty();
				dialogCancelButton.click();
			});
		});

		return false;
	},
	snapshotsDialog: function() {

		Structr.dialog('Schema Snapshots', function() {}, function() {});

		dialog.append('<h3>Create snapshot</h3>');
		dialog.append('<p>Creates a new snapshot of the current schema configuration that can be restored later. You can enter an (optional) suffix for the snapshot.</p>');
		dialog.append('<p><input type="text" name="suffix" id="snapshot-suffix" placeholder="Enter a suffix" length="20" /> <button id="create-snapshot">Create snapshot</button></p>');

		var refresh = function() {

			table.empty();

			Command.snapshots('list', '', null, function(result) {

				result.forEach(function(data) {

					var snapshots = data.snapshots;

					snapshots.forEach(function(snapshot, i) {
						table.append('<tr><td class="snapshot-link name-' + i + '"><a href="#">' + snapshot + '</td><td style="text-align:right;"><button id="restore-' + i + '">Restore</button><button id="add-' + i + '">Add</button><button id="delete-' + i + '">Delete</button></td></tr>');

						$('.name-' + i + ' a').on('click', function() {
							Command.snapshots("get", snapshot, null, function(data) {

								var element = document.createElement('a');
								element.setAttribute('href', 'data:text/plain;charset=utf-8,' + encodeURIComponent(data.schemaJson));
								element.setAttribute('download', snapshot);

								element.style.display = 'none';
								document.body.appendChild(element);

								element.click();
								document.body.removeChild(element);
							});
						});

						$('#restore-' + i).on('click', function() {

							Command.snapshots("restore", snapshot, null, function(data) {

								var status = data[0].status;

								if (status === 'success') {
									window.location.reload();
								} else {

									if (dialogBox.is(':visible')) {

										dialogMsg.html('<div class="infoBox error">' + status + '</div>');
										$('.infoBox', dialogMsg).delay(2000).fadeOut(200);
									}
								}
							});
						});
						$('#add-' + i).on('click', function() {

							Command.snapshots('add', snapshot, null, function(data) {

								var status = data[0].status;

								if (status === 'success') {
									window.location.reload();
								} else {

									if (dialogBox.is(':visible')) {

										dialogMsg.html('<div class="infoBox error">' + status + '</div>');
										$('.infoBox', dialogMsg).delay(2000).fadeOut(200);
									}
								}
							});
						});
						$('#delete-' + i).on('click', function() {
							Command.snapshots('delete', snapshot, null, refresh);
						});
					});

				});

			});
		};

		$('#create-snapshot').on('click', function() {

			var suffix = $('#snapshot-suffix').val();

			var types = [];
			if (selectedNodes && selectedNodes.length) {
				selectedNodes.forEach(function(selectedNode) {
					types.push(selectedNode.name);
				});

				$('.label.rel-type', canvas).each(function (idx, el) {
					$el = $(el);

					var sourceType = $el.children('div').attr('data-source-type');
					var targetType = $el.children('div').attr('data-target-type');

					// include schema relationship if both source and target type are selected
					if (types.indexOf(sourceType) !== -1 && types.indexOf(targetType) !== -1) {
						types.push($el.children('div').attr('data-name'));
					}
				});
			}

			Command.snapshots('export', suffix, types, function(data) {

				var status = data[0].status;
				if (dialogBox.is(':visible')) {

					if (status === 'success') {

						dialogMsg.html('<div class="infoBox success">Snapshot successfully created</div>');
						$('.infoBox', dialogMsg).delay(2000).fadeOut(200);

					} else {

						dialogMsg.html('<div class="infoBox error">Snapshot creation failed.</div>');
						$('.infoBox', dialogMsg).delay(2000).fadeOut(200);
					}
				}

				refresh();
			});

		});

		dialog.append('<h3>Available snapshots to restore</h3>');

		dialog.append('<table class="props" id="snapshots"></table>');

		var table = $('#snapshots');

		refresh();

		// update button
		dialog.append('<p style="text-align: right;"><button id="refresh-snapshots">Refresh</button></p>');
		$('#refresh-snapshots').on('click', refresh);

		return false;
	},
	openAdminTools: function() {
		Structr.dialog('Admin Tools', function() {
		}, function() {
		});

		dialogText.append('<table id="admin-tools-table"></table>');
		var toolsTable = $('#admin-tools-table');
		toolsTable.append('<tr><td><button id="rebuild-index"><img src="icon/arrow_refresh.png"> Rebuild Index</button></td><td><label for"rebuild-index">Rebuild database index for all nodes and relationships</label></td></tr>');
		toolsTable.append('<tr><td><button id="clear-schema"><img src="icon/delete.png"> Clear Schema</button></td><td><label for"clear-schema">Delete all schema nodes and relationships of dynamic schema</label></td></tr>');
		toolsTable.append('<tr><td><select id="node-type-selector"><option selected value="">-- Select Node Type --</option><option disabled>──────────</option><option value="allNodes">All Node Types</option><option disabled>──────────</option></select><button id="add-node-uuids">Add UUIDs</button></td><td><label for"setUuid">Add UUIDs to all nodes of the selected type</label></td></tr>');
		toolsTable.append('<tr><td><select id="rel-type-selector"><option selected value="">-- Select Relationship Type --</option><option disabled>──────────</option><option value="allRels">All Relationship Types</option><option disabled>──────────</option></select><button id="add-rel-uuids">Add UUIDs</button></td><td><label for"setUuid">Add UUIDs to all relationships of the selected type</label></td></tr>');

		toolsTable.append('<tr><td><button id="save-layout"><img src="icon/database.png"> Save Schema Layout</button></td><td><label for"save-layout">Save current positions to backend.</label></td></tr>');
		toolsTable.append('<tr><td><button id="export-layout">Export Schema Layout</button></td><td><label for"export-layout">Export current schema positions as a JSON string</label></td></tr>');
		toolsTable.append('<tr id="schema-layout-export-row"><td></td><td><textarea id="schema-layout-export-textarea"></textarea><button class="btn" id="copy-schema-layout-export" data-clipboard-target="#schema-layout-export-textarea" data-clipboard-action="cut">Copy</button></td></tr>');
		toolsTable.append('<tr><td><button id="import-layout">Import Schema Layout</button></td><td><label for"import-layout">Read schema positions from JSON string</label></td></tr>');
		toolsTable.append('<tr id="schema-layout-import-row"><td></td><td><textarea id="schema-layout-import-textarea"></textarea><button class="btn" id="import-schema-layout-export">Import</button></td></tr>');

		$('#save-layout', toolsTable).click(function() {
			Structr.saveLocalStorage();
		});

		$('#schema-layout-export-row').hide();
		$('#schema-layout-import-row').hide();

		new Clipboard('#copy-schema-layout-export', {
			target: function () {
				window.setTimeout(function () {
					$('#schema-layout-export-row').hide();
				}, 1000);
				return document.getElementById('schema-layout-export-textarea');
			}
		});

		$('#export-layout', toolsTable).click(function() {
			var url = rootUrl + 'schema_nodes';
			$.ajax({
				url: url,
				dataType: 'json',
				contentType: 'application/json; charset=utf-8',
				success: function(data) {
					var res = {};
					data.result.forEach(function (entity, idx) {
						var pos = _Schema.getPosition(entity.name);
						if (pos) {
							res[entity.name] = {position: pos};
						}
					});
					$('#schema-layout-export-textarea').val(JSON.stringify(res));
					$('#schema-layout-export-row').show();
				}
			});

		});

		$('#import-layout', toolsTable).click(function() {
			$('#schema-layout-import-row').show();
		});

		$('#import-schema-layout-export').click(function () {

			var jsonString = $('#schema-layout-import-textarea').val();
			var obj;

			try {
				obj = JSON.parse(jsonString);
			} catch (e) {
				alert ("Unreadable JSON - please make sure you are using JSON exported from this dialog!");
			}

			if (obj) {
				Object.keys(obj).forEach(function (type) {
					LSWrapper.setItem(type + localStorageSuffix + 'node-position', JSON.stringify(obj[type]));
				});

				$('#schema-graph .node').each(function(i, n) {
					var node = $(n);
					var type = node.text();

					if (obj[type]) {
						node.css('top', obj[type].position.top);
						node.css('left', obj[type].position.left);
					}
				});

				Structr.saveLocalStorage();

				instance.repaintEverything();

				$('#schema-layout-import-textarea').val('Import successful - imported ' + Object.keys(obj).length + ' positions.');

				window.setTimeout(function () {
					$('#schema-layout-import-row').hide();
					$('#schema-layout-import-textarea').val('');
				}, 2000);

			}

		});

		$('#rebuild-index').on('click', function(e) {
			var btn = $(this);
			var text = btn.text();
			btn.attr('disabled', 'disabled').addClass('disabled').html(text + ' <img src="img/al.gif">');
			e.preventDefault();
			$.ajax({
				url: rootUrl + 'maintenance/rebuildIndex',
				type: 'POST',
				data: {},
				contentType: 'application/json',
				statusCode: {
					200: function() {
						var btn = $('#rebuild-index');
						btn.removeClass('disabled').attr('disabled', null);
						btn.html(text + ' <img src="icon/tick.png">');
						window.setTimeout(function() {
							$('img', btn).fadeOut();
						}, 1000);
					}
				}
			});
		});

		$('#clear-schema').on('click', function(e) {

			Structr.confirmation('<h3>Delete schema?</h3><p>This will remove all dynamic schema information, but not your other data.</p><p>&nbsp;</p>',
					function() {
						$.unblockUI({
							fadeOut: 25
						});

						var btn = $(this);
						var text = btn.text();
						btn.attr('disabled', 'disabled').addClass('disabled').html(text + ' <img src="img/al.gif">');
						e.preventDefault();
						$.ajax({
							url: rootUrl + 'schema_relationship_nodes',
							type: 'DELETE',
							data: {},
							contentType: 'application/json',
							statusCode: {
								200: function() {
									_Schema.reload();
									$.ajax({
										url: rootUrl + 'schema_nodes',
										type: 'DELETE',
										data: {},
										contentType: 'application/json',
										statusCode: {
											200: function() {
												_Schema.reload();
												var btn = $('#clear-schema');
												btn.removeClass('disabled').attr('disabled', null);
												btn.html(text + ' <img src="icon/tick.png">');
												window.setTimeout(function() {
													$('img', btn).fadeOut();
												}, 1000);
											}
										}
									});

								}
							}
						});
					});
		});

		var nodeTypeSelector = $('#node-type-selector');
		var relTypeSelector = $('#rel-type-selector');

		Command.list('SchemaNode', true, 1000, 1, 'name', 'asc', 'id,name', function(nodes) {
			nodes.forEach(function(node) {
				nodeTypeSelector.append('<option>' + node.name + '</option>');
			});
		});

		Command.list('SchemaRelationshipNode', true, 1000, 1, 'relationshipType', 'asc', 'id,relationshipType', function(rels) {
			rels.forEach(function(rel) {
				relTypeSelector.append('<option>' + rel.relationshipType + '</option>');
			});
		});

		$('#add-node-uuids').on('click', function(e) {
			var btn = $(this);
			var text = btn.text();
			e.preventDefault();
			var type = nodeTypeSelector.val();
			if (!type) {
				nodeTypeSelector.addClass('notify');
				nodeTypeSelector.on('change', function() {
					nodeTypeSelector.removeClass('notify');
				});
				return;
			}
			var data;
			if (type === 'allNodes') {
				data = JSON.stringify({'allNodes': true});
			} else {
				data = JSON.stringify({'type': type});
			}
			btn.attr('disabled', 'disabled').addClass('disabled').html(text + ' <img src="img/al.gif">');
			$.ajax({
				url: rootUrl + 'maintenance/setUuid',
				type: 'POST',
				data: data,
				contentType: 'application/json',
				statusCode: {
					200: function() {
						var btn = $('#add-node-uuids');
						nodeTypeSelector.removeClass('notify');
						btn.removeClass('disabled').attr('disabled', null);
						btn.html(text + ' <img src="icon/tick.png">');
						window.setTimeout(function() {
							$('img', btn).fadeOut();
						}, 1000);
					}
				}
			});
		});

		$('#add-rel-uuids').on('click', function(e) {
			var btn = $(this);
			var text = btn.text();
			e.preventDefault();
			var relType = relTypeSelector.val();
			if (!relType) {
				relTypeSelector.addClass('notify');
				relTypeSelector.on('change', function() {
					relTypeSelector.removeClass('notify');
				});
				return;
			}
			var data;
			if (relType === 'allRels') {
				data = JSON.stringify({'allRels': true});
			} else {
				data = JSON.stringify({'relType': relType});
			}
			btn.attr('disabled', 'disabled').addClass('disabled').html(text + ' <img src="img/al.gif">');
			$.ajax({
				url: rootUrl + 'maintenance/setUuid',
				type: 'POST',
				data: data,
				contentType: 'application/json',
				statusCode: {
					200: function() {
						var btn = $('#add-rel-uuids');
						relTypeSelector.removeClass('notify');
						btn.removeClass('disabled').attr('disabled', null);
						btn.html(text + ' <img src="icon/tick.png">');
						window.setTimeout(function() {
							$('img', btn).fadeOut();
						}, 1000);
					}
				}
			});
		});

	},
	openSchemaDisplayOptions: function() {
		Structr.dialog('Schema Display Options', function() {
		}, function() {
		});

		dialogText.append('<h3>Visibility</h3><table class="props" id="schema-options-table"><tr><th>Type</th><th>Visible <input type="checkbox" id="toggle-all-types"><img class="invert-icon" src="icon/arrow_switch.png" id="invert-all-types"></button></th></table>');
		var schemaOptionsTable = $('#schema-options-table');

		// list: function(type, rootOnly, pageSize, page, sort, order, properties, callback)
		Command.list('SchemaNode', false, 1000, 1, 'name', 'asc', null, function(schemaNodes) {
			schemaNodes.forEach(function(schemaNode) {
				schemaOptionsTable.append('<tr><td>' + schemaNode.name + '</td><td><input class="toggle-type" data-structr-id="' + schemaNode.id + '" type="checkbox" ' + (hiddenSchemaNodes.indexOf(schemaNode.id) > -1 ? '' : 'checked') + '></td></tr>');
			});

			$('#toggle-all-types', schemaOptionsTable).on('click', function() {
				$('.toggle-type', schemaOptionsTable).each(function(i, checkbox) {
					var inp = $(checkbox);
					inp.prop("checked", $('#toggle-all-types', schemaOptionsTable).prop("checked"));
					_Schema.checkIsHiddenSchemaNode(inp);
				});
				_Schema.reload();
		});

			$('#invert-all-types', schemaOptionsTable).on('click', function() {
				$('.toggle-type', schemaOptionsTable).each(function(i, checkbox) {
					var inp = $(checkbox);
					inp.prop("checked", !inp.prop("checked"));
					_Schema.checkIsHiddenSchemaNode(inp);
				});
				_Schema.reload();
			});

			$('#save-options', schemaOptionsTable).on('click', function() {
				Structr.saveLocalStorage();
			});

			// Suppress click action on checkbox, action is triggered by event bound to underlying td element
			$('td .toggle-type', schemaOptionsTable).on('click', function(e) {
				e.stopPropagation();
				e.preventDefault();
				return false;
			});

			$('td', schemaOptionsTable).on('mouseup', function(e) {
				e.stopPropagation();
				e.preventDefault();
				var td = $(this);
				var inp = $('.toggle-type', td);
				inp.prop("checked", !inp.prop("checked"));
				_Schema.checkIsHiddenSchemaNode(inp);
				_Schema.reload();
				return false;
			});

		});

	},
	checkIsHiddenSchemaNode: function(inp) {
		var key = inp.attr('data-structr-id');
		//console.log(inp, key, inp.is(':checked'));
		if (!inp.is(':checked')) {
			if (hiddenSchemaNodes.indexOf(key) === -1) {
				hiddenSchemaNodes.push(key);
			}
			nodes[key] = undefined;
			LSWrapper.setItem(hiddenSchemaNodesKey, JSON.stringify(hiddenSchemaNodes));
		} else {
			if (hiddenSchemaNodes.indexOf(key) > -1) {
				hiddenSchemaNodes.splice(hiddenSchemaNodes.indexOf(key), 1);
				Command.get(key, function(schemaNode) {
					nodes[key] = schemaNode;
					LSWrapper.setItem(hiddenSchemaNodesKey, JSON.stringify(hiddenSchemaNodes));
				});
			}
		}
	},
	getPropertyName: function(type, relationshipType, relatedType, out, callback) {
		$.ajax({
			url: rootUrl + '_schema/' + type,
			type: 'GET',
			contentType: 'application/json; charset=utf-8',
			statusCode: {
				200: function(data) {
					var properties = data.result[0].views.all;
					Object.keys(properties).forEach(function(key) {
						var obj = properties[key];
						var simpleClassName = obj.className.split('.')[obj.className.split('.').length - 1];
						if (obj.relatedType && obj.relationshipType) {
							if (obj.relatedType.endsWith(relatedType) && obj.relationshipType === relationshipType && ((simpleClassName.startsWith('EndNode') && out)
									|| (simpleClassName.startsWith('StartNode') && !out))) {
								callback(key, obj.isCollection);
							}

						}
					});
				}
			}
		});

	},
	doLayout: function() {

		var nodesToLayout = new Array();
		var relsToLayout = new Array();

		$.each(Object.keys(nodes), function(i, id) {

			if (!id.endsWith('_top') && !id.endsWith('_bottom')) {

				var node = $('#id_' + id);
				nodesToLayout.push(node);
			}
		});

		$.each(Object.keys(rels), function(i, id) {
			relsToLayout.push(rels[id]);
		});

		_Layout.doLayout(nodesToLayout, relsToLayout);
	},
	setZoom: function(zoom, instance, transformOrigin, el) {
		transformOrigin = transformOrigin || [ 0.5, 0.5 ];
		instance = instance || jsPlumb;
		el = el || instance.getContainer();
		var p = [ "webkit", "moz", "ms", "o" ],
			s = "scale(" + zoom + ")",
			oString = (transformOrigin[0] * 100) + "% " + (transformOrigin[1] * 100) + "%";

		for (var i = 0; i < p.length; i++) {
			el.style[p[i] + "Transform"] = s;
			el.style[p[i] + "TransformOrigin"] = oString;
		}

		el.style["transform"] = s;
		el.style["transformOrigin"] = oString;

		instance.setZoom(zoom);
		_Schema.resize();
	},
	sort: function(collection, sortKey) {
		if (!sortKey) {
			sortKey = "name";
		}
		collection.sort(function(a, b) {
			return ((a[sortKey] > b[sortKey]) ? 1 : ((a[sortKey] < b[sortKey]) ? -1 : 0));
		});
	},
	updateOverlayVisibility: function(show) {
		LSWrapper.setItem(showSchemaOverlaysKey, show);
		$('#schema-show-overlays').prop('checked', show);
		if (show) {
			$('.rel-type, .multiplicity').show();
		} else {
			$('.rel-type, .multiplicity').hide();
		}
	}
};

function normalizeAttr(attr) {
	return attr.replace(/^_+/, '');
}

function normalizeAttrs(attrs, keys) {
	return attrs.replace(/ /g, '').split(',').map(function(attr) {
		var a = normalizeAttr(attr);
		if (keys.indexOf('_' + a) !== -1) {
			return '_' + a;
		}
		return a;
	}).join(',');
}

function denormalizeAttrs(attrs) {
	return attrs.replace(/ /g, '').split(',').map(function(attr) {
		var a = normalizeAttr(attr);
		return a;
	}).join(', ');
}

var typeOptions = '<select class="property-type"><option value="">--Select--</option>'
		+ '<option value="String">String</option>'
		+ '<option value="StringArray">String[]</option>'
		+ '<option value="Integer">Integer</option>'
		+ '<option value="Long">Long</option>'
		+ '<option value="Double">Double</option>'
		+ '<option value="Boolean">Boolean</option>'
		+ '<option value="Enum">Enum</option>'
		+ '<option value="Date">Date</option>'
		+ '<option value="Count">Count</option>'
		+ '<option value="Function">Function</option>'
		+ '<option value="Notion">Notion</option>'
		+ '<option value="Join">Join</option>'
		+ '<option value="Cypher">Cypher</option>'
		+ '<option value="Thumbnail">Thumbnail</option>';
