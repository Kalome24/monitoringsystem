// models/uomConversionModel.js
const { query } = require('../db');

class UomConversionModel {
  /**
   * Get all conversions with pagination and search.
   * We join with item_master to get the descriptions for both Box and Piece items.
   */
  static async getAll(page = 1, limit = 50, search = '') {
    const offset = (page - 1) * limit;
    const params = [];
    let whereClause = 'WHERE 1=1';

    if (search && String(search).trim()) {
      params.push(`%${String(search).trim()}%`);
      whereClause += ` AND (
        c.box_item_code LIKE @param${params.length} OR 
        c.piece_item_code LIKE @param${params.length} OR 
        i_box.Item_Description LIKE @param${params.length} OR 
        i_piece.Item_Description LIKE @param${params.length}
      )`;
    }

    // Count total
    const countRes = await query(`
      SELECT COUNT(*) AS total 
      FROM uom_conversions c
      LEFT JOIN item_master i_box ON i_box.Item_Code = c.box_item_code
      LEFT JOIN item_master i_piece ON i_piece.Item_Code = c.piece_item_code
      ${whereClause}
    `, params);
    
    const total = countRes[0].total;

    if (total === 0) {
      return { data: [], total: 0, totalPages: 0, currentPage: page };
    }

    // Paginate
    params.push(offset);
    const offIdx = params.length - 1;
    params.push(limit);
    const limIdx = params.length - 1;

    const dataRes = await query(`
      SELECT 
        c.conversion_id, 
        c.box_item_code, 
        i_box.Item_Description AS box_description,
        c.piece_item_code, 
        i_piece.Item_Description AS piece_description,
        c.pieces_per_box, 
        c.Status, 
        c.Created_At, 
        c.Updated_By, 
        c.Updated_At
      FROM uom_conversions c
      LEFT JOIN item_master i_box ON i_box.Item_Code = c.box_item_code
      LEFT JOIN item_master i_piece ON i_piece.Item_Code = c.piece_item_code
      ${whereClause}
      ORDER BY c.conversion_id DESC
      OFFSET @param${offIdx} ROWS FETCH NEXT @param${limIdx} ROWS ONLY
    `, params);

    return {
      data: dataRes,
      total,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
    };
  }

  /**
   * Get a single conversion by ID
   */
  static async getById(id) {
    const res = await query(`
      SELECT 
        c.conversion_id, 
        c.box_item_code, 
        i_box.Item_Description AS box_description,
        c.piece_item_code, 
        i_piece.Item_Description AS piece_description,
        c.pieces_per_box, 
        c.Status, 
        c.Created_At, 
        c.Updated_By, 
        c.Updated_At
      FROM uom_conversions c
      LEFT JOIN item_master i_box ON i_box.Item_Code = c.box_item_code
      LEFT JOIN item_master i_piece ON i_piece.Item_Code = c.piece_item_code
      WHERE c.conversion_id = @param0
    `, [id]);
    return res[0] || null;
  }

  /**
   * Create a new conversion
   */
  static async create(data, actor) {
    const res = await query(`
      INSERT INTO uom_conversions 
        (box_item_code, piece_item_code, pieces_per_box, Status, Updated_By, Updated_At)
      OUTPUT INSERTED.conversion_id
      VALUES 
        (@param0, @param1, @param2, @param3, @param4, GETDATE())
    `, [
      data.box_item_code, 
      data.piece_item_code, 
      data.pieces_per_box, 
      data.Status || 'Active', 
      actor
    ]);
    return res[0].conversion_id;
  }

  /**
   * Update an existing conversion
   */
  static async update(id, data, actor) {
    await query(`
      UPDATE uom_conversions
      SET box_item_code = @param0, 
          piece_item_code = @param1, 
          pieces_per_box = @param2, 
          Status = @param3, 
          Updated_By = @param4, 
          Updated_At = GETDATE()
      WHERE conversion_id = @param5
    `, [
      data.box_item_code, 
      data.piece_item_code, 
      data.pieces_per_box, 
      data.Status, 
      actor, 
      id
    ]);
  }

  /**
   * Delete a conversion
   */
  static async delete(id) {
    await query(`DELETE FROM uom_conversions WHERE conversion_id = @param0`, [id]);
  }
}

module.exports = UomConversionModel;