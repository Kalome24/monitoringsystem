// models/costCenterModel.js
const { sql, pool, poolConnect } = require('../db');

class CostCenterModel {
  static async checkDuplicate(value) {
    await poolConnect;
    const request = pool.request();
    request.input('value', sql.Int, value);
    const result = await request.query(
      'SELECT Cost_Center_Value FROM cost_center_list WHERE Cost_Center_Value = @value'
    );
    return result.recordset.length > 0 ? result.recordset[0] : null;
  }

  static async create(data, actor) {
    await poolConnect;
    const request = pool.request();
    request.input('Cost_Center_Value', sql.Int,      data.Cost_Center_Value);
    request.input('Description',       sql.NVarChar, data.Description || null);
    request.input('Status',            sql.NVarChar, data.Status || 'Active');
    request.input('Creation_Date',     sql.Date,     data.Creation_Date || null);
    request.input('Updated_By',        sql.NVarChar, actor || 'System');

    await request.query(`
      INSERT INTO cost_center_list
        (Cost_Center_Value, [Description],
         Status, Creation_Date, Updated_By, Updated_At)
      VALUES
        (@Cost_Center_Value, @Description,
         @Status, @Creation_Date, @Updated_By, GETDATE())
    `);
  }

  static async _paginate({ offset, limit, page, pattern = null }) {
    await poolConnect;
    const countRequest = pool.request();
    const dataRequest  = pool.request();
    const where = [];

    // LIKE on INT columns requires an explicit CAST — we do it here so
    // the user can type "100" and match Value 1000 or Description
    // "…100 pieces…" in a single query. Table is small (cost centers
    // are typically < 1k rows), so the cast cost is fine.
    if (pattern) {
      countRequest.input('search', sql.NVarChar, pattern);
      dataRequest.input('search',  sql.NVarChar, pattern);
      where.push(`(
        CAST(Cost_Center_Value AS NVARCHAR(20)) LIKE @search OR
        [Description] LIKE @search
      )`);
    }

    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const countResult = await countRequest.query(
      `SELECT COUNT(*) AS total FROM cost_center_list ${whereClause}`
    );
    const total = countResult.recordset[0].total;

    if (total === 0) {
      return { data: [], total: 0, totalPages: 0, currentPage: page };
    }

    dataRequest.input('offset', sql.Int, offset);
    dataRequest.input('limit',  sql.Int, limit);

    const dataResult = await dataRequest.query(`
      SELECT
        Cost_Center_Value, [Description],
        Status, CONVERT(date, Creation_Date) AS Creation_Date,
        Updated_By, Updated_At
      FROM cost_center_list
      ${whereClause}
      ORDER BY Cost_Center_Value
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
    `);

    return {
      data: dataResult.recordset,
      total,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
    };
  }

  static async getAll(page = 1, limit = 50, search = '') {
    await poolConnect;
    const offset  = (page - 1) * limit;
    const trimmed = (search || '').trim();

    if (!trimmed) {
      return this._paginate({ offset, limit, page, pattern: null });
    }

    // Two-phase search same as Item Master:
    //   Phase 1 — prefix (fast)
    //   Phase 2 — substring fallback (only if Phase 1 found nothing)
    const fastResult = await this._paginate({
      offset, limit, page, pattern: trimmed + '%',
    });
    if (fastResult.total > 0) return fastResult;

    return this._paginate({
      offset, limit, page, pattern: '%' + trimmed + '%',
    });
  }

  static async getByValue(value) {
    await poolConnect;
    const request = pool.request();
    request.input('value', sql.Int, value);
    const result = await request.query(
      'SELECT * FROM cost_center_list WHERE Cost_Center_Value = @value'
    );
    return result.recordset.length > 0 ? result.recordset[0] : null;
  }

  static async update(value, data, actor) {
    await poolConnect;
    const request = pool.request();
    request.input('value',             sql.Int,      value);
    request.input('Description',       sql.NVarChar, data.Description || null);
    request.input('Status',            sql.NVarChar, data.Status || 'Active');
    request.input('Creation_Date',     sql.Date,     data.Creation_Date || null);
    request.input('Updated_By',        sql.NVarChar, actor || 'System');

    await request.query(`
      UPDATE cost_center_list SET
        [Description]    = @Description,
        Status           = @Status,
        Creation_Date    = @Creation_Date,
        Updated_By       = @Updated_By,
        Updated_At       = GETDATE()
      WHERE Cost_Center_Value = @value
    `);
  }

  static async updateStatus(value, status, actor) {
    await poolConnect;
    const request = pool.request();
    request.input('value',      sql.Int,      value);
    request.input('status',     sql.NVarChar, status);
    request.input('Updated_By', sql.NVarChar, actor || 'System');
    await request.query(`
      UPDATE cost_center_list
         SET Status     = @status,
             Updated_By = @Updated_By,
             Updated_At = GETDATE()
       WHERE Cost_Center_Value = @value
    `);
  }

  static async delete(value) {
    await poolConnect;
    const request = pool.request();
    request.input('value', sql.Int, value);
    await request.query(
      'DELETE FROM cost_center_list WHERE Cost_Center_Value = @value'
    );
  }
}

module.exports = CostCenterModel;