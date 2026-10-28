// src/hooks/useAdminData.js
import { useState, useEffect, useRef, useMemo } from 'react';
import { 
  userApi, 
  warehouseApi, 
  masterApi, 
  itemMasterApi, 
  equipmentMasterApi,
  uomConversionApi,          // ← ADDED
  costCenterApi, 
  damagedItemsApi 
} from '../services/api';
import { getUser } from '../secure/auth';
import { useToast } from '../components/shared/ToastProvider';
import JsBarcode from 'jsbarcode';
import * as XLSX from 'xlsx';

export const useAdminData = () => {
  const currentUser = getUser();
  const toast = useToast();

  // ---------- Double-submit guard ----------
  const inFlightRef = useRef(new Set());
  const beginFlight = (key) => {
    if (inFlightRef.current.has(key)) return false;
    inFlightRef.current.add(key);
    return true;
  };
  const endFlight = (key) => {
    inFlightRef.current.delete(key);
  };

  // ---------- Stats ----------
  const [stats, setStats] = useState({
    totalUsers: 0,
    totalAddedItems: 0,
    activeUsers: 0,
    deactivatedUsers: 0,
    totalWarehouses: 0,
    itemsAddedToday: 0,
    itemsAddedThisMonth: 0,
    itemsReleasedToday: 0,
    totalReleasesThisMonth: 0,
    totalDamagedItems: 0,
  });

  // ---------- Damaged-items registry ----------
  const [damagedItemsCount, setDamagedItemsCount] = useState(0);

  // ---------- Chart data ----------
  const [itemsMonthData, setItemsMonthData] = useState({
    labels: ['Week 1', 'Week 2', 'Week 3', 'Week 4'],
    values: [0, 0, 0, 0]
  });
  const [releasesMonthData, setReleasesMonthData] = useState({
    labels: ['Week 1', 'Week 2', 'Week 3', 'Week 4'],
    values: [0, 0, 0, 0]
  });
  const [yearlyData, setYearlyData] = useState({
    labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
    received: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    released: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
  });

  // ---------- Users & Warehouses ----------
  const [users, setUsers] = useState([]);
  const [warehouses, setWarehouses] = useState([]);

  // ---------- Legacy items & releases ----------
  const [addedItems, setAddedItems] = useState([]);
  const [releaseRecords, setReleaseRecords] = useState([]);
  const [dailyItems, setDailyItems] = useState([]);
  const [dailyReleases, setDailyReleases] = useState([]);

  // ---------- Master lists (UOM, GL, PC, Cat) ----------
  const [glList, setGlList] = useState([]);
  const [uomList, setUomList] = useState([]);
  const [purchaseClassList, setPurchaseClassList] = useState([]);
  const [categoryList, setCategoryList] = useState([]);

  // ---------- Item Master records ----------
  const [itemMasterRecords, setItemMasterRecords] = useState([]);
  const [itemMasterLoading, setItemMasterLoading] = useState(false);
  const [itemMasterCurrentPage, setItemMasterCurrentPage] = useState(1);
  const [itemMasterTotalPages, setItemMasterTotalPages] = useState(1);
  const [itemMasterTotalCount, setItemMasterTotalCount] = useState(0);
  const [itemMasterSearchTerm, setItemMasterSearchTerm] = useState('');
  const ITEMS_PER_PAGE_MASTER = 50;

  // ---------- Item Master column filters ----------
  const [itemMasterGlFilter, setItemMasterGlFilter] = useState('All');
  const [itemMasterPurchaseClassFilter, setItemMasterPurchaseClassFilter] = useState('All');
  const [itemMasterCategoryFilter, setItemMasterCategoryFilter] = useState('All');
  const [itemMasterFilterOptions, setItemMasterFilterOptions] = useState({
    gl_classes: [],
    purchase_classes: [],
    categories: [],
  });

  // ---------- Equipment Master records ----------
  const [equipmentMasterRecords, setEquipmentMasterRecords] = useState([]);
  const [equipmentMasterLoading, setEquipmentMasterLoading] = useState(false);
  const [equipmentMasterCurrentPage, setEquipmentMasterCurrentPage] = useState(1);
  const [equipmentMasterTotalPages, setEquipmentMasterTotalPages] = useState(1);
  const [equipmentMasterTotalCount, setEquipmentMasterTotalCount] = useState(0);
  const [equipmentMasterSearchTerm, setEquipmentMasterSearchTerm] = useState('');
  
  const [showCreateEquipmentForm, setShowCreateEquipmentForm] = useState(false);
  const [newEquipment, setNewEquipment] = useState({
    Value: '',
    Description: '',
    Status: 'Active',
    Creation_Date: new Date().toISOString().split('T')[0],
    Barcode: '',
  });
  const [newEquipmentImageFile, setNewEquipmentImageFile] = useState(null);
  const [newEquipmentImagePreview, setNewEquipmentImagePreview] = useState(null);
  
  const [showEditEquipmentModal, setShowEditEquipmentModal] = useState(false);
  const [editEquipmentData, setEditEquipmentData] = useState({
    Equipment_Code: '',
    Value: '',
    Description: '',
    Status: 'Active',
    Creation_Date: '',
    Barcode: '',
    Equipment_Image: '',
  });
  const [editEquipmentImageFile, setEditEquipmentImageFile] = useState(null);
  const [editEquipmentImagePreview, setEditEquipmentImagePreview] = useState(null);
  
  const equipmentBarcodeCanvasRef = useRef(null);
  const equipmentBarcodeImageRef = useRef(null);

  // ---------- UOM Conversions ----------    ← ADDED
  const [uomConversionRecords, setUomConversionRecords] = useState([]);
  const [uomConversionLoading, setUomConversionLoading] = useState(false);
  const [uomConversionCurrentPage, setUomConversionCurrentPage] = useState(1);
  const [uomConversionTotalPages, setUomConversionTotalPages] = useState(1);
  const [uomConversionTotalCount, setUomConversionTotalCount] = useState(0);
  const [uomConversionSearchTerm, setUomConversionSearchTerm] = useState('');
  const [uomConversionItemOptions, setUomConversionItemOptions] = useState([]);
  const [showCreateUomConversionForm, setShowCreateUomConversionForm] = useState(false);
  const [newUomConversion, setNewUomConversion] = useState({
    box_item_code: '',
    piece_item_code: '',
    pieces_per_box: '',
    Status: 'Active',
  });
  const [showEditUomConversionModal, setShowEditUomConversionModal] = useState(false);
  const [editUomConversionData, setEditUomConversionData] = useState({
    conversion_id: null,
    box_item_code: '',
    piece_item_code: '',
    pieces_per_box: '',
    Status: 'Active',
  });

  // ---------- Cost Center records ----------
  const [costCenterRecords, setCostCenterRecords] = useState([]);
  const [costCenterLoading, setCostCenterLoading] = useState(false);
  const [costCenterCurrentPage, setCostCenterCurrentPage] = useState(1);
  const [costCenterTotalPages, setCostCenterTotalPages] = useState(1);
  const [costCenterTotalCount, setCostCenterTotalCount] = useState(0);
  const [costCenterSearchTerm, setCostCenterSearchTerm] = useState('');
  const [showCreateCostCenterForm, setShowCreateCostCenterForm] = useState(false);
  const [newCostCenter, setNewCostCenter] = useState({
    Cost_Center_Value: '',
    Description: '',
    Status: 'Active',
    Creation_Date: new Date().toISOString().split('T')[0],
  });
  const [showEditCostCenterModal, setShowEditCostCenterModal] = useState(false);
  const [editCostCenterData, setEditCostCenterData] = useState({
    Cost_Center_Value: '',
    Description: '',
    Status: 'Active',
    Creation_Date: '',
  });

  // ---------- Dashboard preview ----------
  const [dashboardItems, setDashboardItems] = useState([]);
  const [dashboardTotalCount, setDashboardTotalCount] = useState(0);
  const [dashboardItemIndex, setDashboardItemIndex] = useState(0);

  // ---------- Loading ----------
  const [fetching, setFetching] = useState(true);
  const [loading, setLoading] = useState(false);

  // ---------- Highlighted class (pie chart) ----------
  const [highlightedClass, setHighlightedClass] = useState(null);

  // ---------- Create Item form state ----------
  const [showCreateItemForm, setShowCreateItemForm] = useState(false);
  const [newAdminItem, setNewAdminItem] = useState({
    Item_Code: '',
    Item_Description: '',
    Uom_Code: '',
    Uom_Description: '',
    Gl_Class: '',
    Gl_Description: '',
    Purchase_Class: '',
    Category: '',
    List_Price_Per_Unit: 0.00,
    Status: 'Active',
    Creation_Date: new Date().toISOString().split('T')[0],
    Barcode: '',
  });
  const [newAdminItemImage, setNewAdminItemImage] = useState(null);
  const [newAdminItemImagePreview, setNewAdminItemImagePreview] = useState(null);
  const barcodeCanvasRef = useRef(null);
  const barcodeImageRef = useRef(null);

  // ---------- Edit Master modal ----------
  const [showEditMasterModal, setShowEditMasterModal] = useState(false);
  const [editMasterData, setEditMasterData] = useState({
    Item_Code: '',
    Item_Description: '',
    Uom_Code: '',
    Uom_Description: '',
    Gl_Class: '',
    Gl_Description: '',
    Purchase_Class: '',
    Category: '',
    List_Price_Per_Unit: 0,
    Status: 'Active',
    Creation_Date: '',
    Barcode: '',
    Item_Image: '',
  });
  const [editMasterImageFile, setEditMasterImageFile] = useState(null);
  const [editMasterImagePreview, setEditMasterImagePreview] = useState(null);

  // ---------- Detail modal ----------
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [detailItem, setDetailItem] = useState(null);

  // ---------- Master data pagination & search ----------
  const [glSearch, setGlSearch] = useState('');
  const [glPage, setGlPage] = useState(1);
  const [uomSearch, setUomSearch] = useState('');
  const [uomPage, setUomPage] = useState(1);
  const [purchaseClassSearch, setPurchaseClassSearch] = useState('');
  const [purchaseClassPage, setPurchaseClassPage] = useState(1);
  const [categorySearch, setCategorySearch] = useState('');
  const [categoryPage, setCategoryPage] = useState(1);
  const ITEMS_PER_PAGE = 10;

  // ---------- Master add/edit modals ----------
  const [showAddGl, setShowAddGl] = useState(false);
  const [newGl, setNewGl] = useState({ number: '', description: '' });
  const [showAddUom, setShowAddUom] = useState(false);
  const [newUom, setNewUom] = useState({ code: '', description: '' });
  const [showAddPurchaseClass, setShowAddPurchaseClass] = useState(false);
  const [newPurchaseClass, setNewPurchaseClass] = useState({ name: '' });
  const [showAddCategory, setShowAddCategory] = useState(false);
  const [newCategory, setNewCategory] = useState({ name: '' });

  const [showEditGl, setShowEditGl] = useState(false);
  const [editGlData, setEditGlData] = useState({ id: '', description: '', status: 'Active' });
  const [showEditUom, setShowEditUom] = useState(false);
  const [editUomData, setEditUomData] = useState({ id: '', description: '', status: 'Active' });
  const [showEditPurchaseClass, setShowEditPurchaseClass] = useState(false);
  const [editPurchaseClassData, setEditPurchaseClassData] = useState({ id: '', status: 'Active' });
  const [showEditCategory, setShowEditCategory] = useState(false);
  const [editCategoryData, setEditCategoryData] = useState({ id: '', status: 'Active' });

  // ---------- Warehouse add/edit ----------
  const [showAddWarehouse, setShowAddWarehouse] = useState(false);
  const [showEditWarehouse, setShowEditWarehouse] = useState(false);
  const [editingWarehouse, setEditingWarehouse] = useState(null);
  const [newWarehouse, setNewWarehouse] = useState({
    warehouse_name: '',
    warehouse_code: '',
    warehouse_location: '',
    status: 'Active'
  });
  const [editWarehouseData, setEditWarehouseData] = useState({
    warehouse_id: '',
    warehouse_name: '',
    warehouse_code: '',
    warehouse_location: '',
    status: 'Active'
  });

  // ---------- Search/filter states ----------
  const [itemListSearchTerm, setItemListSearchTerm] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [receivedSearchTerm, setReceivedSearchTerm] = useState('');
  const [receivedStartDate, setReceivedStartDate] = useState('');
  const [receivedEndDate, setReceivedEndDate] = useState('');
  const [receivedClassFilter, setReceivedClassFilter] = useState('All');
  const [releasedSearchTerm, setReleasedSearchTerm] = useState('');
  const [releasedStartDate, setReleasedStartDate] = useState('');
  const [releasedEndDate, setReleasedEndDate] = useState('');
  const [releasedClassFilter, setReleasedClassFilter] = useState('All');

  // ---------- Helper: generate barcode data URL ----------
  const generateBarcodeDataUrl = useMemo(() => {
    return (value, width = 1.5, height = 30) => {
      if (!value) return '';
      try {
        const canvas = document.createElement('canvas');
        JsBarcode(canvas, value, {
          format: 'CODE128',
          width: width,
          height: height,
          displayValue: false,
          margin: 0,
          background: '#ffffff',
          lineColor: '#000000',
        });
        return canvas.toDataURL('image/png');
      } catch (e) {
        console.error('Barcode generation error:', e);
        return '';
      }
    };
  }, []);

  // ---------- API fetch functions ----------
  const fetchUsers = async () => {
    try {
      const response = await userApi.getAllUsers();
      if (response.ok && Array.isArray(response.data)) {
        setUsers(response.data);
        const active = response.data.filter(u => u.status === 'Active').length;
        const inactive = response.data.filter(u => u.status === 'Inactive').length;
        setStats(prev => ({
          ...prev,
          totalUsers: response.data.length,
          activeUsers: active,
          deactivatedUsers: inactive
        }));
      }
    } catch (error) {
      console.error('Error fetching users:', error);
    }
  };

  const fetchWarehouses = async () => {
    try {
      const response = await warehouseApi.getAllWarehouses();
      if (response.ok && Array.isArray(response.data)) {
        setWarehouses(response.data);
        setStats(prev => ({ ...prev, totalWarehouses: response.data.length }));
        return response.data;
      }
      return [];
    } catch (error) {
      console.error('Error fetching warehouses:', error);
      return [];
    }
  };

  const fetchDamagedItemsCount = async () => {
    try {
      const res = await damagedItemsApi.totals();
      if (res.ok && res.data) {
        setDamagedItemsCount(Number(res.data.writeoff_count) || 0);
      } else {
        setDamagedItemsCount(0);
      }
    } catch (err) {
      console.warn('Could not load damaged items count:', err);
      setDamagedItemsCount(0);
    }
  };

  const fetchMasterData = async () => {
    try {
      const [glRes, uomRes, pcRes, catRes] = await Promise.all([
        masterApi.getGl(),
        masterApi.getUom(),
        masterApi.getPurchaseClasses(),
        masterApi.getCategories()
      ]);
      if (glRes.ok && Array.isArray(glRes.data)) {
        setGlList(glRes.data.map(item => ({
          id: item.id,
          number: String(item.id),
          description: item.description || '',
          status: item.Status || 'Active'
        })));
      }
      if (uomRes.ok && Array.isArray(uomRes.data)) {
        setUomList(uomRes.data.map(item => ({
          id: item.id,
          code: item.id,
          description: item.description || '',
          status: item.Status || 'Active'
        })));
      }
      if (pcRes.ok && Array.isArray(pcRes.data)) {
        setPurchaseClassList(pcRes.data.map(item => ({
          id: item.id,
          name: item.id,
          status: item.Status || 'Active'
        })));
      }
      if (catRes.ok && Array.isArray(catRes.data)) {
        setCategoryList(catRes.data.map(item => ({
          id: item.id,
          name: item.id,
          status: item.Status || 'Active'
        })));
      }
    } catch (error) {
      console.error('Error fetching master data:', error);
      toast.error('Failed to load master lists.');
    }
  };

  const fetchItemMasters = async (page = 1) => {
    setItemMasterLoading(true);
    try {
      const response = await itemMasterApi.getAllItemMasters({
        page,
        limit: ITEMS_PER_PAGE_MASTER,
        search:         itemMasterSearchTerm.trim() || undefined,
        gl_class:       itemMasterGlFilter             !== 'All' ? itemMasterGlFilter             : undefined,
        purchase_class: itemMasterPurchaseClassFilter  !== 'All' ? itemMasterPurchaseClassFilter  : undefined,
        category:       itemMasterCategoryFilter       !== 'All' ? itemMasterCategoryFilter       : undefined,
      });
      if (response.ok && response.data) {
        const data = response.data.data || [];
        const totalPages = response.data.totalPages || 1;
        const totalCount = response.data.total || data.length;
        setItemMasterRecords(data);
        setItemMasterTotalPages(totalPages);
        setItemMasterTotalCount(totalCount);
      } else {
        console.error('Failed to fetch item masters:', response);
      }
    } catch (error) {
      console.error('Error fetching item masters:', error);
    } finally {
      setItemMasterLoading(false);
    }
  };

  const fetchEquipmentMasters = async (page = 1, searchTerm = equipmentMasterSearchTerm) => {
    setEquipmentMasterLoading(true);
    try {
      const response = await equipmentMasterApi.getAllEquipmentMasters({
        page,
        limit: ITEMS_PER_PAGE_MASTER,
        search: searchTerm.trim() || undefined,
      });
      if (response.ok && response.data) {
        const data = response.data.data || [];
        const totalPages = response.data.totalPages || 1;
        const totalCount = response.data.total || data.length;
        setEquipmentMasterRecords(data);
        setEquipmentMasterTotalPages(totalPages);
        setEquipmentMasterTotalCount(totalCount);
      } else {
        console.error('Failed to fetch equipment masters:', response);
      }
    } catch (error) {
      console.error('Error fetching equipment masters:', error);
    } finally {
      setEquipmentMasterLoading(false);
    }
  };

  // ---------- UOM Conversions: fetch ----------    ← ADDED
  const fetchUomConversions = async (page = 1) => {
    setUomConversionLoading(true);
    try {
      const response = await uomConversionApi.getAll({
        page,
        limit: ITEMS_PER_PAGE_MASTER,
        search: uomConversionSearchTerm.trim() || undefined,
      });
      if (response.ok && response.data) {
        const data = response.data.data || [];
        const totalPages = response.data.totalPages || 1;
        const totalCount = response.data.total || data.length;
        setUomConversionRecords(data);
        setUomConversionTotalPages(totalPages);
        setUomConversionTotalCount(totalCount);
      } else {
        console.error('Failed to fetch UOM conversions:', response);
        toast.error(response.data?.message || 'Failed to load UOM conversions.');
      }
    } catch (error) {
      console.error('Error fetching UOM conversions:', error);
      toast.error('Error connecting to server.');
    } finally {
      setUomConversionLoading(false);
    }
  };

  // ---------- UOM Conversions: fetch item options for dropdowns ----------    ← ADDED
  const fetchUomConversionItemOptions = async () => {
    if (uomConversionItemOptions.length > 0) return; // cached
    try {
      const response = await itemMasterApi.getAllItemMasters({
        page: 1,
        limit: 100000,
        search: '',
      });
      if (response.ok && response.data) {
        const data = response.data.data || [];
        setUomConversionItemOptions(
          data.map((i) => ({
            Item_Code: i.Item_Code,
            Item_Description: i.Item_Description || '',
          }))
        );
      }
    } catch (err) {
      console.error('Error fetching UOM conversion item options:', err);
    }
  };

  const fetchItemFilterOptions = async () => {
    try {
      const response = await itemMasterApi.getItemFilterOptions();
      if (response.ok && response.data) {
        setItemMasterFilterOptions({
          gl_classes:       Array.isArray(response.data.gl_classes)       ? response.data.gl_classes       : [],
          purchase_classes: Array.isArray(response.data.purchase_classes) ? response.data.purchase_classes : [],
          categories:       Array.isArray(response.data.categories)       ? response.data.categories       : [],
        });
      }
    } catch (err) {
      console.warn('Could not load item filter options:', err);
    }
  };

  const fetchCostCenters = async (page = 1) => {
    setCostCenterLoading(true);
    try {
      const response = await costCenterApi.getAllCostCenters({
        page,
        limit: ITEMS_PER_PAGE_MASTER,
        search: costCenterSearchTerm.trim() || undefined,
      });
      if (response.ok && response.data) {
        setCostCenterRecords(response.data.data || []);
        setCostCenterTotalPages(response.data.totalPages || 1);
        setCostCenterTotalCount(response.data.total || 0);
      } else {
        console.error('Failed to fetch cost centers:', response);
      }
    } catch (error) {
      console.error('Error fetching cost centers:', error);
    } finally {
      setCostCenterLoading(false);
    }
  };

  const fetchItemMastersForDashboard = async (page = 1) => {
    try {
      const response = await itemMasterApi.getAllItemMasters({
        page,
        limit: 100000,
        search: '',
      });
      if (response.ok && response.data) {
        const data = response.data.data || [];
        const total = response.data.total || data.length;
        setDashboardItems(data);
        setDashboardTotalCount(total);
        if (data.length > 0 && dashboardItemIndex >= data.length) {
          setDashboardItemIndex(0);
        }
      }
    } catch (error) {
      console.error('Error fetching dashboard items:', error);
    }
  };

  const fetchItemsAndReleases = async () => {
    setAddedItems([]);
    setReleaseRecords([]);
    updateStatsFromItemsAndReleases([], []);
    computeYearlyData([], []);
  };

  const updateStatsFromItemsAndReleases = (items, releases) => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const todayItems = items.filter(item => new Date(item.created_at) >= today);
    const monthItems = items.filter(item => new Date(item.created_at) >= monthStart);
    const todayReleases = releases.filter(r => new Date(r.created_at) >= today);
    const monthReleases = releases.filter(r => new Date(r.created_at) >= monthStart);
    const totalDamagedItems = items.filter(item => item.status === 'Damaged').length;
    setStats(prev => ({
      ...prev,
      totalAddedItems: items.length,
      itemsAddedToday: todayItems.length,
      itemsAddedThisMonth: monthItems.length,
      itemsReleasedToday: todayReleases.reduce((sum, r) => sum + r.quantity, 0),
      totalReleasesThisMonth: monthReleases.reduce((sum, r) => sum + r.quantity, 0),
      totalDamagedItems: totalDamagedItems,
    }));
    setDailyItems(todayItems);
    setDailyReleases(todayReleases);
    const weeklyItems = [0, 0, 0, 0];
    monthItems.forEach(item => {
      const date = new Date(item.created_at);
      const weekIndex = Math.min(3, Math.floor((date.getDate() - 1) / 7));
      weeklyItems[weekIndex]++;
    });
    setItemsMonthData({
      labels: ['Week 1', 'Week 2', 'Week 3', 'Week 4'],
      values: weeklyItems
    });
    const weeklyReleases = [0, 0, 0, 0];
    monthReleases.forEach(r => {
      const date = new Date(r.created_at);
      const weekIndex = Math.min(3, Math.floor((date.getDate() - 1) / 7));
      weeklyReleases[weekIndex] += r.quantity;
    });
    setReleasesMonthData({
      labels: ['Week 1', 'Week 2', 'Week 3', 'Week 4'],
      values: weeklyReleases
    });
  };

  const computeYearlyData = (items, releases) => {
    const currentYear = new Date().getFullYear();
    const monthlyReceived = Array(12).fill(0);
    const monthlyReleased = Array(12).fill(0);
    items.forEach(item => {
      const date = new Date(item.created_at);
      if (date.getFullYear() === currentYear) {
        const month = date.getMonth();
        monthlyReceived[month]++;
      }
    });
    releases.forEach(r => {
      const date = new Date(r.created_at);
      if (date.getFullYear() === currentYear) {
        const month = date.getMonth();
        monthlyReleased[month] += r.quantity;
      }
    });
    setYearlyData({
      labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
      received: monthlyReceived,
      released: monthlyReleased
    });
  };

  // ---------- Initial load ----------
  useEffect(() => {
    const fetchAll = async () => {
      setFetching(true);
      await fetchUsers();
      await fetchWarehouses();
      await fetchMasterData();
      await fetchItemsAndReleases();
      await fetchDamagedItemsCount();
      await fetchItemFilterOptions();
      setFetching(false);
    };
    fetchAll();
  }, []);

  // ---------- Master Data CRUD ----------
  const handleAddGl = () => setShowAddGl(true);
  const handleCloseGlForm = () => { setShowAddGl(false); setNewGl({ number: '', description: '' }); };
  const handleNewGlChange = (e) => { const { name, value } = e.target; setNewGl(prev => ({ ...prev, [name]: value })); };
  const handleSaveGl = async () => {
    if (!beginFlight('saveGl')) return;
    try {
      const number = newGl.number.trim();
      const desc = newGl.description.trim();
      if (!number || !desc) { toast.warning('Both GL Number and Description are required.'); return; }
      const existing = glList.find(gl => gl.number.toLowerCase() === number.toLowerCase());
      if (existing) { toast.error(`GL Number "${number}" already exists.`); return; }
      try {
        const response = await masterApi.createGl({ number, description: desc });
        if (response.ok) {
          toast.success('GL Class added.');
          handleCloseGlForm();
          await fetchMasterData();
          await fetchItemFilterOptions();
          setGlPage(1);
        } else {
          toast.error(response.data?.message || 'Failed to add GL class.');
        }
      } catch (error) {
        console.error('Error creating GL:', error);
        toast.error('Error connecting to server.');
      }
    } finally {
      endFlight('saveGl');
    }
  };
  const handleDeleteGl = async (id) => {
    if (!beginFlight(`deleteGl:${id}`)) return;
    try {
      if (!window.confirm('Deactivate this GL class?')) return;
      try {
        const response = await masterApi.deactivateGl(id);
        if (response.ok) {
          toast.success('GL class deactivated.');
          await fetchMasterData();
          await fetchItemFilterOptions();
        } else {
          toast.error(response.data?.message || 'Failed to deactivate.');
        }
      } catch (error) {
        console.error('Error deactivating GL:', error);
        toast.error('Error connecting to server.');
      }
    } finally {
      endFlight(`deleteGl:${id}`);
    }
  };
  const handleEditGl = (item) => {
    setEditGlData({ id: item.id, description: item.description, status: item.status });
    setShowEditGl(true);
  };
  const handleCloseEditGl = () => { setShowEditGl(false); setEditGlData({ id: '', description: '', status: 'Active' }); };
  const handleEditGlChange = (e) => { const { name, value } = e.target; setEditGlData(prev => ({ ...prev, [name]: value })); };
  const handleUpdateGl = async () => {
    if (!beginFlight(`updateGl:${editGlData.id}`)) return;
    try {
      const desc = editGlData.description.trim();
      if (!desc) { toast.warning('Description is required.'); return; }
      try {
        const response = await masterApi.updateGl(editGlData.id, {
          description: desc,
          status: editGlData.status
        });
        if (response.ok) {
          toast.success('GL class updated.');
          handleCloseEditGl();
          await fetchMasterData();
          await fetchItemFilterOptions();
        } else {
          toast.error(response.data?.message || 'Failed to update.');
        }
      } catch (error) {
        console.error('Error updating GL:', error);
        toast.error('Error connecting to server.');
      }
    } finally {
      endFlight(`updateGl:${editGlData.id}`);
    }
  };

  const handleAddUom = () => setShowAddUom(true);
  const handleCloseUomForm = () => { setShowAddUom(false); setNewUom({ code: '', description: '' }); };
  const handleNewUomChange = (e) => { const { name, value } = e.target; setNewUom(prev => ({ ...prev, [name]: value })); };
  const handleSaveUom = async () => {
    if (!beginFlight('saveUom')) return;
    try {
      const code = newUom.code.trim();
      const desc = newUom.description.trim();
      if (!code || !desc) { toast.warning('Both UOM Code and Description are required.'); return; }
      const existing = uomList.find(uom => uom.code.toLowerCase() === code.toLowerCase());
      if (existing) { toast.error(`UOM Code "${code}" already exists.`); return; }
      try {
        const response = await masterApi.createUom({ code, description: desc });
        if (response.ok) {
          toast.success('UOM added.');
          handleCloseUomForm();
          await fetchMasterData();
          setUomPage(1);
        } else {
          toast.error(response.data?.message || 'Failed to add UOM.');
        }
      } catch (error) {
        console.error('Error creating UOM:', error);
        toast.error('Error connecting to server.');
      }
    } finally {
      endFlight('saveUom');
    }
  };
  const handleDeleteUom = async (id) => {
    if (!beginFlight(`deleteUom:${id}`)) return;
    try {
      if (!window.confirm('Deactivate this UOM?')) return;
      try {
        const response = await masterApi.deactivateUom(id);
        if (response.ok) {
          toast.success('UOM deactivated.');
          await fetchMasterData();
        } else {
          toast.error(response.data?.message || 'Failed to deactivate.');
        }
      } catch (error) {
        console.error('Error deactivating UOM:', error);
        toast.error('Error connecting to server.');
      }
    } finally {
      endFlight(`deleteUom:${id}`);
    }
  };
  const handleEditUom = (item) => {
    setEditUomData({ id: item.id, description: item.description, status: item.status });
    setShowEditUom(true);
  };
  const handleCloseEditUom = () => { setShowEditUom(false); setEditUomData({ id: '', description: '', status: 'Active' }); };
  const handleEditUomChange = (e) => { const { name, value } = e.target; setEditUomData(prev => ({ ...prev, [name]: value })); };
  const handleUpdateUom = async () => {
    if (!beginFlight(`updateUom:${editUomData.id}`)) return;
    try {
      const desc = editUomData.description.trim();
      if (!desc) { toast.warning('Description is required.'); return; }
      try {
        const response = await masterApi.updateUom(editUomData.id, {
          description: desc,
          status: editUomData.status
        });
        if (response.ok) {
          toast.success('UOM updated.');
          handleCloseEditUom();
          await fetchMasterData();
        } else {
          toast.error(response.data?.message || 'Failed to update.');
        }
      } catch (error) {
        console.error('Error updating UOM:', error);
        toast.error('Error connecting to server.');
      }
    } finally {
      endFlight(`updateUom:${editUomData.id}`);
    }
  };

  const handleAddPurchaseClass = () => setShowAddPurchaseClass(true);
  const handleClosePurchaseClassForm = () => { setShowAddPurchaseClass(false); setNewPurchaseClass({ name: '' }); };
  const handleNewPurchaseClassChange = (e) => { const { name, value } = e.target; setNewPurchaseClass(prev => ({ ...prev, [name]: value })); };
  const handleSavePurchaseClass = async () => {
    if (!beginFlight('savePurchaseClass')) return;
    try {
      const name = newPurchaseClass.name.trim();
      if (!name) { toast.warning('Purchase Class name is required.'); return; }
      const existing = purchaseClassList.find(pc => pc.name.toLowerCase() === name.toLowerCase());
      if (existing) { toast.error(`Purchase Class "${name}" already exists.`); return; }
      try {
        const response = await masterApi.createPurchaseClass({ name });
        if (response.ok) {
          toast.success('Purchase Class added.');
          handleClosePurchaseClassForm();
          await fetchMasterData();
          await fetchItemFilterOptions();
          setPurchaseClassPage(1);
        } else {
          toast.error(response.data?.message || 'Failed to add purchase class.');
        }
      } catch (error) {
        console.error('Error creating purchase class:', error);
        toast.error('Error connecting to server.');
      }
    } finally {
      endFlight('savePurchaseClass');
    }
  };
  const handleDeletePurchaseClass = async (id) => {
    if (!beginFlight(`deletePurchaseClass:${id}`)) return;
    try {
      if (!window.confirm('Deactivate this purchase class?')) return;
      try {
        const response = await masterApi.deactivatePurchaseClass(id);
        if (response.ok) {
          toast.success('Purchase class deactivated.');
          await fetchMasterData();
          await fetchItemFilterOptions();
        } else {
          toast.error(response.data?.message || 'Failed to deactivate.');
        }
      } catch (error) {
        console.error('Error deactivating purchase class:', error);
        toast.error('Error connecting to server.');
      }
    } finally {
      endFlight(`deletePurchaseClass:${id}`);
    }
  };
  const handleEditPurchaseClass = (item) => {
    setEditPurchaseClassData({ id: item.id, status: item.status });
    setShowEditPurchaseClass(true);
  };
  const handleCloseEditPurchaseClass = () => { setShowEditPurchaseClass(false); setEditPurchaseClassData({ id: '', status: 'Active' }); };
  const handleEditPurchaseClassChange = (e) => { const { name, value } = e.target; setEditPurchaseClassData(prev => ({ ...prev, [name]: value })); };
  const handleUpdatePurchaseClass = async () => {
    if (!beginFlight(`updatePurchaseClass:${editPurchaseClassData.id}`)) return;
    try {
      try {
        const response = await masterApi.updatePurchaseClass(editPurchaseClassData.id, {
          status: editPurchaseClassData.status
        });
        if (response.ok) {
          toast.success('Purchase class updated.');
          handleCloseEditPurchaseClass();
          await fetchMasterData();
          await fetchItemFilterOptions();
        } else {
          toast.error(response.data?.message || 'Failed to update.');
        }
      } catch (error) {
        console.error('Error updating purchase class:', error);
        toast.error('Error connecting to server.');
      }
    } finally {
      endFlight(`updatePurchaseClass:${editPurchaseClassData.id}`);
    }
  };

  const handleAddCategory = () => setShowAddCategory(true);
  const handleCloseCategoryForm = () => { setShowAddCategory(false); setNewCategory({ name: '' }); };
  const handleNewCategoryChange = (e) => { const { name, value } = e.target; setNewCategory(prev => ({ ...prev, [name]: value })); };
  const handleSaveCategory = async () => {
    if (!beginFlight('saveCategory')) return;
    try {
      const name = newCategory.name.trim();
      if (!name) { toast.warning('Category name is required.'); return; }
      const existing = categoryList.find(cat => cat.name.toLowerCase() === name.toLowerCase());
      if (existing) { toast.error(`Category "${name}" already exists.`); return; }
      try {
        const response = await masterApi.createCategory({ name });
        if (response.ok) {
          toast.success('Category added.');
          handleCloseCategoryForm();
          await fetchMasterData();
          await fetchItemFilterOptions();
          setCategoryPage(1);
        } else {
          toast.error(response.data?.message || 'Failed to add category.');
        }
      } catch (error) {
        console.error('Error creating category:', error);
        toast.error('Error connecting to server.');
      }
    } finally {
      endFlight('saveCategory');
    }
  };
  const handleDeleteCategory = async (id) => {
    if (!beginFlight(`deleteCategory:${id}`)) return;
    try {
      if (!window.confirm('Deactivate this category?')) return;
      try {
        const response = await masterApi.deactivateCategory(id);
        if (response.ok) {
          toast.success('Category deactivated.');
          await fetchMasterData();
          await fetchItemFilterOptions();
        } else {
          toast.error(response.data?.message || 'Failed to deactivate.');
        }
      } catch (error) {
        console.error('Error deactivating category:', error);
        toast.error('Error connecting to server.');
      }
    } finally {
      endFlight(`deleteCategory:${id}`);
    }
  };
  const handleEditCategory = (item) => {
    setEditCategoryData({ id: item.id, status: item.status });
    setShowEditCategory(true);
  };
  const handleCloseEditCategory = () => { setShowEditCategory(false); setEditCategoryData({ id: '', status: 'Active' }); };
  const handleEditCategoryChange = (e) => { const { name, value } = e.target; setEditCategoryData(prev => ({ ...prev, [name]: value })); };
  const handleUpdateCategory = async () => {
    if (!beginFlight(`updateCategory:${editCategoryData.id}`)) return;
    try {
      try {
        const response = await masterApi.updateCategory(editCategoryData.id, {
          status: editCategoryData.status
        });
        if (response.ok) {
          toast.success('Category updated.');
          handleCloseEditCategory();
          await fetchMasterData();
          await fetchItemFilterOptions();
        } else {
          toast.error(response.data?.message || 'Failed to update.');
        }
      } catch (error) {
        console.error('Error updating category:', error);
        toast.error('Error connecting to server.');
      }
    } finally {
      endFlight(`updateCategory:${editCategoryData.id}`);
    }
  };

  // ---------- UOM CONVERSIONS CRUD ----------    ← ADDED
  const handleCloseUomConversionForm = () => {
    setShowCreateUomConversionForm(false);
    setNewUomConversion({
      box_item_code: '',
      piece_item_code: '',
      pieces_per_box: '',
      Status: 'Active',
    });
  };

  const handleCloseEditUomConversionModal = () => {
    setShowEditUomConversionModal(false);
    setEditUomConversionData({
      conversion_id: null,
      box_item_code: '',
      piece_item_code: '',
      pieces_per_box: '',
      Status: 'Active',
    });
  };

  const handleSaveUomConversion = async () => {
    if (!beginFlight('saveUomConversion')) return;
    try {
      const boxCode = String(newUomConversion.box_item_code || '').trim();
      const pieceCode = String(newUomConversion.piece_item_code || '').trim();
      const pieces = parseInt(newUomConversion.pieces_per_box, 10);

      if (!boxCode)   { toast.warning('Please select a Box Item Code.'); return; }
      if (!pieceCode) { toast.warning('Please select a Piece Item Code.'); return; }
      if (boxCode === pieceCode) {
        toast.error('Box and Piece item codes must be different.');
        return;
      }
      if (!Number.isFinite(pieces) || pieces <= 0) {
        toast.warning('Pieces per Box must be a positive integer.');
        return;
      }

      setLoading(true);
      const response = await uomConversionApi.create({
        box_item_code: boxCode,
        piece_item_code: pieceCode,
        pieces_per_box: pieces,
        Status: newUomConversion.Status || 'Active',
      });

      if (response.ok) {
        toast.success('UOM Conversion created.');
        handleCloseUomConversionForm();
        await fetchUomConversions(1);
      } else {
        toast.error(response.data?.message || 'Failed to create UOM Conversion.');
      }
    } catch (error) {
      console.error('Error creating UOM Conversion:', error);
      toast.error('Error connecting to server.');
    } finally {
      setLoading(false);
      endFlight('saveUomConversion');
    }
  };

  const handleEditUomConversion = (item) => {
    setEditUomConversionData({
      conversion_id: item.conversion_id,
      box_item_code: item.box_item_code || '',
      piece_item_code: item.piece_item_code || '',
      pieces_per_box: item.pieces_per_box != null ? String(item.pieces_per_box) : '',
      Status: item.Status || 'Active',
    });
    setShowEditUomConversionModal(true);
  };

  const handleUpdateUomConversion = async () => {
    const id = editUomConversionData.conversion_id;
    if (!id) return;
    if (!beginFlight(`updateUomConversion:${id}`)) return;
    try {
      const boxCode = String(editUomConversionData.box_item_code || '').trim();
      const pieceCode = String(editUomConversionData.piece_item_code || '').trim();
      const pieces = parseInt(editUomConversionData.pieces_per_box, 10);

      if (!boxCode)   { toast.warning('Please select a Box Item Code.'); return; }
      if (!pieceCode) { toast.warning('Please select a Piece Item Code.'); return; }
      if (boxCode === pieceCode) {
        toast.error('Box and Piece item codes must be different.');
        return;
      }
      if (!Number.isFinite(pieces) || pieces <= 0) {
        toast.warning('Pieces per Box must be a positive integer.');
        return;
      }

      setLoading(true);
      const response = await uomConversionApi.update(id, {
        box_item_code: boxCode,
        piece_item_code: pieceCode,
        pieces_per_box: pieces,
        Status: editUomConversionData.Status || 'Active',
      });

      if (response.ok) {
        toast.success('UOM Conversion updated.');
        handleCloseEditUomConversionModal();
        await fetchUomConversions(uomConversionCurrentPage);
      } else {
        toast.error(response.data?.message || 'Failed to update UOM Conversion.');
      }
    } catch (error) {
      console.error('Error updating UOM Conversion:', error);
      toast.error('Error connecting to server.');
    } finally {
      setLoading(false);
      endFlight(`updateUomConversion:${id}`);
    }
  };

  const handleDeleteUomConversion = async (item) => {
    const id = item?.conversion_id;
    if (!id) return;
    if (!beginFlight(`deleteUomConversion:${id}`)) return;
    try {
      const label = `${item.box_item_code} → ${item.piece_item_code}`;
      if (!window.confirm(`Permanently delete this UOM Conversion?\n\n${label}\n\nThis cannot be undone.`)) {
        return;
      }
      setLoading(true);
      const response = await uomConversionApi.remove(id);
      if (response.ok) {
        toast.success(`UOM Conversion "${label}" deleted.`);
        const remainingOnPage = uomConversionRecords.length - 1;
        const newPage = remainingOnPage === 0 && uomConversionCurrentPage > 1
          ? uomConversionCurrentPage - 1
          : uomConversionCurrentPage;
        setUomConversionCurrentPage(newPage);
        await fetchUomConversions(newPage);
      } else {
        toast.error(response.data?.message || 'Failed to delete UOM Conversion.');
      }
    } catch (error) {
      console.error('Error deleting UOM Conversion:', error);
      toast.error('Error connecting to server.');
    } finally {
      setLoading(false);
      endFlight(`deleteUomConversion:${id}`);
    }
  };

  // ---------- COST CENTER CRUD ----------
  const handleSaveCostCenter = async () => {
    if (!beginFlight('saveCostCenter')) return;
    const val = parseInt(newCostCenter.Cost_Center_Value, 10);

    if (isNaN(val)) { toast.warning('Cost Center Value must be an integer.'); return; }

    try {
      setLoading(true);
      const payload = { Cost_Center_Value: val, Description: newCostCenter.Description, Status: newCostCenter.Status, Creation_Date: newCostCenter.Creation_Date };
      const r = await costCenterApi.createCostCenter(payload);
      if (r.ok) {
        toast.success('Cost Center added.');
        setNewCostCenter({ Cost_Center_Value: '', Description: '', Status: 'Active', Creation_Date: new Date().toISOString().split('T')[0] });
        setShowCreateCostCenterForm(false);
        fetchCostCenters(1);
      } else toast.error(r.data?.message || 'Failed to add Cost Center.');
    } finally { setLoading(false); endFlight('saveCostCenter'); }
  };

  const handleEditCostCenter = (item) => {
    setEditCostCenterData({ ...item, Creation_Date: item.Creation_Date ? new Date(item.Creation_Date).toISOString().split('T')[0] : '' });
    setShowEditCostCenterModal(true);
  };

  const handleUpdateCostCenter = async () => {
    if (!beginFlight(`updateCC:${editCostCenterData.Cost_Center_Value}`)) return;

    try {
      setLoading(true);
      const payload = { Description: editCostCenterData.Description, Status: editCostCenterData.Status, Creation_Date: editCostCenterData.Creation_Date };
      const r = await costCenterApi.updateCostCenter(editCostCenterData.Cost_Center_Value, payload);
      if (r.ok) {
        toast.success('Cost Center updated.');
        setShowEditCostCenterModal(false);
        fetchCostCenters(costCenterCurrentPage);
      } else toast.error(r.data?.message || 'Failed to update.');
    } finally { setLoading(false); endFlight(`updateCC:${editCostCenterData.Cost_Center_Value}`); }
  };

  const handleToggleCostCenterStatus = async (item) => {
    const newStatus = item.Status === 'Active' ? 'Inactive' : 'Active';
    if (!window.confirm(`Are you sure you want to ${newStatus.toLowerCase()} Cost Center ${item.Cost_Center_Value}?`)) return;
    try {
      const r = newStatus === 'Active' ? await costCenterApi.activateCostCenter(item.Cost_Center_Value) : await costCenterApi.deactivateCostCenter(item.Cost_Center_Value);
      if (r.ok) { toast.success(`Cost Center ${newStatus.toLowerCase()}d.`); fetchCostCenters(costCenterCurrentPage); }
      else toast.error(r.data?.message || 'Failed to update status.');
    } catch (e) { toast.error('Error connecting to server.'); }
  };

  const handleDeleteCostCenter = async (item) => {
    const typed = window.prompt(`⚠️ PERMANENT DELETE ⚠️\nType DELETE to confirm deletion of Cost Center ${item.Cost_Center_Value}.`);
    if (typed !== 'DELETE') return;
    try {
      const r = await costCenterApi.deleteCostCenter(item.Cost_Center_Value);
      if (r.ok) {
        toast.success('Cost Center deleted.');
        const remainingOnPage = costCenterRecords.length - 1;
        const newPage = remainingOnPage === 0 && costCenterCurrentPage > 1 ? costCenterCurrentPage - 1 : costCenterCurrentPage;
        setCostCenterCurrentPage(newPage);
        fetchCostCenters(newPage);
      } else toast.error(r.data?.message || 'Failed to delete.');
    } catch (e) { toast.error('Error connecting to server.'); }
  };

  // ---------- EQUIPMENT MASTER CRUD ----------
  const generateEquipmentBarcode = () => {
    const val = newEquipment.Value.trim();
    if (!val) {
      toast.warning('Please enter an Equipment Value first.');
      return;
    }
    
    const num = parseInt(val, 10);
    if (isNaN(num) || num.toString() !== val) {
      toast.warning('Equipment Value must be a valid integer.');
      return;
    }

    const barcode = `EQ-${val}`;
    setNewEquipment(prev => ({ ...prev, Barcode: barcode }));
    
    setTimeout(() => {
      if (equipmentBarcodeCanvasRef.current) {
        try {
          JsBarcode(equipmentBarcodeCanvasRef.current, barcode, {
            format: 'CODE128',
            width: 2,
            height: 60,
            displayValue: true,
            fontSize: 16,
            margin: 5,
            background: '#ffffff',
            lineColor: '#1a1f26'
          });
          if (equipmentBarcodeImageRef.current) {
            equipmentBarcodeImageRef.current.src = equipmentBarcodeCanvasRef.current.toDataURL('image/png');
          }
        } catch (error) {
          console.error('Barcode generation error:', error);
        }
      }
    }, 100);
  };

  const handleToggleCreateEquipmentForm = () => {
    setShowCreateEquipmentForm(!showCreateEquipmentForm);
    if (!showCreateEquipmentForm) {
      setNewEquipment({
        Value: '',
        Description: '',
        Status: 'Active',
        Creation_Date: new Date().toISOString().split('T')[0],
        Barcode: '',
      });
      setNewEquipmentImageFile(null);
      setNewEquipmentImagePreview(null);
    } else {
      setNewEquipmentImageFile(null);
      setNewEquipmentImagePreview(null);
    }
  };

  const handleNewEquipmentChange = (e) => {
    const { name, value } = e.target;
    setNewEquipment(prev => ({ ...prev, [name]: value }));
  };

  const handleNewEquipmentImageChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
        const mb = (file.size / 1024 / 1024).toFixed(2);
        toast.error(`Image size (${mb} MB) exceeds the 5 MB limit.`);
        e.target.value = '';
        return;
      }
      setNewEquipmentImageFile(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setNewEquipmentImagePreview(reader.result);
      };
      reader.readAsDataURL(file);
    } else {
      setNewEquipmentImageFile(null);
      setNewEquipmentImagePreview(null);
    }
  };

  const handleRemoveNewEquipmentImage = () => {
    setNewEquipmentImageFile(null);
    setNewEquipmentImagePreview(null);
    const fileInput = document.getElementById('adminEquipmentImageInput');
    if (fileInput) fileInput.value = '';
  };

  const handleSaveEquipment = async () => {
    if (!beginFlight('saveEquipment')) return;
    try {
      const val = newEquipment.Value.trim();
      const desc = newEquipment.Description.trim();
      
      if (!val) { toast.warning('Equipment Value is required.'); return; }
      if (!desc) { toast.warning('Description is required.'); return; }
      
      const num = parseInt(val, 10);
      if (isNaN(num) || num.toString() !== val) {
        toast.warning('Equipment Value must be a valid integer.');
        return;
      }

      const payload = {
        Value: num,
        Description: desc,
        Status: newEquipment.Status,
        Creation_Date: newEquipment.Creation_Date,
      };
      
      if (newEquipmentImagePreview) {
        payload.Equipment_Image = newEquipmentImagePreview;
      }

      const confirmMessage = `Create new equipment in equipment_master table?\n\n` +
        `Code: EQ-${payload.Value}\n` +
        `Value: ${payload.Value}\n` +
        `Description: ${payload.Description}\n` +
        `Status: ${payload.Status}\n` +
        `Creation Date: ${payload.Creation_Date}\n` +
        `Image: ${newEquipmentImagePreview ? 'Yes' : 'No'}`;
        
      if (!window.confirm(confirmMessage)) return;
      
      setLoading(true);
      try {
        const response = await equipmentMasterApi.createEquipmentMaster(payload);
        if (response.ok) {
          toast.success('Equipment successfully saved.');
          setNewEquipment({
            Value: '',
            Description: '',
            Status: 'Active',
            Creation_Date: new Date().toISOString().split('T')[0],
            Barcode: '',
          });
          setNewEquipmentImageFile(null);
          setNewEquipmentImagePreview(null);
          setShowCreateEquipmentForm(false);
          setEquipmentMasterCurrentPage(1);
          setEquipmentMasterSearchTerm('');
          await fetchEquipmentMasters(1);
        } else {
          toast.error(response.data?.message || 'Failed to save equipment.');
        }
      } catch (error) {
        console.error('Error saving equipment:', error);
        toast.error('Error connecting to server.');
      } finally {
        setLoading(false);
      }
    } finally {
      endFlight('saveEquipment');
    }
  };

  const handleEditEquipment = (item) => {
    setEditEquipmentData({
      Equipment_Code: item.Equipment_Code,
      Value: item.Value,
      Description: item.Description || '',
      Status: item.Status || 'Active',
      Creation_Date: item.Creation_Date ? new Date(item.Creation_Date).toISOString().split('T')[0] : '',
      Barcode: item.Barcode || '',
      Equipment_Image: item.Equipment_Image || '',
    });
    if (item.Equipment_Image) {
      setEditEquipmentImagePreview(item.Equipment_Image);
    } else {
      setEditEquipmentImagePreview(null);
    }
    setEditEquipmentImageFile(null);
    setShowEditEquipmentModal(true);
  };

  const handleCloseEditEquipmentModal = () => {
    setShowEditEquipmentModal(false);
    setEditEquipmentData({
      Equipment_Code: '',
      Value: '',
      Description: '',
      Status: 'Active',
      Creation_Date: '',
      Barcode: '',
      Equipment_Image: '',
    });
    setEditEquipmentImageFile(null);
    setEditEquipmentImagePreview(null);
  };

  const handleEditEquipmentChange = (e) => {
    const { name, value } = e.target;
    setEditEquipmentData(prev => ({ ...prev, [name]: value }));
  };

  const handleEditEquipmentImageChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
        const mb = (file.size / 1024 / 1024).toFixed(2);
        toast.error(`Image size (${mb} MB) exceeds the 5 MB limit.`);
        e.target.value = '';
        return;
      }
      setEditEquipmentImageFile(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setEditEquipmentImagePreview(reader.result);
      };
      reader.readAsDataURL(file);
    } else {
      setEditEquipmentImageFile(null);
      setEditEquipmentImagePreview(null);
    }
  };

  const handleRemoveEditEquipmentImage = () => {
    setEditEquipmentImageFile(null);
    setEditEquipmentImagePreview(null);
    setEditEquipmentData(prev => ({ ...prev, Equipment_Image: '' }));
    const fileInput = document.getElementById('editEquipmentImageInput');
    if (fileInput) fileInput.value = '';
  };

  const handleUpdateEquipment = async () => {
    const payload = {
      Description: editEquipmentData.Description,
      Status: editEquipmentData.Status,
      Creation_Date: editEquipmentData.Creation_Date,
    };
    
    if (editEquipmentImageFile) {
      const reader = new FileReader();
      reader.onloadend = async () => {
        payload.Equipment_Image = reader.result;
        await saveUpdatedEquipment(payload);
      };
      reader.readAsDataURL(editEquipmentImageFile);
    } else if (editEquipmentImagePreview && !editEquipmentImageFile) {
      payload.Equipment_Image = editEquipmentData.Equipment_Image || editEquipmentImagePreview;
      await saveUpdatedEquipment(payload);
    } else if (!editEquipmentImagePreview && !editEquipmentImageFile) {
      payload.Equipment_Image = null;
      await saveUpdatedEquipment(payload);
    } else {
      await saveUpdatedEquipment(payload);
    }
  };

  const saveUpdatedEquipment = async (payload) => {
    if (!beginFlight(`saveUpdatedEquipment:${editEquipmentData.Equipment_Code}`)) return;
    try {
      if (!window.confirm(`Update equipment ${editEquipmentData.Equipment_Code}?`)) return;
      setLoading(true);
      try {
        const response = await equipmentMasterApi.updateEquipmentMaster(editEquipmentData.Equipment_Code, payload);
        if (response.ok) {
          toast.success('Equipment updated successfully.');
          handleCloseEditEquipmentModal();
          fetchEquipmentMasters(equipmentMasterCurrentPage);
        } else {
          toast.error(response.data?.message || 'Failed to update equipment.');
        }
      } catch (error) {
        console.error('Error updating equipment:', error);
        toast.error('Error connecting to server.');
      } finally {
        setLoading(false);
      }
    } finally {
      endFlight(`saveUpdatedEquipment:${editEquipmentData.Equipment_Code}`);
    }
  };

  const handleToggleEquipmentStatus = async (item) => {
    if (!beginFlight(`toggleEquipmentStatus:${item.Equipment_Code}`)) return;
    try {
      const newStatus = item.Status === 'Active' ? 'Inactive' : 'Active';
      if (!window.confirm(`Are you sure you want to ${newStatus === 'Active' ? 'activate' : 'deactivate'} equipment ${item.Equipment_Code}?`)) return;
      setLoading(true);
      try {
        let response;
        if (newStatus === 'Active') {
          response = await equipmentMasterApi.activateEquipmentMaster(item.Equipment_Code);
        } else {
          response = await equipmentMasterApi.deactivateEquipmentMaster(item.Equipment_Code);
        }
        if (response.ok) {
          toast.success(`Equipment ${newStatus.toLowerCase()}d.`);
          fetchEquipmentMasters(equipmentMasterCurrentPage);
        } else {
          toast.error(response.data?.message || 'Failed to update status.');
        }
      } catch (error) {
        console.error('Error toggling equipment status:', error);
        toast.error('Error connecting to server.');
      } finally {
        setLoading(false);
      }
    } finally {
      endFlight(`toggleEquipmentStatus:${item.Equipment_Code}`);
    }
  };

  const handleDeleteEquipment = async (item) => {
    if (!beginFlight(`deleteEquipment:${item.Equipment_Code}`)) return;
    try {
      const typed = window.prompt(
        `⚠️ PERMANENT DELETE ⚠️\n\n` +
        `You are about to permanently delete:\n` +
        `  Code: ${item.Equipment_Code}\n` +
        `  Description: ${item.Description || '-'}\n\n` +
        `This CANNOT be undone. Type DELETE to confirm.`
      );
      if (typed !== 'DELETE') {
        if (typed !== null) toast.warning('Deletion cancelled — confirmation text did not match.');
        return;
      }
      setLoading(true);
      try {
        const response = await equipmentMasterApi.deleteEquipmentMaster(item.Equipment_Code);
        if (response.ok) {
          toast.success(`Equipment "${item.Equipment_Code}" permanently deleted.`);
          const remainingOnPage = equipmentMasterRecords.length - 1;
          const newPage = remainingOnPage === 0 && equipmentMasterCurrentPage > 1
            ? equipmentMasterCurrentPage - 1
            : equipmentMasterCurrentPage;
          setEquipmentMasterCurrentPage(newPage);
          await fetchEquipmentMasters(newPage);
        } else {
          toast.error(response.data?.message || 'Failed to delete equipment.');
        }
      } catch (error) {
        console.error('Error deleting equipment:', error);
        toast.error('Error connecting to server.');
      } finally {
        setLoading(false);
      }
    } finally {
      endFlight(`deleteEquipment:${item.Equipment_Code}`);
    }
  };

  // ---------- Warehouse CRUD ----------
  const handleAddWarehouse = () => setShowAddWarehouse(true);
  const handleCloseWarehouseForm = () => {
    setShowAddWarehouse(false);
    setNewWarehouse({ warehouse_name: '', warehouse_code: '', warehouse_location: '', status: 'Active' });
  };
  const handleNewWarehouseChange = (e) => setNewWarehouse({ ...newWarehouse, [e.target.name]: e.target.value });
  const handleSaveWarehouse = async () => {
    if (!beginFlight('saveWarehouse')) return;
    try {
      if (!newWarehouse.warehouse_name.trim() || !newWarehouse.warehouse_code.trim()) {
        toast.warning('Warehouse Name and Code are required.');
        return;
      }
      if (!newWarehouse.warehouse_location || !newWarehouse.warehouse_location.trim()) {
        toast.warning('Warehouse Location is required.');
        return;
      }
      if (!window.confirm(`Create warehouse?\nName: ${newWarehouse.warehouse_name}\nCode: ${newWarehouse.warehouse_code}`)) return;
      try {
        const response = await warehouseApi.createWarehouse(newWarehouse);
        if (response.ok) {
          toast.success('Warehouse created.');
          handleCloseWarehouseForm();
          await fetchWarehouses();
        } else {
          toast.error(response.data?.message || 'Failed to create warehouse.');
        }
      } catch (error) {
        console.error('Error creating warehouse:', error);
        toast.error('Error connecting to server.');
      }
    } finally {
      endFlight('saveWarehouse');
    }
  };
  const handleEditWarehouse = (wh) => {
    setEditingWarehouse(wh);
    setEditWarehouseData({
      warehouse_id: wh.warehouse_id,
      warehouse_name: wh.warehouse_name,
      warehouse_code: wh.warehouse_code,
      warehouse_location: wh.warehouse_location || '',
      status: wh.status
    });
    setShowEditWarehouse(true);
  };
  const handleCloseEditWarehouse = () => {
    setShowEditWarehouse(false);
    setEditingWarehouse(null);
  };
  const handleEditWarehouseChange = (e) => setEditWarehouseData({ ...editWarehouseData, [e.target.name]: e.target.value });
  const handleUpdateWarehouse = async () => {
    if (!beginFlight(`updateWarehouse:${editWarehouseData.warehouse_id}`)) return;
    try {
      if (!editWarehouseData.warehouse_name.trim() || !editWarehouseData.warehouse_code.trim()) {
        toast.warning('Warehouse Name and Code are required.');
        return;
      }
      if (!editWarehouseData.warehouse_location || !editWarehouseData.warehouse_location.trim()) {
        toast.warning('Warehouse Location is required.');
        return;
      }
      if (!window.confirm(`Update warehouse?\nName: ${editWarehouseData.warehouse_name}\nCode: ${editWarehouseData.warehouse_code}`)) return;
      setLoading(true);
      try {
        const response = await warehouseApi.updateWarehouse(editWarehouseData.warehouse_id, editWarehouseData);
        if (response.ok) {
          toast.success('Warehouse updated.');
          handleCloseEditWarehouse();
          await fetchWarehouses();
        } else {
          toast.error(response.data?.message || 'Failed to update warehouse.');
        }
      } catch (error) {
        console.error('Error updating warehouse:', error);
        toast.error('Error connecting to server.');
      } finally {
        setLoading(false);
      }
    } finally {
      endFlight(`updateWarehouse:${editWarehouseData.warehouse_id}`);
    }
  };
  const handleDeactivateWarehouse = async (id) => {
    if (!window.confirm('Deactivate this warehouse?')) return;
    try {
      const response = await warehouseApi.deactivateWarehouse(id);
      if (response.ok) {
        toast.success('Warehouse deactivated.');
        await fetchWarehouses();
      } else {
        toast.error(response.data?.message || 'Failed to deactivate.');
      }
    } catch (error) {
      console.error('Error deactivating warehouse:', error);
      toast.error('Error connecting to server.');
    }
  };
  const handleActivateWarehouse = async (id) => {
    if (!window.confirm('Activate this warehouse?')) return;
    try {
      const response = await warehouseApi.activateWarehouse(id);
      if (response.ok) {
        toast.success('Warehouse activated.');
        await fetchWarehouses();
      } else {
        toast.error(response.data?.message || 'Failed to activate.');
      }
    } catch (error) {
      console.error('Error activating warehouse:', error);
      toast.error('Error connecting to server.');
    }
  };

  const handleDeleteWarehouse = async (wh) => {
    if (!beginFlight(`deleteWarehouse:${wh.warehouse_id}`)) return;
    try {
      const typed = window.prompt(
        `⚠️ PERMANENT DELETE — MAIN WAREHOUSE ⚠️\n\n` +
        `You are about to permanently delete:\n` +
        `  Code: ${wh.warehouse_code}\n` +
        `  Name: ${wh.warehouse_name}\n\n` +
        `This CANNOT be undone. Type DELETE to confirm.`
      );
      if (typed !== 'DELETE') {
        if (typed !== null) toast.warning('Deletion cancelled — confirmation text did not match.');
        return;
      }
      setLoading(true);
      try {
        const response = await warehouseApi.deleteWarehouse(wh.warehouse_id, 'DELETE');
        if (response.ok) {
          toast.success(`Warehouse "${wh.warehouse_code}" permanently deleted.`);
          await fetchWarehouses();
        } else {
          toast.error(response.data?.message || 'Failed to delete warehouse.');
        }
      } catch (error) {
        console.error('Error deleting warehouse:', error);
        toast.error('Error connecting to server.');
      } finally {
        setLoading(false);
      }
    } finally {
      endFlight(`deleteWarehouse:${wh.warehouse_id}`);
    }
  };

  // ---------- Barcode generation (Items) ----------
  const generateBarcode = () => {
    const code = newAdminItem.Item_Code.trim();
    if (!code) {
      toast.warning('Please enter an Item Code first.');
      return;
    }
    const barcode = `BC-${code}`;
    const exists = itemMasterRecords.some(item => item.Barcode === barcode) ||
                   (newAdminItem.Barcode && newAdminItem.Barcode === barcode);
    if (exists) {
      toast.error(`Barcode "${barcode}" already exists. Please use a different item code.`);
      return;
    }
    setNewAdminItem(prev => ({ ...prev, Barcode: barcode }));
    setTimeout(() => {
      if (barcodeCanvasRef.current) {
        try {
          JsBarcode(barcodeCanvasRef.current, barcode, {
            format: 'CODE128',
            width: 2,
            height: 60,
            displayValue: true,
            fontSize: 16,
            margin: 5,
            background: '#ffffff',
            lineColor: '#1a1f26'
          });
          if (barcodeImageRef.current) {
            barcodeImageRef.current.src = barcodeCanvasRef.current.toDataURL('image/png');
          }
        } catch (error) {
          console.error('Barcode generation error:', error);
        }
      }
    }, 100);
  };

  const exportBarcodeImage = () => {
    if (!barcodeCanvasRef.current) {
      toast.warning('Please generate a barcode first.');
      return;
    }
    try {
      const canvas = barcodeCanvasRef.current;
      const link = document.createElement('a');
      link.download = `barcode-${newAdminItem.Barcode || 'item'}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    } catch (error) {
      console.error('Export error:', error);
      toast.error('Error exporting barcode image.');
    }
  };

  const handleToggleCreateItemForm = () => {
    setShowCreateItemForm(!showCreateItemForm);
    if (!showCreateItemForm) {
      setNewAdminItem({
        Item_Code: '',
        Item_Description: '',
        Uom_Code: '',
        Uom_Description: '',
        Gl_Class: '',
        Gl_Description: '',
        Purchase_Class: '',
        Category: '',
        List_Price_Per_Unit: 0.00,
        Status: 'Active',
        Creation_Date: new Date().toISOString().split('T')[0],
        Barcode: '',
      });
      setNewAdminItemImage(null);
      setNewAdminItemImagePreview(null);
    } else {
      setNewAdminItemImage(null);
      setNewAdminItemImagePreview(null);
    }
  };

  const handleNewAdminItemChange = (e) => {
    const { name, value } = e.target;
    setNewAdminItem(prev => ({ ...prev, [name]: value }));
  };

  const handleImageChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
        const mb = (file.size / 1024 / 1024).toFixed(2);
        toast.error(`Image size (${mb} MB) exceeds the 5 MB limit.`);
        e.target.value = '';
        return;
      }
      setNewAdminItemImage(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setNewAdminItemImagePreview(reader.result);
      };
      reader.readAsDataURL(file);
    } else {
      setNewAdminItemImage(null);
      setNewAdminItemImagePreview(null);
    }
  };

  const handleRemoveImage = () => {
    setNewAdminItemImage(null);
    setNewAdminItemImagePreview(null);
    const fileInput = document.getElementById('adminItemImageInput');
    if (fileInput) fileInput.value = '';
  };

  const onUomChange = (e) => {
    const value = e.target.value;
    setNewAdminItem(prev => ({ ...prev, Uom_Code: value }));
    const selectedUom = uomList.find(u => u.code === value);
    if (selectedUom) {
      setNewAdminItem(prev => ({ ...prev, Uom_Description: selectedUom.description }));
    } else {
      setNewAdminItem(prev => ({ ...prev, Uom_Description: '' }));
    }
  };
  const onGlChange = (e) => {
    const value = e.target.value;
    setNewAdminItem(prev => ({ ...prev, Gl_Class: value }));
    const selectedGl = glList.find(g => String(g.id) === value);
    if (selectedGl) {
      setNewAdminItem(prev => ({ ...prev, Gl_Description: selectedGl.description }));
    } else {
      setNewAdminItem(prev => ({ ...prev, Gl_Description: '' }));
    }
  };
  const onPurchaseClassChange = (e) => {
    setNewAdminItem(prev => ({ ...prev, Purchase_Class: e.target.value }));
  };
  const onCategoryChange = (e) => {
    setNewAdminItem(prev => ({ ...prev, Category: e.target.value }));
  };

  const handleSaveAdminItem = async () => {
    if (!beginFlight('saveAdminItem')) return;
    try {
      const code = newAdminItem.Item_Code.trim();
      const desc = newAdminItem.Item_Description.trim();
      if (!code) { toast.warning('Item Code is required.'); return; }
      if (!desc) { toast.warning('Item Description is required.'); return; }
      const exists = itemMasterRecords.some(item => item.Item_Code.toLowerCase() === code.toLowerCase());
      if (exists) {
        toast.error(`Item Code "${code}" already exists in the database.`);
        return;
      }
      if (!newAdminItem.Uom_Code) { toast.warning('Please select a UOM.'); return; }
      if (!newAdminItem.Gl_Class) { toast.warning('Please select a GL Class.'); return; }
      if (!newAdminItem.Purchase_Class) { toast.warning('Please select a Purchase Class.'); return; }
      if (!newAdminItem.Category) { toast.warning('Please select a Category.'); return; }
      if (!newAdminItem.Barcode) {
        toast.warning('Please generate a barcode first.');
        return;
      }
      const payload = {
        Creation_Date: newAdminItem.Creation_Date,
        Item_Code: code,
        Item_Description: desc,
        Uom_Code: newAdminItem.Uom_Code,
        Uom_Description: newAdminItem.Uom_Description,
        Gl_Class: parseInt(newAdminItem.Gl_Class),
        Gl_Description: newAdminItem.Gl_Description,
        Purchase_Class: newAdminItem.Purchase_Class,
        Category: newAdminItem.Category,
        List_Price_Per_Unit: parseFloat(newAdminItem.List_Price_Per_Unit) || 0,
        Status: newAdminItem.Status,
        Barcode: newAdminItem.Barcode,
      };
      if (newAdminItemImagePreview) {
        payload.Item_Image = newAdminItemImagePreview;
      }
      const confirmMessage = `Create new item in item_master table?\n\n` +
        `Code: ${payload.Item_Code}\n` +
        `Description: ${payload.Item_Description}\n` +
        `UOM: ${payload.Uom_Code} - ${payload.Uom_Description}\n` +
        `GL: ${payload.Gl_Class} - ${payload.Gl_Description}\n` +
        `Purchase Class: ${payload.Purchase_Class}\n` +
        `Category: ${payload.Category}\n` +
        `List Price: ${payload.List_Price_Per_Unit}\n` +
        `Status: ${payload.Status}\n` +
        `Creation Date: ${payload.Creation_Date}\n` +
        `Barcode: ${payload.Barcode}\n` +
        `Image: ${newAdminItemImagePreview ? 'Yes' : 'No'}`;
      if (!window.confirm(confirmMessage)) return;
      setLoading(true);
      try {
        const response = await itemMasterApi.createItemMaster(payload);
        if (response.ok) {
          toast.success('Item successfully saved to item_master table.');
          setNewAdminItem({
            Item_Code: '',
            Item_Description: '',
            Uom_Code: '',
            Uom_Description: '',
            Gl_Class: '',
            Gl_Description: '',
            Purchase_Class: '',
            Category: '',
            List_Price_Per_Unit: 0.00,
            Status: 'Active',
            Creation_Date: new Date().toISOString().split('T')[0],
            Barcode: '',
          });
          setNewAdminItemImage(null);
          setNewAdminItemImagePreview(null);
          setShowCreateItemForm(false);
          setItemMasterCurrentPage(1);
          setItemMasterSearchTerm('');
          await fetchItemMasters(1);
          await fetchItemMastersForDashboard(1);
          await fetchItemsAndReleases();
          await fetchItemFilterOptions();
        } else {
          const errorMsg = response.data?.message || 'Failed to save item.';
          toast.error(errorMsg);
        }
      } catch (error) {
        console.error('Error saving item to item_master:', error);
        toast.error('Error connecting to server. Please try again.');
      } finally {
        setLoading(false);
      }
    } finally {
      endFlight('saveAdminItem');
    }
  };

  const handleEditMasterItem = (item) => {
    setEditMasterData({
      Item_Code: item.Item_Code,
      Item_Description: item.Item_Description || '',
      Uom_Code: item.Uom_Code || '',
      Uom_Description: item.Uom_Description || '',
      Gl_Class: item.Gl_Class || '',
      Gl_Description: item.Gl_Description || '',
      Purchase_Class: item.Purchase_Class || '',
      Category: item.Category || '',
      List_Price_Per_Unit: item.List_Price_Per_Unit || 0,
      Status: item.Status || 'Active',
      Creation_Date: item.Creation_Date ? new Date(item.Creation_Date).toISOString().split('T')[0] : '',
      Barcode: item.Barcode || '',
      Item_Image: item.Item_Image || '',
    });
    if (item.Item_Image) {
      setEditMasterImagePreview(item.Item_Image);
    } else {
      setEditMasterImagePreview(null);
    }
    setEditMasterImageFile(null);
    setShowEditMasterModal(true);
  };

  const handleCloseEditMasterModal = () => {
    setShowEditMasterModal(false);
    setEditMasterData({
      Item_Code: '',
      Item_Description: '',
      Uom_Code: '',
      Uom_Description: '',
      Gl_Class: '',
      Gl_Description: '',
      Purchase_Class: '',
      Category: '',
      List_Price_Per_Unit: 0,
      Status: 'Active',
      Creation_Date: '',
      Barcode: '',
      Item_Image: '',
    });
    setEditMasterImageFile(null);
    setEditMasterImagePreview(null);
  };

  const handleEditMasterChange = (e) => {
    const { name, value } = e.target;
    setEditMasterData(prev => ({ ...prev, [name]: value }));
  };

  const handleEditMasterImageChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
        const mb = (file.size / 1024 / 1024).toFixed(2);
        toast.error(`Image size (${mb} MB) exceeds the 5 MB limit.`);
        e.target.value = '';
        return;
      }
      setEditMasterImageFile(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setEditMasterImagePreview(reader.result);
      };
      reader.readAsDataURL(file);
    } else {
      setEditMasterImageFile(null);
      setEditMasterImagePreview(null);
    }
  };

  const handleRemoveEditMasterImage = () => {
    setEditMasterImageFile(null);
    setEditMasterImagePreview(null);
    setEditMasterData(prev => ({ ...prev, Item_Image: '' }));
    const fileInput = document.getElementById('editMasterImageInput');
    if (fileInput) fileInput.value = '';
  };

  const handleUpdateMasterItem = async () => {
    const payload = {
      Item_Description: editMasterData.Item_Description,
      Uom_Code: editMasterData.Uom_Code,
      Uom_Description: editMasterData.Uom_Description,
      Gl_Class: parseInt(editMasterData.Gl_Class) || 0,
      Gl_Description: editMasterData.Gl_Description,
      Purchase_Class: editMasterData.Purchase_Class,
      Category: editMasterData.Category,
      List_Price_Per_Unit: parseFloat(editMasterData.List_Price_Per_Unit) || 0,
      Status: editMasterData.Status,
      Creation_Date: editMasterData.Creation_Date,
    };
    if (editMasterImageFile) {
      const reader = new FileReader();
      reader.onloadend = async () => {
        payload.Item_Image = reader.result;
        await saveUpdatedItem(payload);
      };
      reader.readAsDataURL(editMasterImageFile);
    } else if (editMasterImagePreview && !editMasterImageFile) {
      payload.Item_Image = editMasterData.Item_Image || editMasterImagePreview;
      await saveUpdatedItem(payload);
    } else if (!editMasterImagePreview && !editMasterImageFile) {
      payload.Item_Image = null;
      await saveUpdatedItem(payload);
    } else {
      await saveUpdatedItem(payload);
    }
  };

  const saveUpdatedItem = async (payload) => {
    if (!beginFlight(`saveUpdatedItem:${editMasterData.Item_Code}`)) return;
    try {
      if (!window.confirm(`Update item ${editMasterData.Item_Code}?`)) return;
      setLoading(true);
      try {
        const response = await itemMasterApi.updateItemMaster(editMasterData.Item_Code, payload);
        if (response.ok) {
          toast.success('Item updated successfully.');
          handleCloseEditMasterModal();
          fetchItemMasters(itemMasterCurrentPage);
          fetchItemMastersForDashboard(1);
          fetchItemFilterOptions();
        } else {
          toast.error(response.data?.message || 'Failed to update item.');
        }
      } catch (error) {
        console.error('Error updating item:', error);
        toast.error('Error connecting to server.');
      } finally {
        setLoading(false);
      }
    } finally {
      endFlight(`saveUpdatedItem:${editMasterData.Item_Code}`);
    }
  };

  const handleToggleMasterStatus = async (item) => {
    if (!beginFlight(`toggleMasterStatus:${item.Item_Code}`)) return;
    try {
      const newStatus = item.Status === 'Active' ? 'Inactive' : 'Active';
      if (!window.confirm(`Are you sure you want to ${newStatus === 'Active' ? 'activate' : 'deactivate'} item ${item.Item_Code}?`)) return;
      setLoading(true);
      try {
        let response;
        if (newStatus === 'Active') {
          response = await itemMasterApi.activateItemMaster(item.Item_Code);
        } else {
          response = await itemMasterApi.deactivateItemMaster(item.Item_Code);
        }
        if (response.ok) {
          toast.success(`Item ${newStatus.toLowerCase()}d.`);
          fetchItemMasters(itemMasterCurrentPage);
          fetchItemMastersForDashboard(1);
        } else {
          toast.error(response.data?.message || 'Failed to update status.');
        }
      } catch (error) {
        console.error('Error toggling status:', error);
        toast.error('Error connecting to server.');
      } finally {
        setLoading(false);
      }
    } finally {
      endFlight(`toggleMasterStatus:${item.Item_Code}`);
    }
  };

  const handleDeleteMasterItem = async (item) => {
    if (!beginFlight(`deleteMasterItem:${item.Item_Code}`)) return;
    try {
      const typed = window.prompt(
        `⚠️ PERMANENT DELETE ⚠️\n\n` +
        `You are about to permanently delete:\n` +
        `  Code: ${item.Item_Code}\n` +
        `  Description: ${item.Item_Description || '-'}\n\n` +
        `This CANNOT be undone. Type DELETE to confirm.`
      );
      if (typed !== 'DELETE') {
        if (typed !== null) toast.warning('Deletion cancelled — confirmation text did not match.');
        return;
      }
      setLoading(true);
      try {
        const response = await itemMasterApi.deleteItemMaster(item.Item_Code);
        if (response.ok) {
          toast.success(`Item "${item.Item_Code}" permanently deleted.`);
          const remainingOnPage = itemMasterRecords.length - 1;
          const newPage = remainingOnPage === 0 && itemMasterCurrentPage > 1
            ? itemMasterCurrentPage - 1
            : itemMasterCurrentPage;
          setItemMasterCurrentPage(newPage);
          await fetchItemMasters(newPage);
          await fetchItemMastersForDashboard(1);
          await fetchItemFilterOptions();
        } else {
          toast.error(response.data?.message || 'Failed to delete item.');
        }
      } catch (error) {
        console.error('Error deleting item:', error);
        toast.error('Error connecting to server.');
      } finally {
        setLoading(false);
      }
    } finally {
      endFlight(`deleteMasterItem:${item.Item_Code}`);
    }
  };

  const handleRowClick = (item) => {
    setDetailItem(item);
    setShowDetailModal(true);
  };
  const handleCloseDetailModal = () => {
    setShowDetailModal(false);
    setDetailItem(null);
  };

  const nextDashboardItem = () => {
    if (dashboardItems.length > 0) {
      setDashboardItemIndex((prev) => (prev + 1) % dashboardItems.length);
    }
  };
  const prevDashboardItem = () => {
    if (dashboardItems.length > 0) {
      setDashboardItemIndex((prev) => (prev - 1 + dashboardItems.length) % dashboardItems.length);
    }
  };

  const handleExportMonthly = () => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const monthItems = addedItems.filter(item => {
      const d = new Date(item.created_at);
      return d >= monthStart && d <= monthEnd;
    });
    const monthReleases = releaseRecords.filter(r => {
      const d = new Date(r.created_at);
      return d >= monthStart && d <= monthEnd;
    });
    if (monthItems.length === 0 && monthReleases.length === 0) {
      toast.warning('No data available for the current month.');
      return;
    }
    try {
      const wb = XLSX.utils.book_new();
      const itemsData = monthItems.map(item => ({
        'Code': item.item_code,
        'Item Name': item.item_name,
        'Category': item.category_name || '',
        'GL Number': item.gl_number || '',
        'GL Description': item.gl_description || '',
        'UOM Code': item.uom_code || '',
        'UOM Description': item.uom_description || '',
        'Purchase Class': item.purchase_class_name || '',
        'Quantity': item.quantity || 1,
        'List Price': item.list_price || 0,
        'Added By': item.added_by || 'System',
        'Date Added': new Date(item.created_at).toLocaleString(),
        'Status': item.status || 'Active',
        'Barcode': item.barcode || item.item_code || '',
        'Damage Reason': item.damageReason || '',
      }));
      const ws1 = XLSX.utils.json_to_sheet(itemsData);
      XLSX.utils.book_append_sheet(wb, ws1, 'Items Added');
      const releasesData = monthReleases.map(r => ({
        'Item Code': r.item_code,
        'Item Name': r.item_name,
        'Quantity': r.quantity,
        'Unit': r.unit,
        'Reason': r.reason,
        'Released By': r.released_by || 'System',
        'Date Released': new Date(r.created_at).toLocaleString(),
        'Warehouse ID': r.warehouse_id
      }));
      const ws2 = XLSX.utils.json_to_sheet(releasesData);
      XLSX.utils.book_append_sheet(wb, ws2, 'Releases');
      const fileName = `Inventory_Report_${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}.xlsx`;
      XLSX.writeFile(wb, fileName);
      toast.success('Monthly report exported successfully.');
    } catch (error) {
      console.error('Export error:', error);
      toast.error('Error exporting monthly report.');
    }
  };

  return {
    // State
    stats,
    itemsMonthData,
    releasesMonthData,
    yearlyData,
    users,
    warehouses,
    addedItems,
    releaseRecords,
    dailyItems,
    dailyReleases,
    glList,
    uomList,
    purchaseClassList,
    categoryList,
    itemMasterRecords,
    itemMasterLoading,
    itemMasterCurrentPage,
    setItemMasterCurrentPage,
    itemMasterTotalPages,
    itemMasterTotalCount,
    itemMasterSearchTerm,
    setItemMasterSearchTerm,
    
    // Item Master column filters
    itemMasterGlFilter, setItemMasterGlFilter,
    itemMasterPurchaseClassFilter, setItemMasterPurchaseClassFilter,
    itemMasterCategoryFilter, setItemMasterCategoryFilter,
    itemMasterFilterOptions,

    // Equipment Master
    equipmentMasterRecords, equipmentMasterLoading, equipmentMasterCurrentPage, setEquipmentMasterCurrentPage,
    equipmentMasterTotalPages, equipmentMasterTotalCount, equipmentMasterSearchTerm, setEquipmentMasterSearchTerm,
    showCreateEquipmentForm, setShowCreateEquipmentForm, newEquipment, setNewEquipment,
    newEquipmentImagePreview, equipmentBarcodeCanvasRef, equipmentBarcodeImageRef,
    showEditEquipmentModal, setShowEditEquipmentModal, editEquipmentData, setEditEquipmentData,
    editEquipmentImagePreview,
    fetchEquipmentMasters, generateEquipmentBarcode, handleSaveEquipment, handleEditEquipment,
    handleUpdateEquipment, handleToggleEquipmentStatus, handleDeleteEquipment,
    handleToggleCreateEquipmentForm, handleNewEquipmentChange, handleNewEquipmentImageChange,
    handleRemoveNewEquipmentImage, handleEditEquipmentChange, handleEditEquipmentImageChange,
    handleRemoveEditEquipmentImage, handleCloseEditEquipmentModal,

    // UOM Conversions    ← ADDED
    uomConversionRecords,
    uomConversionLoading,
    uomConversionCurrentPage,
    setUomConversionCurrentPage,
    uomConversionTotalPages,
    uomConversionTotalCount,
    uomConversionSearchTerm,
    setUomConversionSearchTerm,
    uomConversionItemOptions,
    showCreateUomConversionForm,
    setShowCreateUomConversionForm,
    newUomConversion,
    setNewUomConversion,
    showEditUomConversionModal,
    setShowEditUomConversionModal,
    editUomConversionData,
    setEditUomConversionData,
    fetchUomConversions,
    fetchUomConversionItemOptions,
    handleSaveUomConversion,
    handleEditUomConversion,
    handleUpdateUomConversion,
    handleDeleteUomConversion,
    handleCloseUomConversionForm,
    handleCloseEditUomConversionModal,

    // Cost Center
    costCenterRecords, costCenterLoading, costCenterCurrentPage, setCostCenterCurrentPage,
    costCenterTotalPages, costCenterTotalCount, costCenterSearchTerm, setCostCenterSearchTerm,
    showCreateCostCenterForm, setShowCreateCostCenterForm, newCostCenter, setNewCostCenter,
    showEditCostCenterModal, setShowEditCostCenterModal, editCostCenterData, setEditCostCenterData,
    fetchCostCenters, handleSaveCostCenter, handleEditCostCenter, handleUpdateCostCenter,
    handleToggleCostCenterStatus, handleDeleteCostCenter,

    dashboardItems,
    dashboardTotalCount,
    dashboardItemIndex,
    setDashboardItemIndex,
    fetching,
    loading,
    highlightedClass,
    setHighlightedClass,
    showCreateItemForm,
    newAdminItem,
    newAdminItemImagePreview,
    barcodeCanvasRef,
    barcodeImageRef,
    showEditMasterModal,
    editMasterData,
    editMasterImagePreview,
    showDetailModal,
    detailItem,
    glSearch, setGlSearch,
    glPage, setGlPage,
    uomSearch, setUomSearch,
    uomPage, setUomPage,
    purchaseClassSearch, setPurchaseClassSearch,
    purchaseClassPage, setPurchaseClassPage,
    categorySearch, setCategorySearch,
    categoryPage, setCategoryPage,
    showAddGl, setShowAddGl,
    newGl, setNewGl,
    showAddUom, setShowAddUom,
    newUom, setNewUom,
    showAddPurchaseClass, setShowAddPurchaseClass,
    newPurchaseClass, setNewPurchaseClass,
    showAddCategory, setShowAddCategory,
    newCategory, setNewCategory,
    showEditGl, setShowEditGl,
    editGlData, setEditGlData,
    showEditUom, setShowEditUom,
    editUomData, setEditUomData,
    showEditPurchaseClass, setShowEditPurchaseClass,
    editPurchaseClassData, setEditPurchaseClassData,
    showEditCategory, setShowEditCategory,
    editCategoryData, setEditCategoryData,
    showAddWarehouse, setShowAddWarehouse,
    showEditWarehouse, setShowEditWarehouse,
    editingWarehouse, setEditingWarehouse,
    newWarehouse, setNewWarehouse,
    editWarehouseData, setEditWarehouseData,
    itemListSearchTerm, setItemListSearchTerm,
    startDate, setStartDate,
    endDate, setEndDate,
    receivedSearchTerm, setReceivedSearchTerm,
    receivedStartDate, setReceivedStartDate,
    receivedEndDate, setReceivedEndDate,
    receivedClassFilter, setReceivedClassFilter,
    releasedSearchTerm, setReleasedSearchTerm,
    releasedStartDate, setReleasedStartDate,
    releasedEndDate, setReleasedEndDate,
    releasedClassFilter, setReleasedClassFilter,
    damagedItemsCount,
    // Functions
    generateBarcodeDataUrl,
    fetchUsers,
    fetchWarehouses,
    fetchDamagedItemsCount,
    fetchMasterData,
    fetchItemMasters,
    fetchItemFilterOptions,
    fetchItemMastersForDashboard,
    fetchItemsAndReleases,
    updateStatsFromItemsAndReleases,
    computeYearlyData,
    handleAddGl,
    handleCloseGlForm,
    handleNewGlChange,
    handleSaveGl,
    handleDeleteGl,
    handleEditGl,
    handleCloseEditGl,
    handleEditGlChange,
    handleUpdateGl,
    handleAddUom,
    handleCloseUomForm,
    handleNewUomChange,
    handleSaveUom,
    handleDeleteUom,
    handleEditUom,
    handleCloseEditUom,
    handleEditUomChange,
    handleUpdateUom,
    handleAddPurchaseClass,
    handleClosePurchaseClassForm,
    handleNewPurchaseClassChange,
    handleSavePurchaseClass,
    handleDeletePurchaseClass,
    handleEditPurchaseClass,
    handleCloseEditPurchaseClass,
    handleEditPurchaseClassChange,
    handleUpdatePurchaseClass,
    handleAddCategory,
    handleCloseCategoryForm,
    handleNewCategoryChange,
    handleSaveCategory,
    handleDeleteCategory,
    handleEditCategory,
    handleCloseEditCategory,
    handleEditCategoryChange,
    handleUpdateCategory,
    handleAddWarehouse,
    handleCloseWarehouseForm,
    handleNewWarehouseChange,
    handleSaveWarehouse,
    handleEditWarehouse,
    handleCloseEditWarehouse,
    handleEditWarehouseChange,
    handleUpdateWarehouse,
    handleDeactivateWarehouse,
    handleActivateWarehouse,
    handleDeleteWarehouse,
    generateBarcode,
    exportBarcodeImage,
    handleToggleCreateItemForm,
    handleNewAdminItemChange,
    handleImageChange,
    handleRemoveImage,
    onUomChange,
    onGlChange,
    onPurchaseClassChange,
    onCategoryChange,
    handleSaveAdminItem,
    handleEditMasterItem,
    handleCloseEditMasterModal,
    handleEditMasterChange,
    handleEditMasterImageChange,
    handleRemoveEditMasterImage,
    handleUpdateMasterItem,
    handleToggleMasterStatus,
    handleDeleteMasterItem,
    handleRowClick,
    handleCloseDetailModal,
    nextDashboardItem,
    prevDashboardItem,
    handleExportMonthly,
    currentUser,
    ITEMS_PER_PAGE,
    ITEMS_PER_PAGE_MASTER,
  };
};