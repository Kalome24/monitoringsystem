// controllers/equipmentMasterController.js
const EquipmentMasterModel = require('../models/equipmentMasterModel');

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
 * Convert Equipment_Image buffer to base64 data URL for a single record
 */
const convertEquipmentImage = (equipment) => {
  if (equipment && equipment.Equipment_Image) {
    const mimeType = detectMimeType(equipment.Equipment_Image);
    equipment.Equipment_Image = bufferToBase64(equipment.Equipment_Image, mimeType);
  }
  return equipment;
};

/**
 * Create a new equipment in equipment_master.
 * Value, Equipment_Code, and Barcode are tightly coupled.
 */
const createEquipmentMaster = async (req, res) => {
  try {
    const {
      Creation_Date,
      Value,
      Description,
      Status,
      Equipment_Image
    } = req.body;

    // 1. Validate required fields
    if (Value === undefined || Value === null || String(Value).trim() === '') {
      return res.status(400).json({ message: 'Missing required field: Value' });
    }
    if (!Description || Description.toString().trim() === '') {
      return res.status(400).json({ message: 'Missing required field: Description' });
    }

    // 2. Enforce Numeric constraint for Value
    const parsedValue = parseInt(Value, 10);
    if (isNaN(parsedValue) || parsedValue.toString() !== String(Value).trim()) {
      return res.status(400).json({ message: 'Value must be a valid integer number.' });
    }

    // 3. Auto-generate Code and Barcode
    const generatedCode = `EQ-${parsedValue}`;

    // 4. Check for duplicates (Value or Barcode)
    const duplicate = await EquipmentMasterModel.checkDuplicate(parsedValue, generatedCode);
    if (duplicate) {
      if (duplicate.Value === parsedValue) {
        return res.status(409).json({ message: `Value "${parsedValue}" already exists.` });
      }
      if (duplicate.Barcode === generatedCode) {
        return res.status(409).json({ message: `Generated Barcode "${generatedCode}" already exists.` });
      }
    }

    // 5. Handle Image Conversion
    let imageBuffer = null;
    if (Equipment_Image) {
      try {
        const base64Data = Equipment_Image.replace(/^data:image\/\w+;base64,/, '');
        imageBuffer = Buffer.from(base64Data, 'base64');
      } catch (err) {
        console.error('Error decoding image:', err);
        return res.status(400).json({ message: 'Invalid image format' });
      }
    }

    // 6. Prepare data
    const data = {
      Value: parsedValue,
      Description: Description.trim(),
      Status: Status || 'Active',
      Creation_Date: Creation_Date || null,
      Updated_By: req.user ? req.user.username : 'System',
      Equipment_Image: imageBuffer
    };

    const result = await EquipmentMasterModel.create(data);

    res.status(201).json({
      success: true,
      message: 'Equipment successfully created',
      data: { Equipment_Code: result.Equipment_Code, Barcode: result.Barcode }
    });
  } catch (error) {
    console.error('Error creating equipment master:', error);
    res.status(500).json({ message: 'Internal server error', error: error.message });
  }
};

/**
 * Get all equipment with pagination and search.
 */
const getAllEquipmentMasters = async (req, res) => {
  try {
    const page  = parseInt(req.query.page, 10)  || 1;
    const limit = parseInt(req.query.limit, 10) || 50;
    const search = req.query.search || '';

    const result = await EquipmentMasterModel.getAll(page, limit, search);

    // Convert buffers to base64
    const dataWithImages = result.data.map(eq => convertEquipmentImage(eq));

    res.status(200).json({
      success: true,
      data: dataWithImages,
      total: result.total,
      totalPages: result.totalPages,
      currentPage: result.currentPage,
    });
  } catch (error) {
    console.error('Error fetching equipment masters:', error);
    res.status(500).json({ message: 'Internal server error', error: error.message });
  }
};

/**
 * Get a single equipment by Equipment_Code
 */
const getEquipmentMasterByCode = async (req, res) => {
  try {
    const { code } = req.params;
    const equipment = await EquipmentMasterModel.getByCode(code);
    if (!equipment) {
      return res.status(404).json({ message: 'Equipment not found' });
    }
    const equipmentWithImage = convertEquipmentImage(equipment);
    res.status(200).json({ success: true, data: equipmentWithImage });
  } catch (error) {
    console.error('Error fetching equipment:', error);
    res.status(500).json({ message: 'Internal server error', error: error.message });
  }
};

/**
 * Bulk fetch of equipment images for many codes.
 */
const getEquipmentImagesByCodes = async (req, res) => {
  try {
    const { equipment_codes = [] } = req.body;

    if (!Array.isArray(equipment_codes) || equipment_codes.length === 0) {
      return res.status(400).json({ success: false, message: 'No equipment codes provided.' });
    }

    const imageMap = await EquipmentMasterModel.getImagesByCodes(equipment_codes);

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
    console.error('Error fetching equipment images:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
    });
  }
};

/**
 * Update an equipment by Equipment_Code.
 * Value, Equipment_Code, and Barcode are IMMUTABLE.
 */
const updateEquipmentMaster = async (req, res) => {
  try {
    const { code } = req.params;
    const {
      Description,
      Status,
      Creation_Date,
      Equipment_Image,
    } = req.body;

    // Check if exists
    const existing = await EquipmentMasterModel.getByCode(code);
    if (!existing) {
      return res.status(404).json({ message: 'Equipment not found' });
    }

    // Prepare update data
    const updateData = {
      Description: Description || '',
      Status: Status || 'Active',
      Creation_Date: Creation_Date || null,
      Updated_By: req.user ? req.user.username : 'System'
    };

    // Handle Image
    if (Equipment_Image !== undefined) {
      if (Equipment_Image && typeof Equipment_Image === 'string' && Equipment_Image.startsWith('data:image')) {
        try {
          const base64Data = Equipment_Image.replace(/^data:image\/\w+;base64,/, '');
          updateData.Equipment_Image = Buffer.from(base64Data, 'base64');
        } catch (err) {
          return res.status(400).json({ message: 'Invalid image format' });
        }
      } else if (Equipment_Image === null || Equipment_Image === '') {
        updateData.Equipment_Image = null;
      } else {
        updateData.Equipment_Image = Equipment_Image;
      }
    }

    await EquipmentMasterModel.update(code, updateData);

    const updated = await EquipmentMasterModel.getByCode(code);
    const updatedWithImage = convertEquipmentImage(updated);

    res.status(200).json({
      success: true,
      message: 'Equipment updated successfully',
      data: updatedWithImage
    });
  } catch (error) {
    console.error('Error updating equipment:', error);
    res.status(500).json({ message: 'Internal server error', error: error.message });
  }
};

/**
 * Deactivate an equipment
 */
const deactivateEquipmentMaster = async (req, res) => {
  try {
    const { code } = req.params;
    const existing = await EquipmentMasterModel.getByCode(code);
    if (!existing) {
      return res.status(404).json({ message: 'Equipment not found' });
    }
    await EquipmentMasterModel.updateStatus(code, 'Inactive');
    res.status(200).json({ success: true, message: 'Equipment deactivated' });
  } catch (error) {
    console.error('Error deactivating equipment:', error);
    res.status(500).json({ message: 'Internal server error', error: error.message });
  }
};

/**
 * Activate an equipment
 */
const activateEquipmentMaster = async (req, res) => {
  try {
    const { code } = req.params;
    const existing = await EquipmentMasterModel.getByCode(code);
    if (!existing) {
      return res.status(404).json({ message: 'Equipment not found' });
    }
    await EquipmentMasterModel.updateStatus(code, 'Active');
    res.status(200).json({ success: true, message: 'Equipment activated' });
  } catch (error) {
    console.error('Error activating equipment:', error);
    res.status(500).json({ message: 'Internal server error', error: error.message });
  }
};

/**
 * Permanently delete an equipment
 */
const deleteEquipmentMaster = async (req, res) => {
  try {
    const { code } = req.params;

    const existing = await EquipmentMasterModel.getByCode(code);
    if (!existing) {
      return res.status(404).json({
        success: false,
        message: 'Equipment not found'
      });
    }

    await EquipmentMasterModel.delete(code);

    return res.status(200).json({
      success: true,
      message: `Equipment "${code}" permanently deleted.`,
      data: { Equipment_Code: code }
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
          `Cannot delete equipment "${req.params.code}" because it has related records. Please deactivate it instead.`
      });
    }

    console.error('Error deleting equipment:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};

module.exports = {
  createEquipmentMaster,
  getAllEquipmentMasters,
  getEquipmentMasterByCode,
  getEquipmentImagesByCodes,
  updateEquipmentMaster,
  deactivateEquipmentMaster,
  activateEquipmentMaster,
  deleteEquipmentMaster,
};