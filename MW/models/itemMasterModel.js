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
   * ---------------------------------------------------------------------------
   * Internal — paginated list with optional search pattern and column filters.
   * Both the COUNT and the DATA query receive the same WHERE clause, so the
   * total always matches the visible page count.
   *
   * Supported filters:
   *   gl_class        → Gl_Class = @gl_class (Int)
   *   purchase_class  → Purchase_Class = @purchase_class (NVarChar)
   *   category        → Category = @category (NVarChar)
   * ---------------------------------------------------------------------------
   */
  static async _paginate({ offset, limit, page, pattern = null, filters = {} }) {
    await poolConnect;

    const countRequest = pool.request();
    const dataRequest = pool.request();
    const where = [];

    // ---------- Search pattern (prefix or substring, chosen by the caller) ----
    if (pattern) {
      countRequest.input('search', sql.NVarChar, pattern);
      dataRequest.input('search', sql.NVarChar, pattern);
      where.push(`(
        Item_Code        LIKE @search OR
        Item_Description LIKE @search OR
        Uom_Code         LIKE @search OR
        Purchase_Class   LIKE @search OR
        Category         LIKE @search
      )`);
    }

    // ---------- GL Class ------------------------------------------------------
    if (
      filters.gl_class != null &&
      filters.gl_class !== '' &&
      filters.gl_class !== 'All'
    ) {
      const glVal = parseInt(filters.gl_class, 10);
      if (!Number.isNaN(glVal)) {
        countRequest.input('gl_class', sql.Int, glVal);
        dataRequest.input('gl_class', sql.Int, glVal);
        where.push('Gl_Class = @gl_class');
      }
    }

    // ---------- Purchase Class ------------------------------------------------
    if (
      filters.purchase_class != null &&
      filters.purchase_class !== '' &&
      filters.purchase_class !== 'All'
    ) {
      const pcVal = String(filters.purchase_class).trim();
      if (pcVal) {
        countRequest.input('purchase_class', sql.NVarChar, pcVal);
        dataRequest.input('purchase_class', sql.NVarChar, pcVal);
        where.push('Purchase_Class = @purchase_class');
      }
    }

    // ---------- Category ------------------------------------------------------
    if (
      filters.category != null &&
      filters.category !== '' &&
      filters.category !== 'All'
    ) {
      const catVal = String(filters.category).trim();
      if (catVal) {
        countRequest.input('category', sql.NVarChar, catVal);
        dataRequest.input('category', sql.NVarChar, catVal);
        where.push('Category = @category');
      }
    }

    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

    // ---------- Count ---------------------------------------------------------
    const countResult = await countRequest.query(
      `SELECT COUNT(*) AS total FROM item_master ${whereClause}`
    );
    const total = countResult.recordset[0].total;

    if (total === 0) {
      return { data: [], total: 0, totalPages: 0, currentPage: page };
    }

    // ---------- Data ----------------------------------------------------------
    dataRequest.input('offset', sql.Int, offset);
    dataRequest.input('limit',  sql.Int, limit);

    const dataResult = await dataRequest.query(`
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
    `);

    return {
      data: dataResult.recordset,
      total,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
    };
  }

  /**
   * ---------------------------------------------------------------------------
   * Public — paginated list with optional search and filters.
   *
   * Two-phase search strategy (unchanged):
   *
   *   PHASE 1 — Prefix search `'term%'`. Uses the clustered PK index.
   *   PHASE 2 — Fallback to substring `'%term%'` when PHASE 1 returned nothing.
   *
   * Filters are ANDed into both phases, so search + GL + Purchase Class +
   * Category all combine into a single WHERE clause.
   * ---------------------------------------------------------------------------
   */
  static async getAll(page = 1, limit = 50, search = '', filters = {}) {
    await poolConnect;
    const offset = (page - 1) * limit;
    const trimmed = (search || '').trim();

    // No search term — straight paginated list with filters.
    if (!trimmed) {
      return this._paginate({ offset, limit, page, pattern: null, filters });
    }

    // PHASE 1 — fast prefix search + filters.
    const prefixPattern = trimmed + '%';
    const fastResult = await this._paginate({
      offset, limit, page, pattern: prefixPattern, filters,
    });
    if (fastResult.total > 0) {
      return fastResult;
    }

    // PHASE 2 — slow substring fallback (only if PHASE 1 found nothing).
    const containsPattern = '%' + trimmed + '%';
    return this._paginate({
      offset, limit, page, pattern: containsPattern, filters,
    });
  }

  /**
   * ---------------------------------------------------------------------------
   * Distinct filter options for the Item Master filter bar.
   * Returns GL classes (with descriptions), Purchase Classes, and Categories.
   *
   * These are deliberately unfiltered — the dropdown always shows the full
   * universe of values so the user can switch between them freely.
   * ---------------------------------------------------------------------------
   */
  static async getFilterOptions() {
    await poolConnect;

    const [glRes, pcRes, catRes] = await Promise.all([
      pool.request().query(`
        SELECT DISTINCT Gl_Class, Gl_Description
          FROM item_master
         WHERE Gl_Class IS NOT NULL
         ORDER BY Gl_Class
      `),
      pool.request().query(`
        SELECT DISTINCT Purchase_Class
          FROM item_master
         WHERE Purchase_Class IS NOT NULL
           AND LTRIM(RTRIM(Purchase_Class)) <> ''
         ORDER BY Purchase_Class
      `),
      pool.request().query(`
        SELECT DISTINCT Category
          FROM item_master
         WHERE Category IS NOT NULL
           AND LTRIM(RTRIM(Category)) <> ''
         ORDER BY Category
      `),
    ]);

    return {
      gl_classes: glRes.recordset.map((r) => ({
        value: String(r.Gl_Class),
        label: r.Gl_Description
          ? `${r.Gl_Class} — ${r.Gl_Description}`
          : String(r.Gl_Class),
      })),
      purchase_classes: pcRes.recordset.map((r) => r.Purchase_Class),
      categories:       catRes.recordset.map((r) => r.Category),
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

  /**
   * ▸ NEW — Fetch all items for the offline sync payload.
   */
  static async getAllItemsForSync() {
    await poolConnect;
    const request = pool.request();
    const result = await request.query(`
      SELECT 
        Item_Code, Item_Description, Uom_Code, Uom_Description,
        Gl_Class, Gl_Description, Purchase_Class, Category,
        List_Price_Per_Unit, Status, Barcode, Creation_Date
      FROM item_master
      WHERE Status = 'Active'
    `);
    return result.recordset;
  }
}

module.exports = ItemMasterModel;