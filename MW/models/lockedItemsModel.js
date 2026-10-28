// models/lockedItemsModel.js
const { query, pool, poolConnect, sql } = require('../db');

const CHUNK_SIZE = 500;
const chunk = (arr, size) => {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

const LockedItemsModel = {
  /**
   * Paginated admin list with joins to item_master, warehouse_table,
   * and locator_table for display.
   */
  async list({ warehouse_code, search, is_active, page = 1, limit = 50 } = {}) {
    const safePage  = Math.max(1, Number(page)  || 1);
    const safeLimit = Math.min(500, Math.max(1, Number(limit) || 50));
    const offset    = (safePage - 1) * safeLimit;

    const conditions = [];
    const params = [];

    if (warehouse_code && String(warehouse_code).trim() !== '') {
      conditions.push(`li.warehouse_code = @param${params.length}`);
      params.push(String(warehouse_code).trim());
    }
    if (is_active !== undefined && is_active !== null && is_active !== '') {
      conditions.push(`li.is_active = @param${params.length}`);
      params.push(Number(is_active) ? 1 : 0);
    }
    if (search && String(search).trim() !== '') {
      const s = `%${String(search).trim()}%`;
      conditions.push(
        `(li.item_code LIKE @param${params.length}
          OR im.Item_Description LIKE @param${params.length}
          OR li.warehouse_code LIKE @param${params.length})`
      );
      params.push(s);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const countRes = await query(
      `SELECT COUNT(*) AS total
         FROM locked_items li
         LEFT JOIN item_master im ON im.Item_Code = li.item_code
         ${where}`,
      params
    );
    const total = countRes[0]?.total || 0;

    const listParams = [...params, safeLimit, offset];
    const limIdx = listParams.length - 2;
    const offIdx = listParams.length - 1;

    const rows = await query(
      `SELECT li.id, li.item_code, li.warehouse_code, li.locator_code, li.is_active,
              li.remarks, li.created_at, li.created_by, li.updated_at, li.updated_by,
              im.Item_Description, im.Uom_Code, im.Uom_Description,
              w.warehouse_name, w.status AS warehouse_status,
              lt.description AS locator_description
         FROM locked_items li
         LEFT JOIN item_master im ON im.Item_Code = li.item_code
         LEFT JOIN warehouse_table w ON w.warehouse_code = li.warehouse_code
         LEFT JOIN locator_table lt ON lt.locator_code = li.locator_code
         ${where}
         ORDER BY li.item_code
         OFFSET @param${offIdx} ROWS FETCH NEXT @param${limIdx} ROWS ONLY`,
      listParams
    );

    return { rows, total };
  },

  async getById(id) {
    const rows = await query(
      `SELECT li.*, im.Item_Description, im.Uom_Code, im.Uom_Description,
              w.warehouse_name, lt.description AS locator_description
         FROM locked_items li
         LEFT JOIN item_master im ON im.Item_Code = li.item_code
         LEFT JOIN warehouse_table w ON w.warehouse_code = li.warehouse_code
         LEFT JOIN locator_table lt ON lt.locator_code = li.locator_code
        WHERE li.id = @param0`,
      [id]
    );
    return rows[0] || null;
  },

  async getByItemCode(itemCode) {
    const rows = await query(
      `SELECT * FROM locked_items WHERE item_code = @param0`,
      [itemCode]
    );
    return rows[0] || null;
  },

  /**
   * Bulk lookup used by the import controller.
   * Returns Map<item_code, {warehouse_code, locator_code}>.
   * Only active rows are returned.
   */
  async bulkLookup(itemCodes = []) {
    await poolConnect;
    const map = new Map();
    if (!itemCodes.length) return map;

    const unique = [...new Set(itemCodes.map(c => String(c).trim()).filter(Boolean))];

    for (const batch of chunk(unique, CHUNK_SIZE)) {
      const request = pool.request();
      const placeholders = batch
        .map((c, i) => {
          request.input(`c${i}`, sql.NVarChar, c);
          return `@c${i}`;
        })
        .join(',');

      const result = await request.query(`
        SELECT item_code, warehouse_code, locator_code
          FROM locked_items
         WHERE is_active = 1
           AND item_code IN (${placeholders})
      `);

      for (const r of result.recordset) {
        map.set(String(r.item_code).trim(), {
          warehouse_code: r.warehouse_code,
          locator_code: r.locator_code || null,
        });
      }
    }
    return map;
  },

  async create({ item_code, warehouse_code, locator_code, remarks, created_by }) {
    await query(
      `INSERT INTO locked_items
         (item_code, warehouse_code, locator_code, is_active, remarks, created_by)
       VALUES (@param0, @param1, @param2, 1, @param3, @param4)`,
      [item_code, warehouse_code, locator_code || null, remarks || null, created_by || 'System']
    );
    return this.getByItemCode(item_code);
  },

  async update(id, { warehouse_code, locator_code, remarks, is_active, updated_by }) {
    await query(
      `UPDATE locked_items
          SET warehouse_code = @param0,
              locator_code   = @param1,
              remarks        = @param2,
              is_active      = @param3,
              updated_at     = GETDATE(),
              updated_by     = @param4
        WHERE id = @param5`,
      [
        warehouse_code,
        locator_code || null,
        remarks || null,
        Number(is_active) ? 1 : 0,
        updated_by || 'System',
        id,
      ]
    );
    return this.getById(id);
  },

  async delete(id) {
    await query(`DELETE FROM locked_items WHERE id = @param0`, [id]);
    return true;
  },
};

module.exports = LockedItemsModel;