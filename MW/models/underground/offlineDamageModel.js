// models/underground/offlineDamageModel.js
'use strict';

const { sql, ensurePool, query } = require('../../db');

const assertLocatorAllowed = (locatorCode, assignedLocators) => {
    if (!Array.isArray(assignedLocators) || assignedLocators.length === 0) return;
    if (!assignedLocators.includes(String(locatorCode).trim())) {
        throw new Error(`You do not have access to locator "${locatorCode}".`);
    }
};

const OfflineDamageModel = {
    recordDamage: async ({
        warehouse_id,      // <-- Added explicitly
        warehouse_code,
        locator_code,
        item_code,
        qty,
        qty_boxes,
        qty_loose_pieces,
        reason,
        actor,
        shift_id,
        assigned_locators,
    }) => {
        assertLocatorAllowed(locator_code, assigned_locators);
        if (!shift_id) throw new Error('An open shift is required to record damage.');

        const pool = await ensurePool();
        const tx = new sql.Transaction(pool);
        await tx.begin();

        try {
            const uomRes = await new sql.Request(tx)
                .input('item', sql.NVarChar(100), item_code)
                .query(`SELECT pieces_per_box FROM dbo.uom_conversions WHERE piece_item_code = @item AND Status = 'Active'`);
            const pieces_per_box = uomRes.recordset.length > 0 ? Number(uomRes.recordset[0].pieces_per_box) : null;
            
            let total_qty = Number(qty) || 0;
            let boxes = qty_boxes != null ? Number(qty_boxes) : null;
            let loose = qty_loose_pieces != null ? Number(qty_loose_pieces) : null;

            if (pieces_per_box && (boxes > 0 || loose > 0)) {
                total_qty = (boxes * pieces_per_box) + (loose || 0);
            }
            if (!(total_qty > 0)) throw new Error('Damage quantity must be greater than 0.');

            const checkReq = new sql.Request(tx);
            checkReq.input('shift', sql.Int, shift_id);
            checkReq.input('loc', sql.NVarChar(100), locator_code);
            checkReq.input('item', sql.NVarChar(100), item_code);

            const itemRes = await checkReq.query(`
                SELECT qty_on_hand, unit_cost, item_name
                FROM dbo.vw_underground_current_inventory
                WHERE shift_id = @shift AND locator_code = @loc AND item_code = @item
            `);

            if (itemRes.recordset.length === 0) {
                throw new Error(`Item ${item_code} not found in locator ${locator_code} for this shift.`);
            }

            const row = itemRes.recordset[0];
            if (Number(row.qty_on_hand) < total_qty) {
                throw new Error(`Insufficient stock. Available: ${row.qty_on_hand}, Requested: ${total_qty}.`);
            }

            const unitCost = Number(row.unit_cost) || 0;
            const totalValue = Number((total_qty * unitCost).toFixed(4));

            // Insert into damage_writeoffs (Explicit VALUES)
            const insReq = new sql.Request(tx);
            insReq.input('item', sql.NVarChar(100), item_code);
            insReq.input('name', sql.NVarChar(800), row.item_name);
            insReq.input('wh_id', sql.Int, warehouse_id);
            insReq.input('wh', sql.NVarChar(40), warehouse_code);
            insReq.input('loc', sql.NVarChar(100), locator_code);
            insReq.input('qty', sql.Decimal(18,4), total_qty);
            insReq.input('qty_boxes', sql.Decimal(18,4), boxes);
            insReq.input('qty_loose_pieces', sql.Decimal(18,4), loose);
            insReq.input('pieces_per_box_snapshot', sql.Decimal(18,4), pieces_per_box);
            insReq.input('cost', sql.Decimal(18,6), unitCost);
            insReq.input('val', sql.Decimal(18,4), totalValue);
            insReq.input('reason', sql.NVarChar(1000), reason);
            insReq.input('actor', sql.NVarChar(200), actor);

            await insReq.query(`
                INSERT INTO dbo.damage_writeoffs
                (source_type, item_code, item_name, warehouse_id, warehouse_code, locator_code, 
                 qty, qty_boxes, qty_loose_pieces, pieces_per_box_snapshot, 
                 unit_cost, total_value, currency, reason, actor)
                VALUES ('Offline', @item, @name, @wh_id, @wh, @loc, 
                       @qty, @qty_boxes, @qty_loose_pieces, @pieces_per_box_snapshot, 
                       @cost, @val, 'PHP', @reason, @actor)
            `);

            // Log to underground_shift_lines for Inventory Sync payload
            const lineReq = new sql.Request(tx);
            lineReq.input('shift', sql.Int, shift_id);
            lineReq.input('loc', sql.NVarChar(100), locator_code);
            lineReq.input('item', sql.NVarChar(100), item_code);
            lineReq.input('name', sql.NVarChar(800), row.item_name);
            lineReq.input('qty', sql.Decimal(18,4), total_qty);
            lineReq.input('cost', sql.Decimal(18,6), unitCost);
            lineReq.input('val', sql.Decimal(18,4), totalValue);
            lineReq.input('actor', sql.NVarChar(200), actor);
            lineReq.input('remarks', sql.NVarChar(1000), reason);

            await lineReq.query(`
                INSERT INTO dbo.underground_shift_lines
                (shift_id, line_kind, locator_code, item_code, item_name, qty, unit_cost, line_total, released_by, remarks, released_at)
                VALUES (@shift, 'Damage', @loc, @item, @name, @qty, @cost, @val, @actor, @remarks, GETDATE())
            `);

            await tx.commit();
            return { qty: total_qty, unit_cost: unitCost, total_value: totalValue };
        } catch (err) {
            await tx.rollback();
            throw err;
        }
    },

    getHistory: async ({
        warehouse_code,
        search,
        start_date,
        end_date,
        locator_codes,
        page = 1,
        limit = 30,
    }) => {
        const offset = (page - 1) * limit;
        const params = [warehouse_code];
        const conds = ['warehouse_code = @param0'];

        if (search) {
            params.push(`%${search}%`);
            const i = params.length - 1;
            conds.push(`(item_code LIKE @param${i} OR reason LIKE @param${i} OR locator_code LIKE @param${i})`);
        }
        if (start_date) {
            params.push(start_date);
            conds.push(`CAST(acted_at AS DATE) >= @param${params.length - 1}`);
        }
        if (end_date) {
            params.push(end_date);
            conds.push(`CAST(acted_at AS DATE) <= @param${params.length - 1}`);
        }
        if (Array.isArray(locator_codes) && locator_codes.length > 0) {
            const placeholders = locator_codes.map((code) => {
                params.push(String(code));
                return `@param${params.length - 1}`;
            });
            conds.push(`locator_code IN (${placeholders.join(', ')})`);
        }

        const whereClause = conds.join(' AND ');

        const countRes = await query(
            `SELECT COUNT(*) AS total FROM dbo.damage_writeoffs WHERE ${whereClause}`,
            params
        );
        const total = countRes[0]?.total || 0;

        const listParams = [...params, offset, limit];
        const offIdx = listParams.length - 2;
        const limIdx = listParams.length - 1;

        const rows = await query(`
            SELECT writeoff_id, item_code, item_name, locator_code, 
                   qty, qty_boxes, qty_loose_pieces, pieces_per_box_snapshot,
                   unit_cost, total_value, reason, actor, acted_at
            FROM dbo.damage_writeoffs
            WHERE ${whereClause}
            ORDER BY acted_at DESC
            OFFSET @param${offIdx} ROWS FETCH NEXT @param${limIdx} ROWS ONLY
        `, listParams);

        return { data: rows, total, page, limit, totalPages: Math.ceil(total / limit) };
    }
};

module.exports = OfflineDamageModel;