// controllers/itemMasterController.js
const ItemMasterModel = require('../models/itemMasterModel');

/**
 * Convert binary buffer to base64 data URL
 * @param {Buffer} buffer - Binary image data
 * @param {string} mimeType - Optional MIME type (default: image/png)
 * @returns {string|null} - Base64 data URL or null
 */
const bufferToBase64 = (buffer, mimeType = 'image/png') => {
  if (!buffer) return null;
  const base64 = buffer.toString('base64');
  return `data:${mimeType};base64,${base64}`;
};

/**
 * Detect MIME type from buffer (simple detection for common image types)
 */
const detectMimeType = (buffer) => {
  if (!buffer || buffer.length < 4) return 'image/png';
  // JPEG: FF D8 FF
  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
    return 'image/jpeg';
  }
  // PNG: 89 50 4E 47
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
    return 'image/png';
  }
  // GIF: 47 49 46
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
    return 'image/gif';
  }
  // WebP: 52 49 46 46
  if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46) {
    return 'image/webp';
  }
  return 'image/png';
};

/**
 * Convert Item_Image buffer to base64 data URL for a single item
 */
const convertItemImage = (item) => {
  if (item && item.Item_Image) {
    const mimeType = detectMimeType(item.Item_Image);
    item.Item_Image = bufferToBase64(item.Item_Image, mimeType);
  }
  return item;
};

/**
 * Create a new item in item_master
 */
const createItemMaster = async (req, res) => {
  try {
    const {
      Creation_Date,
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
      Barcode,
      Item_Image
    } = req.body;

    // Validate required fields
    const requiredFields = ['Item_Code', 'Item_Description', 'Uom_Code', 'Gl_Class', 'Purchase_Class', 'Category', 'Barcode'];
    for (const field of requiredFields) {
      if (!req.body[field] || req.body[field].toString().trim() === '') {
        return res.status(400).json({ message: `Missing required field: ${field}` });
      }
    }

    // Check for duplicates
    const duplicate = await ItemMasterModel.checkDuplicate(Item_Code, Barcode);
    if (duplicate) {
      if (duplicate.Item_Code === Item_Code) {
        return res.status(409).json({ message: `Item Code "${Item_Code}" already exists.` });
      }
      if (duplicate.Barcode === Barcode) {
        return res.status(409).json({ message: `Barcode "${Barcode}" already exists.` });
      }
    }

    // Convert image from base64 to Buffer if provided
    let imageBuffer = null;
    if (Item_Image) {
      try {
        const base64Data = Item_Image.replace(/^data:image\/\w+;base64,/, '');
        imageBuffer = Buffer.from(base64Data, 'base64');
      } catch (err) {
        console.error('Error decoding image:', err);
        return res.status(400).json({ message: 'Invalid image format' });
      }
    }

    const data = {
      Creation_Date,
      Item_Code: Item_Code.trim(),
      Item_Description: Item_Description.trim(),
      Uom_Code,
      Uom_Description: Uom_Description || '',
      Gl_Class,
      Gl_Description: Gl_Description || '',
      Purchase_Class,
      Category,
      List_Price_Per_Unit,
      Status: Status || 'Active',
      Barcode,
      Item_Image: imageBuffer
    };

    await ItemMasterModel.create(data);

    res.status(201).json({
      success: true,
      message: 'Item successfully created in item_master',
      data: { Item_Code, Barcode }
    });
  } catch (error) {
    console.error('Error creating item master:', error);
    res.status(500).json({ message: 'Internal server error', error: error.message });
  }
};

/**
 * Get all items with pagination, search, and column filters.
 *
 * Query params:
 *   page            (Int,  default 1)
 *   limit           (Int,  default 50)
 *   search          (Str)  → LIKE across Item_Code / Description / Uom / PC / Cat
 *   gl_class        (Int)  → Gl_Class = @gl_class
 *   purchase_class  (Str)  → Purchase_Class = @purchase_class
 *   category        (Str)  → Category = @category
 */
const getAllItemMasters = async (req, res) => {
  try {
    const page  = parseInt(req.query.page, 10)  || 1;
    const limit = parseInt(req.query.limit, 10) || 50;
    const search = req.query.search || '';

    const filters = {
      gl_class:       req.query.gl_class       || '',
      purchase_class: req.query.purchase_class || '',
      category:       req.query.category       || '',
    };

    const result = await ItemMasterModel.getAll(page, limit, search, filters);

    // Convert Item_Image from buffer to base64 for each item
    const dataWithImages = result.data.map(item => convertItemImage(item));

    res.status(200).json({
      success: true,
      data: dataWithImages,
      total: result.total,
      totalPages: result.totalPages,
      currentPage: result.currentPage,
    });
  } catch (error) {
    console.error('Error fetching item masters:', error);
    res.status(500).json({ message: 'Internal server error', error: error.message });
  }
};

/**
 * Distinct filter options for the Item Master filter bar.
 * Returns: { success, data: { gl_classes, purchase_classes, categories } }
 */
const getItemFilterOptions = async (req, res) => {
  try {
    const options = await ItemMasterModel.getFilterOptions();
    res.status(200).json({ success: true, data: options });
  } catch (error) {
    console.error('Error fetching item filter options:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
    });
  }
};

/**
 * Get a single item by Item_Code
 */
const getItemMasterByCode = async (req, res) => {
  try {
    const { itemCode } = req.params;
    const item = await ItemMasterModel.getByItemCode(itemCode);
    if (!item) {
      return res.status(404).json({ message: 'Item not found' });
    }
    // Convert image if present
    const itemWithImage = convertItemImage(item);
    res.status(200).json({ success: true, data: itemWithImage });
  } catch (error) {
    console.error('Error fetching item:', error);
    res.status(500).json({ message: 'Internal server error', error: error.message });
  }
};

/**
 * Bulk fetch of item images for many item codes.
 *
 * POST /api/item-master/images
 * Body: { item_codes: ["CODE-1", "CODE-2", ...] }
 * Returns: {
 *   success: true,
 *   images: {
 *     "CODE-1": "data:image/png;base64,..." | null,
 *     "CODE-2": null,
 *     ...
 *   }
 * }
 */
const getItemImagesByCodes = async (req, res) => {
  try {
    const { item_codes = [] } = req.body;

    if (!Array.isArray(item_codes) || item_codes.length === 0) {
      return res.status(400).json({ success: false, message: 'No item codes provided.' });
    }

    const imageMap = await ItemMasterModel.getImagesByCodes(item_codes);

    const images = {};
    for (const [code, buf] of Object.entries(imageMap)) {
      if (buf && Buffer.isBuffer(buf) && buf.length > 0) {
        const mimeType = detectMimeType(buf);
        images[code] = bufferToBase64(buf, mimeType);
      } else {
        images[code] = null;
      }
    }

    return res.status(200).json({ success: true, images });
  } catch (error) {
    console.error('Error fetching item images:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
    });
  }
};

/**
 * Update an item by Item_Code
 * Supports updating Item_Image as well
 */
const updateItemMaster = async (req, res) => {
  try {
    const { itemCode } = req.params;
    const {
      Item_Description,
      Uom_Code,
      Uom_Description,
      Gl_Class,
      Gl_Description,
      Purchase_Class,
      Category,
      List_Price_Per_Unit,
      Status,
      Creation_Date,
      Item_Image,  // base64 string or null
    } = req.body;

    // Check if item exists
    const existing = await ItemMasterModel.getByItemCode(itemCode);
    if (!existing) {
      return res.status(404).json({ message: 'Item not found' });
    }

    // Prepare update data
    const updateData = {
      Item_Description: Item_Description || '',
      Uom_Code: Uom_Code || '',
      Uom_Description: Uom_Description || '',
      Gl_Class: parseInt(Gl_Class) || 0,
      Gl_Description: Gl_Description || '',
      Purchase_Class: Purchase_Class || '',
      Category: Category || '',
      List_Price_Per_Unit: parseFloat(List_Price_Per_Unit) || 0,
      Status: Status || 'Active',
      Creation_Date: Creation_Date || null,
    };

    // Handle Item_Image
    if (Item_Image !== undefined) {
      if (Item_Image && typeof Item_Image === 'string' && Item_Image.startsWith('data:image')) {
        // New image provided - convert from base64
        try {
          const base64Data = Item_Image.replace(/^data:image\/\w+;base64,/, '');
          updateData.Item_Image = Buffer.from(base64Data, 'base64');
        } catch (err) {
          console.error('Error decoding image:', err);
          return res.status(400).json({ message: 'Invalid image format' });
        }
      } else if (Item_Image === null || Item_Image === '') {
        // Explicitly remove image
        updateData.Item_Image = null;
      } else {
        // If Item_Image is something else (like already a Buffer), just pass it through
        updateData.Item_Image = Item_Image;
      }
    }
    // If Item_Image is undefined, we don't update it (keep existing)

    await ItemMasterModel.update(itemCode, updateData);

    // Fetch updated item to return
    const updated = await ItemMasterModel.getByItemCode(itemCode);
    const updatedWithImage = convertItemImage(updated);

    res.status(200).json({
      success: true,
      message: 'Item updated successfully',
      data: updatedWithImage
    });
  } catch (error) {
    console.error('Error updating item:', error);
    res.status(500).json({ message: 'Internal server error', error: error.message });
  }
};

/**
 * Deactivate an item (set Status = 'Inactive')
 */
const deactivateItemMaster = async (req, res) => {
  try {
    const { itemCode } = req.params;
    const existing = await ItemMasterModel.getByItemCode(itemCode);
    if (!existing) {
      return res.status(404).json({ message: 'Item not found' });
    }
    await ItemMasterModel.updateStatus(itemCode, 'Inactive');
    res.status(200).json({ success: true, message: 'Item deactivated' });
  } catch (error) {
    console.error('Error deactivating item:', error);
    res.status(500).json({ message: 'Internal server error', error: error.message });
  }
};

/**
 * Activate an item (set Status = 'Active')
 */
const activateItemMaster = async (req, res) => {
  try {
    const { itemCode } = req.params;
    const existing = await ItemMasterModel.getByItemCode(itemCode);
    if (!existing) {
      return res.status(404).json({ message: 'Item not found' });
    }
    await ItemMasterModel.updateStatus(itemCode, 'Active');
    res.status(200).json({ success: true, message: 'Item activated' });
  } catch (error) {
    console.error('Error activating item:', error);
    res.status(500).json({ message: 'Internal server error', error: error.message });
  }
};

/**
 * Permanently delete an item from item_master
 * ⚠️ Irreversible. Refuses to delete if the item is referenced by other tables.
 */
const deleteItemMaster = async (req, res) => {
  try {
    const { itemCode } = req.params;

    // 1. Confirm item exists
    const existing = await ItemMasterModel.getByItemCode(itemCode);
    if (!existing) {
      return res.status(404).json({
        success: false,
        message: 'Item not found'
      });
    }

    // 2. Attempt permanent delete
    await ItemMasterModel.delete(itemCode);

    return res.status(200).json({
      success: true,
      message: `Item "${itemCode}" permanently deleted.`,
      data: { Item_Code: itemCode }
    });
  } catch (error) {
    // SQL Server FK constraint violation = error number 547
    const isFkViolation =
      error?.number === 547 ||
      error?.originalError?.number === 547 ||
      (typeof error?.message === 'string' && error.message.includes('REFERENCE constraint'));

    if (isFkViolation) {
      return res.status(409).json({
        success: false,
        message:
          `Cannot delete item "${req.params.itemCode}" because it has related records ` +
          `(received, released, damaged, or transferred). Please deactivate it instead.`
      });
    }

    console.error('Error deleting item:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};

module.exports = {
  createItemMaster,
  getAllItemMasters,
  getItemFilterOptions,
  getItemMasterByCode,
  getItemImagesByCodes,
  updateItemMaster,
  deactivateItemMaster,
  activateItemMaster,
  deleteItemMaster,
};