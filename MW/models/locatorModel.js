// models/locatorModel.js
const { query } = require('../db');

const LocatorModel = {
    /**
     * Paginated + filtered locator list with per-locator aggregates.
     *
     * Cost tracking:
     *   - inventory_locator.avg_unit_cost  ← per-locator blended cost
     *   - inventory_locator.total_value    ← per-locator stored value
     *   - Falls back to warehouse_inventory.avg_unit_cost for legacy rows
     *     where the locator columns are still 0.
     *
     * Bodega restriction:
     *   - `assigned_locators`: when set (array of strings), the query
     *     is scoped to those locator codes only. Used by the underground
     *     handler's inventory view. When null/empty, no scoping is
     *     applied (admins, or handlers with no assignments configured).
     */
    list: async ({
        warehouse_code,
        search,
        purchase_class,
        category,
        status,
        locator_type,
        assigned_locators,
        limit = 20,
        offset = 0,
    }) => {
        const conditions = ['l.warehouse_code = @param0'];
        const params = [warehouse_code];

        if (search && String(search).trim()) {
            const s = `%${String(search).trim()}%`;
            const idx = params.length;
            conditions.push(`(l.locator_code LIKE @param${idx} OR l.locator_name LIKE @param${idx})`);
            params.push(s);
        }
        if (purchase_class) {
            conditions.push(`l.purchase_class = @param${params.length}`);
            params.push(purchase_class);
        }
        if (category) {
            conditions.push(`l.category = @param${params.length}`);
            params.push(category);
        }
        if (status) {
            conditions.push(`l.status = @param${params.length}`);
            params.push(status);
        }
        if (locator_type) {
            conditions.push(`ISNULL(l.locator_type, 'Regular') = @param${params.length}`);
            params.push(locator_type);
        }

        // Bodega restriction — injected as an IN clause so the pagination
        // math stays correct (LIMIT/OFFSET still see the FULL filtered set,
        // not just the current page).
        if (Array.isArray(assigned_locators) && assigned_locators.length > 0) {
            const placeholders = assigned_locators.map((code) => {
                params.push(String(code));
                return `@param${params.length - 1}`;
            });
            conditions.push(`l.locator_code IN (${placeholders.join(', ')})`);
        }

        const offsetIdx = params.length;
        const limitIdx  = params.length + 1;
        params.push(offset, limit);

        const sql = `
            SELECT
                l.locator_code,
                l.locator_name,
                l.description,
                l.warehouse_code,
                l.purchase_class,
                l.category,
                l.status,
                ISNULL(l.locator_type, 'Regular') AS locator_type,
                l.created_at,
                l.updated_at,
                ISNULL(agg.item_codes, '')  AS item_codes,
                ISNULL(agg.item_count, 0)   AS item_count,
                ISNULL(agg.total_qty, 0)    AS total_qty,
                ISNULL(agg.total_value, 0)  AS total_value
            FROM locator_table l
            OUTER APPLY (
                SELECT
                    STRING_AGG(il.item_code, ', ') AS item_codes,
                    COUNT(DISTINCT il.item_code)   AS item_count,
                    SUM(il.qty)                  AS total_qty,
                    SUM(
                        il.qty *
                        ISNULL(
                            NULLIF(il.avg_unit_cost, 0),
                            ISNULL(wi.avg_unit_cost, 0)
                        )
                    ) AS total_value
                FROM inventory_locator il
                LEFT JOIN warehouse_inventory wi
                    ON wi.warehouse_code = il.warehouse_code
                   AND wi.item_code      = il.item_code
                WHERE il.warehouse_code = l.warehouse_code
                  AND il.locator_code   = l.locator_code
            ) agg
            WHERE ${conditions.join(' AND ')}
            ORDER BY
                CASE WHEN ISNULL(l.locator_type, 'Regular') = 'Damage' THEN 1 ELSE 0 END,
                l.locator_code
            OFFSET @param${offsetIdx} ROWS
            FETCH NEXT @param${limitIdx} ROWS ONLY
        `;

        return await query(sql, params);
    },

    /**
     * Admin overview — per-warehouse AGGREGATE totals only.
     *
     * Returns one row per warehouse: locator_count, item_count, total_qty,
     * total_value. Does NOT return individual locators — that's what the
     * paginated `listLocatorsByWarehouse()` is for. This keeps the initial
     * admin payload tiny even when the system has hundreds of warehouses
     * and hundreds of thousands of locators.
     *
     * Value formula matches list() / getItems() exactly:
     *     effective_unit_cost = ISNULL(NULLIF(il.avg_unit_cost, 0),
     *                                  ISNULL(wi.avg_unit_cost, 0))
     */
    getWarehouseSummaries: async () => {
        const sql = `
            SELECT
                l.warehouse_code,
                w.warehouse_name,
                w.status                            AS warehouse_status,
                COUNT(*)                            AS locator_count,
                ISNULL(SUM(agg.item_count), 0)      AS item_count,
                ISNULL(SUM(agg.total_qty), 0)       AS total_qty,
                ISNULL(SUM(agg.total_value), 0)     AS total_value
            FROM locator_table l
            LEFT JOIN warehouse_table w
                ON w.warehouse_code = l.warehouse_code
            OUTER APPLY (
                SELECT
                    COUNT(DISTINCT il.item_code) AS item_count,
                    SUM(il.qty)                  AS total_qty,
                    SUM(
                        il.qty *
                        ISNULL(
                            NULLIF(il.avg_unit_cost, 0),
                            ISNULL(wi.avg_unit_cost, 0)
                        )
                    ) AS total_value
                FROM inventory_locator il
                LEFT JOIN warehouse_inventory wi
                    ON wi.warehouse_code = il.warehouse_code
                   AND wi.item_code      = il.item_code
                WHERE il.warehouse_code = l.warehouse_code
                  AND il.locator_code   = l.locator_code
            ) agg
            GROUP BY l.warehouse_code, w.warehouse_name, w.status
            ORDER BY l.warehouse_code
        `;
        return await query(sql, []);
    },

    /**
     * Admin drill-down — paginated locators for ONE warehouse.
     *
     * Used by the admin Inventory Locators tab when a warehouse accordion
     * is expanded. Returns only `limit` rows per call, so a warehouse with
     * 5,000 locators fetches 20 at a time.
     *
     * Supports optional `search` (locator_code / locator_name LIKE) so the
     * admin search box filters server-side across ALL locators in the
     * warehouse, not just the current page.
     *
     * Adds `last_activity_at` (MAX inventory_locator.updated_at) which the
     * handler-facing list() doesn't include — this is the one extra field
     * the admin tab displays.
     *
     * Value formula matches list() / getItems() exactly.
     */
    listLocatorsByWarehouse: async ({
        warehouse_code,
        search,
        limit = 20,
        offset = 0,
    }) => {
        const conditions = ['l.warehouse_code = @param0'];
        const params = [warehouse_code];

        if (search && String(search).trim()) {
            const s = `%${String(search).trim()}%`;
            const idx = params.length;
            conditions.push(`(l.locator_code LIKE @param${idx} OR l.locator_name LIKE @param${idx})`);
            params.push(s);
        }

        const offsetIdx = params.length;
        const limitIdx  = params.length + 1;
        params.push(offset, limit);

        const sql = `
            SELECT
                l.locator_code,
                l.locator_name,
                l.description,
                l.warehouse_code,
                l.purchase_class,
                l.category,
                l.status,
                ISNULL(l.locator_type, 'Regular') AS locator_type,
                l.created_at                        AS locator_created_at,
                l.updated_at                        AS locator_updated_at,
                ISNULL(agg.item_codes, '')          AS item_codes,
                ISNULL(agg.item_count, 0)           AS item_count,
                ISNULL(agg.total_qty, 0)            AS total_qty,
                ISNULL(agg.total_value, 0)          AS total_value,
                agg.last_activity_at
            FROM locator_table l
            OUTER APPLY (
                SELECT
                    STRING_AGG(il.item_code, ', ') AS item_codes,
                    COUNT(DISTINCT il.item_code)   AS item_count,
                    SUM(il.qty)                  AS total_qty,
                    SUM(
                        il.qty *
                        ISNULL(
                            NULLIF(il.avg_unit_cost, 0),
                            ISNULL(wi.avg_unit_cost, 0)
                        )
                    ) AS total_value,
                    MAX(il.updated_at)           AS last_activity_at
                FROM inventory_locator il
                LEFT JOIN warehouse_inventory wi
                    ON wi.warehouse_code = il.warehouse_code
                   AND wi.item_code      = il.item_code
                WHERE il.warehouse_code = l.warehouse_code
                  AND il.locator_code   = l.locator_code
            ) agg
            WHERE ${conditions.join(' AND ')}
            ORDER BY
                CASE WHEN ISNULL(l.locator_type, 'Regular') = 'Damage' THEN 1 ELSE 0 END,
                l.locator_code
            OFFSET @param${offsetIdx} ROWS
            FETCH NEXT @param${limitIdx} ROWS ONLY
        `;

        return await query(sql, params);
    },

    /**
     * Total locator count for one warehouse, matching the same `search`
     * filter used by listLocatorsByWarehouse(). Feeds the pagination math.
     */
    countLocatorsByWarehouse: async ({ warehouse_code, search }) => {
        const conditions = ['warehouse_code = @param0'];
        const params = [warehouse_code];

        if (search && String(search).trim()) {
            const s = `%${String(search).trim()}%`;
            const idx = params.length;
            conditions.push(`(locator_code LIKE @param${idx} OR locator_name LIKE @param${idx})`);
            params.push(s);
        }

        const sql = `SELECT COUNT(*) AS total FROM locator_table WHERE ${conditions.join(' AND ')}`;
        const rows = await query(sql, params);
        return rows[0] ? rows[0].total : 0;
    },

    /**
     * Total count for pagination — same filters as list().
     *
     * `assigned_locators` mirrors list()'s behavior: when provided as a
     * non-empty array, the count is restricted to those locator codes so
     * pagination math reflects the handler's filtered view.
     */
    count: async ({
        warehouse_code,
        search,
        purchase_class,
        category,
        status,
        locator_type,
        assigned_locators,
    }) => {
        const conditions = ['warehouse_code = @param0'];
        const params = [warehouse_code];

        if (search && String(search).trim()) {
            const s = `%${String(search).trim()}%`;
            const idx = params.length;
            conditions.push(`(locator_code LIKE @param${idx} OR locator_name LIKE @param${idx})`);
            params.push(s);
        }
        if (purchase_class) {
            conditions.push(`purchase_class = @param${params.length}`);
            params.push(purchase_class);
        }
        if (category) {
            conditions.push(`category = @param${params.length}`);
            params.push(category);
        }
        if (status) {
            conditions.push(`status = @param${params.length}`);
            params.push(status);
        }
        if (locator_type) {
            conditions.push(`ISNULL(locator_type, 'Regular') = @param${params.length}`);
            params.push(locator_type);
        }

        if (Array.isArray(assigned_locators) && assigned_locators.length > 0) {
            const placeholders = assigned_locators.map((code) => {
                params.push(String(code));
                return `@param${params.length - 1}`;
            });
            conditions.push(`locator_code IN (${placeholders.join(', ')})`);
        }

        const sql = `SELECT COUNT(*) AS total FROM locator_table WHERE ${conditions.join(' AND ')}`;
        const rows = await query(sql, params);
        return rows[0] ? rows[0].total : 0;
    },

    /**
     * Distinct purchase_class / category / status / locator_type with counts
     * for a single warehouse, PLUS the warehouse's aggregate summary
     * (locator_count, item_count, total_qty, total_value).
     */
    getFilterOptions: async (warehouse_code) => {
        const filterSql = `
            SELECT 'purchase_class' AS kind, purchase_class AS value, COUNT(*) AS cnt
            FROM locator_table
            WHERE warehouse_code = @param0
              AND purchase_class IS NOT NULL AND purchase_class <> ''
            GROUP BY purchase_class

            UNION ALL

            SELECT 'category' AS kind, category AS value, COUNT(*) AS cnt
            FROM locator_table
            WHERE warehouse_code = @param0
              AND category IS NOT NULL AND category <> ''
            GROUP BY category

            UNION ALL

            SELECT 'status' AS kind, status AS value, COUNT(*) AS cnt
            FROM locator_table
            WHERE warehouse_code = @param0
            GROUP BY status

            UNION ALL

            SELECT 'locator_type' AS kind, ISNULL(locator_type, 'Regular') AS value, COUNT(*) AS cnt
            FROM locator_table
            WHERE warehouse_code = @param0
            GROUP BY ISNULL(locator_type, 'Regular')
        `;

        const summarySql = `
            SELECT
                (SELECT COUNT(*) FROM locator_table WHERE warehouse_code = @param0) AS locator_count,
                ISNULL(COUNT(DISTINCT il.item_code), 0)                             AS item_count,
                ISNULL(SUM(il.qty), 0)                                              AS total_qty,
                ISNULL(SUM(
                    il.qty *
                    ISNULL(
                        NULLIF(il.avg_unit_cost, 0),
                        ISNULL(wi.avg_unit_cost, 0)
                    )
                ), 0)                                                               AS total_value
            FROM inventory_locator il
            LEFT JOIN warehouse_inventory wi
                ON wi.warehouse_code = il.warehouse_code
               AND wi.item_code      = il.item_code
            WHERE il.warehouse_code = @param0
        `;

        const [rows, summaryRows] = await Promise.all([
            query(filterSql,   [warehouse_code]),
            query(summarySql,  [warehouse_code]),
        ]);

        const result = {
            purchase_classes: [],
            categories: [],
            statuses: [],
            locator_types: [],
            total: 0,
            summary: {
                locator_count: 0,
                item_count:    0,
                total_qty:     0,
                total_value:   0,
            },
        };

        for (const r of rows) {
            const item = { value: r.value, count: r.cnt };
            if (r.kind === 'purchase_class')      result.purchase_classes.push(item);
            else if (r.kind === 'category')       result.categories.push(item);
            else if (r.kind === 'status')         result.statuses.push(item);
            else if (r.kind === 'locator_type')   result.locator_types.push(item);
            result.total += r.cnt;
        }

        result.purchase_classes.sort((a, b) => a.value.localeCompare(b.value));
        result.categories.sort((a, b) => a.value.localeCompare(b.value));

        const s = summaryRows[0] || {};
        result.summary = {
            locator_count: Number(s.locator_count) || 0,
            item_count:    Number(s.item_count)    || 0,
            total_qty:     Number(s.total_qty)     || 0,
            total_value:   Number(s.total_value)   || 0,
        };

        return result;
    },

    /**
     * All items currently stored in a locator.
     */
    getItems: async (warehouse_code, locator_code) => {
        const sql = `
            SELECT
                il.item_code,
                il.qty,
                ISNULL(im.Item_Description, wi.item_name)             AS item_name,
                ISNULL(im.Uom_Code,         wi.uom)                   AS uom,
                im.Uom_Description                                     AS uom_description,
                im.Barcode                                             AS barcode,
                CAST(im.Gl_Class AS NVARCHAR(50))                      AS gl_class_code,
                im.Gl_Description                                      AS gl_description,
                im.Purchase_Class                                      AS purchase_class,
                im.Category                                            AS category,
                ISNULL(
                    NULLIF(il.avg_unit_cost, 0),
                    ISNULL(wi.avg_unit_cost, 0)
                )                                                      AS avg_unit_cost,
                il.qty * ISNULL(
                    NULLIF(il.avg_unit_cost, 0),
                    ISNULL(wi.avg_unit_cost, 0)
                )                                                      AS line_total,
                ISNULL(il.total_value, 0)                              AS stored_total_value
            FROM inventory_locator il
            LEFT JOIN item_master im
                ON im.Item_Code = il.item_code
            LEFT JOIN warehouse_inventory wi
                ON wi.warehouse_code = il.warehouse_code
               AND wi.item_code      = il.item_code
            WHERE il.warehouse_code = @param0
              AND il.locator_code   = @param1
            ORDER BY im.Item_Description, il.item_code
        `;
        return await query(sql, [warehouse_code, locator_code]);
    },

    /**
     * Stock report export — ONE flat row per (locator, item) pair where
     * qty > 0. Used by the "Export Stock Report" button.
     */
    getStockReportRows: async (warehouse_code) => {
        const sql = `
            SELECT
                il.warehouse_code                           AS WarehouseCode,
                il.locator_code                             AS LocatorCode,
                lt.locator_name                             AS LocatorName,
                il.item_code                                AS ItemCode,
                ISNULL(im.Item_Description, wi.item_name)   AS ItemDescription,
                ISNULL(im.Uom_Code,         wi.uom)         AS UomCode,
                im.Uom_Description                          AS UomDescription,
                il.qty                                      AS TotalQty,
                il.avg_unit_cost                            AS AvgUnitCost,
                il.total_value                              AS TotalValue
            FROM inventory_locator il
            LEFT JOIN item_master im
                ON im.Item_Code = il.item_code
            LEFT JOIN locator_table lt
                ON lt.locator_code   = il.locator_code
               AND lt.warehouse_code = il.warehouse_code
            LEFT JOIN warehouse_inventory wi
                ON wi.warehouse_code = il.warehouse_code
               AND wi.item_code      = il.item_code
            WHERE il.warehouse_code = @param0
              AND il.qty > 0
            ORDER BY il.locator_code, il.item_code
        `;
        return await query(sql, [warehouse_code]);
    },

    /**
     * ▸ NEW — Item Code Search across warehouses.
     */
    searchItemAcrossWarehouses: async ({ search, warehouse_code }) => {
        const term = `%${String(search).trim()}%`;
        const params = [term];
        let warehouseClause = '';

        if (warehouse_code) {
            params.push(warehouse_code);
            warehouseClause = `AND il.warehouse_code = @param1`;
        }

        const sql = `
            SELECT
                il.warehouse_code                           AS WarehouseCode,
                w.warehouse_name                            AS WarehouseName,
                il.locator_code                             AS LocatorCode,
                lt.locator_name                             AS LocatorName,
                il.item_code                                AS ItemCode,
                ISNULL(im.Item_Description, wi.item_name)   AS ItemDescription,
                ISNULL(im.Uom_Code,         wi.uom)         AS UomCode,
                im.Uom_Description                          AS UomDescription,
                il.qty                                      AS TotalQty,
                il.avg_unit_cost                            AS AvgUnitCost,
                il.total_value                              AS TotalValue
            FROM inventory_locator il
            LEFT JOIN item_master im
                ON im.Item_Code = il.item_code
            LEFT JOIN warehouse_table w
                ON w.warehouse_code = il.warehouse_code
            LEFT JOIN locator_table lt
                ON lt.locator_code   = il.locator_code
               AND lt.warehouse_code = il.warehouse_code
            LEFT JOIN warehouse_inventory wi
                ON wi.warehouse_code = il.warehouse_code
               AND wi.item_code      = il.item_code
            WHERE il.qty > 0
              AND (
                  il.item_code             LIKE @param0
                  OR im.Item_Description   LIKE @param0
                  OR wi.item_name          LIKE @param0
              )
              ${warehouseClause}
            ORDER BY il.item_code, il.warehouse_code, il.locator_code
        `;

        return await query(sql, params);
    },

    /**
     * ▸ NEW — Fetch all locators for the offline sync payload.
     */
    getAllLocatorsForSync: async () => {
        const sql = `
            SELECT 
                warehouse_code, locator_code, locator_name, description,
                purchase_class, category, status, locator_type
            FROM locator_table
        `;
        return await query(sql, []);
    },

    /**
     * Single locator by composite key.
     */
    getOne: async (warehouse_code, locator_code) => {
        const sql = `
            SELECT
                locator_code, locator_name, description,
                warehouse_code, purchase_class, category,
                status, ISNULL(locator_type, 'Regular') AS locator_type,
                created_at, updated_at, created_by, updated_by
            FROM locator_table
            WHERE warehouse_code = @param0 AND locator_code = @param1
        `;
        const rows = await query(sql, [warehouse_code, locator_code]);
        return rows[0] || null;
    },

    /**
     * Legacy lookup — kept for backward compat.
     */
    getByCode: async (locator_code) => {
        const rows = await query(
            `SELECT locator_code, description, warehouse_code,
                    ISNULL(locator_type, 'Regular') AS locator_type
             FROM locator_table WHERE locator_code = @param0`,
            [locator_code]
        );
        return rows[0] || null;
    },

    /**
     * Does this code exist for this warehouse?
     */
    codeExists: async (warehouse_code, locator_code) => {
        const sql = `
            SELECT 1 AS found
            FROM locator_table
            WHERE warehouse_code = @param0 AND locator_code = @param1
        `;
        const rows = await query(sql, [warehouse_code, locator_code]);
        return rows.length > 0;
    },

    /**
     * Insert a new locator.
     */
    create: async ({
        warehouse_code,
        locator_code,
        locator_name,
        purchase_class,
        category,
        status,
        created_by,
    }) => {
        const sql = `
            INSERT INTO locator_table
                (warehouse_code, locator_code, locator_name, description,
                 purchase_class, category, status, locator_type,
                 created_by, created_at)
            VALUES
                (@param0, @param1, @param2, @param2,
                 @param3, @param4, @param5, 'Regular',
                 @param6, GETDATE())
        `;
        await query(sql, [
            warehouse_code,
            locator_code,
            locator_name || null,
            purchase_class || null,
            category || null,
            status || 'Active',
            created_by || 'System',
        ]);
        return { warehouse_code, locator_code };
    },

    /**
     * Update. Cannot change the composite key.
     */
    update: async ({
        warehouse_code,
        locator_code,
        locator_name,
        purchase_class,
        category,
        status,
        updated_by,
    }) => {
        const sql = `
            UPDATE locator_table
               SET locator_name   = @param0,
                   description    = @param0,
                   purchase_class = @param1,
                   category       = @param2,
                   status         = @param3,
                   updated_by     = @param4,
                   updated_at     = GETDATE()
             WHERE warehouse_code = @param5 AND locator_code = @param6
        `;
        await query(sql, [
            locator_name || null,
            purchase_class || null,
            category || null,
            status || 'Active',
            updated_by || 'System',
            warehouse_code,
            locator_code,
        ]);
        return { warehouse_code, locator_code };
    },
};

module.exports = LocatorModel;