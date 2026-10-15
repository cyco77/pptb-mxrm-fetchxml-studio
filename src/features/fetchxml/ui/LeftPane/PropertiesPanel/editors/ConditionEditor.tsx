/**
 * Property editor for <condition>: attribute, operator, value(s) or valueof, and entityname (#90b).
 * Operators and value pickers follow the attribute's metadata.
 * https://learn.microsoft.com/power-apps/developer/data-platform/fetchxml/reference/condition
 */

import { useState, useEffect, useMemo } from "react";
import { Input, Dropdown, Option, Radio, RadioGroup } from "@fluentui/react-components";
import type { ConditionNode, FetchNode } from "../../../../model/nodes";
import type { RuleFinding } from "../../../../model/fetchxmlRules";
import { VALUEOF_OPERATORS } from "../../../../model/fetchxmlRules";
import { getValueOfCompatibleTypes } from "../../../../model/attributeCapabilities";
import { AttributePicker } from "../../../../../../shared/components/AttributePicker";
import { OptionSetValuePicker } from "../../../../../../shared/components/OptionSetValuePicker";
import { BooleanValuePicker } from "../../../../../../shared/components/BooleanValuePicker";
import { NumericInputPicker } from "../../../../../../shared/components/NumericInputPicker";
import { DateTimeInputPicker } from "../../../../../../shared/components/DateTimeInputPicker";
import { BetweenInputPicker } from "../../../../../../shared/components/BetweenInputPicker";
import { MultiValuePicker } from "../../../../../../shared/components/MultiValuePicker";
import {
	getOperatorsForAttributeType,
	operatorRequiresValue,
	type OperatorDefinition,
} from "../../../../model/operators";
import { loadEntityAttributes, loadAttributeDetailedMetadata } from "../../../../api/dataverseMetadata";
import type { AttributeMetadata } from "../../../../api/pptbClient";
import { collectLinkEntityReferences, isConditionInRootEntityFilter } from "../../../../model/treeUtils";
import { DOCS } from "../docLinks";
import { useEditorStyles } from "../editorStyles";
import { Info, InfoField, LeftoverSetting, SectionHeading } from "../fields";
import { findingFor } from "../ruleFindings";
import { ValueOfPicker } from "./ValueOfPicker";

const THIS_ENTITY = "__this";
const OPTION_SET_TYPES = new Set(["Picklist", "State", "Status"]);
const NUMERIC_TYPES = new Set(["Integer", "BigInt", "Decimal", "Double"]);
/** Operators that need hours or minutes, which date-only attributes don't have */
const TIME_OPERATORS = new Set(["last-x-hours", "next-x-hours", "olderthan-x-hours", "olderthan-x-minutes"]);

interface ConditionEditorProps {
	node: ConditionNode;
	/** The entity / link-entity whose filter holds the condition */
	entityName: string;
	fetchQuery: FetchNode;
	/** Query-rule findings for this node (fetchxmlRules.ts) */
	findings: readonly RuleFinding[];
	onUpdate: (updates: Record<string, unknown>) => void;
}

export function ConditionEditor({ node, entityName, fetchQuery, findings, onUpdate }: ConditionEditorProps) {
	const styles = useEditorStyles();
	const [availableOperators, setAvailableOperators] = useState<OperatorDefinition[]>([]);
	const [selectedAttribute, setSelectedAttribute] = useState<AttributeMetadata | null>(null);

	const linkEntityReferences = useMemo(() => collectLinkEntityReferences(fetchQuery), [fetchQuery]);
	// entityname applies to conditions in the root entity's filters (filters on link-entity, after the join)
	const isInRootFilter = useMemo(() => isConditionInRootEntityFilter(fetchQuery, node.id), [fetchQuery, node.id]);
	const entityTarget = node.entityname
		? linkEntityReferences.find((r) => r.identifier === node.entityname)
		: undefined;
	const effectiveEntityName = isInRootFilter && entityTarget ? entityTarget.entityName : entityName;

	const compatibleTypes = useMemo(
		() => getValueOfCompatibleTypes(selectedAttribute?.AttributeType),
		[selectedAttribute?.AttributeType],
	);

	// The attribute's metadata decides the operators and the value picker
	useEffect(() => {
		let cancelled = false;
		if (!node.attribute || !effectiveEntityName) {
			setAvailableOperators(getOperatorsForAttributeType(undefined));
			setSelectedAttribute(null);
			return;
		}
		loadEntityAttributes(effectiveEntityName)
			.then(async (attributes: AttributeMetadata[]) => {
				const attr = attributes.find((a) => a.LogicalName === node.attribute);
				const type = attr?.AttributeType;
				let detailed = attr;
				// Ranges, precision and date formats come from the type-cast metadata
				if (attr && type && (NUMERIC_TYPES.has(type) || type === "DateTime")) {
					try {
						detailed = await loadAttributeDetailedMetadata(effectiveEntityName, node.attribute, type);
					} catch (error) {
						console.error(`Failed to load detailed metadata for ${node.attribute}:`, error);
					}
				}
				if (cancelled) return;
				setSelectedAttribute(detailed ?? null);
				let operators = getOperatorsForAttributeType(type);
				if (type === "DateTime" && detailed) {
					const isDateOnly = detailed.Format === "DateOnly" || detailed.DateTimeBehavior?.Value === "DateOnly";
					if (isDateOnly) operators = operators.filter((op) => !TIME_OPERATORS.has(op.value));
				}
				setAvailableOperators(operators);
			})
			.catch((error) => {
				console.error("Failed to load attribute metadata for operator filtering:", error);
				if (cancelled) return;
				setAvailableOperators(getOperatorsForAttributeType(undefined));
				setSelectedAttribute(null);
			});
		return () => {
			cancelled = true;
		};
	}, [node.attribute, effectiveEntityName]);

	const requiresValue = operatorRequiresValue(node.operator);
	const operatorDef = availableOperators.find((op) => op.value === node.operator);
	const requiresTwoValues = operatorDef?.requiresTwoValues ?? false;
	const requiresMultipleValues = operatorDef?.requiresMultipleValues ?? false;
	const isSingleValue = requiresValue && !(requiresMultipleValues && selectedAttribute) && !(requiresTwoValues && selectedAttribute);
	const comparesToAttribute = node.valueof !== undefined;
	const canCompareToAttribute = VALUEOF_OPERATORS.has(node.operator);
	const valueofFinding = findingFor(findings, "valueof");
	const attributeType = selectedAttribute?.AttributeType;

	const showEntity = (isInRootFilter && linkEntityReferences.length > 0) || !!node.entityname;
	const entityLabel = node.entityname
		? (entityTarget?.displayLabel ?? node.entityname)
		: `This entity (${entityName})`;

	const renderLiteralValue = () => {
		if (attributeType && OPTION_SET_TYPES.has(attributeType)) {
			return (
				<OptionSetValuePicker
					entityLogicalName={effectiveEntityName}
					attributeLogicalName={node.attribute}
					value={typeof node.value === "number" ? node.value : undefined}
					onChange={(val) => onUpdate({ value: val })}
					placeholder="Select a value"
				/>
			);
		}
		if (attributeType === "Boolean") {
			return (
				<BooleanValuePicker
					entityLogicalName={effectiveEntityName}
					attributeLogicalName={node.attribute}
					value={
						typeof node.value === "boolean"
							? node.value
							: typeof node.value === "string"
								? node.value === "true" || node.value === "1"
								: undefined
					}
					onChange={(val) => onUpdate({ value: val })}
					placeholder="Select true or false"
				/>
			);
		}
		if (attributeType && NUMERIC_TYPES.has(attributeType) && selectedAttribute) {
			return (
				<NumericInputPicker
					attribute={selectedAttribute}
					value={typeof node.value === "number" ? node.value : undefined}
					onChange={(val) => onUpdate({ value: val })}
					placeholder="Enter a number"
				/>
			);
		}
		if (attributeType === "DateTime" && selectedAttribute) {
			return (
				<DateTimeInputPicker
					attribute={selectedAttribute}
					value={typeof node.value === "string" ? node.value : node.value instanceof Date ? node.value : undefined}
					onChange={(val) => onUpdate({ value: val?.toISOString() })}
					placeholder="Select a date"
				/>
			);
		}
		return (
			<Input
				value={typeof node.value === "string" || typeof node.value === "number" ? String(node.value) : ""}
				onChange={(_, data) => onUpdate({ value: data.value || undefined })}
				placeholder="Value"
			/>
		);
	};

	return (
		<div className={styles.container}>
			<div className={styles.section}>
				<SectionHeading>Condition</SectionHeading>

				{showEntity && (
					<InfoField
						label="Entity"
						validation={findingFor(findings, "entityname")}
						info={
							<Info
								text="Filter on a link-entity's attribute after the join instead of within it, usually with an outer link-entity (for example, records with no related record). Uses the link-entity's alias, or its name when it has none."
								href={DOCS.filtersOnLinkEntity}
							/>
						}
					>
						<Dropdown
							value={entityLabel}
							selectedOptions={[node.entityname ?? THIS_ENTITY]}
							onOptionSelect={(_, data) =>
								// The attribute belongs to the chosen entity, so start over
								onUpdate({
									entityname: data.optionValue === THIS_ENTITY ? undefined : data.optionValue,
									attribute: undefined,
									operator: undefined,
									value: undefined,
									valueof: undefined,
								})
							}
						>
							<Option value={THIS_ENTITY}>{`This entity (${entityName})`}</Option>
							{node.entityname && !entityTarget && (
								<Option value={node.entityname} text={node.entityname}>
									<span className={styles.optionText}>
										{node.entityname}
										<span className={styles.optionSecondary}>Not a link-entity in this query</span>
									</span>
								</Option>
							)}
							{isInRootFilter &&
								linkEntityReferences.map((ref) => (
									<Option key={ref.nodeId} value={ref.identifier}>
										{ref.displayLabel}
									</Option>
								))}
						</Dropdown>
					</InfoField>
				)}

				<InfoField
					label="Attribute"
					required
					validation={!node.attribute ? { state: "error", message: "Choose an attribute to filter on." } : undefined}
					info={<Info text={`The logical name of the ${effectiveEntityName} attribute to filter on.`} href={DOCS.condition} />}
				>
					<AttributePicker
						entityLogicalName={effectiveEntityName}
						value={node.attribute}
						onChange={(logicalName) =>
							// A different attribute can have a different type: reset operator and value, keep the mode
							onUpdate({
								attribute: logicalName || undefined,
								operator: undefined,
								value: undefined,
								valueof: comparesToAttribute ? "" : undefined,
							})
						}
						placeholder="Select an attribute"
					/>
				</InfoField>

				<InfoField
					label="Operator"
					required
					info={<Info text="The operators listed depend on the attribute's type." href={DOCS.operators} />}
				>
					<Dropdown
						value={operatorDef?.label ?? node.operator ?? ""}
						selectedOptions={node.operator ? [node.operator] : []}
						onOptionSelect={(_, data) =>
							// Only eq / ne / gt / ge / lt / le compare to another attribute (0x80048415)
							onUpdate(
								comparesToAttribute && !VALUEOF_OPERATORS.has(data.optionValue ?? "")
									? { operator: data.optionValue, valueof: undefined, value: undefined }
									: { operator: data.optionValue },
							)
						}
						placeholder="Select an operator"
					>
						{node.operator && !operatorDef && availableOperators.length > 0 && (
							<Option value={node.operator} text={node.operator}>
								<span className={styles.optionText}>
									{node.operator}
									<span className={styles.optionSecondary}>Not listed for this attribute type</span>
								</span>
							</Option>
						)}
						{availableOperators.map((op) => (
							<Option key={op.value} value={op.value}>
								{op.label}
							</Option>
						))}
					</Dropdown>
				</InfoField>

				{requiresValue && requiresMultipleValues && selectedAttribute && (
					<InfoField
						label="Values"
						info={<Info text="Each value is written as a <value> element." href={DOCS.condition} />}
					>
						<MultiValuePicker
							entityLogicalName={effectiveEntityName}
							attributeLogicalName={node.attribute}
							attribute={selectedAttribute}
							value={Array.isArray(node.value) ? node.value : undefined}
							onChange={(val) => onUpdate({ value: val })}
							placeholder="Enter values (comma-separated)"
						/>
					</InfoField>
				)}

				{requiresValue && requiresTwoValues && !requiresMultipleValues && selectedAttribute && (
					<InfoField
						label="Values"
						info={<Info text="The two values the operator needs, written as <value> elements." href={DOCS.operators} />}
					>
						<BetweenInputPicker
							attribute={selectedAttribute}
							value={
								Array.isArray(node.value) && node.value.length === 2
									? [node.value[0], node.value[1]]
									: [undefined, undefined]
							}
							onChange={(val) => onUpdate({ value: val })}
							placeholder1="From"
							placeholder2="To"
						/>
					</InfoField>
				)}

				{isSingleValue && (canCompareToAttribute || comparesToAttribute) && (
					<InfoField
						label="Compare to"
						validation={valueofFinding?.state === "error" ? valueofFinding : undefined}
						info={
							<Info
								text="A fixed value, or another attribute of the same record or of a link-entity. Comparing attributes works only with eq, ne, gt, ge, lt and le, and the attributes must have compatible types."
								href={DOCS.filterOnColumnValues}
							/>
						}
					>
						<RadioGroup
							layout="horizontal"
							value={comparesToAttribute ? "attribute" : "value"}
							onChange={(_, data) =>
								onUpdate(data.value === "attribute" ? { value: undefined, valueof: "" } : { valueof: undefined, value: undefined })
							}
						>
							<Radio value="value" label="A value" />
							<Radio value="attribute" label="Another attribute" disabled={!canCompareToAttribute && !comparesToAttribute} />
						</RadioGroup>
					</InfoField>
				)}

				{isSingleValue &&
					(comparesToAttribute ? (
						<ValueOfPicker
							fetchQuery={fetchQuery}
							rootEntityName={fetchQuery.entity.name}
							effectiveEntityName={effectiveEntityName}
							valueof={node.valueof ?? ""}
							compatibleTypes={compatibleTypes}
							onChange={(valueof) => onUpdate({ valueof: valueof ?? "" })}
						/>
					) : (
						<InfoField
							label="Value"
							info={<Info text="The value to compare the attribute with." href={DOCS.filterRows} />}
						>
							{renderLiteralValue()}
						</InfoField>
					))}

				{/* Settings Dataverse ignores here (parsed XML or after an operator change) */}
				{!requiresValue && node.valueof !== undefined && (
					<LeftoverSetting
						text={`Compare to: ${node.valueof || "(empty)"}`}
						validation={{
							state: "warning",
							message: valueofFinding?.message ?? `The '${node.operator}' operator doesn't compare to a value.`,
						}}
						onRemove={() => onUpdate({ valueof: undefined })}
					/>
				)}
				{node.aggregate && (
					<LeftoverSetting
						text={`Aggregate: ${node.aggregate}`}
						validation={{
							state: "warning",
							message:
								findingFor(findings, "aggregate")?.message ??
								"Dataverse ignores aggregate on a condition. FetchXML can't filter on aggregate values.",
						}}
						onRemove={() => onUpdate({ aggregate: undefined })}
					/>
				)}
			</div>
		</div>
	);
}
