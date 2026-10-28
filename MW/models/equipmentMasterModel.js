// models/equipmentMasterModel.js
const { sql, pool } = require('../db');
const { poolConnect } = require('../db');

class EquipmentMasterModel {
  /**
   * Check if Value or Barcode already exists
   */
  static async checkDuplicate(value, barcode) {
    await poolConnect;
    const request = pool.request();
    request.input('value', sql.Int, value);
    request.input('barcode', sql.NVarChar, barcode);
    const result = await request.query(
      'SELECT Equipment_Code, Value, Barcode FROM equipment_master WHERE Value = @value OR Barcode = @barcode'
    );
    return result.recordset.length > 0 ? result.recordset[0] : null;
  }

  /**
   * Create a new equipment in equipment_master.
   * Equipment_Code and Barcode are auto-generated from Value.
   */
  static async create(data) {
    await poolConnect;
    
    // Auto-generate codes based on the numeric Value
    const generatedCode = `EQ-${data.Value}`;
    
    const request = pool.request();
    request.input('Equipment_Code', sql.NVarChar, generatedCode);
    request.input('Value', sql.Int, data.Value);
    request.input('Description', sql.NVarChar, data.Description.trim());
    request.input('Barcode', sql.NVarChar, generatedCode);
    request.input('Status', sql.NVarChar, data.Status || 'Active');
    request.input('Creation_Date', sql.Date, data.Creation_Date || null);
    request.input('Updated_By', sql.NVarChar, data.Updated_By || null);
    request.input('Updated_At', sql.DateTime, data.Updated_At || new Date());
    request.input('Equipment_Image', sql.VarBinary, data.Equipment_Image || null);

    await request.query(`
      INSERT INTO equipment_master 
      (Equipment_Code, Value, Description, Barcode, Status, Creation_Date, Updated_By, Updated_At, Equipment_Image)
      VALUES 
      (@Equipment_Code, @Value, @Description, @Barcode, @Status, @Creation_Date, @Updated_By, @Updated_At, @Equipment_Image)
    `);

    return { Equipment_Code: generatedCode, Barcode: generatedCode };
  }

  /**
   * Internal — paginated list with optional search pattern.
   */
  static async _paginate({ offset, limit, page, pattern = null }) {
    await poolConnect;

    const countRequest = pool.request();
    const dataRequest = pool.request();
    const where = [];

    // Search pattern across Code, Value, and Description
    if (pattern) {
      countRequest.input('search', sql.NVarChar, pattern);
      dataRequest.input('search', sql.NVarChar, pattern);
      where.push(`(
        Equipment_Code LIKE @search OR
        CAST(Value AS NVARCHAR) LIKE @search OR
        Description LIKE @search
      )`);
    }

    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

    // Count
    const countResult = await countRequest.query(
      `SELECT COUNT(*) AS total FROM equipment_master ${whereClause}`
    );
    const total = countResult.recordset[0].total;

    if (total === 0) {
      return { data: [], total: 0, totalPages: 0, currentPage: page };
    }

    // Data
    dataRequest.input('offset', sql.Int, offset);
    dataRequest.input('limit',  sql.Int, limit);

    const dataResult = await dataRequest.query(`
      SELECT
        Equipment_Code,
        Value,
        Description,
        Barcode,
        Status,
        CONVERT(date, Creation_Date) AS Creation_Date,
        Updated_By,
        Updated_At,
        Equipment_Image
      FROM equipment_master
      ${whereClause}
      ORDER BY Value ASC
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
    `);

    return {
      data: dataResult.recordset,
      total,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
    };
  }

  /**
   * Public — paginated list with two-phase search.
   */
  static async getAll(page = 1, limit = 50, search = '') {
    await poolConnect;
    const offset = (page - 1) * limit;
    const trimmed = (search || '').trim();

    if (!trimmed) {
      return this._paginate({ offset, limit, page, pattern: null });
    }

    // PHASE 1 — fast prefix search
    const prefixPattern = trimmed + '%';
    const fastResult = await this._paginate({
      offset, limit, page, pattern: prefixPattern,
    });
    if (fastResult.total > 0) {
      return fastResult;
    }

    // PHASE 2 — slow substring fallback
    const containsPattern = '%' + trimmed + '%';
    return this._paginate({
      offset, limit, page, pattern: containsPattern,
    });
  }

  /**
   * Get a single equipment by Equipment_Code
   */
  static async getByCode(code) {
    await poolConnect;
    const request = pool.request();
    request.input('code', sql.NVarChar, code);
    const result = await request.query(
      'SELECT * FROM equipment_master WHERE Equipment_Code = @code'
    );
    return result.recordset.length > 0 ? result.recordset[0] : null;
  }

  /**
   * Bulk fetch of Equipment_Image buffers for many codes.
   */
  static async getImagesByCodes(codes = []) {
    await poolConnect;
    const map = {};
    if (!Array.isArray(codes) || codes.length === 0) return map;

    const CHUNK = 500;
    const unique = [...new Set(codes.map(c => String(c).trim()).filter(Boolean))];

    for (let i = 0; i < unique.length; i += CHUNK) {
      const batch = unique.slice(i, i + CHUNK);
      const request = pool.request();
      const placeholders = batch
        .map((code, idx) => {
          request.input(`c${idx}`, sql.NVarChar, code);
          return `@c${idx}`;
        })
        .join(',');

      const result = await request.query(`
        SELECT Equipment_Code, Equipment_Image
          FROM equipment_master
         WHERE Equipment_Code IN (${placeholders})
      `);

      for (const row of result.recordset) {
        map[row.Equipment_Code] = row.Equipment_Image || null;
      }
    }

    return map;
  }

  /**
   * Update an equipment (Value and Code are immutable).
   */
  static async update(code, data) {
    await poolConnect;
    const request = pool.request();
    request.input('code', sql.NVarChar, code);
    request.input('Description', sql.NVarChar, data.Description || '');
    request.input('Status', sql.NVarChar, data.Status || 'Active');
    request.input('Creation_Date', sql.Date, data.Creation_Date || null);
    request.input('Updated_By', sql.NVarChar, data.Updated_By || null);
    request.input('Updated_At', sql.DateTime, new Date());
    request.input('Equipment_Image', sql.VarBinary, data.Equipment_Image || null);

    await request.query(`
      UPDATE equipment_master SET
        Description = @Description,
        Status = @Status,
        Creation_Date = @Creation_Date,
        Updated_By = @Updated_By,
        Updated_At = @Updated_At,
        Equipment_Image = @Equipment_Image
      WHERE Equipment_Code = @code
    `);
  }

  /**
   * Update the status of an equipment
   */
  static async updateStatus(code, status) {
    await poolConnect;
    const request = pool.request();
    request.input('code', sql.NVarChar, code);
    request.input('status', sql.NVarChar, status);
    await request.query(
      'UPDATE equipment_master SET Status = @status WHERE Equipment_Code = @code'
    );
  }

  /**
   * PERMANENT delete of an equipment by Equipment_Code
   */
  static async delete(code) {
    await poolConnect;
    const request = pool.request();
    request.input('code', sql.NVarChar, code);
    await request.query('DELETE FROM equipment_master WHERE Equipment_Code = @code');
  }

  /**
   * Fetch all active equipment for the offline sync payload.
   */
  static async getAllEquipmentForSync() {
    await poolConnect;
    const request = pool.request();
    const result = await request.query(`
      SELECT 
        Equipment_Code, Value, Description, Barcode, Status, Creation_Date, Updated_By, Updated_At
      FROM equipment_master
      WHERE Status = 'Active'
    `);
    return result.recordset;
  }
}

module.exports = EquipmentMasterModel;