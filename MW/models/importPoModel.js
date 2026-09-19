// models/importPoModel.js
const { sql, pool, poolConnect } = require('../db');

const CHUNK_SIZE = 500;

const chunk = (arr, size) => {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

class ImportPoModel {
  static async lookupItemMasters(itemCodes = []) {
    await poolConnect;
    const map = new Map();
    if (!itemCodes.length) return map;

    const unique = [...new Set(itemCodes.map(c => String(c).trim()).filter(Boolean))];

    for (const batch of chunk(unique, CHUNK_SIZE)) {
      const request = pool.request();
      const placeholders = batch
        .map((code, i) => {
          request.input(`c${i}`, sql.NVarChar, code);
          return `@c${i}`;
        })
        .join(',');

      const result = await request.query(`
        SELECT Item_Code, Item_Description, Uom_Code, Uom_Description,
               Barcode, Gl_Class, Gl_Description, Purchase_Class, Category
          FROM item_master
         WHERE Item_Code IN (${placeholders})
      `);

      for (const row of result.recordset) {
        map.set(String(row.Item_Code).trim(), {
          item_name:       row.Item_Description || '',
          uom:             row.Uom_Code         || '',
          uom_description: row.Uom_Description  || '',
          barcode:         row.Barcode          || '',
          gl_class_code:   row.Gl_Class != null ? String(row.Gl_Class) : '',
          gl_description:  row.Gl_Description   || '',
          purchase_class:  row.Purchase_Class   || '',
          category:        row.Category         || '',
        });
      }
    }
    return map;
  }

  static async findExistingKeys(poNos = []) {
    await poolConnect;
    const set = new Set();
    if (!poNos.length) return set;

    const unique = [...new Set(poNos.map(p => String(p).trim()).filter(Boolean))];

    for (const batch of chunk(unique, CHUNK_SIZE)) {
      const request = pool.request();
      const placeholders = batch
        .map((p, i) => {
          request.input(`p${i}`, sql.NVarChar, p);
          return `@p${i}`;
        })
        .join(',');

      const result = await request.query(`
        SELECT po_no, item_code
          FROM import_po
         WHERE po_no IN (${placeholders})
      `);

      for (const row of result.recordset) {
        set.add(`${row.po_no}|||${row.item_code}`);
      }
    }
    return set;
  }

  static async findExistingPOs(poNos = []) {
    await poolConnect;
    if (!poNos.length) return [];

    const unique = [...new Set(poNos.map(p => String(p).trim()).filter(Boolean))];
    const found = new Set();

    for (const batch of chunk(unique, CHUNK_SIZE)) {
      const request = pool.request();
      const placeholders = batch
        .map((p, i) => {
          request.input(`p${i}`, sql.NVarChar, p);
          return `@p${i}`;
        })
        .join(',');

      const result = await request.query(`
        SELECT DISTINCT po_no
          FROM import_po
         WHERE po_no IN (${placeholders})
      `);
      result.recordset.forEach(r => found.add(r.po_no));
    }

    return [...found];
  }

  static async insertLine(data) {
    await poolConnect;
    const request = pool.request();

    request.input('po_date',         sql.Date,          data.po_date);
    request.input('pr_no',           sql.NVarChar,      data.pr_no || '');
    request.input('po_no',           sql.NVarChar,      data.po_no);
    request.input('vendor_name',     sql.NVarChar,      data.vendor_name || '');
    request.input('item_code',       sql.NVarChar,      data.item_code);
    request.input('qty',             sql.Decimal(18,4), data.qty);
    request.input('unit_price',      sql.Decimal(18,6), data.unit_price);
    request.input('currency',        sql.NVarChar,      data.currency || 'PHP');
    request.input('buyer',           sql.NVarChar,      data.buyer || '');
    request.input('uom',             sql.NVarChar,      data.uom || '');
    request.input('uom_description', sql.NVarChar,      data.uom_description || '');
    request.input('item_name',       sql.NVarChar,      data.item_name || '');
    request.input('barcode',         sql.NVarChar,      data.barcode || '');
    request.input('gl_class_code',   sql.NVarChar,      data.gl_class_code || '');
    request.input('gl_description',  sql.NVarChar,      data.gl_description || '');
    request.input('purchase_class',  sql.NVarChar,      data.purchase_class || '');
    request.input('category',        sql.NVarChar,      data.category || '');
    request.input('warehouse_id',    sql.BigInt,        data.warehouse_id || null);
    request.input('source_file',     sql.NVarChar,      data.source_file || null);
    request.input('imported_by',     sql.NVarChar,      data.imported_by || 'System');
    request.input('imported_at',     sql.DateTime,      data.imported_at || new Date());

    await request.query(`
      INSERT INTO import_po
        (po_date, pr_no, po_no, vendor_name, item_code, qty, unit_price,
         currency, buyer, uom, uom_description, item_name, barcode,
         gl_class_code, gl_description, purchase_class, category,
         warehouse_id, status, source_file, imported_by, imported_at)
      VALUES
        (@po_date, @pr_no, @po_no, @vendor_name, @item_code, @qty, @unit_price,
         @currency, @buyer, @uom, @uom_description, @item_name, @barcode,
         @gl_class_code, @gl_description, @purchase_class, @category,
         @warehouse_id, 'Pending', @source_file, @imported_by, @imported_at)
    `);
  }

  static async updateLine(data) {
    await poolConnect;
    const request = pool.request();

    request.input('po_date',         sql.Date,          data.po_date);
    request.input('pr_no',           sql.NVarChar,      data.pr_no || '');
    request.input('vendor_name',     sql.NVarChar,      data.vendor_name || '');
    request.input('qty',             sql.Decimal(18,4), data.qty);
    request.input('unit_price',      sql.Decimal(18,6), data.unit_price);
    request.input('currency',        sql.NVarChar,      data.currency || 'PHP');
    request.input('buyer',           sql.NVarChar,      data.buyer || '');
    request.input('uom',             sql.NVarChar,      data.uom || '');
    request.input('uom_description', sql.NVarChar,      data.uom_description || '');
    request.input('item_name',       sql.NVarChar,      data.item_name || '');
    request.input('barcode',         sql.NVarChar,      data.barcode || '');
    request.input('gl_class_code',   sql.NVarChar,      data.gl_class_code || '');
    request.input('gl_description',  sql.NVarChar,      data.gl_description || '');
    request.input('purchase_class',  sql.NVarChar,      data.purchase_class || '');
    request.input('category',        sql.NVarChar,      data.category || '');
    request.input('po_no',           sql.NVarChar,      data.po_no);
    request.input('item_code',       sql.NVarChar,      data.item_code);

    await request.query(`
      UPDATE import_po
         SET po_date         = @po_date,
             pr_no           = @pr_no,
             vendor_name     = @vendor_name,
             qty             = @qty,
             unit_price      = @unit_price,
             currency        = @currency,
             buyer           = @buyer,
             uom             = @uom,
             uom_description = @uom_description,
             item_name       = @item_name,
             barcode         = @barcode,
             gl_class_code   = @gl_class_code,
             gl_description  = @gl_description,
             purchase_class  = @purchase_class,
             category        = @category
       WHERE po_no    = @po_no
         AND item_code = @item_code
    `);
  }

  /**
   * List POs grouped by po_no — used by the Registrar and Admin views.
   * Aggregate status uses MIN of severity codes (least advanced wins).
   */
  static async listPOs({
    warehouse_id,
    viewer_warehouse_id,
    status,
    search,
    start_date,
    end_date,
    page = 1,
    limit = 50,
  } = {}) {
    await poolConnect;

    const safePage  = Math.max(1, Number(page)  || 1);
    const safeLimit = Math.min(500, Math.max(1, Number(limit) || 50));
    const offset    = (safePage - 1) * safeLimit;

    const countReq = pool.request();
    const countConditions = [];

    if (warehouse_id != null && warehouse_id !== '') {
      countReq.input('warehouse_id', sql.BigInt, Number(warehouse_id));
      countConditions.push('warehouse_id = @warehouse_id');
    }
    if (status && status !== 'All') {
      countReq.input('status', sql.NVarChar, status);
      countConditions.push('status = @status');
    }
    if (search && String(search).trim() !== '') {
      countReq.input('search', sql.NVarChar, `%${String(search).trim()}%`);
      countConditions.push('(po_no LIKE @search OR vendor_name LIKE @search OR pr_no LIKE @search)');
    }
    if (start_date) {
      countReq.input('start_date', sql.Date, start_date);
      countConditions.push('po_date >= @start_date');
    }
    if (end_date) {
      countReq.input('end_date', sql.Date, end_date);
      countConditions.push('po_date <= @end_date');
    }

    const countWhere = countConditions.length ? `WHERE ${countConditions.join(' AND ')}` : '';

    const countRes = await countReq.query(`
      SELECT COUNT(*) AS total
        FROM (
          SELECT po_no
            FROM import_po
            ${countWhere}
           GROUP BY po_no
        ) AS x
    `);
    const total = countRes.recordset[0]?.total || 0;

    const rowsReq = pool.request();
    const conditions = [];

    if (warehouse_id != null && warehouse_id !== '') {
      rowsReq.input('warehouse_id', sql.BigInt, Number(warehouse_id));
      conditions.push('warehouse_id = @warehouse_id');
    }
    if (status && status !== 'All') {
      rowsReq.input('status', sql.NVarChar, status);
      conditions.push('status = @status');
    }
    if (search && String(search).trim() !== '') {
      rowsReq.input('search', sql.NVarChar, `%${String(search).trim()}%`);
      conditions.push('(po_no LIKE @search OR vendor_name LIKE @search OR pr_no LIKE @search)');
    }
    if (start_date) {
      rowsReq.input('start_date', sql.Date, start_date);
      conditions.push('po_date >= @start_date');
    }
    if (end_date) {
      rowsReq.input('end_date', sql.Date, end_date);
      conditions.push('po_date <= @end_date');
    }

    rowsReq.input('offset', sql.Int, offset);
    rowsReq.input('limit',  sql.Int, safeLimit);

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const rowsRes = await rowsReq.query(`
      SELECT po_no,
             MIN(po_date)          AS po_date,
             MAX(pr_no)            AS pr_no,
             MAX(vendor_name)      AS vendor_name,
             MAX(buyer)            AS buyer,
             COUNT(*)              AS line_count,
             SUM(qty * unit_price) AS total_amount,
             CASE MIN(CASE status
               WHEN 'Pending'                THEN 1
               WHEN 'Partial Received'       THEN 2
               WHEN 'Complete'               THEN 3
               WHEN 'Complete (with damage)' THEN 4
               WHEN 'Partial With Handler'   THEN 5
               WHEN 'With Handler'           THEN 6
               WHEN 'Pending Transfer'       THEN 7
               WHEN 'Transferred'            THEN 8
               WHEN 'Stored'                 THEN 9
               ELSE 0
             END)
               WHEN 9 THEN 'Stored'
               WHEN 8 THEN 'Transferred'
               WHEN 7 THEN 'Pending Transfer'
               WHEN 6 THEN 'With Handler'
               WHEN 5 THEN 'Partial With Handler'
               WHEN 4 THEN 'Complete (with damage)'
               WHEN 3 THEN 'Complete'
               WHEN 2 THEN 'Partial Received'
               WHEN 1 THEN 'Pending'
               ELSE 'Pending'
             END AS status,
             MAX(warehouse_id)     AS warehouse_id,
             MIN(imported_by)      AS imported_by,
             MIN(imported_at)      AS imported_at,
             MAX(forwarded_by)     AS forwarded_by,
             MAX(forwarded_at)     AS forwarded_at
        FROM import_po
        ${where}
       GROUP BY po_no
       ORDER BY TRY_CAST(po_no AS BIGINT) DESC, po_no DESC
       OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
    `);

    const rows = rowsRes.recordset;

    const viewerId = viewer_warehouse_id != null && viewer_warehouse_id !== ''
      ? Number(viewer_warehouse_id)
      : null;

    if (!viewerId || rows.length === 0) {
      for (const r of rows) {
        r.my_line_count          = 0;
        r.my_can_forward         = false;
        r.my_has_forwarded       = false;
        r.my_pending_count       = 0;
        r.my_transferable_count  = 0;
      }
      return { rows, total };
    }

    const poNos = [...new Set(rows.map(r => r.po_no))];
    const enrichReq = pool.request();
    enrichReq.input('viewer_warehouse_id', sql.BigInt, viewerId);

    const placeholders = poNos.map((p, i) => {
      enrichReq.input(`p${i}`, sql.NVarChar, p);
      return `@p${i}`;
    }).join(',');

    const enrichRes = await enrichReq.query(`
      SELECT po_no,
             COUNT(*) AS my_line_count,
             SUM(CASE WHEN status IN ('Partial Received', 'Complete', 'Complete (with damage)')
                      THEN 1 ELSE 0 END) AS my_forwardable_count,
             SUM(CASE WHEN status IN ('With Handler', 'Partial With Handler',
                                      'Pending Transfer', 'Transferred', 'Stored')
                      THEN 1 ELSE 0 END) AS my_forwarded_count,
             SUM(CASE WHEN status = 'Pending Transfer'
                      THEN 1 ELSE 0 END) AS my_pending_count,
             SUM(CASE WHEN status IN ('With Handler', 'Partial With Handler')
                      THEN 1 ELSE 0 END) AS my_transferable_count
        FROM import_po
       WHERE po_no IN (${placeholders})
         AND warehouse_id = @viewer_warehouse_id
       GROUP BY po_no
    `);

    const enrichMap = {};
    for (const r of enrichRes.recordset) enrichMap[r.po_no] = r;

    for (const row of rows) {
      const e = enrichMap[row.po_no];
      row.my_line_count         = e ? Number(e.my_line_count)         : 0;
      row.my_can_forward        = e ? Number(e.my_forwardable_count)  > 0 : false;
      row.my_has_forwarded      = e ? Number(e.my_forwarded_count)    > 0 : false;
      row.my_pending_count      = e ? Number(e.my_pending_count)      : 0;
      row.my_transferable_count = e ? Number(e.my_transferable_count) : 0;
    }

    return { rows, total };
  }

  /**
   * NEW: Handler view — one row per item (import_po line) for a
   * specific warehouse, filtered to handler-relevant statuses.
   *
   * Each row is an independent actionable unit. The handler can
   * transfer each item separately, and per-item statuses tell the
   * UI exactly what each item needs.
   */
  static async listHandlerItems({
    warehouse_id,
    status,
    search,
    start_date,
    end_date,
    limit = 500,
  } = {}) {
    await poolConnect;

    if (warehouse_id == null || warehouse_id === '') {
      return [];
    }

    const request = pool.request();
    request.input('warehouse_id', sql.BigInt, Number(warehouse_id));

    const conditions = [
      `warehouse_id = @warehouse_id`,
      `status IN ('With Handler', 'Partial With Handler', 'Pending Transfer', 'Transferred', 'Stored')`,
    ];

    if (status && status !== 'All') {
      request.input('status', sql.NVarChar, status);
      conditions.push('status = @status');
    }
    if (search && String(search).trim() !== '') {
      request.input('search', sql.NVarChar, `%${String(search).trim()}%`);
      conditions.push(
        '(po_no LIKE @search OR item_code LIKE @search OR item_name LIKE @search OR vendor_name LIKE @search OR pr_no LIKE @search)'
      );
    }
    if (start_date) {
      request.input('start_date', sql.Date, start_date);
      conditions.push('po_date >= @start_date');
    }
    if (end_date) {
      request.input('end_date', sql.Date, end_date);
      conditions.push('po_date <= @end_date');
    }

    request.input('limit', sql.Int, Number(limit) || 500);

    const where = conditions.join(' AND ');

    const result = await request.query(`
      SELECT TOP (@limit)
             id, po_date, pr_no, po_no, vendor_name, buyer,
             item_code, item_name, uom, uom_description,
             qty, received_qty, damaged_qty, unit_price, currency,
             status, damage_reason, warehouse_id,
             imported_by, imported_at,
             forwarded_by, forwarded_at
        FROM import_po
       WHERE ${where}
       ORDER BY TRY_CAST(po_no AS BIGINT) DESC, po_no DESC, item_code ASC
    `);

    return result.recordset;
  }

  static async getPODetail(poNo, warehouseId = null) {
    await poolConnect;
    const request = pool.request();
    request.input('po_no', sql.NVarChar, poNo);

    let sqlText = `
      SELECT id, po_date, pr_no, po_no, vendor_name, buyer,
             item_code, item_name, uom, uom_description, barcode,
             gl_class_code, gl_description, purchase_class, category,
             qty, received_qty, damaged_qty, unit_price, currency,
             status, damage_reason, warehouse_id,
             imported_by, imported_at,
             forwarded_by, forwarded_at
        FROM import_po
       WHERE po_no = @po_no
    `;

    if (warehouseId != null && warehouseId !== '') {
      request.input('warehouse_id', sql.BigInt, Number(warehouseId));
      sqlText += ' AND warehouse_id = @warehouse_id';
    }
    sqlText += ' ORDER BY item_code';

    const result = await request.query(sqlText);
    return result.recordset;
  }

  static async receiveLine({
    id,
    incoming_good,
    incoming_dmg,
    damage_reason,
    unit_price,
    currency,
    receiving_warehouse_id = null,
  }) {
    await poolConnect;
    const request = pool.request();
    request.input('id',            sql.BigInt,         id);
    request.input('incoming_good', sql.Decimal(18,4),  incoming_good);
    request.input('incoming_dmg',  sql.Decimal(18,4),  incoming_dmg);
    request.input('damage_reason', sql.NVarChar,       damage_reason || null);
    request.input(
      'new_price',
      sql.Decimal(18,6),
      unit_price != null && unit_price !== '' && !Number.isNaN(Number(unit_price))
        ? Number(unit_price)
        : null
    );
    request.input('new_currency',  sql.NVarChar,       currency || null);
    request.input(
      'receiving_warehouse_id',
      sql.BigInt,
      receiving_warehouse_id != null ? Number(receiving_warehouse_id) : null
    );

    await request.query(`
      UPDATE import_po
         SET received_qty  = received_qty + @incoming_good,
             damaged_qty   = damaged_qty  + @incoming_dmg,
             damage_reason = CASE
               WHEN @incoming_dmg > 0 THEN @damage_reason
               ELSE damage_reason
             END,
             unit_price = COALESCE(@new_price, unit_price),
             currency   = COALESCE(@new_currency, currency),
             warehouse_id = COALESCE(warehouse_id, @receiving_warehouse_id),
             status = CASE
               WHEN (received_qty + @incoming_good + damaged_qty + @incoming_dmg) >= qty
                    THEN IIF(@incoming_dmg > 0, 'Complete (with damage)', 'Complete')
               ELSE 'Partial Received'
             END
       WHERE id = @id
    `);
  }

  static async recomputePOStatus(poNo) {
    await poolConnect;
    const request = pool.request();
    request.input('po_no', sql.NVarChar, poNo);

    await request.query(`
      UPDATE import_po
         SET status = CASE
           WHEN (received_qty + damaged_qty) >= qty
                THEN IIF(damaged_qty > 0, 'Complete (with damage)', 'Complete')
           WHEN (received_qty + damaged_qty) > 0
                THEN 'Partial Received'
           ELSE 'Pending'
         END
       WHERE po_no = @po_no
         AND status IN ('Pending', 'Partial Received', 'Complete', 'Complete (with damage)')
    `);
  }

  static async countForwardableLines(poNo, warehouseId) {
    await poolConnect;
    const request = pool.request();
    request.input('po_no',        sql.NVarChar, poNo);
    request.input('warehouse_id', sql.BigInt,   warehouseId);

    const result = await request.query(`
      SELECT COUNT(*) AS cnt
        FROM import_po
       WHERE po_no = @po_no
         AND warehouse_id = @warehouse_id
         AND status IN ('Partial Received', 'Complete', 'Complete (with damage)')
    `);

    return result.recordset[0]?.cnt || 0;
  }

  static async forwardPOToHandler(poNo, username, warehouseId) {
    await poolConnect;
    const request = pool.request();
    request.input('po_no',        sql.NVarChar, poNo);
    request.input('forwarded_by', sql.NVarChar, username || 'System');
    request.input('warehouse_id', sql.BigInt,   warehouseId);

    const result = await request.query(`
      UPDATE import_po
         SET status = CASE
               WHEN (received_qty + damaged_qty) >= qty
                    THEN 'With Handler'
               ELSE 'Partial With Handler'
             END,
             forwarded_by = @forwarded_by,
             forwarded_at = GETDATE()
       WHERE po_no = @po_no
         AND warehouse_id = @warehouse_id
         AND status IN ('Partial Received', 'Complete', 'Complete (with damage)')
    `);

    return result.rowsAffected[0] || 0;
  }

  static async deletePOIfPending(poNo) {
    await poolConnect;
    const request = pool.request();
    request.input('po_no', sql.NVarChar, poNo);

    const check = await request.query(`
      SELECT COUNT(*) AS not_pending
        FROM import_po
       WHERE po_no = @po_no AND status <> 'Pending'
    `);
    if (check.recordset[0].not_pending > 0) {
      const err = new Error('Cannot delete a PO that has already been received.');
      err.code = 'PO_HAS_RECEIPTS';
      throw err;
    }

    const del = await pool.request()
      .input('po_no', sql.NVarChar, poNo)
      .query(`DELETE FROM import_po WHERE po_no = @po_no`);

    return del.rowsAffected[0] || 0;
  }
}

module.exports = ImportPoModel;