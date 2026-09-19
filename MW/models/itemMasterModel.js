// models/itemMasterModel.js
const { sql, pool } = require('../db');
const { poolConnect } = require('../db');

class ItemMasterModel {
  /**
   * Check if Item_Code or Barcode already exists
   */
  static async checkDuplicate(itemCode, barcode) {
    await poolConnect;
    const request = pool.request();
    request.input('itemCode', sql.NVarChar, itemCode);
    request.input('barcode', sql.NVarChar, barcode);
    const result = await request.query(
      'SELECT Item_Code, Barcode FROM item_master WHERE Item_Code = @itemCode OR Barcode = @barcode'
    );
    return result.recordset.length > 0 ? result.recordset[0] : null;
  }

  /**
   * Create a new item in item_master
   */
  static async create(data) {
    await poolConnect;
    const request = pool.request();
    request.input('Creation_Date', sql.Date, data.Creation_Date || null);
    request.input('Item_Code', sql.NVarChar, data.Item_Code.trim());
    request.input('Item_Description', sql.NVarChar, data.Item_Description.trim());
    request.input('Uom_Code', sql.NVarChar, data.Uom_Code);
    request.input('Uom_Description', sql.NVarChar, data.Uom_Description || '');
    request.input('Gl_Class', sql.Int, parseInt(data.Gl_Class) || 0);
    request.input('Gl_Description', sql.NVarChar, data.Gl_Description || '');
    request.input('Purchase_Class', sql.NVarChar, data.Purchase_Class);
    request.input('Category', sql.NVarChar, data.Category);
    request.input('List_Price_Per_Unit', sql.Decimal(18, 10), parseFloat(data.List_Price_Per_Unit) || 0);
    request.input('Status', sql.NVarChar, data.Status || 'Active');
    request.input('Barcode', sql.NVarChar, data.Barcode);
    request.input('Item_Image', sql.VarBinary, data.Item_Image || null);

    await request.query(`
      INSERT INTO item_master 
      (Creation_Date, Item_Code, Item_Description, Uom_Code, Uom_Description, Gl_Class, Gl_Description, Purchase_Class, Category, List_Price_Per_Unit, Status, Barcode, Item_Image)
      VALUES 
      (@Creation_Date, @Item_Code, @Item_Description, @Uom_Code, @Uom_Description, @Gl_Class, @Gl_Description, @Purchase_Class, @Category, @List_Price_Per_Unit, @Status, @Barcode, @Item_Image)
    `);
  }

  /**
   * Get all item_master records with pagination and search
   * @param {number} page - page number (1-indexed)
   * @param {number} limit - items per page
   * @param {string} search - optional search term
   * @returns {Promise<{ data: Array, total: number, totalPages: number }>}
   */
  static async getAll(page = 1, limit = 50, search = '') {
    await poolConnect;
    const offset = (page - 1) * limit;

    let whereClause = '';
    let searchParam = null;
    if (search && search.trim() !== '') {
      searchParam = `%${search.trim()}%`;
      whereClause = `
        WHERE 
          Item_Code LIKE @search 
          OR Item_Description LIKE @search 
          OR Uom_Code LIKE @search 
          OR Purchase_Class LIKE @search 
          OR Category LIKE @search
      `;
    }

    const countQuery = `SELECT COUNT(*) AS total FROM item_master ${whereClause}`;
    const countRequest = pool.request();
    if (searchParam) {
      countRequest.input('search', sql.NVarChar, searchParam);
    }
    const countResult = await countRequest.query(countQuery);
    const total = countResult.recordset[0].total;
    const totalPages = Math.ceil(total / limit);

    // Include Item_Image in SELECT
    const dataQuery = `
      SELECT 
        Item_Code,
        Item_Description,
        Uom_Code,
        Uom_Description,
        Gl_Class,
        Gl_Description,
        Purchase_Class,
        Category,
        List_Price_Per_Unit,
        Status,
        CONVERT(date, Creation_Date) AS Creation_Date,
        Barcode,
        Item_Image
      FROM item_master
      ${whereClause}
      ORDER BY Item_Code
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
    `;

    const dataRequest = pool.request();
    dataRequest.input('offset', sql.Int, offset);
    dataRequest.input('limit', sql.Int, limit);
    if (searchParam) {
      dataRequest.input('search', sql.NVarChar, searchParam);
    }
    const dataResult = await dataRequest.query(dataQuery);

    return {
      data: dataResult.recordset,
      total,
      totalPages,
      currentPage: page,
    };
  }

  /**
   * Get a single item by Item_Code
   */
  static async getByItemCode(itemCode) {
    await poolConnect;
    const request = pool.request();
    request.input('itemCode', sql.NVarChar, itemCode);
    const result = await request.query(
      'SELECT * FROM item_master WHERE Item_Code = @itemCode'
    );
    return result.recordset.length > 0 ? result.recordset[0] : null;
  }

  /**
   * Bulk fetch of Item_Image buffers for many item codes.
   * Returns { item_code: Buffer|null }
   * Chunks at 500 to stay under SQL Server's 2100 parameter limit.
   */
  static async getImagesByCodes(itemCodes = []) {
    await poolConnect;
    const map = {};
    if (!Array.isArray(itemCodes) || itemCodes.length === 0) return map;

    const CHUNK = 500;
    const unique = [...new Set(itemCodes.map(c => String(c).trim()).filter(Boolean))];

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
        SELECT Item_Code, Item_Image
          FROM item_master
         WHERE Item_Code IN (${placeholders})
      `);

      for (const row of result.recordset) {
        map[row.Item_Code] = row.Item_Image || null;
      }
    }

    return map;
  }

  /**
   * Update an item (all fields except Item_Code and Barcode)
   * Now supports Item_Image update as well
   */
  static async update(itemCode, data) {
    await poolConnect;
    const request = pool.request();
    request.input('itemCode', sql.NVarChar, itemCode);
    request.input('Item_Description', sql.NVarChar, data.Item_Description || '');
    request.input('Uom_Code', sql.NVarChar, data.Uom_Code || '');
    request.input('Uom_Description', sql.NVarChar, data.Uom_Description || '');
    request.input('Gl_Class', sql.Int, parseInt(data.Gl_Class) || 0);
    request.input('Gl_Description', sql.NVarChar, data.Gl_Description || '');
    request.input('Purchase_Class', sql.NVarChar, data.Purchase_Class || '');
    request.input('Category', sql.NVarChar, data.Category || '');
    request.input('List_Price_Per_Unit', sql.Decimal(18, 10), parseFloat(data.List_Price_Per_Unit) || 0);
    request.input('Status', sql.NVarChar, data.Status || 'Active');
    request.input('Creation_Date', sql.Date, data.Creation_Date || null);
    request.input('Item_Image', sql.VarBinary, data.Item_Image || null);

    await request.query(`
      UPDATE item_master SET
        Item_Description = @Item_Description,
        Uom_Code = @Uom_Code,
        Uom_Description = @Uom_Description,
        Gl_Class = @Gl_Class,
        Gl_Description = @Gl_Description,
        Purchase_Class = @Purchase_Class,
        Category = @Category,
        List_Price_Per_Unit = @List_Price_Per_Unit,
        Status = @Status,
        Creation_Date = @Creation_Date,
        Item_Image = @Item_Image
      WHERE Item_Code = @itemCode
    `);
  }

  /**
   * Update the status of an item
   */
  static async updateStatus(itemCode, status) {
    await poolConnect;
    const request = pool.request();
    request.input('itemCode', sql.NVarChar, itemCode);
    request.input('status', sql.NVarChar, status);
    await request.query(
      'UPDATE item_master SET Status = @status WHERE Item_Code = @itemCode'
    );
  }

  /**
   * PERMANENT delete of an item by Item_Code
   * ⚠️ Irreversible. May throw if related records exist (FK constraint).
   */
  static async delete(itemCode) {
    await poolConnect;
    const request = pool.request();
    request.input('itemCode', sql.NVarChar, itemCode);
    await request.query('DELETE FROM item_master WHERE Item_Code = @itemCode');
  }
}

module.exports = ItemMasterModel;