/**
 * Tree view for FetchXML query builder
 * Displays hierarchical structure: Entity -> Attributes, Orders, Filters, Link-Entities
 */

import { useState, useEffect, useCallback, type MouseEvent } from "react";
import {
	Tree,
	TreeItem,
	TreeItemLayout,
	Button,
	makeStyles,
	Menu,
	MenuTrigger,
	MenuPopover,
	MenuList,
	MenuItem,
	MenuDivider,
	tokens,
	type TreeOpenChangeData,
} from "@fluentui/react-components";
import {
	Table20Regular,
	Column20Regular,
	Filter20Regular,
	ArrowSort20Regular,
	Link20Regular,
	Add20Regular,
	Delete20Regular,
} from "@fluentui/react-icons";
import type {
	FetchNode,
	EntityNode,
	AttributeNode,
	AllAttributesNode,
	OrderNode,
	FilterNode,
	ConditionNode,
	LinkEntityNode,
	NodeId,
} from "../../model/nodes";
import { operatorRequiresValue } from "../../model/operators";
import { debugLog, debugWarn } from "../../../../shared/utils/debug";
import { SelectAttributesDialog } from "../Dialogs/SelectAttributesDialog";
import { metadataCache } from "../../state/cache";
import type { AttributeMetadata } from "../../api/pptbClient";
import { loadEntityAttributes } from "../../api/dataverseMetadata";

/**
 * Format a value for display, avoiding scientific notation for numbers
 */
function formatDisplayValue(val: unknown): string {
	if (typeof val === "number") {
		if (Math.abs(val) < 1e-10 && val !== 0) {
			// Very small numbers - use high precision
			return val.toFixed(20).replace(/\.?0+$/, "");
		} else if (Number.isInteger(val)) {
			// Integer - no decimal point needed
			return val.toString();
		} else {
			// Decimal - preserve precision but remove trailing zeros
			return val.toFixed(10).replace(/\.?0+$/, "");
		}
	}
	if (Array.isArray(val)) {
		// Format array values (for between, in, etc.)
		return val.map((v) => formatDisplayValue(v)).join(", ");
	}
	return String(val);
}

const useStyles = makeStyles({
	container: {
		flex: 1,
		overflow: "auto",
		padding: "8px",
		minHeight: 0, // Important for flex child with overflow
		// Ensure scrollbars are always visible when content overflows
		scrollbarGutter: "stable",
	},
	treeItem: {
		"&:hover": {
			backgroundColor: tokens.colorNeutralBackground1Hover,
		},
	},
	selectedTreeItem: {
		backgroundColor: tokens.colorNeutralBackground1Selected,
		color: tokens.colorNeutralForeground1Selected,
		"&:hover": {
			backgroundColor: tokens.colorNeutralBackground1Selected,
		},
	},
	actions: {
		display: "flex",
		gap: "4px",
		opacity: 0,
		transition: "opacity 0.2s",
		"&:focus-within": {
			opacity: 1,
		},
	},
	treeItemWithActions: {
		"&:hover .actions": {
			opacity: 1,
		},
	},
});

interface TreeViewProps {
	fetchQuery: FetchNode;
	selectedNodeId: NodeId | null;
	onNodeSelect: (nodeId: NodeId) => void;
	onAddAttribute: (parentId: NodeId) => void;
	onAddAllAttributes: (parentId: NodeId) => void;
	onAddOrder: (parentId: NodeId) => void;
	onAddFilter: (parentId: NodeId) => void;
	onAddSubfilter: (filterId: NodeId) => void;
	onAddCondition: (filterId: NodeId) => void;
	onAddLinkEntity: (parentId: NodeId) => void;
	onRemoveNode: (nodeId: NodeId) => void;
	onUpdateAttributes: (parentId: NodeId, attributeNames: string[]) => void;
}

export function TreeView({
	fetchQuery,
	selectedNodeId,
	onNodeSelect,
	onAddAttribute,
	onAddAllAttributes,
	onAddOrder,
	onAddFilter,
	onAddSubfilter,
	onAddCondition,
	onAddLinkEntity,
	onRemoveNode,
	onUpdateAttributes,
}: TreeViewProps) {
	const styles = useStyles();
	const getTreeItemLayoutClassName = (nodeId: NodeId) =>
		selectedNodeId === nodeId ? styles.selectedTreeItem : undefined;
	const handleNodeSelect = (nodeId: NodeId) => (event: MouseEvent) => {
		if (
			event.target instanceof Element &&
			event.target.closest(".fui-TreeItemLayout__expandIcon")
		) {
			return;
		}

		event.preventDefault();
		onNodeSelect(nodeId);
	};
	const stopMenuEventPropagation = (event: MouseEvent) => event.stopPropagation();

	// Dialog state
	const [selectAttrsDialogOpen, setSelectAttrsDialogOpen] = useState(false);
	const [selectAttrsEntityId, setSelectAttrsEntityId] = useState<NodeId | null>(null);
	const [selectAttrsDisplayName, setSelectAttrsDisplayName] = useState<string>("");
	const [selectAttrsAttributes, setSelectAttrsAttributes] = useState<AttributeMetadata[]>([]);
	const [selectAttrsCurrentNames, setSelectAttrsCurrentNames] = useState<string[]>([]);

	// Manage which tree items are open/expanded
	const [openItems, setOpenItems] = useState<Set<NodeId>>(
		new Set([fetchQuery.id, fetchQuery.entity.id])
	);

	// Helper to find path from root to a node (all ancestor IDs)
	const findPathToNode = (targetId: NodeId): NodeId[] => {
		const path: NodeId[] = [];

		const findInNode = (node: unknown, target: NodeId): boolean => {
			if (!node || typeof node !== "object") return false;

			const n = node as Record<string, unknown>;

			if (n.id === target) {
				debugLog("treeExpansion", "Found target node:", n.id);
				// Don't add the target to path, only ancestors
				return true;
			}

			// Add current node to path before searching children
			const currentId = n.id as NodeId;
			debugLog("treeExpansion", "Checking node:", currentId, "type:", n.type);

			// Search in all possible child arrays
			const arrayProps = ["attributes", "orders", "filters", "conditions", "subfilters", "links"];
			for (const prop of arrayProps) {
				if (Array.isArray(n[prop])) {
					for (const item of n[prop]) {
						if (findInNode(item, target)) {
							// Found in this branch, add current to path
							path.unshift(currentId);
							return true;
						}
					}
				}
			}

			// Search in nested entity
			if (n.entity && findInNode(n.entity, target)) {
				// Found in entity, add current to path
				path.unshift(currentId);
				return true;
			}

			// All Attributes is a nested node, not part of the child arrays above
			if (n.allAttributes && findInNode(n.allAttributes, target)) {
				path.unshift(currentId);
				return true;
			}

			return false;
		};

		findInNode(fetchQuery, targetId);
		debugLog("treeExpansion", "Final path:", path);
		return path;
	};

	// Auto-expand ancestors when a new node is selected
	useEffect(() => {
		if (selectedNodeId) {
			debugLog("treeExpansion", "Node selected, expanding path:", selectedNodeId);
			const pathToNode = findPathToNode(selectedNodeId);
			debugLog("treeExpansion", "Path to node:", pathToNode);

			if (pathToNode.length === 0) {
				debugWarn("treeExpansion", "Path is empty! Node might not be in tree yet.");
				return;
			}

			setOpenItems((prev) => {
				const newSet = new Set(prev);
				const sizeBefore = newSet.size;
				// Add all ancestors to open items (except the leaf node itself)
				pathToNode.forEach((id) => newSet.add(id));
				const itemsAdded = Array.from(newSet).filter((id) => !prev.has(id));
				debugLog("treeExpansion", "Updated openItems:", {
					sizeBefore,
					sizeAfter: newSet.size,
					added: itemsAdded,
					addedCount: itemsAdded.length,
					allOpen: Array.from(newSet),
				});

				// Always return the new set to ensure re-render even if no new items
				return newSet;
			});

			// Scroll the selected node into view after a short delay to allow DOM updates
			// Note: Fluent UI Tree doesn't set aria-selected="true" reliably, so we use
			// the last tree item as the target (newly added nodes appear at the end)
			setTimeout(() => {
				const allTreeItems = document.querySelectorAll('[role="treeitem"]');

				if (allTreeItems.length > 0) {
					const targetElement = allTreeItems[allTreeItems.length - 1];
					targetElement.scrollIntoView({ behavior: "smooth", block: "nearest" });
					debugLog(
						"treeExpansion",
						`Scrolled to item ${allTreeItems.length} of ${allTreeItems.length}`
					);
				} else {
					debugWarn("treeExpansion", "No tree items found in DOM for scrolling");
				}
			}, 250);
		}
	}, [selectedNodeId]); // eslint-disable-line react-hooks/exhaustive-deps

	// Handle opening the Select Attributes dialog
	const handleOpenSelectAttributes = useCallback(
		async (entityNode: EntityNode | LinkEntityNode) => {
			const entityName = entityNode.name;
			const entityDisplayName =
				metadataCache.getEntityMetadata(entityName)?.DisplayName?.UserLocalizedLabel?.Label ||
				entityName;

			// Get currently selected attribute names
			const currentAttributeNames = entityNode.attributes.map((attr) => attr.name);

			// Get all attributes for this entity
			let attributes = metadataCache.getEntityAttributes(entityName);
			if (!attributes) {
				// Fetch from API
				try {
					attributes = await loadEntityAttributes(entityName);
					metadataCache.setEntityAttributes(entityName, attributes);
				} catch (error) {
					console.error("Failed to load attributes:", error);
					attributes = [];
				}
			}

			setSelectAttrsEntityId(entityNode.id);
			setSelectAttrsDisplayName(entityDisplayName);
			setSelectAttrsAttributes(attributes || []);
			setSelectAttrsCurrentNames(currentAttributeNames);
			setSelectAttrsDialogOpen(true);
		},
		[]
	);

	// Handle applying selected attributes from dialog
	const handleApplySelectedAttributes = useCallback(
		(nodeId: NodeId, selectedAttributes: string[]) => {
			onUpdateAttributes(nodeId, selectedAttributes);
		},
		[onUpdateAttributes]
	);

	const handleOpenChange = (_event: unknown, data: TreeOpenChangeData) => {
		debugLog("treeExpansion", "handleOpenChange called:", {
			open: data.open,
			value: data.value,
			type: data.type,
			openItemsCount: data.openItems.size,
			openItems: Array.from(data.openItems),
		});
		// data.openItems is already the updated Set from Fluent UI
		// Use it directly to respect user's expand/collapse actions
		setOpenItems(data.openItems as Set<NodeId>);
	};

	const renderFetchNode = (fetch: FetchNode) => {
		return (
			<TreeItem
				key={fetch.id}
				itemType="branch"
				value={fetch.id}
				className={styles.treeItemWithActions}
			>
				<TreeItemLayout
					className={getTreeItemLayoutClassName(fetch.id)}
					iconBefore={<Table20Regular />}
					onClick={handleNodeSelect(fetch.id)}
				>
					Fetch Query
				</TreeItemLayout>

				<Tree>{renderEntityNode(fetch.entity, true)}</Tree>
			</TreeItem>
		);
	};

	const renderEntityNode = (entity: EntityNode, isRootEntity: boolean = true) => {
		// Only allow one top-level filter per entity
		const hasFilter = entity.filters.length > 0;
		const hasAllAttributes = entity.allAttributes?.enabled ?? false;
		const hasAttributes = entity.attributes.length > 0;

		return (
			<TreeItem
				key={entity.id}
				itemType="branch"
				value={entity.id}
				className={styles.treeItemWithActions}
			>
				<Menu openOnContext>
					<MenuTrigger disableButtonEnhancement>
						<TreeItemLayout
							className={getTreeItemLayoutClassName(entity.id)}
							iconBefore={<Table20Regular />}
							actions={
								<div className="actions">
									<Menu>
										<MenuTrigger disableButtonEnhancement>
											<Button
												appearance="subtle"
												size="small"
												icon={<Add20Regular />}
												title="Add..."
											/>
										</MenuTrigger>
		<MenuPopover onClick={stopMenuEventPropagation} onContextMenu={stopMenuEventPropagation}>
							<MenuList>
								<MenuItem
									onClick={() => onAddAllAttributes(entity.id)}
									disabled={hasAllAttributes || hasAttributes}
								>
										All Attributes
									</MenuItem>
								<MenuItem onClick={() => onAddAttribute(entity.id)} disabled={hasAllAttributes}>
									Attribute
								</MenuItem>
								<MenuItem
									onClick={() => handleOpenSelectAttributes(entity)}
									disabled={hasAllAttributes}
								>
										Select Attributes
											</MenuItem>
												<MenuItem onClick={() => onAddOrder(entity.id)}>Order By</MenuItem>
												<MenuItem onClick={() => onAddFilter(entity.id)} disabled={hasFilter}>
													Filter
												</MenuItem>
												<MenuItem onClick={() => onAddLinkEntity(entity.id)}>Link-Entity</MenuItem>
											</MenuList>
										</MenuPopover>
									</Menu>
									{!isRootEntity && (
										<Button
											appearance="subtle"
											size="small"
											icon={<Delete20Regular />}
											onClick={(e) => {
												e.stopPropagation();
												onRemoveNode(entity.id);
											}}
											title="Remove"
										/>
									)}
								</div>
							}
							onClick={handleNodeSelect(entity.id)}
						>
							{entity.name}
						</TreeItemLayout>
					</MenuTrigger>
					<MenuPopover onClick={stopMenuEventPropagation} onContextMenu={stopMenuEventPropagation}>
						<MenuList>
							<MenuItem
								onClick={() => onAddAllAttributes(entity.id)}
								disabled={hasAllAttributes || hasAttributes}
							>
								All Attributes
							</MenuItem>
							<MenuItem onClick={() => onAddAttribute(entity.id)} disabled={hasAllAttributes}>
								Attribute
							</MenuItem>
							<MenuItem onClick={() => handleOpenSelectAttributes(entity)} disabled={hasAllAttributes}>
								Select Attributes
							</MenuItem>
							<MenuItem onClick={() => onAddOrder(entity.id)}>Order By</MenuItem>
							<MenuItem onClick={() => onAddFilter(entity.id)} disabled={hasFilter}>
								Filter
							</MenuItem>
							<MenuItem onClick={() => onAddLinkEntity(entity.id)}>Link-Entity</MenuItem>
							{!isRootEntity && (
								<>
									<MenuDivider />
									<MenuItem onClick={() => onRemoveNode(entity.id)}>Remove</MenuItem>
								</>
							)}
						</MenuList>
					</MenuPopover>
				</Menu>

				<Tree>
					{/* All Attributes */}
					{entity.allAttributes?.enabled && renderAllAttributesNode(entity.allAttributes)}

					{/* Attributes */}
					{entity.attributes.map((attr) => renderAttributeNode(attr))}

					{/* Orders */}
					{entity.orders.map((order) => renderOrderNode(order))}

					{/* Filters */}
					{entity.filters.map((filter) => renderFilterNode(filter))}

					{/* Link-Entities */}
					{entity.links.map((link) => renderLinkEntityNode(link))}
				</Tree>
			</TreeItem>
		);
	};

	const renderAllAttributesNode = (node: AllAttributesNode) => {
		return (
			<TreeItem
				key={node.id}
				itemType="leaf"
				value={node.id}
				className={styles.treeItem}
			>
				<Menu openOnContext>
					<MenuTrigger disableButtonEnhancement>
						<TreeItemLayout
							className={getTreeItemLayoutClassName(node.id)}
							iconBefore={<Column20Regular />}
							actions={
								<Button
									appearance="subtle"
									size="small"
									icon={<Delete20Regular />}
									onClick={(e) => {
										e.stopPropagation();
										onRemoveNode(node.id);
									}}
									title="Remove"
								/>
							}
							onClick={handleNodeSelect(node.id)}
						>
							All Attributes
						</TreeItemLayout>
					</MenuTrigger>
					<MenuPopover onClick={stopMenuEventPropagation} onContextMenu={stopMenuEventPropagation}>
						<MenuList>
							<MenuItem onClick={() => onRemoveNode(node.id)}>Remove</MenuItem>
						</MenuList>
					</MenuPopover>
				</Menu>
			</TreeItem>
		);
	};

	const renderAttributeNode = (attr: AttributeNode) => {
		const label = attr.alias ? `${attr.name} (as ${attr.alias})` : attr.name;
		const suffix = attr.aggregate ? ` [${attr.aggregate}]` : "";

		return (
			<TreeItem
				key={attr.id}
				itemType="leaf"
				value={attr.id}
				className={styles.treeItemWithActions}
			>
				<Menu openOnContext>
					<MenuTrigger disableButtonEnhancement>
						<TreeItemLayout
							className={getTreeItemLayoutClassName(attr.id)}
							iconBefore={<Column20Regular />}
							actions={
								<div className="actions">
									<Button
										appearance="subtle"
										size="small"
										icon={<Delete20Regular />}
										onClick={(e) => {
											e.stopPropagation();
											onRemoveNode(attr.id);
										}}
										title="Remove Attribute"
									/>
								</div>
							}
							onClick={handleNodeSelect(attr.id)}
						>
							{label}
							{suffix}
						</TreeItemLayout>
					</MenuTrigger>
					<MenuPopover onClick={stopMenuEventPropagation} onContextMenu={stopMenuEventPropagation}>
						<MenuList>
							<MenuItem onClick={() => onRemoveNode(attr.id)}>Remove Attribute</MenuItem>
						</MenuList>
					</MenuPopover>
				</Menu>
			</TreeItem>
		);
	};

	const renderOrderNode = (order: OrderNode) => {
		const direction = order.descending ? "↓" : "↑";
		// Show entityname prefix for link-entity orders
		const displayName = order.entityname
			? `${order.entityname}.${order.attribute}`
			: order.attribute;
		return (
			<TreeItem
				key={order.id}
				itemType="leaf"
				value={order.id}
				className={styles.treeItemWithActions}
			>
				<Menu openOnContext>
					<MenuTrigger disableButtonEnhancement>
						<TreeItemLayout
							className={getTreeItemLayoutClassName(order.id)}
							iconBefore={<ArrowSort20Regular />}
							actions={
								<div className="actions">
									<Button
										appearance="subtle"
										size="small"
										icon={<Delete20Regular />}
										onClick={(e) => {
											e.stopPropagation();
											onRemoveNode(order.id);
										}}
										title="Remove Order"
									/>
								</div>
							}
							onClick={handleNodeSelect(order.id)}
						>
							{displayName} {direction}
						</TreeItemLayout>
					</MenuTrigger>
					<MenuPopover onClick={stopMenuEventPropagation} onContextMenu={stopMenuEventPropagation}>
						<MenuList>
							<MenuItem onClick={() => onRemoveNode(order.id)}>Remove Order</MenuItem>
						</MenuList>
					</MenuPopover>
				</Menu>
			</TreeItem>
		);
	};

	const renderFilterNode = (filter: FilterNode) => {
		return (
			<TreeItem
				key={filter.id}
				itemType="branch"
				value={filter.id}
				className={styles.treeItemWithActions}
			>
				<Menu openOnContext>
					<MenuTrigger disableButtonEnhancement>
						<TreeItemLayout
							className={getTreeItemLayoutClassName(filter.id)}
							iconBefore={<Filter20Regular />}
							actions={
								<div className="actions">
									<Menu>
										<MenuTrigger disableButtonEnhancement>
											<Button appearance="subtle" size="small" icon={<Add20Regular />} title="Add..." />
										</MenuTrigger>
										<MenuPopover
											onClick={stopMenuEventPropagation}
											onContextMenu={stopMenuEventPropagation}
										>
											<MenuList>
												<MenuItem onClick={() => onAddCondition(filter.id)}>Condition</MenuItem>
												<MenuItem onClick={() => onAddSubfilter(filter.id)}>Sub-Filter</MenuItem>
												<MenuItem onClick={() => onAddLinkEntity(filter.id)}>
													Link-Entity (any/not any/all)
												</MenuItem>
											</MenuList>
										</MenuPopover>
									</Menu>
									<Button
										appearance="subtle"
										size="small"
										icon={<Delete20Regular />}
										onClick={(e) => {
											e.stopPropagation();
											onRemoveNode(filter.id);
										}}
										title="Remove Filter"
									/>
								</div>
							}
							onClick={handleNodeSelect(filter.id)}
						>
							Filter ({filter.conjunction})
						</TreeItemLayout>
					</MenuTrigger>
					<MenuPopover onClick={stopMenuEventPropagation} onContextMenu={stopMenuEventPropagation}>
						<MenuList>
							<MenuItem onClick={() => onAddCondition(filter.id)}>Condition</MenuItem>
							<MenuItem onClick={() => onAddSubfilter(filter.id)}>Sub-Filter</MenuItem>
							<MenuItem onClick={() => onAddLinkEntity(filter.id)}>
								Link-Entity (any/not any/all)
							</MenuItem>
							<MenuDivider />
							<MenuItem onClick={() => onRemoveNode(filter.id)}>Remove Filter</MenuItem>
						</MenuList>
					</MenuPopover>
				</Menu>

				<Tree>
					{filter.conditions.map((cond) => renderConditionNode(cond))}
					{filter.subfilters.map((subfilter) => renderFilterNode(subfilter))}
					{filter.links?.map((link) => renderLinkEntityNode(link))}
				</Tree>
			</TreeItem>
		);
	};

	const renderConditionNode = (condition: ConditionNode) => {
		// Format the display text based on operator and value
		const requiresValue = operatorRequiresValue(condition.operator);
		let displayText = `${condition.attribute} ${condition.operator}`;

		if (
			requiresValue &&
			condition.value !== undefined &&
			condition.value !== null &&
			condition.value !== ""
		) {
			displayText += ` = ${formatDisplayValue(condition.value)}`;
		}

		return (
			<TreeItem
				key={condition.id}
				itemType="leaf"
				value={condition.id}
				className={styles.treeItemWithActions}
			>
				<Menu openOnContext>
					<MenuTrigger disableButtonEnhancement>
						<TreeItemLayout
							className={getTreeItemLayoutClassName(condition.id)}
							actions={
								<div className="actions">
									<Button
										appearance="subtle"
										size="small"
										icon={<Delete20Regular />}
										onClick={(e) => {
											e.stopPropagation();
											onRemoveNode(condition.id);
										}}
										title="Remove Condition"
									/>
								</div>
							}
							onClick={handleNodeSelect(condition.id)}
						>
							{displayText}
						</TreeItemLayout>
					</MenuTrigger>
					<MenuPopover onClick={stopMenuEventPropagation} onContextMenu={stopMenuEventPropagation}>
						<MenuList>
							<MenuItem onClick={() => onRemoveNode(condition.id)}>Remove Condition</MenuItem>
						</MenuList>
					</MenuPopover>
				</Menu>
			</TreeItem>
		);
	};

	const renderLinkEntityNode = (link: LinkEntityNode) => {
		// Attributes are not allowed in "not any" and "not all" link types
		const canHaveAttributes = link.linkType !== "not any" && link.linkType !== "not all";
		// Only allow one top-level filter per link-entity
		const hasFilter = link.filters.length > 0;
		const hasAllAttributes = link.allAttributes?.enabled ?? false;
		const hasAttributes = link.attributes.length > 0;

		return (
			<TreeItem
				key={link.id}
				itemType="branch"
				value={link.id}
				className={styles.treeItemWithActions}
			>
				<Menu openOnContext>
					<MenuTrigger disableButtonEnhancement>
						<TreeItemLayout
							className={getTreeItemLayoutClassName(link.id)}
							iconBefore={<Link20Regular />}
							actions={
								<div className="actions">
									<Menu>
										<MenuTrigger disableButtonEnhancement>
											<Button appearance="subtle" size="small" icon={<Add20Regular />} title="Add..." />
										</MenuTrigger>
										<MenuPopover
											onClick={stopMenuEventPropagation}
											onContextMenu={stopMenuEventPropagation}
										>
							<MenuList>
								<MenuItem
									onClick={() => onAddAllAttributes(link.id)}
									disabled={!canHaveAttributes || hasAllAttributes || hasAttributes}
								>
									All Attributes
								</MenuItem>
												<MenuItem
													onClick={() => onAddAttribute(link.id)}
													disabled={!canHaveAttributes || hasAllAttributes}
												>
													Attribute
												</MenuItem>
								<MenuItem
									onClick={() => handleOpenSelectAttributes(link)}
									disabled={!canHaveAttributes || hasAllAttributes}
								>
									Select Attributes
								</MenuItem>
												<MenuItem onClick={() => onAddOrder(link.id)}>Order By</MenuItem>
												<MenuItem onClick={() => onAddFilter(link.id)} disabled={hasFilter}>
													Filter
												</MenuItem>
												<MenuItem onClick={() => onAddLinkEntity(link.id)}>Link-Entity</MenuItem>
											</MenuList>
										</MenuPopover>
									</Menu>
									<Button
										appearance="subtle"
										size="small"
										icon={<Delete20Regular />}
										onClick={(e) => {
											e.stopPropagation();
											onRemoveNode(link.id);
										}}
										title="Remove Link"
									/>
								</div>
							}
							onClick={handleNodeSelect(link.id)}
						>
							{link.alias || link.name} ({link.linkType})
						</TreeItemLayout>
					</MenuTrigger>
					<MenuPopover onClick={stopMenuEventPropagation} onContextMenu={stopMenuEventPropagation}>
						<MenuList>
							<MenuItem
								onClick={() => onAddAllAttributes(link.id)}
								disabled={!canHaveAttributes || hasAllAttributes || hasAttributes}
							>
								All Attributes
							</MenuItem>
							<MenuItem
								onClick={() => onAddAttribute(link.id)}
								disabled={!canHaveAttributes || hasAllAttributes}
							>
								Attribute
							</MenuItem>
							<MenuItem
								onClick={() => handleOpenSelectAttributes(link)}
								disabled={!canHaveAttributes || hasAllAttributes}
							>
								Select Attributes
							</MenuItem>
							<MenuItem onClick={() => onAddOrder(link.id)}>Order By</MenuItem>
							<MenuItem onClick={() => onAddFilter(link.id)} disabled={hasFilter}>
								Filter
							</MenuItem>
							<MenuItem onClick={() => onAddLinkEntity(link.id)}>Link-Entity</MenuItem>
							<MenuDivider />
							<MenuItem onClick={() => onRemoveNode(link.id)}>Remove Link</MenuItem>
						</MenuList>
					</MenuPopover>
				</Menu>

				<Tree>
					{link.allAttributes?.enabled && renderAllAttributesNode(link.allAttributes)}
					{link.attributes.map((attr) => renderAttributeNode(attr))}
					{link.orders.map((order) => renderOrderNode(order))}
					{link.filters.map((filter) => renderFilterNode(filter))}
					{link.links.map((nestedLink) => renderLinkEntityNode(nestedLink))}
				</Tree>
			</TreeItem>
		);
	};

	return (
		<div className={styles.container}>
			<Tree
				aria-label="FetchXML Query Structure"
				openItems={openItems}
				onOpenChange={handleOpenChange}
			>
				{renderFetchNode(fetchQuery)}
			</Tree>

			<SelectAttributesDialog
				open={selectAttrsDialogOpen}
				onOpenChange={setSelectAttrsDialogOpen}
				entityDisplayName={selectAttrsDisplayName}
				nodeId={selectAttrsEntityId || ""}
				attributes={selectAttrsAttributes}
				selectedAttributeNames={selectAttrsCurrentNames}
				onApply={handleApplySelectedAttributes}
			/>
		</div>
	);
}
