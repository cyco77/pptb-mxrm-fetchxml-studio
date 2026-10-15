# Changelog

All notable changes to FetchXML Studio will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.4.1-beta.11] - 2026-10-15

### 🔧 Fixed

- **Many-to-many relationships from the relationship picker return the right rows (#85).** Choosing an N:N relationship built a single link-entity straight to the related entity, using the intersect entity's attribute names. That silently returned 0 rows (or failed, depending on the side).
  - It now builds the [documented pattern](https://learn.microsoft.com/power-apps/developer/data-platform/fetchxml/join-tables#many-to-many-relationships): the link-entity becomes the intersect entity (`intersect="true"`, joined on the parent's primary key), and the related entity is nested inside it, with the alias, so attributes are added there.
  - The attributes come from the relationship metadata (`IntersectEntityName`, `Entity1/2IntersectAttribute`) and both entities' primary keys. It works from either side, and for self-referential relationships.
  - **Verified live:** for every many-to-many relationship with data in the sandbox (47 checks from both sides, system, custom and self-referential), the join returned exactly the intersect entity's pairs.

### 🏗️ Technical

- `model/manyToMany.ts`: `planManyToManyJoin`, with tests.

## [1.4.1-beta.8] - 2026-10-14

### 🔧 Fixed

- **The tool icon now shows in Power Platform ToolBox (#62).** PPTB resolves the top-level `icon` relative to `dist/`, but the SVGs were never copied there, so PPTB showed its default icon. A valid SVG bundled under `dist` is also a **required** item for Verified status ([publishing](https://docs.powerplatformtoolbox.com/tool-development/publishing), [maturity model](https://docs.powerplatformtoolbox.com/tool-development/maturity-model)).
  - The build now bundles the icon at `dist/icons/icon.svg`, and `package.json` points `icon` there.
  - Prerelease versions (e.g. `1.4.1-beta.8`) get the gold-stamped Insider icon; releases get the regular blue icon. There's no manual switch per release.

### 🏗️ Technical

- **`package-lock.json` is committed**, pinning every dependency with an integrity hash. npm's guidance: it's "intended to be committed into source repositories" and isn't published. PPTB users install the pre-built package, so this only affects development and CI.
  - It enables `npm ci` and `npm audit` (a Verified requirement) and CI (#72).
  - It pins exactly the versions tested so far (restored from the last `npm-shrinkwrap.json`), not a fresh resolution.
- `files` no longer lists `icons` (the icon ships inside `dist`) or the removed `npm-shrinkwrap.json`.

## [1.4.1-beta.7] - 2026-10-14

### 🔧 Fixed

- **Editor mode: actions now run exactly what's in the editor (#102).** In editor mode, **Execute**, **Save / Save As** and **Send to Tool** first load the editor's FetchXML into the tree, then act on the tree.
  - **What went wrong before:**
    - Execute ran the editor XML, but the results grid took its columns, layout, entity and record actions from the tree. With a different query in the editor, you saw the tree's (often empty) columns.
    - Save As and Send to Tool silently used the tree's XML, not the editor's.
    - Execute, Save As and Send to Tool were disabled while the tree was empty, even with a valid query in the editor.
  - **Now:**
    - Execute is enabled as soon as the editor has content.
    - The tree always matches what ran, was saved or was sent, so the results grid, column picker, sorting and record actions all match too.
    - Editor mode stays on, and your column widths and order are kept. Your text is kept as typed, unless loading changed the query; then the editor shows the cleaned FetchXML that ran, with an "Editor updated" note.
    - When the editor already matches the tree, nothing is reloaded.
  - **No silent changes:** if loading into the tree would change the query (for example, dropping a second `<entity>`), a confirmation lists the changes first ("Load and execute" / "Load and save" / "Load and send"). Invalid FetchXML is reported and nothing runs. Cancel leaves the editor and tree untouched.
  - Loading a different query clears the loaded-view link, as any tree edit does, so Save then saves a new view.
- **Results are no longer cleared by a fast response** that arrives before the tree update is rendered.

### 🏗️ Technical

- `editorSync.ts`: a context that lets toolbar buttons rendered inside the results/editor pane ask it to sync before acting.
- `ParseChangesDialog.tsx`: the Parse to Tree confirmation, shared by Parse to Tree and the editor-mode actions.
- `loadFetchXml(xml, { preserveLayout })` keeps the current column layout and merges new attributes into it.

## [1.4.1-beta.6] - 2026-10-14

### 🔧 Fixed

- **Validate and Execute now catch the query mistakes Dataverse rejects (#90b, part 1).** New query-level rules, each verified against a live Dataverse org. FXS's parser agreed with Dataverse on all 48 rule cases (0 mismatches).
  - **Aggregate queries:**
    - every attribute needs Group by or an aggregate (`0x8004111e`) and an alias (`0x8004110b`);
    - an attribute can't be both Group by and an aggregate (`0x80041137`);
    - Group by and aggregates outside aggregate queries are errors (`0x8004112e`, `0x8004111a`);
    - an order can only use aliases from its own entity or link-entity (`0x8004110a`);
    - `aggregatelimit` together with an order fails with a SQL error.
  - **Orders:** `entityname` must match a link-entity alias, a link-entity name or the root entity (`0x80041108`), and isn't allowed on orders inside a link-entity.
  - **Aliases:** must be unique across the query, case-insensitively, and can't reuse the logical name of another attribute selected without an alias. Link-entity aliases must be unique too (`0x80041130`).
  - **Filters:** the union hint must be exactly `union`, on an `or` filter, once per query (`0x80041122`). Other hint values were silently dropped by Parse to Tree; they're now reported.
  - **Count child records (`rowaggregate`):** needs an alias, works only on the root entity, and doesn't work in aggregate queries.
  - **Ignored, not errors:** settings Dataverse accepts but ignores are reported as information only. Examples: `aggregatelimit` or date grouping outside aggregate queries, and `distinct` on aggregates other than `countcolumn`.
- **Boolean spellings Dataverse accepts are read correctly.**
  - `usertimezone="1"` used to be read as **false** (inverted meaning after Parse to Tree).
  - `groupby="1"`, `descending="1"`, `distinct="1"`, `returntotalrecordcount="1"` and `enableprefiltering="1"` (the documented form) were dropped.
  - `descending="True"`, which Dataverse rejects (`0x80041119`), is now an error instead of silently sorting ascending.
  - `aggregate` only makes an aggregate query when it's exactly `"true"`, as Dataverse does.
- **Report prefiltering is written as `enableprefiltering="1"`**, the documented value ([Use data filtering](https://learn.microsoft.com/en-us/dynamics365/customerengagement/on-premises/analytics/improve-report-performance-by-using-filters?view=op-9-1)).
- **Choosing "None" no longer writes `aggregate="none"` / `dategrouping="none"` (#88).** The Attribute and Condition editors clear the value instead, and the serializer never writes values outside the documented sets. The invalid "Row Aggregate" aggregate option is removed (`0x8004111a`).

### 🏗️ Technical

- `model/fetchxmlRules.ts`: query-level rules shared by the parser and (next) the property editors. Findings carry the `nodeId` they refer to.
- `model/attributeCapabilities.ts`: the metadata-driven capability matrix for the property panel. It records which attribute types support sort, group by and each aggregate function. It came from a 912-query live matrix over every attribute type, identical through `fetchXmlQuery` and `queryData`.
  - Example: Money attributes can't be counted through the Web API.
  - Example: multi-select option sets can't be sorted or grouped.
- `AttributeNode.aggregate` no longer allows `"rowaggregate"`.
- 280 unit tests.
- `npm-shrinkwrap.json` removed, and `finalize-package` no longer runs `npm shrinkwrap` (npm 12 dropped that command). The local `.claude/` workspace folder is git-ignored.

## [1.4.1-beta.5] - 2026-10-13

### 🔧 Fixed

- **FetchXML now runs against the entity's real entity set name (#61).** Queries used to go through the host's `fetchXmlQuery`, which guesses the Web API entity set name with English plural rules. Measured on the sandbox org, the guess is wrong for **67 of 1,612** Advanced Find entities, so every query on them failed. Examples: `feedback` (host requested `feedbacks`) and `msdyn_conversationdata` (actual set `msdyn_conversationsdata`).
  - Execution now uses `dataverseAPI.queryData(`${EntitySetName}?fetchXml=…`)` with the `EntitySetName` from entity metadata (cached). Microsoft requires the entity set name for the entity in the FetchXML's `entity` element ([Retrieve data with FetchXML](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/fetchxml/retrieve-data?tabs=webapi)).
  - The request is otherwise identical: GET with `Prefer: odata.include-annotations="*"`. Results were the same as before across 1,047 audit queries on entities the host names correctly.
  - The entity set comes from the FetchXML being executed, so editor-mode XML and paged requests (Load more, Retrieve all) use the right entity too.
  - Two system entities (`archivecleanupinfo`, `delegatedauthorization`) report an `EntitySetName` the service doesn't route. When Dataverse answers "Resource not found for the segment", the query is retried once with the entity's `LogicalCollectionName`.
  - `fetchXmlQuery` remains only as a fallback when entity metadata can't be loaded.
- Record delete still goes through the host, which only accepts a logical name. The metadata-based fix needs PPTB 1.2.7's `executeBatch` and moves to the v1.5.0 upgrade (#82).

## [1.4.1-beta.4] - 2026-10-13

### 📦 Dependencies

- **Fluent UI React v9 upgraded (#104)** ahead of the property-panel work in #90b:
  - `@fluentui/react-components` 9.72.4 → 9.74.9;
  - `@fluentui/react-icons` 2.0.313 → 2.0.343;
  - `@fluentui/react-calendar-compat` 0.3.16 → 0.4.7 (required by the date picker);
  - `@fluentui/react-datepicker-compat` 0.6.19 → 0.6.39;
  - `@fluentui/react-timepicker-compat` 0.4.24 → 0.4.41;
  - `@fluentui-contrib/react-data-grid-react-window` 1.4.1 → 1.4.2.
- Every new version was published at least two weeks ago. `react-icons` is pinned to 2.0.343 instead of 2.0.344 (published 2026-10-09) for that reason.
- The dependency tree has a single copy of each Fluent package. `npm audit` drops from 29 findings to 26 (three fewer high); the rest are tracked in #77.

### 🏗️ Technical

- `npm-shrinkwrap.json` was regenerated with npm 11.20.0. npm 12 no longer has `npm shrinkwrap`, and it writes a `package-lock.json` (without integrity hashes) instead of updating the shrinkwrap. Use npm 11 for dependency changes until the release tooling in #75 handles this.

## [1.4.1-beta.3] - 2026-10-13

### 🔧 Fixed

- **Parse to Tree is now lossless (#90a).** Previously the tree model couldn't hold several documented FetchXML attributes, so Parse to Tree (and editing in tree mode) silently dropped them or changed the query's meaning. Measured on all 60 FetchXML examples in the Microsoft Learn FetchXML articles: 25 of them changed after Parse to Tree. Now all 60 round-trip without loss.
  - **`<fetch>`:** `aggregatelimit`, `datasource`, `latematerialize` (was parsed but never written), `options` (query hints, kept exactly as written) and `useraworderby`.
  - **`<attribute>`:** `distinct` (for `countcolumn`) and `rowaggregate="CountChildren"`.
  - **`<order>`:** `alias`, which aggregate queries require.
  - **`<filter>`:** `isquickfindfields`, `overridequickfindrecordlimitenabled` and `overridequickfindrecordlimitdisabled`.
  - **`<entity>`:** `enableprefiltering` and `prefilterparametername` were read but never written.
  - **`<link-entity>`:** empty `from` / `to` are now omitted instead of being written as `from="" to=""`, which made Dataverse silently return no rows. The documented "let Dataverse choose" join for system many-to-many relationships now works after Parse to Tree.
  - **Everything else that works is kept verbatim:** unknown attributes, namespaced attributes, namespace declarations (`xmlns:generator`) and legacy attributes (`version`, `output-format`, `mapping`, `uiname`, `uitype`). A default `xmlns`, which Dataverse rejects, is still removed.
- **New validation, verified against a live Dataverse environment:**
  - `aggregatelimit` must be 1–50,000;
  - `datasource` must be `retained` (documented) or `bin` (accepted by Dataverse);
  - `aggregate="rowaggregate"` is an error (use `rowaggregate="CountChildren"`);
  - aggregate queries must order by `alias` (`0x80041131`), and non-aggregate queries by `attribute` (`0x80041132`);
  - query hint names that aren't documented get a note, because Dataverse silently ignores them.

### 🏗️ Technical

- Model: `FetchNode.options` gained `aggregateLimit`, `dataSource`, `useRawOrderBy` and `queryHints` (replacing an unused `hints` object). `AttributeNode` gained `distinct` and `rowAggregate`. `OrderNode.attribute` is now optional, alongside a new `alias`. `FilterNode` gained the quick find flags. Every node gained `extraAttributes` for verbatim pass-through.
- New round-trip suite (`fetchxmlRoundTrip.test.ts`) over all Learn examples, committed as MIT-licensed fixtures with source URLs (`__fixtures__/learnFetchXml.ts`), plus real-world FetchXML (Advanced Find, saved views, SQL 4 CDS, report prefiltering). 194 unit tests.
- Live replay: every Learn example executed as written and as regenerated, through the PPTB `dataverseAPI` request path, with identical results for all 53 full queries.
- Small display fallbacks for alias-only orders: the tree label shows `alias (alias)`, and the grid shows sort arrows on aggregate columns ordered by alias. The full UI controls for the new attributes follow in #90b.

## [1.4.1-beta.2] - 2026-10-13

### 🔧 Fixed

- **Valid FetchXML is no longer blocked in the editor (#89, #48).** Previously *any* parser warning blocked Validate and Execute. That refused FetchXML Dataverse accepts, such as `<fetch xmlns:generator="MarkMpn.SQL4CDS">` from SQL 4 CDS, `useraworderby`, `aggregatelimit` and `<order alias>`.
  - **Principle:** everything the [FetchXML reference](https://learn.microsoft.com/power-apps/developer/data-platform/fetchxml/reference/) documents is supported. Undocumented behaviour verified to work is supported too. Only what is known not to work is blocked.
  - Every classification was checked against a live Dataverse environment through the PPTB `dataverseAPI` request path: 33 probes, 0 mismatches.
  - **Errors** (Execute is blocked) are things Dataverse is known to reject:
    - invalid attribute alias characters;
    - an unknown child element;
    - non-integer `top` / `count` / `page`;
    - `top` combined with `count`, `page` or `returntotalrecordcount`;
    - an unknown `link-type`;
    - an invalid filter `type`, aggregate or date grouping;
    - a missing `name` / `attribute` / `operator`;
    - an order with neither attribute nor alias;
    - a default `xmlns`.

    Parse to Tree can still build the tree and lists what it corrects or removes. Malformed XML, a missing `<entity>`, and a link-entity with empty `from=""` and `to=""` (Dataverse silently returns no rows) can't be parsed at all.
  - **Warnings** (with **Execute anyway**) are only for what can't be determined in the client: a link-entity without `from` / `to` (valid only for system many-to-many relationships), and an operator that isn't in the documented list.
  - **Notes** never block:
    - namespace declarations, namespaced attributes and unknown attributes (Dataverse ignores them);
    - documented attributes the visual builder doesn't support yet, including `datasource`;
    - `top` / `count` above 5,000 (Dataverse returns at most 5,000 rows);
    - the deprecated `neq` operator (works like `ne`);
    - extra `<entity>` elements (Dataverse uses the first).

    Common legacy attributes from Advanced Find and saved views (`version`, `output-format`, `mapping`, `uiname`, `uitype`) are accepted silently.
- **`link-type="natural"` is supported.** It's undocumented, but Dataverse accepts it; it's listed in Dataverse's own link-type error and was verified against a live org. It's preserved through Parse to Tree.
- **Parse to Tree no longer changes queries silently.** When it would remove or rewrite something, a confirmation dialog lists the changes under **Removed** and **Corrected**. Examples: `datasource="retained"`, which would otherwise read live data; `<order alias>`; an invalid alias.
  - Order elements that the tree can't represent are now dropped, with a note, instead of being rewritten as the invalid `<order attribute="" />`.
  - The misleading "Auto-corrected" label is gone.
- **Validate** shows at most one bar per level (Invalid FetchXML / "Dataverse might reject this query" / Notes) instead of one bar per finding. Lists are bulleted.

### 🏗️ Technical

- `ParseWarning` gained `severity` (`error` | `warning` | `info`) and `kind` (`invalid` | `ignored` | `dropped` | `corrected` | `advice`).
- New helpers: `getExecutionErrors()`, `getBlockingWarnings()` and `getParseToTreeChanges()`.
- Unknown-attribute checks now cover every element, using per-element attribute lists from the reference.
- New `ParseIssueList` component. The Parse to Tree confirmation uses a Fluent UI v9 `Dialog` (`modalType="alert"`, Cancel focused first).
- 44 new unit tests, 109 in total.

## [1.4.1-beta.1] - 2026-10-12

### 🔧 Fixed

- **Wrong attribute injected into the root entity (#54).** The root table was taken from the first entry of an alphabetically sorted list of the query's tables. That list was sorted *in place*, so a link-entity whose name sorts first (e.g. `bookableresource` before `msdyn_timeentry`) was treated as the root. Its primary key (`bookableresourceid`) was injected into the root `<entity>`, and its metadata also drove relationships, the layout and bulk delete.
  - The root now always comes from the query's `<entity>` element.
  - Metadata responses that arrive after the query changed are discarded.
  - Root metadata is only used when its `LogicalName` matches the current root.
- **FetchXML is no longer modified (#59).** The primary key used to be injected into the generated FetchXML. That broke aggregate queries (`0x8004111e: An attribute can not be requested when an aggregate operation has been specified…`), silently defeated `distinct`, and the injected attribute never appeared in the tree.
  - Validated on a live org through the PPTB `dataverseAPI` request path: Dataverse returns the root primary key for every non-aggregate, non-distinct query without it being selected ([Select columns](https://learn.microsoft.com/power-apps/developer/data-platform/fetchxml/select-columns?tabs=webapi)). Distinct queries return none ([Ordering and paging](https://learn.microsoft.com/power-apps/developer/data-platform/fetchxml/page-results?tabs=webapi#ordering-and-paging)).
  - What you see in the FetchXML pane, copy, save as a view, send to another tool or generate code from is now exactly what you built.
- **Record actions use real record IDs only.**
  - Record actions (Open, Copy URL, Delete, Bulk Delete, Run Workflow) are enabled only when the results contain the table's primary key.
  - For aggregate and distinct results they are disabled, and a "Record actions unavailable" indicator explains why. Previously, Open/Copy URL could be clicked for an aggregate row and used a random ID.
  - Grid row IDs are now unique and stable even when a 1:N join repeats a record. Synthetic row IDs are never passed to record actions.

### 🏗️ Technical

- `generateFetchXml(fetchNode)` no longer takes a `primaryIdAttribute` parameter.
- New `getQueryEntities()` (`model/treeUtils.ts`) and `buildRowIdentity()` (`ui/RightPane/rowIdentity.ts`), with unit tests: 65 tests in total.
- **Unit test baseline (#64).** Added Vitest (`npm test`, `npm run test:watch`, `npm run coverage`) with jsdom, plus 52 characterization tests for the FetchXML serializer, parser (including a parse → generate → parse round-trip of the #54 query), paging-attribute rewriting, alias utilities and the operator catalogue.
- **Lint cleanup, part 1 (#65).** ESLint errors reduced to zero with no behaviour change:
  - `useBuilder` / `BuilderContext` moved to `state/builderContext.ts`;
  - `useTheme` / `ThemeContext` moved to `shared/contexts/useTheme.ts`;
  - `getCellRenderer` moved to `RightPane/getCellRenderer.tsx` (React Fast Refresh: component modules export only components);
  - removed two `any` types in `ResultsGrid.tsx`;
  - `_`-prefixed bindings are now allowed as intentionally unused.
  - The remaining `react-hooks/exhaustive-deps` warnings can affect runtime behaviour and are handled separately.

## [1.4.0] - 2026-07-01

### ✨ Added

#### Tool-to-Tool (T2T) invocation

FetchXML Studio now participates in PPTB Tool-to-Tool (T2T) invocation in both directions. This feature was iterated through the `1.2.2-beta.*` and `1.2.3-beta.*` prereleases (detailed below); `1.4.0` is its first stable release. All T2T behavior is capability-gated and feature-detected, so standalone use and hosts without invocation/discovery support are unaffected. `features.minAPI` stays `1.2.2`.

- **Send to Tool (caller)** — Send the current FetchXML (plus root entity) to another PPTB tool. Targets are discovered automatically via the capability registry (`invocation.findToolsByCapability("fetchxml")`); the "Send to Tool" dropdown lists installed tools that declare the `fetchxml` capability, excluding FetchXML Studio itself (matched on the runtime tool id from `getToolContext()`). One-way, fire-and-forget handoff via `launchTool(..., { noReturn: true })`.
- **Callee (inbound prefill + return)** — When launched by another tool, FetchXML Studio consumes the inbound launch context to pre-populate the builder (resolution priority `fetchXml` → `viewRef` → `entityLogicalName`; the root entity is always derived from the FetchXML). A "Return FetchXML" button (shown only when launched as a callee) returns `{ fetchXml }` to the caller via `returnData()`.
- **Contract** — `pptb.config.json` declares `capabilities: ["fetchxml"]`, a `prefill` schema, and a `returnTopic`.

### 🏗️ Technical

- Depends on `@pptb/types` `1.2.3` (stable). New modules: `src/features/fetchxml/api/invocation.ts`, `src/shared/hooks/useLaunchContext.ts`, `src/shared/hooks/useSendToTools.ts`, `src/features/fetchxml/ui/Toolbar/SendToToolButton.tsx`. See the `1.2.x-beta.*` entries below for the full iteration history.

## [1.3.1] - 2026-05-30

### 🔧 Fixed

- **Double sort arrows on results grid column headers** (#22, #35) — The Fluent UI v9 `DataGrid` component renders its own sort indicator when `sortable` is set without a controlled `sortState`. This caused both Fluent's built-in arrow and the custom `renderHeaderCell` multi-sort arrow to render simultaneously. Fixed by passing a controlled `sortState` sentinel value (`sortColumn: "__sort_managed_externally__"`) that never matches any real column ID, preventing Fluent from rendering its internal indicator. The custom FetchXML-driven sort arrows in the column headers are now the sole source of truth.

- **"Parse to Tree" injects incorrect primary key for activity entities** (#37) — Standard entities follow the `${entityname}id` naming convention (e.g. `accountid`, `contactid`), but activity entities (`email`, `task`, `phonecall`, `fax`, `letter`, `appointment`, and custom activities) all inherit from `activitypointer` and use `activityid` as their primary key. The previous code hardcoded the `${entityname}id` pattern everywhere, causing `emailid`, `taskid`, etc. to be injected into the FetchXML query tree — attributes that do not exist in Dataverse. Fixed by threading `EntityMetadata.PrimaryIdAttribute` (the authoritative value from the Dataverse metadata API) through the full call chain. No fallback pattern or guessing — the primary key is only injected when the metadata is available.

### 🏗️ Technical

- `fetchxml.ts` — `generateFetchXml(fetchNode, primaryIdAttribute?)` accepts the PK from the caller; only injects the primary ID attribute when explicitly provided.
- `layoutxml.ts` — `generateLayoutFromFetchXml(fetchQuery, primaryIdAttribute?, attributeTypeMap?)` — PK is now optional; stored in `LayoutXmlConfig.primaryIdAttribute` when provided.
- `builderStore.tsx` — `ViewLoadInfo` now includes `originalFetchXml: string`; `SYNC_LAYOUT_WITH_FETCHXML` action and `syncLayoutWithFetchXml()` both accept `primaryIdAttribute?`; the store no longer derives or guesses the primary key itself.
- `ResultsGrid.tsx` — `primaryIdAttribute` prop replaces the old `${entityName}id` `useMemo`; `sortState` sentinel eliminates the double-arrow rendering.
- `PreviewTabs.tsx` — threads `primaryIdAttribute?` down to `ResultsGrid`.
- `AppShell.tsx` — passes `entityMetadata.PrimaryIdAttribute` to all call sites: `generateFetchXml`, `syncLayoutWithFetchXml`, `setLoadedView` (via `originalFetchXml`), and `<PreviewTabs>`.

---

## [1.3.0] - 2026-05-29

### ✨ Added

#### Code Generation Panel (#38)
- **Code tab** — New tab in the right pane (alongside FetchXML, LayoutXML, Results) with a tabbed panel that generates ready-to-use code from the current query in seven formats. Async formats (C# QueryExpression, SQL) run in parallel and cancel automatically when the query changes.

#### C# QueryExpression (#39, #40)
- Converts FetchXML to a full `QueryExpression` SDK object graph via the Dataverse `FetchXmlToQueryExpression` Web API function.
- Emits `ColumnSet`, `FilterExpression`, `ConditionExpression`, `LinkEntity`, `OrderExpression`, `XrmAttributeExpression`, `PagingInfo`, `TopCount`, `Distinct`, and `NoLock`.
- Full aggregate query support — `XrmAggregateType` (Count, CountColumn, Sum, Avg, Min, Max) and `XrmDateTimeGrouping` (Day, Week, Month, Quarter, Year, FiscalPeriod, FiscalYear).
- Correctly resolves all Dataverse API enum values returned as strings (`ConditionOperator`, `JoinOperator`, `LogicalOperator`, `OrderType`, `XrmAggregateType`, `XrmDateTimeGrouping`) via a shared `resolveEnum()` helper.
- Correctly unwraps .NET-serialized condition values (`{ "Type": "System.Int32", "Value": 0 }`) to C# integer / string / GUID literals via `unwrapODataValue()`.

#### C# FetchExpression (#43)
- Wraps the FetchXML in `new FetchExpression(@"...")` using a C# verbatim string literal for multi-line XML.

#### JavaScript (#43)
- Generates an `Xrm.WebApi.retrieveMultipleRecords` call for model-driven app JS, PCF components, and browser console.

#### pac CLI (#43)
- Generates a `pac org fetch --xml "..."` command for the Power Platform CLI.

#### Power Automate (#43)
- Field-by-field form mirroring the Dataverse "List rows" connector UI — not a plain code dump.
- Displays Table name, Select Columns, Filter Rows, Sort By, Top Count, and Fetch Xml Query fields with individual copy buttons and flash confirmation feedback.
- Table name resolved from `EntityDefinitions` metadata (already cached from entity selection) — accurate OData entity set name, not a heuristic pluralisation.

#### Web API (#43)
- Full OData URL with URL-encoded FetchXML, required request headers, a `curl` snippet, and a PowerShell `Invoke-RestMethod` example.
- Entity set name resolved from the same metadata cache as the Power Automate tab.

#### SQL (#39)
- T-SQL generated via the Dataverse `FetchXMLToSQL` Web API function (undocumented — labelled "Preview" with a tooltip warning).
- Robust response-property fallback parsing handles multiple possible response key names.

### 🏗️ Technical

- Added `src/features/fetchxml/engine/` — new code-generation module:
  - `queryExpressionTypes.ts` — TypeScript interfaces mirroring the Dataverse QE JSON schema; all enum fields typed as `number | string` to match actual API wire responses.
  - `queryExpressionCodegen.ts` — C# SDK code emitter with `resolveEnum()` and `unwrapODataValue()` helpers for robust handling of string-name enums and .NET-serialized value wrappers.
  - `fetchxmlCodeGenerators.ts` — Sync code generators (FetchExpression, JavaScript, pac CLI, Power Automate spec, Web API); pure functions with no API calls required.
- Added `src/features/fetchxml/ui/RightPane/PowerAutomatePane.tsx` — field-by-field form component (3-column grid: label | input | copy button) with "N of N populated" badge and "Copy all" action.
- Added `src/features/fetchxml/ui/RightPane/CodePanel.tsx` — 7-tab code generation panel; async tabs run in parallel with abort-on-change cancellation.
- `PreviewTabs.tsx` — Added Code tab with `Code20Regular` icon.
- `pptbClient.ts` — Added `fetchXmlToQueryExpression` (calls `FetchXmlToQueryExpression` Dataverse function) and `fetchXmlToSQL` (calls `FetchXMLToSQL`) with multi-property fallback response parsing.

## [1.2.3-beta.3] - 2026-07-01

### 🏗️ Technical

- Upgraded `@pptb/types` `1.2.3-beta.0` → `1.2.3` (stable) ahead of merging the T2T branch into `dev`. Types are compile-time only, so there is **no runtime change** — the API surface FetchXML Studio uses (capability discovery, `launchTool` `noReturn`, `getToolContext`) is identical in the stable release. `features.minAPI` stays at `1.2.2`; discovery remains feature-detected and degrades gracefully on older hosts.

## [1.2.3-beta.2] - 2026-07-01

### 🐛 Fixed

- **Send to Tool no longer spins forever.** The launch is now fire-and-forget — previously the button awaited `launchTool`, whose promise doesn't resolve until the callee window closes, so the spinner stayed up for the whole session (reported when sending FXS → Bulk Data Studio). This is purely a caller-side fix; a callee does **not** need to declare a `returnTopic` to avoid it.
- **Always shows a "Send to Tool" dropdown.** Previously a single discovered tool collapsed the toolbar control into a button labelled with that tool's name; it now consistently reads "Send to Tool" and lists the target(s) in the menu.
- **Each target shows its tool id on its own line** beneath the display name in the menu.
- **FetchXML Studio no longer lists itself** as a target. Self-exclusion now matches on the runtime tool id from `getToolContext()` (with the npm package id as a fallback), since discovery reports the runtime id (e.g. `npm-mohsinonxrm-pptb-fetchxml-studio`) rather than the npm package name.

## [1.2.3-beta.1] - 2026-06-17

### ✨ Added

#### Tool-to-Tool (T2T) — capability-based tool discovery

The "Send to Tool" target list is now populated automatically via the PPTB capability registry instead of a manually maintained list. Requires **`@pptb/types` ≥ 1.2.3-beta.0** and a host that exposes capability discovery.

- **Automatic discovery** — FetchXML Studio calls `toolboxAPI.invocation.findToolsByCapability("fetchxml")` to find installed tools that declare the `fetchxml` capability, excludes itself, and lists them in the Send to Tool button (single button for one match, dropdown for several). Hidden when no matches or when the host lacks discovery — feature-detected at runtime, so older hosts degrade gracefully.
- **One-way send** — Launches now pass `noReturn: true`, the dedicated flag for the "Send To" pattern, which suppresses the callee's "Return to [Caller]" banner since FXS isn't waiting for data back.

### 🔧 Changed

- **Removed the manual "Tool Integration" settings.** The Settings → Tool Integration section and the `targetTools` display setting are gone; discovery replaces them entirely.

### 🏗️ Technical

- Bumped `@pptb/types` `1.2.2-beta.1` → `1.2.3-beta.0`, which now types `invocation.findToolsByCapability` / `getKnownCapabilityTags`, the `capabilities` field on `InvocationConfig`, the `CapabilityTag`/`KnownCapabilityTag` types, and `launchTool`'s `noReturn` option. Removed the local `InvocationAPI` interface in `invocation.ts` in favor of the now-published host types.
- `src/features/fetchxml/api/invocation.ts` — Added `DiscoveredTool` + `discoverFetchXmlTools()` (feature-detected; filters out our own id; defaults `name` to `id`); added `noReturn: true` to `sendFetchXmlToTool`.
- `src/shared/hooks/useSendToTools.ts` — New hook; discovers send targets once on mount.
- `src/app/AppShell.tsx` — Uses `useSendToTools`; Send to Tool slot now gated on `isT2TSupported() && sendToTools.length > 0`.
- `src/features/fetchxml/ui/Toolbar/SendToToolButton.tsx` — Prop changed from `targetTools: string[]` to `tools: DiscoveredTool[]`; labels use the discovered tool name.
- `src/features/fetchxml/ui/Settings/SettingsDrawer.tsx` — Removed the Tool Integration section, its handlers/state/styles, and now-unused imports.
- `src/features/fetchxml/model/displaySettings.ts` — Removed `targetTools` from `DisplaySettings` and the defaults.

## [1.2.2-beta.2] - 2026-06-16

### ✨ Added

#### Tool-to-Tool (T2T) Invocation — Callee (prefill + return)

FetchXML Studio can now be *launched by* another PPTB tool, pre-populated with an inbound query, and hand a query back. Completes the round-trip alongside the existing caller support.

- **Inbound prefill** — On launch via T2T, FetchXML Studio reads its launch context and pre-populates the builder. Resolution priority is `fetchXml` → `viewRef` → `entityLogicalName`: a `fetchXml` string is loaded directly; a `viewRef` has its FetchXML retrieved from the referenced `savedquery`/`userquery`; and a bare `entityLogicalName` starts a fresh query on that entity. When `fetchXml` is present the root entity is **derived from the FetchXML itself** and any `entityLogicalName` hint is ignored, because a mismatched value would break this metadata-driven tool's lookups.
- **Return FetchXML button** — When launched as a callee, a "Return FetchXML" button appears in the FetchXML toolbar. It returns `{ fetchXml }` (the current editor-or-tree query) to the caller via `returnData()`, which the host resolves as the caller's `launchTool(...)` result. This is intentionally separate from the host-injected "Return to [Caller]" banner, which only navigates back and resolves the caller's promise with `null`.
- **`pptb.config.json`** — Added the `fetchxml` capability tag (for discovery via `findToolsByCapability`) and a `returnTopic` describing the `{ fetchXml }` return shape. Relaxed the prefill contract so `entityLogicalName` is optional/hint-only.

### 🏗️ Technical

- `src/features/fetchxml/api/invocation.ts` — Added callee helpers: `getLaunchContext()`, `resolveLaunchPrefill(context)` (returns a `{ kind: "fetchxml" | "entity" }` action following the `fetchXml` → `viewRef` → `entityLogicalName` priority; resolves `viewRef` by reusing the `dataverseAPI.queryData` view-read route filtered to a single record), `returnDataToInvokingTool(data)`, and `returnFetchXmlToInvokingTool(fetchXml)`. Added `FetchXmlStudioLaunchPrefill` type and `LaunchPrefillAction` union.
- `src/shared/hooks/useLaunchContext.ts` — New hook. Calls `getLaunchContext()` once on mount and exposes `{ loading, isCallee, context }` so detection happens in one place.
- `src/app/AppShell.tsx` — Consumes the prefill exactly once on launch (loads incoming FetchXML via `builder.loadFetchXml`), and passes `isCallee` to `PreviewTabs`.
- `src/features/fetchxml/ui/RightPane/PreviewTabs.tsx` — Added `isCallee?` prop and a `ReturnFetchXmlButton` (gated on `isCallee`) rendered next to Execute; uses a `getCurrentXml()` helper that returns the live editor buffer when in editor mode.

### 🔧 Changed

- **"Send to Tool" button visibility** — The caller button is now hidden entirely unless at least one target tool is configured under Settings → Tool Integration (previously it rendered as a disabled button with a tooltip). The two T2T toolbar actions are now strictly capability-gated and never change meaning by mode: **Return FetchXML** shows only when launched as a callee (`isCallee`); **Send to Tool** shows only when targets are configured.

## [1.2.2-beta.1] - 2026-05-25

### ✨ Added

#### Tool-to-Tool (T2T) Invocation — Caller

FetchXML Studio can now send the active query to any other PPTB tool that accepts a FetchXML prefill payload. Requires **PPTB host ≥ 1.2.2**.

- **Send to Tool button** — A new "Send to Tool" button appears in the toolbar (alongside Save View) whenever the PPTB host exposes the `toolboxAPI.invocation` API. Three interaction modes depending on how many target tools are configured:
  - *No tools configured* — Button is disabled with a tooltip pointing to Settings → Tool Integration.
  - *One tool configured* — Single button; click launches the tool directly.
  - *Multiple tools configured* — Dropdown menu listing all configured tools; click an item to launch.
- **Settings → Tool Integration section** — New section in the Settings drawer to manage the list of target tool npm package IDs (e.g. `@linked365/pptb-bulk-data-studio`). Supports add (text input + Enter/Add button) and remove (× button per item). The list is persisted via `toolboxAPI.settings` alongside other display preferences.
- **Active connection forwarding** — The caller automatically retrieves the currently active Dataverse connection and forwards its ID as `primaryConnectionId` when launching the target tool, so the callee opens against the same environment.
- **`pptb.config.json`** — Added PPTB callee contract file at the repository root. Declares the prefill schema this tool accepts when *receiving* a T2T invocation from another tool (see [Callee Contract](#-callee-contract-pptbconfigjson) in the README). `viewRef` is modelled as a Dataverse EntityReference: required fields `id` (UUID string) and `entityLogicalName` (enum: `"savedquery"` | `"userquery"`).

### 🏗️ Technical

- `src/features/fetchxml/api/invocation.ts` — New module. Defines a local `InvocationAPI` interface (mirrors the PPTB host API not yet in `@pptb/types`) and exposes `isT2TSupported()` and `sendFetchXmlToTool(targetToolId, { fetchXml, entityLogicalName })`.
- `src/features/fetchxml/ui/Toolbar/SendToToolButton.tsx` — New toolbar component. Handles the disabled / single / multi-tool rendering variants; calls `sendFetchXmlToTool`; surfaces errors via `toolboxAPI.utils.showNotification`.
- `src/features/fetchxml/model/displaySettings.ts` — Added `targetTools: string[]` (default `[]`) to `DisplaySettings` interface and `defaultDisplaySettings`.
- `src/features/fetchxml/ui/Settings/SettingsDrawer.tsx` — Added Tool Integration section with add/remove UI. Added `Input`, `Field`, `Add20Regular`, `Dismiss16Regular`, `PlugConnected20Regular` to imports.
- `src/features/fetchxml/ui/RightPane/PreviewTabs.tsx` — Added `sendToToolButton?: ReactNode` prop; rendered unconditionally (all tabs) next to `saveViewButton`.
- `src/app/AppShell.tsx` — Imports `SendToToolButton` + `isT2TSupported`; passes `sendToToolButton` prop to `PreviewTabs` gated on `isT2TSupported()`.
- `package.json` — `features.minAPI` bumped from `1.2.0` → `1.2.2` to reflect the new PPTB host requirement. `scheduler` added to `devDependencies` (required peer dep of `@fluentui/react-context-selector` that was missing from the install tree).

#### Packaging fixes (resolves #33)

- **`icon` path corrected** — `"icon"` field in `package.json` was missing the `icons/` directory prefix (`"icon-insider.svg"` → `"icons/icon-insider.svg"`). Icon was not resolvable by PPTB at install time.
- **`files` array expanded** — Added `"icons"`, `"index.html"`, `"LICENSE"`, `"README.md"`, `"CHANGELOG.md"`, `"SECURITY.md"` alongside the existing `"dist"` and `"npm-shrinkwrap.json"` entries. Previously the `icons/` folder (referenced by the `"icon"` field) and all root-level docs were absent from the published package.
- **Production source maps disabled** — Added `sourcemap: false` to `vite.config.ts` `build` options. Monaco worker source maps were silently adding ~17 MB to the package; disabling them brings the published size down to ~3–4 MB.

---

## [1.2.1] - 2026-04-07

### ✨ Added

- **Copy button in editor mode** — The FetchXML editor toolbar now includes a Copy button when in editor mode, making it consistent with the read-only toolbar. Previously Copy was only available when the editor was not in edit mode.

### 🔧 Fixed

- **Results grid column overlap** — Column widths are now estimated dynamically from header text (capped at 400 px) so adjacent columns no longer overlap on first render. All cells use `TableCellLayout truncate` for clean overflow.
- **Results grid header/row misalignment** — Removed a stray CSS class from `DataGridBody` that was causing header and row widths to drift out of sync when the grid had overflowing content.
- **Alias validation in property editors** — Typing an invalid alias character (space, hyphen, special character) in `AttributeEditor` or `LinkEntityEditor` now sanitizes the value in real time: invalid characters are stripped, and a leading digit is prefixed with `_`.
- **Alias validation in parser** — When parsing FetchXML (both *Parse to Tree* and *Execute*), invalid aliases are now automatically sanitized. A parse warning describes the correction (e.g. *"Alias 'this is id' had invalid characters and was corrected to 'thisisid'."*) instead of silently forwarding the invalid alias to Dataverse where it would cause an API error.
- **Execute blocked when alias warnings are present** — Clicking Execute in editor mode now validates the XML completely before sending it to Dataverse. If parse warnings exist (e.g. an invalid alias that wasn't auto-corrected via *Parse to Tree*), execution is blocked and the warning is surfaced in a message bar above the editor with a hint to use *Parse to Tree* to auto-correct. Previously the bad alias was silently sent to Dataverse and the error appeared in the Results tab.
- **Editor state preserved across tab switches** — Switching from the FetchXML tab to Results or LayoutXML and back no longer resets editor mode or discards the edited XML. The editor component is now always mounted (hidden via `display: none` when not active) so Monaco state — editor mode toggle, cursor position, edit buffer — is fully preserved.
- **Validate contradictory messages** — *Validate* no longer shows both a "Valid" success message and warnings simultaneously. When warnings are present, validate now shows each warning plus an "Action required" notice and stops — the "Valid" success message is only shown when there are zero warnings.
- **Parse to Tree corrections shown as informational** — Auto-corrected alias warnings from *Parse to Tree* are now shown with `intent="info"` (blue) rather than `intent="warning"` (yellow), correctly communicating that the tool has already resolved the problem.
- **Execute API errors surfaced** — Dataverse API errors that occur during query execution are now captured and displayed in a message bar in the Results tab. Previously they were only visible in the browser console.

### 🏗️ Technical

- Added `src/features/fetchxml/model/aliasUtils.ts` — `isValidAlias()` and `sanitizeAlias()` shared utilities enforcing the Dataverse alias constraint (`[A-Za-z_][A-Za-z0-9_]*`).
- `fetchxmlParser.ts` — `parseAttribute` and `parseLinkEntity` now import `sanitizeAlias`; invalid aliases are corrected in place and described in the parse warning rather than propagated as-is.
- `PreviewTabs.tsx` — `FetchXmlEditor` is always mounted; `handleExecute` blocks on parse warnings; navigating back to the FetchXML tab clears any stale editor validation error banner.
- `AppShell.tsx` — `handleExecute` accepts an optional `xmlOverride` (used when editor mode is active); `executeError` state threads Dataverse API errors back to the `PreviewTabs` message bar.

---

## [1.2.0] - 2026-04-03

### ✨ Added

#### Query Scope Settings
- **Entity Scope Mode** — New setting (persisted across sessions) to control which entities appear in the entity dropdown:
  - **Publisher + Solution** — Select a publisher, then narrow to specific solutions; only entities belonging to those solutions are shown
  - **Solution Only** — Skip the publisher step and pick solutions directly
  - **All Entities** — Show every entity in the environment (no solution filter)
- **Advanced Find Only toggle** — When enabled (default), entities and attributes are limited to those marked `IsValidForAdvancedFind = true`, matching the classic Advanced Find behavior. Disabling shows all entities and attributes — including system and developer-only tables — useful for building admin or integration queries. The filter is applied locally so toggling is instant with no additional API call.
- Scope mode and Advanced Find preference are persisted individually via `toolboxAPI.settings` and survive across sessions.

#### Monaco Editor — Local Bundling
- Monaco is now fully bundled in `dist/` instead of being fetched from a CDN at runtime.
- Eliminates CSP errors and ensures line numbers, syntax highlighting, and all editor features work correctly in the PPTB host environment without network access to external CDNs.

### 🔧 Fixed

- **Internal solutions in Solution-only mode** — Solutions from `isreadonly = true` publishers (Microsoft, system publishers) are now excluded from the solution picker, consistent with what Publisher + Solution mode shows. Previously some Microsoft-owned visible solutions appeared in the list.
- **Parse-to-tree no longer resets the entity** — Pasting FetchXML into the editor and clicking "Parse to Tree" no longer wipes the selected entity. The validation that auto-clears the entity selection now only fires when there is an active solution filter in place (i.e. specific solutions have been selected) and the entity has dropped out of scope — not when the entity was set programmatically via the XML editor.
- **Entity list cache race condition** — `loadAllEntities` no longer accepts an `advancedFindOnly` parameter. It always fetches all entities from the server (no `$filter=IsValidForAdvancedFind eq true`). The Advanced Find filter is now applied locally in the EntitySelector `memo`. This eliminates a bug where an earlier `advancedFindOnly=true` load could poison the cache and cause subsequent `advancedFindOnly=false` calls to silently return the wrong (filtered) set.
- **Privilege check console noise** — `checkPrivilegeByName` errors for privileges that don't exist in the environment (e.g. `prvDeleteGitorganization` for system tables) are now logged as `console.warn` instead of `console.error`. The UI behavior is unchanged.
- **CSP exception** — Removed the invalid `*.crm*.dynamics.com` wildcard from `cspExceptions` (browsers reject multi-depth subdomain wildcards). The only `connect-src` exception kept is `https://*.dynamics.com`.

### 🏗️ Technical

- `useAccessMode` preloads only the AF-valid entity metadata cache (`allEntityMetadataCache`) on startup — used by publisher-solution and solution-only modes. The all-entities cache is populated lazily the first time "All Entities" scope mode is used.
- `loadAllEntities` / `useLazyMetadata.loadEntities` signatures simplified (no `advancedFindOnly` param — always fetches everything).
- `vite.config.ts` — `manualChunks` splits Monaco into its own chunk (`monaco-editor-*.js`, ~3.7 MB; `monaco-editor-*.css`, ~145 kB).
- TypeScript strict compile: **zero errors** (`tsc -b --noEmit`).

---

## [1.1.0] - 2026-03-23

### ⬆️ Upgraded

- **`@pptb/types` 1.0.7 → 1.2.0** — now the authoritative source for all PPTB host API types (`window.dataverseAPI`, `window.toolboxAPI`). Added to `tsconfig.app.json` `types` array so global augmentations apply project-wide without per-file triple-slash references.
- **`features.minAPI`** set to `"1.2.0"` in `package.json` to enforce the correct PPTB host version at install time.

### ✨ Added

#### Native File Save Dialog
- Both export paths (local ExcelJS export and Dataverse `ExportToExcel` action) now use `window.toolboxAPI.fileSystem.saveFile` when running inside the PPTB desktop host, presenting a native OS save-file dialog instead of a forced browser blob download.
- Graceful fallback to browser blob/anchor download when running in standalone or dev context (i.e. when `window.toolboxAPI` is not available).

#### Connection Environment Awareness
- `PptbContext` now exposes `environment?: "Dev" | "Test" | "UAT" | "Production"` sourced from the active `DataverseConnection`.
- Subscribes to `connection:updated`, `connection:created`, and `connection:deleted` PPTB events to keep the field in sync dynamically.

#### Package Manifest Hardening
- Added top-level `"icon"` field pointing to `icons/icon.svg` (replacing deprecated `configurations.iconUrl`).
- `"features"` block added: `{ "multiConnection": "none", "minAPI": "1.2.0" }`.
- `cspExceptions` migrated from plain-string arrays to the required object format with `domain` + `exceptionReason` fields (+ `optional: true` on style-src).
- Added `"validate": "pptb-validate"` npm script for pre-publish manifest validation.
- Added `"finalize-package": "npm run build && npm shrinkwrap"` convenience script.

### ♻️ Refactored

#### `pptbClient.ts`
- Removed the entire hand-written `declare global { interface Window { dataverseAPI?: { ... } } }` block (~60 lines). The `window.dataverseAPI` global is now typed entirely by `@pptb/types`.
- Added local `DataverseFetchXmlResponse` interface to capture OData response annotations beyond what `@pptb/types` `FetchXmlResult` declares (`@Microsoft.Dynamics.CRM.totalrecordcount`, `morerecords`, `pagingcookie`, `totalrecordcountlimitexceeded`). These are OData wire annotations returned directly by Dataverse — not fabricated by PPTB — so the cast is safe at runtime.
- `downloadBase64File()` changed from `void` to `async Promise<void>`; uses `fileSystem.saveFile` when available.

#### `usePptbContext.ts`
- Removed the entire hand-written `declare global { interface Window { toolboxAPI?: { ... } } }` block. The `window.toolboxAPI` global is now typed entirely by `@pptb/types`.
- `PptbContext` interface: removed legacy `organizationId?: string` (not present in `DataverseConnection` v1.2.0 types); replaced with `environment?: "Dev" | "Test" | "UAT" | "Production"`.

#### `excelExport.ts`
- `downloadExcelFile()` changed from `void` to `async Promise<void>`; uses `fileSystem.saveFile` when available.

#### `AppShell.tsx`
- Both download call sites updated with `await` to match the new async signatures.

### 🔧 Technical

- TypeScript strict compile: **zero errors** (`tsc -b --noEmit`).
- `pptb-validate`: **✔ Validation passed**.

---

## [1.0.6] - 2026-01-14

### ✨ Added

#### Select Attributes Dialog (#12)
- **Bulk Attribute Selection**: New "Select Attributes" modal dialog for efficient multi-attribute selection
  - Accessible from entity and link-entity context menus in the tree view
  - Works on root entity, link-entities, and nested link-entities at any level
- **Smart Selection Grid**: DataGrid showing all available entity attributes
  - Three sortable columns: Logical Name, Display Name, and Data Type
  - Pre-selects currently selected attributes with checkboxes
  - Multi-select support for bulk add/remove operations
- **Search & Filter**: Integrated SearchBox for quick attribute filtering
  - Filters across all columns (logical name, display name, data type)
  - Real-time filtering as you type
- **Fixed Headers**: Column headers remain visible while scrolling through attributes
- **Confirmation Required**: Changes only applied when user clicks Apply button
  - Cancel button discards changes without affecting the tree
- **Smart Updates**: Intelligently adds new attributes and removes deselected ones
  - Preserves existing attributes that remain selected
  - Maintains attribute order and properties
- **Performance**: Leverages metadata cache for fast attribute loading
  - Falls back to API loading if attributes not cached
  - Shows only attributes valid for Advanced Find

### 🔧 Technical

- Added `SelectAttributesDialog` component with FluentUI DataGrid
- New `UPDATE_ATTRIBUTES` action in builderStore for bulk attribute operations
- Enhanced TreeView with dialog state management and attribute loading
- Integrated with existing metadata caching system

## [1.0.0] - 2024-12-15

### 🎉 Initial Release

FetchXML Studio v1.0.0 - A powerful FetchXML query builder for Power Platform ToolBox.

### ✨ Features

#### Query Builder
- Tree-based visual query builder with hierarchical FetchXML structure
- Full entity, attribute, filter, order, and link-entity support
- Context-aware properties panel for each node type
- Nested filter groups with AND/OR logic
- Support for all FetchXML operators (60+ operators)
- Aggregate queries with groupby and distinct
- Query hints for performance optimization

#### Relationships & Joins
- Relationship picker with 1:N, N:1, N:N categorization
- Inner and outer join support
- Filter link-entity for any/all/not any/not all scenarios
- Value-of conditions for cross-entity comparisons
- Entity name conditions for outer join filtering

#### Results Grid
- Virtualized DataGrid for large datasets (react-window)
- Rich cell rendering for lookups, option sets, dates, currency
- Multi-column sorting (click + Shift+click)
- Row selection (single and multi-select)
- Resizable and reorderable columns
- Formatted values with raw value toggle

#### FetchXML Editor
- Monaco editor with XML syntax highlighting
- Bi-directional editing (visual ↔ XML)
- Parse FetchXML to visual builder
- Copy to clipboard
- LayoutXML preview tab

#### Views
- Load system and personal views
- Optimized view execution via SavedQuery/UserQuery APIs
- Save queries as personal views
- Update existing views
- Solution-aware save (add to solution)

#### Data Operations
- Export to Excel with native data types
- Delete selected records
- Bulk delete jobs (async)
- Run on-demand workflows on selection
- Batch progress tracking with ETA

#### User Experience
- Dark/Light theme support (follows PPTB theme)
- Lazy metadata loading
- Intelligent caching (per-session)
- Resizable split panes
- Keyboard shortcuts (Ctrl+Enter to execute)

#### Security
- Privilege-aware operations
- Export/Delete privilege checks
- Bulk delete privilege validation
- Workflow execution privilege checks

### 🏗️ Technical

- Built with React 19 and TypeScript 5.9
- Fluent UI v9 components
- Monaco Editor integration
- ExcelJS for native Excel export
- Vite build tooling
- Power Platform ToolBox integration via @pptb/types

### 📚 Documentation

- Comprehensive README with feature overview
- Debug logging system documentation
- Project structure guide
- Contributing guidelines

---

## Development History

### Pre-release commits (dev branch)

- `feat: Beta release enhancements - Settings, Export, and UX improvements`
- `feat(preview): add LayoutXML tab to preview pane`
- `feat(commands): add record action commands - delete, bulk delete, workflow`
- `feat(columns): Add/Edit Columns panels with related entity support`
- `feat(export): add Export to Excel with status feedback and privilege check`
- `feat(paging): fix paging with cookies and page size support`
- `feat(grid): multi-entity metadata & column display name fixes`
- `feat(builder): Sprint 1 - Foundation & Layout improvements`
- `feat(save): implement Save View functionality`
- `feat(sort): Add multi-column sort with FetchXML integration`
- `feat(results): Add Column from Results Grid`
- `feat(views): Load view LayoutXML for column configuration`
- `feat(layout): Add column resize and reorder`
- `feat(layout): Add LayoutXML foundation`
- `feat(filter): Add filter link-entity support for any/not any/all scenarios`
- `feat(condition): Add valueof cross-entity comparison`
- `feat(condition): Add valueof same-row column comparison`
- `feat(condition): Add entityname support for outer join filtering`
- `feat(views): Add Load View picker and optimized view execution`
- `feat(parser): Add FetchXML parser with Monaco editor dialog`
- `feat: Implement Phases 1-4 - DataGrid UI polish`
- `feat: add filter consistency, cascading validation, and global metadata caching`
- `feat(entity-selector): implement advanced filtering with publisher/solution multiselect`
- `feat(ui): add resizable panes with visual grip indicators and command bar`
- `Initial commit - setup main branch`
