// models/underground/offlineTransferModel.js
'use strict';

const { sql, ensurePool, query } = require('../../db');

const roundMoney = (v) => Number(Number(v).toFixed(4)) || 0;

const assertLocatorAllowed = (locatorCode, assignedLocators, roleLabel) => {
    if (!Array.isArray(assignedLocators) || assignedLocators.length === 0) return;
    if (!assignedLocators.includes(String(locatorCode).trim())) {
        throw new Error(`You do not have access to ${roleLabel} bodega "${locatorCode}".`);
    }
};

const OfflineTransferModel = {
    /**
     * Generates a suggested STS No. unique to this user.
     * Format: OFF-{SHORT_USERNAME}-{SEQ}
     */
    getNextStsNo: async (username) => {
        // Strip special characters, limit to 8 chars
        const safeUser = String(username || 'USER').replace(/[^A-Z0-9]/gi, '').substring(0, 8).toUpperCase();
        const prefix = `OFF-${safeUser}-`;

        const rows = await query(`
            SELECT TOP 1 sts_no 
            FROM dbo.stock_transfer_slips 
            WHERE sts_no LIKE @param0 AND request_origin = 'Offline'
            ORDER BY sts_id DESC
        `, [`${prefix}%`]);

        let nextSeq = 1;
        if (rows.length > 0) {
            const lastSts = rows[0].sts_no;
            const parts = lastSts.split('-');
            const lastNum = parseInt(parts[parts.length - 1], 10);
            if (Number.isFinite(lastNum)) {
                nextSeq = lastNum + 1;
            }
        }
        
        const seqStr = String(nextSeq).padStart(3, '0');
        return `${prefix}${seqStr}`;
    },

    getItemsInLocator: async (warehouse_code, locator_code, { assigned_locators, shift_id } = {}) => {
        assertLocatorAllowed(locator_code, assigned_locators, 'source');
        
        return await query(`
            SELECT item_code, item_name, uom, qty_on_hand AS qty, unit_cost AS avg_unit_cost
            FROM dbo.vw_underground_current_inventory
            WHERE shift_id = @param0 AND locator_code = @param1 AND qty_on_hand > 0
        `, [shift_id, locator_code]);
    },

    /**
     * Fetch available destination locators within the SAME warehouse (e.g., UG Warehouse).
     * Excludes the user's own assigned locators so they don't transfer to themselves.
     */
    getDestinationLocators: async ({ warehouse_code, assigned_locators } = {}) => {
        const params = [];
        let whereClause = `WHERE status = 'Active'`;

        // ⚡ Restrict to the handler's assigned warehouse (e.g., 'UG')
        if (warehouse_code) {
            params.push(String(warehouse_code).trim());
            whereClause += ` AND warehouse_code = @param${params.length - 1}`;
        }

        // Exclude the user's own assigned locators
        if (Array.isArray(assigned_locators) && assigned_locators.length > 0) {
            const placeholders = assigned_locators.map((code) => {
                params.push(String(code));
                return `@param${params.length - 1}`;
            });
            whereClause += ` AND locator_code NOT IN (${placeholders.join(', ')})`;
        }

        const rows = await query(`
            SELECT warehouse_code, locator_code, locator_name, description
            FROM dbo.locator_table
            ${whereClause}
            ORDER BY locator_code
        `, params);

        return rows;
    },

    createTransfer: async ({
        sts_no, warehouse_id, warehouse_code, from_locator, to_locator, item_code, item_name, uom,
        qty, qty_boxes, qty_loose_pieces, approved_by, initiated_by, released_by, received_by, remarks, shift_id, assigned_locators,
    }) => {
        assertLocatorAllowed(from_locator, assigned_locators, 'source');
        // ⚡ Removed assertLocatorAllowed for to_locator to allow transferring TO a Surface/UG warehouse.
        
        if (!shift_id) throw new Error('An open shift is required to transfer items.');

        const pool = await ensurePool();
        const tx = new sql.Transaction(pool);
        await tx.begin();

        try {
            const uomRes = await new sql.Request(tx)
                .input('item', sql.NVarChar(100), item_code)
                .query(`SELECT box_item_code, piece_item_code, pieces_per_box FROM dbo.uom_conversions WHERE (box_item_code = @item OR piece_item_code = @item) AND Status = 'Active'`);
            const uomRule = uomRes.recordset[0];

            let actualItemCode = item_code, actualItemName = item_name, actualUom = uom;
            let pieces_per_box = null, total_qty = Number(qty) || 0;
            let boxes = qty_boxes != null ? Number(qty_boxes) : null;
            let loose = qty_loose_pieces != null ? Number(qty_loose_pieces) : null;

            if (uomRule) {
                actualItemCode = uomRule.piece_item_code;
                pieces_per_box = Number(uomRule.pieces_per_box);

                if (boxes > 0 || loose > 0) {
                    total_qty = (boxes * pieces_per_box) + (loose || 0);
                } else if (item_code === uomRule.box_item_code) {
                    total_qty = total_qty * pieces_per_box;
                    boxes = qty;
                }

                const itemInfo = await new sql.Request(tx)
                    .input('i', sql.NVarChar(100), actualItemCode)
                    .query(`SELECT Item_Description, Uom_Code FROM dbo.item_master WHERE Item_Code = @i`);
                
                if (itemInfo.recordset.length > 0) {
                    actualItemName = itemInfo.recordset[0].Item_Description || item_name;
                    actualUom = itemInfo.recordset[0].Uom_Code || 'PC';
                } else {
                    actualUom = 'PC';
                }
            }

            if (!(total_qty > 0)) throw new Error('Transfer quantity must be greater than 0.');

            // Check uniqueness (throws if already exists)
            const stsCheck = await new sql.Request(tx).input('sts_no', sql.NVarChar(60), sts_no)
                .query(`SELECT 1 FROM dbo.stock_transfer_slips WHERE sts_no = @sts_no`);
            if (stsCheck.recordset.length > 0) throw new Error(`STS No. ${sts_no} already exists.`);

            // Check stock against the SHIFT's current view
            const srcReq = new sql.Request(tx);
            srcReq.input('shift', sql.Int, shift_id);
            srcReq.input('loc', sql.NVarChar(100), from_locator);
            srcReq.input('item', sql.NVarChar(100), actualItemCode);

            const srcRes = await srcReq.query(`
                SELECT qty_on_hand, unit_cost FROM dbo.vw_underground_current_inventory
                WHERE shift_id = @shift AND locator_code = @loc AND item_code = @item
            `);

            if (srcRes.recordset.length === 0 || srcRes.recordset[0].qty_on_hand < total_qty) {
                throw new Error(`Insufficient quantity in source bodega for ${actualItemCode}.`);
            }
            const unitCost = Number(srcRes.recordset[0].unit_cost) || 0;
            const totalValue = roundMoney(total_qty * unitCost);

            // Insert Header
            const hdrRes = await new sql.Request(tx)
                .input('sts_no', sql.NVarChar(60), sts_no)
                .input('wh_id', sql.Int, warehouse_id)
                .input('wh_code', sql.NVarChar(40), warehouse_code)
                .input('from_loc', sql.NVarChar(100), from_locator)
                .input('approved', sql.NVarChar(200), approved_by)
                .input('initiated', sql.NVarChar(200), initiated_by)
                .input('released', sql.NVarChar(200), released_by)
                .input('received', sql.NVarChar(200), received_by)
                .input('remarks', sql.NVarChar(500), remarks || null)
                .query(`
                    INSERT INTO dbo.stock_transfer_slips
                    (sts_no, from_warehouse_id, to_warehouse_id, transfer_date, status, request_origin, submitted_by, approved_by, approved_at, shipped_by, received_by, from_warehouse_code, to_warehouse_code, source_locator_code, remarks)
                    OUTPUT INSERTED.sts_id
                    VALUES (@sts_no, @wh_id, @wh_id, CAST(GETDATE() AS DATE), 'Offline-Completed', 'Offline', @initiated, @approved, GETDATE(), @released, @received, @wh_code, @wh_code, @from_loc, @remarks)
                `);
            const sts_id = hdrRes.recordset[0].sts_id;

            // Insert Line
            await new sql.Request(tx)
                .input('sts_id', sql.BigInt, sts_id)
                .input('item', sql.NVarChar(100), actualItemCode)
                .input('name', sql.NVarChar(800), actualItemName)
                .input('uom', sql.NVarChar(100), actualUom)
                .input('qty', sql.Decimal(18,4), total_qty)
                .input('qty_boxes', sql.Decimal(18,4), boxes)
                .input('qty_loose', sql.Decimal(18,4), loose)
                .input('pieces_per_box', sql.Decimal(18,4), pieces_per_box)
                .input('cost', sql.Decimal(18,6), unitCost)
                .input('to_loc', sql.NVarChar(100), to_locator)
                .query(`
                    INSERT INTO dbo.stock_transfer_slip_lines
                    (sts_id, line_no, item_code, item_name, uom, qty, qty_boxes, qty_loose_pieces, pieces_per_box_snapshot, unit_price, locator_code)
                    VALUES (@sts_id, 1, @item, @name, @uom, @qty, @qty_boxes, @qty_loose, @pieces_per_box, @cost, @to_loc)
                `);

            // Insert Activity Log
            await new sql.Request(tx)
                .input('sts_id', sql.BigInt, sts_id)
                .input('sts_no', sql.NVarChar(60), sts_no)
                .input('wh', sql.NVarChar(40), warehouse_code)
                .input('item', sql.NVarChar(100), actualItemCode)
                .input('name', sql.NVarChar(800), actualItemName)
                .input('uom', sql.NVarChar(100), actualUom)
                .input('qty', sql.Decimal(18,4), total_qty)
                .input('from_loc', sql.NVarChar(100), from_locator)
                .input('to_loc', sql.NVarChar(100), to_locator)
                .input('actor', sql.NVarChar(200), released_by)
                .query(`
                    INSERT INTO dbo.stock_transfer_activity_log
                    (sts_id, sts_no, event_type, stage, from_warehouse_code, to_warehouse_code, item_code, item_name, uom, qty_change, locator_code, actor, actor_role, remarks)
                    VALUES
                    (@sts_id, @sts_no, 'Offline Transfer', 'COMPLETE', @wh, @wh, @item, @name, @uom, @qty, @from_loc, @actor, 'Underground Handler', 'Transfer OUT'),
                    (@sts_id, @sts_no, 'Offline Transfer', 'COMPLETE', @wh, @wh, @item, @name, @uom, @qty, @to_loc, @actor, 'Underground Handler', 'Transfer IN')
                `);

            // LOG TO SHIFT LINES ONLY
            await new sql.Request(tx)
                .input('shift', sql.Int, shift_id)
                .input('item', sql.NVarChar(100), actualItemCode)
                .input('name', sql.NVarChar(800), actualItemName)
                .input('uom', sql.NVarChar(100), actualUom)
                .input('qty', sql.Decimal(18,4), total_qty)
                .input('cost', sql.Decimal(18,6), unitCost)
                .input('val', sql.Decimal(18,4), totalValue)
                .input('actor', sql.NVarChar(200), released_by)
                .input('sts', sql.NVarChar(60), sts_no)
                .input('from_loc', sql.NVarChar(100), from_locator)
                .input('to_loc', sql.NVarChar(100), to_locator)
                .query(`
                    INSERT INTO dbo.underground_shift_lines
                    (shift_id, line_kind, locator_code, item_code, item_name, uom, qty, unit_cost, line_total, released_by, remarks, released_at)
                    VALUES
                    (@shift, 'Transfer-Out', @from_loc, @item, @name, @uom, @qty, @cost, @val, @actor, @sts, GETDATE()),
                    (@shift, 'Transfer-In', @to_loc, @item, @name, @uom, @qty, @cost, @val, @actor, @sts, GETDATE())
                `);

            await tx.commit();
            return { sts_id, sts_no };
        } catch (err) {
            await tx.rollback();
            throw err;
        }
    },
    
    getHistory: async ({ warehouse_code, search, start_date, end_date, locator_codes, page = 1, limit = 30 }) => {
        const offset = (page - 1) * limit;
        const params = [warehouse_code];
        const conds = ["s.from_warehouse_code = @param0", "s.request_origin = 'Offline'"];

        if (search) {
            params.push(`%${search}%`);
            const i = params.length - 1;
            conds.push(`(s.sts_no LIKE @param${i} OR l.item_code LIKE @param${i})`);
        }
        if (start_date) {
            params.push(start_date);
            conds.push(`CAST(s.transfer_date AS DATE) >= @param${params.length - 1}`);
        }
        if (end_date) {
            params.push(end_date);
            conds.push(`CAST(s.transfer_date AS DATE) <= @param${params.length - 1}`);
        }
        if (Array.isArray(locator_codes) && locator_codes.length > 0) {
            const placeholders = locator_codes.map((code) => {
                params.push(String(code));
                return `@param${params.length - 1}`;
            });
            const inList = placeholders.join(', ');
            conds.push(`(s.source_locator_code IN (${inList}) OR l.locator_code IN (${inList}))`);
        }

        const whereClause = conds.join(' AND ');

        const countRes = await query(`
            SELECT COUNT(*) AS total
            FROM dbo.stock_transfer_slips s
            INNER JOIN dbo.stock_transfer_slip_lines l ON s.sts_id = l.sts_id
            WHERE ${whereClause}
        `, params);
        const total = countRes[0]?.total || 0;

        const listParams = [...params, offset, limit];
        const offIdx = listParams.length - 2;
        const limIdx = listParams.length - 1;

        const rows = await query(`
            SELECT
                s.sts_id, s.sts_no, s.transfer_date, s.source_locator_code AS from_bodega,
                l.locator_code AS to_bodega, l.item_code, l.item_name, l.uom,
                l.qty, l.qty_boxes, l.qty_loose_pieces, l.pieces_per_box_snapshot,
                l.unit_price AS unit_cost,
                CAST(ROUND(l.qty * l.unit_price, 4) AS DECIMAL(18,4)) AS total_value,
                s.approved_by, s.submitted_by, s.shipped_by, s.received_by, s.created_at
            FROM dbo.stock_transfer_slips s
            INNER JOIN dbo.stock_transfer_slip_lines l ON s.sts_id = l.sts_id
            WHERE ${whereClause}
            ORDER BY s.created_at DESC
            OFFSET @param${offIdx} ROWS FETCH NEXT @param${limIdx} ROWS ONLY
        `, listParams);

        return { data: rows, total, page, limit, totalPages: Math.ceil(total / limit) };
    }
};

module.exports = OfflineTransferModel;