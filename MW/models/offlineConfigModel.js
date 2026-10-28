// models/offlineConfigModel.js
'use strict';

const { query, ensurePool, sql } = require('../db');
const crypto = require('crypto');

/* ============================================================
   LOCATOR SYNC SCOPE
   ------------------------------------------------------------
   Only export locators that belong to warehouses the underground
   devices actually operate in. 
   ⚠️ LUMB has been removed from the offline system scope. Only UG.
   ============================================================ */
const SYNC_WAREHOUSE_CODES = Object.freeze(['UG']);

/* ============================================================
   BATCH INSERT HELPERS (Preserved)
   ============================================================ */
const insertConfigsBatch = async (tx, configs, username) => {
    const BATCH = 200;
    for (let i = 0; i < configs.length; i += BATCH) {
        const batch = configs.slice(i, i + BATCH);
        const valuesClauses = [];
        const req = new sql.Request(tx);

        batch.forEach((c, idx) => {
            const b = idx * 6;
            valuesClauses.push(`(@c${b}, @v${b+1}, @d${b+2}, @s${b+3}, @a${b+4}, @u${b+5})`);
            req.input(`c${b}`,     sql.VarChar(50),   String(c.category   || ''));
            req.input(`v${b+1}`,   sql.NVarChar(255), String(c.item_value || ''));
            req.input(`d${b+2}`,   sql.NVarChar(255), c.description ? String(c.description) : null);
            req.input(`s${b+3}`,   sql.Int,           Number(c.sort_order) || 0);
            req.input(`a${b+4}`,   sql.Bit,           c.is_active ? 1 : 0);
            req.input(`u${b+5}`,   sql.NVarChar(100), String(username || 'sync-system'));
        });

        await req.query(`
            INSERT INTO dbo.offline_config_items
                (category, item_value, description, sort_order, is_active, created_by)
            VALUES ${valuesClauses.join(', ')}
        `);
    }
};

const insertSignaturesBatch = async (tx, signatures, username) => {
    const BATCH = 200;
    for (let i = 0; i < signatures.length; i += BATCH) {
        const batch = signatures.slice(i, i + BATCH);
        const valuesClauses = [];
        const req = new sql.Request(tx);

        batch.forEach((s, idx) => {
            const b = idx * 6;
            valuesClauses.push(`(@f${b}, @p${b+1}, @r${b+2}, @o${b+3}, @a${b+4}, @u${b+5})`);
            req.input(`f${b}`,     sql.NVarChar(150), String(s.full_name      || ''));
            req.input(`p${b+1}`,   sql.NVarChar(150), String(s.position_title || ''));
            req.input(`r${b+2}`,   sql.NVarChar(30),  'Authorized By');
            req.input(`o${b+3}`,   sql.Int,           Number(s.sort_order) || 0);
            req.input(`a${b+4}`,   sql.Bit,           s.is_active ? 1 : 0);
            req.input(`u${b+5}`,   sql.NVarChar(100), String(username || 'sync-system'));
        });

        await req.query(`
            INSERT INTO dbo.signature_config
                (full_name, position_title, role_slot, sort_order, is_active, created_by)
            VALUES ${valuesClauses.join(', ')}
        `);
    }
};

const upsertItemMasterBatch = async (tx, items) => {
    const BATCH = 100;
    for (let i = 0; i < items.length; i += BATCH) {
        const batch = items.slice(i, i + BATCH);
        const valuesClauses = [];
        const req = new sql.Request(tx);

        batch.forEach((item, idx) => {
            const b = idx * 12;
            valuesClauses.push(
                `(@ic${b}, @id${b+1}, @uc${b+2}, @ud${b+3}, @gc${b+4}, @gd${b+5}, ` +
                `@pc${b+6}, @ca${b+7}, @lp${b+8}, @st${b+9}, @bc${b+10}, @cd${b+11})`
            );
            req.input(`ic${b}`,      sql.NVarChar(50),    String(item.Item_Code || ''));
            req.input(`id${b+1}`,    sql.NVarChar(400),   item.Item_Description  ?? null);
            req.input(`uc${b+2}`,    sql.NVarChar(50),    item.Uom_Code          ?? null);
            req.input(`ud${b+3}`,    sql.NVarChar(100),   item.Uom_Description   ?? null);
            req.input(`gc${b+4}`,    sql.Int,             parseInt(item.Gl_Class) || 0);
            req.input(`gd${b+5}`,    sql.NVarChar(100),   item.Gl_Description    ?? null);
            req.input(`pc${b+6}`,    sql.NVarChar(100),   item.Purchase_Class    ?? null);
            req.input(`ca${b+7}`,    sql.NVarChar(100),   item.Category          ?? null);
            req.input(`lp${b+8}`,    sql.Decimal(18, 10), parseFloat(item.List_Price_Per_Unit) || 0);
            req.input(`st${b+9}`,    sql.NVarChar(20),    item.Status            ?? 'Active');
            req.input(`bc${b+10}`,   sql.NVarChar(100),   item.Barcode           ?? null);
            req.input(`cd${b+11}`,   sql.Date,            item.Creation_Date ? new Date(item.Creation_Date) : null);
        });

        await req.query(`
            MERGE INTO dbo.item_master AS target
            USING (
                SELECT * FROM (VALUES ${valuesClauses.join(', ')})
                AS v(
                    Item_Code, Item_Description, Uom_Code, Uom_Description,
                    Gl_Class, Gl_Description, Purchase_Class, Category,
                    List_Price_Per_Unit, Status, Barcode, Creation_Date
                )
            ) AS source
            ON (target.Item_Code = source.Item_Code)
            WHEN MATCHED THEN UPDATE SET
                Item_Description    = source.Item_Description,
                Uom_Code            = source.Uom_Code,
                Uom_Description     = source.Uom_Description,
                Gl_Class            = source.Gl_Class,
                Gl_Description      = source.Gl_Description,
                Purchase_Class      = source.Purchase_Class,
                Category            = source.Category,
                List_Price_Per_Unit = source.List_Price_Per_Unit,
                Status              = source.Status,
                Barcode             = source.Barcode,
                Creation_Date       = source.Creation_Date
            WHEN NOT MATCHED THEN INSERT (
                Item_Code, Item_Description, Uom_Code, Uom_Description,
                Gl_Class, Gl_Description, Purchase_Class, Category,
                List_Price_Per_Unit, Status, Barcode, Creation_Date
            ) VALUES (
                source.Item_Code, source.Item_Description, source.Uom_Code, source.Uom_Description,
                source.Gl_Class, source.Gl_Description, source.Purchase_Class, source.Category,
                source.List_Price_Per_Unit, source.Status, source.Barcode, source.Creation_Date
            );
        `);
    }
};

const upsertEquipmentMasterBatch = async (tx, equipments) => {
    const BATCH = 100;
    for (let i = 0; i < equipments.length; i += BATCH) {
        const batch = equipments.slice(i, i + BATCH);
        const valuesClauses = [];
        const req = new sql.Request(tx);

        batch.forEach((eq, idx) => {
            const b = idx * 8;
            valuesClauses.push(
                `(@ec${b}, @va${b+1}, @de${b+2}, @ba${b+3}, @st${b+4}, @cd${b+5}, @ub${b+6}, @ua${b+7})`
            );
            req.input(`ec${b}`,      sql.NVarChar(50),    String(eq.Equipment_Code || ''));
            req.input(`va${b+1}`,    sql.Int,             parseInt(eq.Value) || 0);
            req.input(`de${b+2}`,    sql.NVarChar(400),   eq.Description ?? null);
            req.input(`ba${b+3}`,    sql.NVarChar(100),   eq.Barcode ?? null);
            req.input(`st${b+4}`,    sql.NVarChar(20),    eq.Status ?? 'Active');
            req.input(`cd${b+5}`,    sql.Date,            eq.Creation_Date ? new Date(eq.Creation_Date) : null);
            req.input(`ub${b+6}`,    sql.NVarChar(100),   eq.Updated_By ?? null);
            req.input(`ua${b+7}`,    sql.DateTime,        eq.Updated_At ? new Date(eq.Updated_At) : null);
        });

        await req.query(`
            MERGE INTO dbo.equipment_master AS target
            USING (
                SELECT * FROM (VALUES ${valuesClauses.join(', ')}) 
                AS v(
                    Equipment_Code, Value, Description, Barcode, Status, Creation_Date, Updated_By, Updated_At
                )
            ) AS source
            ON (target.Equipment_Code = source.Equipment_Code)
            WHEN MATCHED THEN UPDATE SET
                Value         = source.Value,
                Description   = source.Description,
                Barcode       = source.Barcode,
                Status        = source.Status,
                Creation_Date = source.Creation_Date,
                Updated_By    = source.Updated_By,
                Updated_At    = source.Updated_At
            WHEN NOT MATCHED THEN INSERT (
                Equipment_Code, Value, Description, Barcode, Status, Creation_Date, Updated_By, Updated_At
            ) VALUES (
                source.Equipment_Code, source.Value, source.Description, source.Barcode, source.Status, source.Creation_Date, source.Updated_By, source.Updated_At
            );
        `);
    }
};

const upsertLocatorsBatch = async (tx, locators) => {
    const BATCH = 200;
    for (let i = 0; i < locators.length; i += BATCH) {
        const batch = locators.slice(i, i + BATCH);
        const valuesClauses = [];
        const req = new sql.Request(tx);

        batch.forEach((l, idx) => {
            const b = idx * 8;
            valuesClauses.push(
                `(@wc${b}, @lc${b+1}, @ln${b+2}, @ds${b+3}, ` +
                `@pc${b+4}, @ca${b+5}, @st${b+6}, @lt${b+7})`
            );
            req.input(`wc${b}`,      sql.NVarChar(20),  String(l.warehouse_code || ''));
            req.input(`lc${b+1}`,    sql.NVarChar(50),  String(l.locator_code   || ''));
            req.input(`ln${b+2}`,    sql.NVarChar(255), l.locator_name    ?? null);
            req.input(`ds${b+3}`,    sql.NVarChar(255), l.description     ?? null);
            req.input(`pc${b+4}`,    sql.NVarChar(100), l.purchase_class  ?? null);
            req.input(`ca${b+5}`,    sql.NVarChar(100), l.category        ?? null);
            req.input(`st${b+6}`,    sql.NVarChar(20),  l.status          ?? 'Active');
            req.input(`lt${b+7}`,    sql.NVarChar(20),  l.locator_type    ?? 'Regular');
        });

        await req.query(`
            MERGE INTO dbo.locator_table AS target
            USING (
                SELECT * FROM (VALUES ${valuesClauses.join(', ')})
                AS v(
                    warehouse_code, locator_code, locator_name, description,
                    purchase_class, category, status, locator_type
                )
            ) AS source
            ON (target.warehouse_code = source.warehouse_code
                AND target.locator_code = source.locator_code)
            WHEN MATCHED THEN UPDATE SET
                locator_name   = source.locator_name,
                description    = source.description,
                purchase_class = source.purchase_class,
                category       = source.category,
                status         = source.status,
                locator_type   = source.locator_type,
                updated_at     = GETDATE()
            WHEN NOT MATCHED THEN INSERT (
                warehouse_code, locator_code, locator_name, description,
                purchase_class, category, status, locator_type,
                created_by, created_at
            ) VALUES (
                source.warehouse_code, source.locator_code, source.locator_name, source.description,
                source.purchase_class, source.category, source.status, source.locator_type,
                'sync-system', GETDATE()
            );
        `);
    }
};

/* ============================================================
   UOM CONVERSIONS BATCH INSERT (Preserved)
   ============================================================ */
const insertUomConversionsBatch = async (tx, conversions, username) => {
    const BATCH = 200;
    for (let i = 0; i < conversions.length; i += BATCH) {
        const batch = conversions.slice(i, i + BATCH);
        const valuesClauses = [];
        const req = new sql.Request(tx);

        batch.forEach((c, idx) => {
            const b = idx * 7;
            valuesClauses.push(
                `(@box${b}, @pc${b+1}, @ppb${b+2}, @st${b+3}, @ub${b+4}, @ua${b+5}, @ca${b+6})`
            );
            req.input(`box${b}`,     sql.NVarChar(100), String(c.box_item_code   || ''));
            req.input(`pc${b+1}`,    sql.NVarChar(100), String(c.piece_item_code || ''));
            req.input(`ppb${b+2}`,   sql.Decimal(18,4), Number(c.pieces_per_box) || 0);
            req.input(`st${b+3}`,    sql.NVarChar(20),  String(c.Status || 'Active'));
            req.input(`ub${b+4}`,    sql.NVarChar(100), String(c.Updated_By || username || 'sync-system'));
            req.input(`ua${b+5}`,    sql.DateTime,      c.Updated_At ? new Date(c.Updated_At) : new Date());
            req.input(`ca${b+6}`,    sql.DateTime,      c.Created_At ? new Date(c.Created_At) : new Date());
        });

        await req.query(`
            INSERT INTO dbo.uom_conversions
                (box_item_code, piece_item_code, pieces_per_box, Status,
                 Updated_By, Updated_At, Created_At)
            VALUES ${valuesClauses.join(', ')}
        `);
    }
};

/* ============================================================
   MODEL
   ============================================================ */
const OfflineConfigModel = {
    /* ============================================================
       DROPDOWN CRUD
       ============================================================ */
    
    getPaginatedConfigItems: async ({ category, page = 1, limit = 20, search = '' }) => {
        if (!category) throw new Error('Category is required');
        
        let allItems = [];

        if (category === 'ACTIVITY_CC') {
            let costCenters = [];
            try {
                costCenters = await query(`
                    SELECT Cost_Center_Value, [Description], Status, Creation_Date, Updated_By, Updated_At
                    FROM dbo.cost_center_list
                    WHERE Status = 'Active'
                `, []);
            } catch (e) { /* ignore if missing */ }

            allItems = costCenters.map(cc => ({
                config_id: `cc_${cc.Cost_Center_Value}`,
                category: 'ACTIVITY_CC',
                item_value: String(cc.Cost_Center_Value),
                description: cc.Description || '',
                sort_order: 0,
                is_active: 1,
                created_at: cc.Creation_Date,
                created_by: 'System',
                updated_at: cc.Updated_At || cc.Creation_Date,
                updated_by: cc.Updated_By || 'System'
            }));
        } else if (category === 'LHD_NO') {
            let equipment = [];
            try {
                equipment = await query(`
                    SELECT Equipment_Code, Value, [Description], Status, Creation_Date, Updated_By, Updated_At
                    FROM dbo.equipment_master
                    WHERE Status = 'Active'
                `, []);
            } catch (e) { /* ignore if missing */ }

            allItems = equipment.map(eq => ({
                config_id: `eq_${eq.Equipment_Code}`,
                category: 'LHD_NO',
                item_value: String(eq.Value),
                description: eq.Description || '',
                sort_order: 0,
                is_active: 1,
                created_at: eq.Creation_Date,
                created_by: 'System',
                updated_at: eq.Updated_At || eq.Creation_Date,
                updated_by: eq.Updated_By || 'System'
            }));
        } else {
            allItems = await query(`
                SELECT config_id, category, item_value, description, sort_order, is_active, 
                       created_at, created_by, updated_at, updated_by
                FROM dbo.offline_config_items
                WHERE category = @param0 AND is_active = 1
            `, [category]);
        }

        const searchTerm = search.trim().toLowerCase();
        if (searchTerm) {
            allItems = allItems.filter(item => 
                String(item.item_value).toLowerCase().includes(searchTerm) || 
                String(item.description || '').toLowerCase().includes(searchTerm)
            );
        }

        allItems.sort((a, b) => {
            if (category === 'ACTIVITY_CC' || category === 'LHD_NO') {
                return parseInt(a.item_value) - parseInt(b.item_value);
            }
            return String(a.item_value).localeCompare(String(b.item_value));
        });

        const total = allItems.length;
        const startIndex = (page - 1) * limit;
        const paginatedData = allItems.slice(startIndex, startIndex + limit);

        return {
            data: paginatedData,
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit) || 1
        };
    },

    /**
     * Dashboard view of synced locators.
     * Filtered to sync warehouses only (UG).
     */
    getPaginatedLocators: async ({ page = 1, limit = 20, search = '' }) => {
        const params = [];
        const conds = [
            "status = 'Active'",
            `warehouse_code IN (${SYNC_WAREHOUSE_CODES.map((_, i) => {
                params.push(SYNC_WAREHOUSE_CODES[i]);
                return `@param${params.length - 1}`;
            }).join(', ')})`
        ];
        
        if (search && String(search).trim()) {
            params.push(`%${String(search).trim()}%`);
            const i = params.length - 1;
            conds.push(`(locator_code LIKE @param${i} OR locator_name LIKE @param${i} OR warehouse_code LIKE @param${i})`);
        }
        
        const where = `WHERE ${conds.join(' AND ')}`;

        const countRes = await query(`SELECT COUNT(*) AS total FROM dbo.locator_table ${where}`, params);
        const total = countRes[0]?.total || 0;

        const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 200);
        const safePage  = Math.max(parseInt(page, 10) || 1, 1);
        const offset    = (safePage - 1) * safeLimit;

        const listParams = [...params, offset, safeLimit];
        const offIdx = listParams.length - 2;
        const limIdx = listParams.length - 1;

        const rows = await query(`
            SELECT locator_code, locator_name, warehouse_code, status, locator_type
            FROM dbo.locator_table
            ${where}
            ORDER BY warehouse_code, locator_code
            OFFSET @param${offIdx} ROWS FETCH NEXT @param${limIdx} ROWS ONLY
        `, listParams);

        return {
            data: rows,
            total,
            page: safePage,
            limit: safeLimit,
            totalPages: Math.ceil(total / safeLimit) || 1
        };
    },

    getAuthorizedSignatures: async () => {
        return await query(`
            SELECT id, full_name, position_title, sort_order, is_active
            FROM dbo.signature_config
            WHERE role_slot = 'Authorized By'
            ORDER BY full_name ASC
        `, []);
    },

    createConfigItem: async ({ category, item_value, description, sort_order, created_by }) => {
        if (category === 'ACTIVITY_CC') {
            const val = parseInt(item_value, 10);
            if (isNaN(val)) throw new Error('Cost Center value must be a number.');
            
            const res = await query(`
                INSERT INTO dbo.cost_center_list (Cost_Center_Value, [Description], Status, Updated_By, Updated_At)
                OUTPUT INSERTED.Cost_Center_Value
                VALUES (@param0, @param1, 'Active', @param2, GETDATE())
            `, [val, description || null, created_by]);
            
            return { 
                config_id: `cc_${res[0].Cost_Center_Value}`, category, item_value: String(val), description, sort_order: 0, is_active: 1, created_by 
            };
        }

        if (category === 'LHD_NO') {
            const val = parseInt(item_value, 10);
            if (isNaN(val)) throw new Error('LHD No. must be a number.');
            
            const generatedCode = `EQ-${val}`;
            
            const res = await query(`
                INSERT INTO dbo.equipment_master (Equipment_Code, Value, [Description], Barcode, Status, Updated_By, Updated_At)
                OUTPUT INSERTED.Equipment_Code
                VALUES (@param0, @param1, @param2, @param0, 'Active', @param3, GETDATE())
            `, [generatedCode, val, description || null, created_by]);
            
            return { 
                config_id: `eq_${res[0].Equipment_Code}`, category, item_value: String(val), description, sort_order: 0, is_active: 1, created_by 
            };
        }

        const res = await query(`
            INSERT INTO dbo.offline_config_items (category, item_value, description, sort_order, created_by)
            OUTPUT INSERTED.*
            VALUES (@param0, @param1, @param2, @param3, @param4)
        `, [category, item_value, description || null, sort_order || 0, created_by]);
        return res[0];
    },

    updateConfigItem: async (id, { item_value, description, sort_order, is_active, updated_by, category }) => {
        if (category === 'ACTIVITY_CC' || String(id).startsWith('cc_')) {
            const ccId = String(id).replace('cc_', '');
            const status = is_active ? 'Active' : 'Inactive';
            
            await query(`
                UPDATE dbo.cost_center_list
                SET [Description] = @param0, Status = @param1, Updated_By = @param2, Updated_At = GETDATE()
                WHERE Cost_Center_Value = @param3
            `, [description || null, status, updated_by, ccId]);
            
            return { config_id: id, category: 'ACTIVITY_CC', item_value: String(ccId), description, is_active: is_active ? 1 : 0 };
        }

        if (category === 'LHD_NO' || String(id).startsWith('eq_')) {
            const code = String(id).replace('eq_', '');
            const status = is_active ? 'Active' : 'Inactive';
            
            await query(`
                UPDATE dbo.equipment_master
                SET [Description] = @param0, Status = @param1, Updated_By = @param2, Updated_At = GETDATE()
                WHERE Equipment_Code = @param3
            `, [description || null, status, updated_by, code]);
            
            return { config_id: id, category: 'LHD_NO', item_value: item_value, description, is_active: is_active ? 1 : 0 };
        }

        const res = await query(`
            UPDATE dbo.offline_config_items
            SET item_value = @param0, description = @param1, sort_order = @param2,
                is_active = @param3, updated_by = @param4, updated_at = SYSUTCDATETIME()
            OUTPUT INSERTED.*
            WHERE config_id = @param5
        `, [item_value, description || null, sort_order || 0, is_active, updated_by, id]);
        return res[0];
    },

    deleteConfigItem: async (id) => {
        if (String(id).startsWith('cc_')) {
            const ccId = String(id).replace('cc_', '');
            await query(`DELETE FROM dbo.cost_center_list WHERE Cost_Center_Value = @param0`, [ccId]);
            return;
        }
        if (String(id).startsWith('eq_')) {
            const code = String(id).replace('eq_', '');
            await query(`DELETE FROM dbo.equipment_master WHERE Equipment_Code = @param0`, [code]);
            return;
        }
        await query(`DELETE FROM dbo.offline_config_items WHERE config_id = @param0`, [id]);
    },

    /* ============================================================
       SIGNATURE CRUD
       ============================================================ */
    listSignatures: async ({ role_slot, is_active, include_inactive } = {}) => {
        const params = [];
        const conds  = [];

        if (role_slot) {
            params.push(String(role_slot).trim());
            conds.push(`role_slot = @param${params.length - 1}`);
        }
        if (is_active === true || is_active === false) {
            params.push(is_active ? 1 : 0);
            conds.push(`is_active = @param${params.length - 1}`);
        } else if (!include_inactive) {
            conds.push(`is_active = 1`);
        }
        const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

        return query(
            `SELECT id, full_name, position_title, role_slot,
                    sort_order, is_active, remarks,
                    created_at, created_by, updated_at, updated_by
             FROM dbo.signature_config
             ${where}
             ORDER BY role_slot ASC, full_name ASC, id ASC`,
            params
        );
    },

    getSignatureById: async (id) => {
        const rows = await query(`SELECT * FROM dbo.signature_config WHERE id = @param0`, [id]);
        return rows[0] || null;
    },

    createSignature: async ({ full_name, position_title, role_slot, is_active = true, remarks = null, created_by }) => {
        const res = await query(`
            INSERT INTO dbo.signature_config
                (full_name, position_title, role_slot, sort_order, is_active, remarks, created_by)
            OUTPUT INSERTED.id
            VALUES (@param0, @param1, @param2, 0, @param3, @param4, @param5)
        `, [String(full_name).trim(), String(position_title).trim(), String(role_slot).trim(), is_active ? 1 : 0, remarks ?? null, String(created_by).trim()]);
        return { id: res[0].id };
    },

    updateSignature: async (id, { full_name, position_title, role_slot, is_active, remarks, updated_by }) => {
        const params = [];
        const sets   = [];
        const set = (col, val) => { params.push(val); sets.push(`${col} = @param${params.length - 1}`); };

        if (full_name      !== undefined) set('full_name',      String(full_name).trim());
        if (position_title !== undefined) set('position_title', String(position_title).trim());
        if (role_slot      !== undefined) set('role_slot',      String(role_slot).trim());
        if (is_active      !== undefined) set('is_active',      is_active ? 1 : 0);
        if (remarks        !== undefined) set('remarks',        remarks ?? null);
        set('updated_at', new Date());
        set('updated_by', String(updated_by || '').trim() || null);

        params.push(id);
        const idIdx = params.length - 1;

        await query(`UPDATE dbo.signature_config SET ${sets.join(', ')} WHERE id = @param${idIdx}`, params);
        return { updated: 1 };
    },

    removeSignature: async (id) => {
        await query(`DELETE FROM dbo.signature_config WHERE id = @param0`, [id]);
        return { removed: 1 };
    },

    /* ============================================================
       SYNC HISTORY / PAYLOAD
       ============================================================ */
    logSync: async ({ direction, username, userId, fileName, fileHash, itemCount, notes }) => {
        return await query(`
            INSERT INTO dbo.offline_config_sync_log 
                (direction, performed_by_username, performed_by_id, file_name, file_hash, item_count, notes)
            OUTPUT INSERTED.*
            VALUES (@param0, @param1, @param2, @param3, @param4, @param5, @param6)
        `, [direction, username, userId, fileName, fileHash, itemCount, notes]);
    },

    getSyncHistory: async (limit = 50) => {
        const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 500);
        return await query(`
            SELECT TOP (${safeLimit}) sync_id, direction, performed_by_username, performed_at, 
                   file_name, item_count, notes
            FROM dbo.offline_config_sync_log
            ORDER BY performed_at DESC
        `, []);
    },

    /**
     * Build the sync payload the surface sends to underground peers.
     */
    generateSyncPayload: async () => {
        const standardConfigs = await query(`
            SELECT config_id, category, item_value, description, sort_order, is_active, created_at, created_by, updated_at, updated_by
            FROM dbo.offline_config_items
            WHERE category NOT IN ('ACTIVITY_CC', 'LHD_NO', 'DEPARTMENT', 'ADH_DH')
        `, []);

        let costCenters = [];
        try {
            costCenters = await query(`SELECT Cost_Center_Value, [Description], Status FROM dbo.cost_center_list WHERE Status = 'Active'`, []);
        } catch (e) { /* ignore */ }

        const ccConfigs = costCenters.map(cc => ({
            category: 'ACTIVITY_CC', item_value: String(cc.Cost_Center_Value), description: cc.Description || '', sort_order: 0, is_active: 1
        }));

        let equipment = [];
        try {
            equipment = await query(`SELECT Equipment_Code, Value, Description, Barcode, Status, Creation_Date, Updated_By, Updated_At FROM dbo.equipment_master WHERE Status = 'Active'`, []);
        } catch (e) { /* ignore */ }

        const eqConfigs = equipment.map(eq => ({
            category: 'LHD_NO', item_value: String(eq.Value), description: eq.Description || '', sort_order: 0, is_active: 1
        }));

        const configs = [...standardConfigs, ...ccConfigs, ...eqConfigs];
        const signatures = await OfflineConfigModel.getAuthorizedSignatures();
        const items = await query(`SELECT Item_Code, Item_Description, Uom_Code, Uom_Description, Gl_Class, Gl_Description, Purchase_Class, Category, List_Price_Per_Unit, Status, Barcode, Creation_Date FROM dbo.item_master WHERE Status = 'Active'`, []);

        // ⚡ SCOPE-FILTERED LOCATORS — only UG warehouse
        const locParams = [];
        const locPlaceholders = SYNC_WAREHOUSE_CODES.map((code) => {
            locParams.push(code);
            return `@param${locParams.length - 1}`;
        }).join(', ');

        const locators = await query(`
            SELECT warehouse_code, locator_code, locator_name, description, purchase_class, category, status, locator_type 
            FROM dbo.locator_table 
            WHERE status = 'Active'
              AND warehouse_code IN (${locPlaceholders})
        `, locParams);

        let uomConversions = [];
        try {
            uomConversions = await query(`
                SELECT c.box_item_code, c.piece_item_code, c.pieces_per_box,
                       c.Status, c.Created_At, c.Updated_By, c.Updated_At
                  FROM dbo.uom_conversions c
                 WHERE EXISTS (
                         SELECT 1 FROM dbo.item_master ib
                          WHERE ib.Item_Code = c.box_item_code
                            AND ib.Status    = 'Active'
                       )
                   AND EXISTS (
                         SELECT 1 FROM dbo.item_master ip
                          WHERE ip.Item_Code = c.piece_item_code
                            AND ip.Status    = 'Active'
                       )
                 ORDER BY c.conversion_id
            `, []);
        } catch (e) { /* ignore */ }

        const payload = { 
            version: '1.0', 
            generated_at: new Date().toISOString(), 
            configs, 
            signatures: signatures.filter(s => s.is_active), 
            item_master: items, 
            locators,
            equipment_master: equipment,
            uom_conversions: uomConversions,
        };

        const payloadString = JSON.stringify(payload);
        const fileHash = crypto.createHash('sha256').update(payloadString).digest('hex');
        const fileName = `offline-config-${new Date().toISOString().split('T')[0]}.json`;
        const itemCount =
            payload.configs.length +
            payload.signatures.length +
            items.length +
            locators.length +
            equipment.length +
            uomConversions.length;

        return { payload, fileName, fileHash, itemCount };
    },

    applySyncPayload: async (payload, username, userId, fileName, fileHash) => {
        const pool = await ensurePool();
        const tx = new sql.Transaction(pool);
        let currentStep = 'starting transaction';

        await tx.begin();
        try {
            currentStep = 'clearing existing config items';
            await new sql.Request(tx).query(`DELETE FROM dbo.offline_config_items`);

            if (payload.configs && payload.configs.length > 0) {
                currentStep = `inserting ${payload.configs.length} config item(s)`;
                await insertConfigsBatch(tx, payload.configs, username);
            }

            currentStep = 'clearing existing signatures';
            await new sql.Request(tx).query(`DELETE FROM dbo.signature_config WHERE role_slot = 'Authorized By'`);

            if (payload.signatures && payload.signatures.length > 0) {
                currentStep = `inserting ${payload.signatures.length} signature(s)`;
                await insertSignaturesBatch(tx, payload.signatures, username);
            }

            if (payload.item_master && payload.item_master.length > 0) {
                currentStep = `upserting ${payload.item_master.length} item code(s)`;
                await upsertItemMasterBatch(tx, payload.item_master);
            }

            if (payload.uom_conversions !== undefined) {
                currentStep = 'clearing existing uom conversions';
                await new sql.Request(tx).query(`DELETE FROM dbo.uom_conversions`);

                if (Array.isArray(payload.uom_conversions) && payload.uom_conversions.length > 0) {
                    currentStep = `inserting ${payload.uom_conversions.length} uom conversion rule(s)`;
                    await insertUomConversionsBatch(tx, payload.uom_conversions, username);
                }
            }

            if (payload.locators && payload.locators.length > 0) {
                currentStep = `upserting ${payload.locators.length} locator(s)`;
                await upsertLocatorsBatch(tx, payload.locators);
            }
            
            if (payload.equipment_master && payload.equipment_master.length > 0) {
                currentStep = `upserting ${payload.equipment_master.length} equipment record(s)`;
                await upsertEquipmentMasterBatch(tx, payload.equipment_master);
            }

            currentStep = 'logging import';
            const totalCount = (payload.configs?.length || 0) + 
                               (payload.signatures?.length || 0) + 
                               (payload.item_master?.length || 0) + 
                               (payload.locators?.length || 0) +
                               (payload.equipment_master?.length || 0) +
                               (payload.uom_conversions?.length || 0);

            await new sql.Request(tx)
                .input('dir', sql.VarChar(20), 'Import').input('user', sql.NVarChar(50), username)
                .input('uid', sql.Int, userId).input('file', sql.NVarChar(255), fileName)
                .input('hash', sql.VarChar(64), fileHash).input('count', sql.Int, totalCount)
                .query(`INSERT INTO dbo.offline_config_sync_log (direction, performed_by_username, performed_by_id, file_name, file_hash, item_count, notes) VALUES (@dir, @user, @uid, @file, @hash, @count, 'Bulk import applied via API')`);

            currentStep = 'committing transaction';
            await tx.commit();
            return { success: true };
        } catch (err) {
            const originalMessage = err.message || String(err);
            err.step = currentStep; err.originalMessage = originalMessage; err.message = `[${currentStep}] ${originalMessage}`;
            try { await tx.rollback(); } catch { /* noop */ }
            throw err;
        }
    }
};

module.exports = OfflineConfigModel;