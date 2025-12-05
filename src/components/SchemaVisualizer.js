import React, { useEffect, useRef } from 'react';
import ReactFlow, {
    Background,
    Controls,
    Handle,
    Position,
    useNodesState,
    useEdgesState,
    useReactFlow,
    ReactFlowProvider
} from 'reactflow';
import dagre from 'dagre';
import 'reactflow/dist/style.css';
import './SchemaVisualizer.css';

// Custom Node Component for Database Tables - Modern "Pill" Design
const TableNode = ({ data, id }) => {
    const columns = data.columns || [];
    const isExpanded = data.isExpanded;
    const onToggle = data.onToggle;

    // Filter for key columns (explicit keys or heuristics)
    const keyColumns = columns.filter(col =>
        col.primary_key || col.pk || col.foreign_key || col.fk ||
        col.name.toLowerCase() === 'id' ||
        col.name.toLowerCase().endsWith('_id')
    );

    return (
        <div className={`table-node ${isExpanded ? 'expanded' : ''}`}>
            {/* Default handles for collapsed state */}
            <Handle type="target" position={Position.Left} style={{ opacity: 0, top: '50%' }} />
            <Handle type="source" position={Position.Right} style={{ opacity: 0, top: '50%' }} />

            <div
                className="table-pill"
                onClick={() => onToggle(id)}
            >
                <div className="table-pill-content">
                    <span className="table-icon">🗃️</span>
                    <span className="table-name">{data.label}</span>
                </div>
            </div>

            {isExpanded && (
                <div className="table-columns-container">
                    {keyColumns.length > 0 ? (
                        keyColumns.map((col, index) => (
                            <div key={index} className="table-column-row" style={{ position: 'relative' }}>
                                {/* Column-specific handles */}
                                <Handle
                                    type="target"
                                    position={Position.Left}
                                    id={`target-${col.name}`}
                                    style={{ left: -10, opacity: 0 }}
                                />
                                <span className="col-name">{col.name}</span>
                                <span className="col-type">{col.type}</span>
                                <Handle
                                    type="source"
                                    position={Position.Right}
                                    id={`source-${col.name}`}
                                    style={{ right: -10, opacity: 0 }}
                                />
                            </div>
                        ))
                    ) : (
                        <div className="no-columns">No key columns</div>
                    )}
                </div>
            )}
        </div>
    );
};

const nodeTypes = {
    table: TableNode,
};

// Layout Helper using Dagre
const getLayoutedElements = (nodes, edges, direction = 'LR') => {
    const dagreGraph = new dagre.graphlib.Graph();
    dagreGraph.setDefaultEdgeLabel(() => ({}));

    dagreGraph.setGraph({
        rankdir: direction,
        ranksep: 300, // Increased horizontal spacing to give edges more room
        nodesep: 100   // Increased vertical spacing
    });

    nodes.forEach((node) => {
        // Dynamic width calculation based on label length
        // Base width 220px + approx 12px per character over 10 chars
        const labelLength = node.data.label ? node.data.label.length : 0;
        const dynamicWidth = Math.max(240, labelLength * 12 + 70); // Ensure enough space for icon + padding

        dagreGraph.setNode(node.id, { width: dynamicWidth, height: 80 });
    });

    edges.forEach((edge) => {
        dagreGraph.setEdge(edge.source, edge.target);
    });

    dagre.layout(dagreGraph);

    const layoutedNodes = nodes.map((node) => {
        const nodeWithPosition = dagreGraph.node(node.id);
        node.targetPosition = direction === 'LR' ? 'left' : 'top';
        node.sourcePosition = direction === 'LR' ? 'right' : 'bottom';

        // Shift to match React Flow top-left anchor
        node.position = {
            x: nodeWithPosition.x - nodeWithPosition.width / 2,
            y: nodeWithPosition.y - nodeWithPosition.height / 2,
        };

        return node;
    });

    return { nodes: layoutedNodes, edges };
};

const SchemaVisualizerInner = ({ schema }) => {
    const [nodes, setNodes, onNodesChange] = useNodesState([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState([]);
    const { fitView } = useReactFlow();
    const initializedRef = useRef(false);
    const [isLayoutReady, setIsLayoutReady] = React.useState(false);
    const [expandedNodes, setExpandedNodes] = React.useState(new Set());

    // Toggle node expansion
    const toggleNode = React.useCallback((nodeId) => {
        setExpandedNodes((prev) => {
            const next = new Set(prev);
            if (next.has(nodeId)) {
                next.delete(nodeId);
            } else {
                next.add(nodeId);
            }
            return next;
        });
    }, []);

    // Initialize and layout nodes
    useEffect(() => {
        if (!schema || !schema.tables) return;

        setIsLayoutReady(false);

        // 1. Create initial nodes
        const initialNodes = schema.tables.map((table) => ({
            id: table.name,
            type: 'table',
            data: {
                label: table.name,
                columns: table.columns || [],
                isExpanded: false, // Initial state
                onToggle: toggleNode
            },
            position: { x: 0, y: 0 }
        }));

        // 2. Create edges from related_tables (from canonical schema)
        const initialEdges = [];
        const addedEdges = new Set(); // Avoid duplicate edges

        schema.tables.forEach(sourceTable => {
            const relatedTables = sourceTable.related_tables || [];
            relatedTables.forEach(targetTableName => {
                // Check if target table exists in schema
                const targetTable = schema.tables.find(t => t.name === targetTableName);
                if (targetTable) {
                    const edgeId = `${sourceTable.name}-${targetTableName}`;
                    if (!addedEdges.has(edgeId)) {
                        addedEdges.add(edgeId);

                        // Find the FK column (column ending with referenced table name + _id)
                        const columns = sourceTable.columns || [];
                        const fkColumn = columns.find(col =>
                            col.name.endsWith('_id') &&
                            (col.name === `${targetTableName}_id` ||
                             col.name === `${targetTableName.replace(/s$/, '')}_id`)
                        );

                        initialEdges.push({
                            id: edgeId,
                            source: sourceTable.name,
                            target: targetTableName,
                            type: 'smoothstep',
                            style: { stroke: '#999', strokeWidth: 1.5 },
                            markerEnd: {
                                type: 'arrowclosed',
                                color: '#999',
                            },
                            animated: false,
                            data: {
                                sourceColumn: fkColumn ? fkColumn.name : null,
                                targetColumn: 'id'
                            }
                        });
                    }
                }
            });
        });

        // 3. Apply Dagre Layout
        const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(
            initialNodes,
            initialEdges,
            'LR' // Left-to-Right layout
        );

        setNodes(layoutedNodes);
        setEdges(layoutedEdges);
        initializedRef.current = true;

        // 4. Fit view and show
        setTimeout(() => {
            fitView({ padding: 0.2, minZoom: 0.6, duration: 0 });
            // Small delay to ensure render before showing
            setTimeout(() => setIsLayoutReady(true), 50);
        }, 10);

    }, [schema, setNodes, setEdges, fitView, toggleNode]);

    // Update nodes and edges when expansion changes
    useEffect(() => {
        if (!initializedRef.current) return;

        setNodes((nds) => nds.map((node) => ({
            ...node,
            data: {
                ...node.data,
                isExpanded: expandedNodes.has(node.id),
                onToggle: toggleNode
            }
        })));

        setEdges((eds) => eds.map((edge) => {
            const isSourceExpanded = expandedNodes.has(edge.source);
            const isTargetExpanded = expandedNodes.has(edge.target);

            let sourceHandle = null;
            let targetHandle = null;

            // If source is expanded, connect to specific column
            if (isSourceExpanded && edge.data && edge.data.sourceColumn) {
                sourceHandle = `source-${edge.data.sourceColumn}`;
            }

            // If target is expanded, connect to specific column
            if (isTargetExpanded && edge.data && edge.data.targetColumn) {
                targetHandle = `target-${edge.data.targetColumn}`;
            }

            return {
                ...edge,
                sourceHandle,
                targetHandle
            };
        }));

    }, [expandedNodes, setNodes, setEdges, toggleNode]);

    return (
        <div
            className="schema-visualizer-container"
            style={{
                opacity: isLayoutReady ? 1 : 0,
                transition: 'opacity 0.3s ease-in'
            }}
        >
            <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                nodeTypes={nodeTypes}
                fitView
                minZoom={0.1} // Allow zooming out far manually
                maxZoom={1.5}
                attributionPosition="bottom-right"
            >
                <Background color="#f0f0f0" gap={20} />
                <Controls />
            </ReactFlow>
        </div>
    );
};

const SchemaVisualizer = (props) => (
    <ReactFlowProvider>
        <SchemaVisualizerInner {...props} />
    </ReactFlowProvider>
);

export default SchemaVisualizer;
