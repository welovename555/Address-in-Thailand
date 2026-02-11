/**
 * Thai Address Picker - Main Application
 * 
 * Features:
 * - Load geography.json and build in-memory indexes
 * - Hierarchical dropdown selection (province → district → subdistrict → postal)
 * - Quick search with debouncing
 * - Integrity check for data completeness
 * - Copy to clipboard with fallback
 */

// ============================================================================
// DATA STRUCTURES & STATE
// ============================================================================

let geographyData = [];
let provinceMap = new Map();      // Map<provinceCode, {code, nameTh, nameEn}>
let districtMap = new Map();      // Map<districtCode, {code, provinceCode, nameTh, nameEn}>
let subdistrictMap = new Map();   // Map<subdistrictCode, {code, districtCode, provinceCode, nameTh, nameEn, postal}>
let searchIndex = [];             // Array of searchable items

let currentSelection = {
    province: null,
    district: null,
    subdistrict: null,
    postal: null
};

// ============================================================================
// DOM ELEMENTS
// ============================================================================

const statusMessage = document.getElementById('statusMessage');
const integrityWarning = document.getElementById('integrityWarning');
const provinceSelect = document.getElementById('province');
const districtSelect = document.getElementById('district');
const subdistrictSelect = document.getElementById('subdistrict');
const postalInput = document.getElementById('postal');
const previewText = document.getElementById('preview');
const copyBtn = document.getElementById('copyBtn');
const resetBtn = document.getElementById('resetBtn');
const quickSearchInput = document.getElementById('quickSearch');
const suggestionsContainer = document.getElementById('suggestions');
const copyFeedback = document.getElementById('copyFeedback');

// ============================================================================
// INITIALIZATION
// ============================================================================

document.addEventListener('DOMContentLoaded', async () => {
    try {
        showStatus('กำลังโหลดข้อมูล...', 'loading');
        await loadGeographyData();
        buildIndexes();
        checkDataIntegrity();
        setupEventListeners();
        showStatus('โหลดสำเร็จ', 'success');
        setTimeout(() => hideStatus(), 2000);
    } catch (error) {
        console.error('Error initializing app:', error);
        showStatus(`เกิดข้อผิดพลาด: ${error.message}`, 'error');
    }
});

// ============================================================================
// DATA LOADING
// ============================================================================

/**
 * Load geography.json from public/data directory
 * Handles flexible key naming (e.g., postalCode vs postal_code)
 */
async function loadGeographyData() {
    try {
        const response = await fetch('/data/geography.json');
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ไม่พบไฟล์ data/geography.json`);
        }
        
        const rawData = await response.json();
        
        if (!Array.isArray(rawData)) {
            throw new Error('ข้อมูลต้องเป็น array');
        }

        // Normalize keys to handle variations (postalCode, postal_code, etc.)
        geographyData = rawData.map(item => normalizeKeys(item));
        
        if (geographyData.length === 0) {
            throw new Error('ไฟล์ข้อมูลว่างเปล่า');
        }
    } catch (error) {
        throw new Error(`ไม่สามารถโหลดข้อมูล: ${error.message}`);
    }
}

/**
 * Normalize object keys to handle variations
 * e.g., postal_code → postalCode, subdistrictNameTh → subdistrictNameTh
 */
function normalizeKeys(item) {
    const normalized = {};
    
    for (const [key, value] of Object.entries(item)) {
        // Convert snake_case to camelCase
        const camelKey = key.replace(/_([a-z])/g, (g) => g[1].toUpperCase());
        normalized[camelKey] = value;
    }
    
    return normalized;
}

// ============================================================================
// INDEX BUILDING
// ============================================================================

/**
 * Build in-memory indexes for fast lookups
 * - Province map (unique provinces)
 * - District map (districts by province)
 * - Subdistrict map (subdistricts by district)
 * - Search index (for quick search)
 */
function buildIndexes() {
    provinceMap.clear();
    districtMap.clear();
    subdistrictMap.clear();
    searchIndex = [];

    // Build province map (unique)
    const uniqueProvinces = new Map();
    geographyData.forEach(item => {
        if (!uniqueProvinces.has(item.provinceCode)) {
            uniqueProvinces.set(item.provinceCode, {
                code: item.provinceCode,
                nameTh: item.provinceNameTh,
                nameEn: item.provinceNameEn
            });
        }
    });
    provinceMap = uniqueProvinces;

    // Build district map (unique)
    const uniqueDistricts = new Map();
    geographyData.forEach(item => {
        if (!uniqueDistricts.has(item.districtCode)) {
            uniqueDistricts.set(item.districtCode, {
                code: item.districtCode,
                provinceCode: item.provinceCode,
                nameTh: item.districtNameTh,
                nameEn: item.districtNameEn
            });
        }
    });
    districtMap = uniqueDistricts;

    // Build subdistrict map (unique)
    const uniqueSubdistricts = new Map();
    geographyData.forEach(item => {
        if (!uniqueSubdistricts.has(item.subdistrictCode)) {
            uniqueSubdistricts.set(item.subdistrictCode, {
                code: item.subdistrictCode,
                districtCode: item.districtCode,
                provinceCode: item.provinceCode,
                nameTh: item.subdistrictNameTh,
                nameEn: item.subdistrictNameEn,
                postal: item.postalCode
            });
        }
    });
    subdistrictMap = uniqueSubdistricts;

    // Build search index
    searchIndex = Array.from(uniqueSubdistricts.values()).map(sub => ({
        type: 'subdistrict',
        nameTh: sub.nameTh,
        nameEn: sub.nameEn,
        postal: sub.postal,
        code: sub.code,
        districtCode: sub.districtCode,
        provinceCode: sub.provinceCode
    }));

    Array.from(uniqueDistricts.values()).forEach(dist => {
        searchIndex.push({
            type: 'district',
            nameTh: dist.nameTh,
            nameEn: dist.nameEn,
            code: dist.code,
            provinceCode: dist.provinceCode
        });
    });

    Array.from(uniqueProvinces.values()).forEach(prov => {
        searchIndex.push({
            type: 'province',
            nameTh: prov.nameTh,
            nameEn: prov.nameEn,
            code: prov.code
        });
    });
}

// ============================================================================
// DATA INTEGRITY CHECK
// ============================================================================

/**
 * Verify data completeness
 * Expected counts:
 * - Provinces: 77
 * - Districts: 928
 * - Subdistricts: 7,436
 */
function checkDataIntegrity() {
    const provinceCount = provinceMap.size;
    const districtCount = districtMap.size;
    const subdistrictCount = subdistrictMap.size;

    const isValid = 
        provinceCount >= 77 &&
        districtCount >= 928 &&
        subdistrictCount >= 7436;

    if (!isValid) {
        integrityWarning.classList.add('show');
        console.warn(`Data integrity check failed:
            Provinces: ${provinceCount} (expected: 77)
            Districts: ${districtCount} (expected: 928)
            Subdistricts: ${subdistrictCount} (expected: 7,436)`);
    } else {
        integrityWarning.classList.remove('show');
        console.log(`✓ Data integrity check passed:
            Provinces: ${provinceCount}
            Districts: ${districtCount}
            Subdistricts: ${subdistrictCount}`);
    }
}

// ============================================================================
// EVENT LISTENERS & INTERACTIONS
// ============================================================================

function setupEventListeners() {
    // Province selection
    provinceSelect.addEventListener('change', handleProvinceChange);
    
    // District selection
    districtSelect.addEventListener('change', handleDistrictChange);
    
    // Subdistrict selection
    subdistrictSelect.addEventListener('change', handleSubdistrictChange);
    
    // Quick search
    quickSearchInput.addEventListener('input', handleQuickSearch);
    document.addEventListener('click', handleClickOutside);
    
    // Copy & Reset buttons
    copyBtn.addEventListener('click', handleCopy);
    resetBtn.addEventListener('click', handleReset);
}

/**
 * Handle province selection
 * - Update district dropdown with districts from selected province
 * - Clear district and subdistrict selections
 */
function handleProvinceChange() {
    const provinceCode = provinceSelect.value;
    currentSelection.province = provinceCode;
    currentSelection.district = null;
    currentSelection.subdistrict = null;
    currentSelection.postal = null;

    // Clear and disable district/subdistrict
    districtSelect.innerHTML = '<option value="">-- เลือกเขต/อำเภอ --</option>';
    districtSelect.disabled = true;
    subdistrictSelect.innerHTML = '<option value="">-- เลือกแขวง/ตำบล --</option>';
    subdistrictSelect.disabled = true;
    postalInput.value = '';

    if (!provinceCode) {
        updatePreview();
        return;
    }

    // Get districts for selected province
    const districts = Array.from(districtMap.values())
        .filter(d => d.provinceCode === parseInt(provinceCode))
        .sort((a, b) => a.nameTh.localeCompare(b.nameTh));

    districts.forEach(district => {
        const option = document.createElement('option');
        option.value = district.code;
        option.textContent = `${district.nameTh} (${district.nameEn})`;
        districtSelect.appendChild(option);
    });

    districtSelect.disabled = false;
    updatePreview();
}

/**
 * Handle district selection
 * - Update subdistrict dropdown with subdistricts from selected district
 * - Clear subdistrict selection
 */
function handleDistrictChange() {
    const districtCode = districtSelect.value;
    currentSelection.district = districtCode;
    currentSelection.subdistrict = null;
    currentSelection.postal = null;

    // Clear and disable subdistrict
    subdistrictSelect.innerHTML = '<option value="">-- เลือกแขวง/ตำบล --</option>';
    subdistrictSelect.disabled = true;
    postalInput.value = '';

    if (!districtCode) {
        updatePreview();
        return;
    }

    // Get subdistricts for selected district
    const subdistricts = Array.from(subdistrictMap.values())
        .filter(s => s.districtCode === parseInt(districtCode))
        .sort((a, b) => a.nameTh.localeCompare(b.nameTh));

    subdistricts.forEach(subdistrict => {
        const option = document.createElement('option');
        option.value = subdistrict.code;
        option.textContent = `${subdistrict.nameTh} (${subdistrict.nameEn})`;
        subdistrictSelect.appendChild(option);
    });

    subdistrictSelect.disabled = false;
    updatePreview();
}

/**
 * Handle subdistrict selection
 * - Auto-fill postal code
 * - Update preview
 */
function handleSubdistrictChange() {
    const subdistrictCode = subdistrictSelect.value;
    currentSelection.subdistrict = subdistrictCode;

    if (!subdistrictCode) {
        postalInput.value = '';
        currentSelection.postal = null;
        updatePreview();
        return;
    }

    const subdistrict = subdistrictMap.get(parseInt(subdistrictCode));
    if (subdistrict) {
        postalInput.value = subdistrict.postal || '';
        currentSelection.postal = subdistrict.postal;
    }

    updatePreview();
}

/**
 * Quick search with debouncing
 * - Minimum 2 characters
 * - Show up to 12 suggestions
 * - Support Thai/English names and postal codes
 */
let searchTimeout;
function handleQuickSearch() {
    clearTimeout(searchTimeout);
    const query = quickSearchInput.value.trim();

    if (query.length < 2) {
        suggestionsContainer.classList.remove('show');
        return;
    }

    searchTimeout = setTimeout(() => {
        const results = performSearch(query);
        displaySuggestions(results);
    }, 150); // Debounce 150ms
}

/**
 * Perform search across all geography data
 * Supports:
 * - Thai names (ตำบล/อำเภอ/จังหวัด)
 * - English names
 * - Postal codes
 */
function performSearch(query) {
    const lowerQuery = query.toLowerCase();
    const results = [];

    searchIndex.forEach(item => {
        const matchesTh = item.nameTh.includes(query);
        const matchesEn = item.nameEn.toLowerCase().includes(lowerQuery);
        const matchesPostal = item.postal && item.postal.toString().includes(query);

        if (matchesTh || matchesEn || matchesPostal) {
            results.push(item);
        }
    });

    return results.slice(0, 12); // Limit to 12 results
}

/**
 * Display search suggestions
 */
function displaySuggestions(results) {
    suggestionsContainer.innerHTML = '';

    if (results.length === 0) {
        const item = document.createElement('div');
        item.className = 'suggestion-item';
        item.textContent = 'ไม่พบผลลัพธ์';
        suggestionsContainer.appendChild(item);
        suggestionsContainer.classList.add('show');
        return;
    }

    results.forEach(result => {
        const item = document.createElement('div');
        item.className = 'suggestion-item';
        
        let displayText = `${result.nameTh} (${result.nameEn})`;
        if (result.postal) {
            displayText += ` ${result.postal}`;
        }
        
        item.innerHTML = `${displayText}<span class="suggestion-type">${getTypeLabel(result.type)}</span>`;
        item.addEventListener('click', () => selectFromSearch(result));
        suggestionsContainer.appendChild(item);
    });

    suggestionsContainer.classList.add('show');
}

/**
 * Get Thai label for result type
 */
function getTypeLabel(type) {
    const labels = {
        'province': 'จังหวัด',
        'district': 'อำเภอ',
        'subdistrict': 'ตำบล'
    };
    return labels[type] || type;
}

/**
 * Select item from search results
 * - Auto-fill all dropdowns
 * - Close suggestions
 */
function selectFromSearch(result) {
    quickSearchInput.value = '';
    suggestionsContainer.classList.remove('show');

    if (result.type === 'province') {
        provinceSelect.value = result.code;
        handleProvinceChange();
    } else if (result.type === 'district') {
        provinceSelect.value = result.provinceCode;
        handleProvinceChange();
        
        setTimeout(() => {
            districtSelect.value = result.code;
            handleDistrictChange();
        }, 0);
    } else if (result.type === 'subdistrict') {
        provinceSelect.value = result.provinceCode;
        handleProvinceChange();
        
        setTimeout(() => {
            districtSelect.value = result.districtCode;
            handleDistrictChange();
            
            setTimeout(() => {
                subdistrictSelect.value = result.code;
                handleSubdistrictChange();
            }, 0);
        }, 0);
    }
}

/**
 * Close suggestions when clicking outside
 */
function handleClickOutside(e) {
    if (!e.target.closest('.search-input-wrapper')) {
        suggestionsContainer.classList.remove('show');
    }
}

/**
 * Update preview text
 * Format: [ตำบล] [อำเภอ] [จังหวัด] [รหัสไปรษณีย์]
 */
function updatePreview() {
    const parts = [];

    if (currentSelection.subdistrict) {
        const sub = subdistrictMap.get(parseInt(currentSelection.subdistrict));
        if (sub) parts.push(sub.nameTh);
    }

    if (currentSelection.district) {
        const dist = districtMap.get(parseInt(currentSelection.district));
        if (dist) parts.push(dist.nameTh);
    }

    if (currentSelection.province) {
        const prov = provinceMap.get(parseInt(currentSelection.province));
        if (prov) parts.push(prov.nameTh);
    }

    if (currentSelection.postal) {
        parts.push(currentSelection.postal);
    }

    previewText.textContent = parts.length > 0 ? parts.join(' ') : 'ยังไม่มีการเลือก';
}

/**
 * Copy address to clipboard
 * - Primary: navigator.clipboard API
 * - Fallback: textarea + execCommand
 */
async function handleCopy() {
    const text = previewText.textContent;

    if (text === 'ยังไม่มีการเลือก') {
        showStatus('กรุณาเลือกที่อยู่ก่อน', 'error');
        setTimeout(() => hideStatus(), 2000);
        return;
    }

    try {
        // Try modern clipboard API first
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(text);
            showCopyFeedback();
        } else {
            // Fallback for older browsers
            copyToClipboardFallback(text);
            showCopyFeedback();
        }
    } catch (error) {
        console.error('Copy failed:', error);
        copyToClipboardFallback(text);
        showCopyFeedback();
    }
}

/**
 * Fallback copy method using textarea
 */
function copyToClipboardFallback(text) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
}

/**
 * Show copy feedback message
 */
function showCopyFeedback() {
    copyFeedback.classList.add('show');
    setTimeout(() => {
        copyFeedback.classList.remove('show');
    }, 2000);
}

/**
 * Reset all selections
 */
function handleReset() {
    currentSelection = {
        province: null,
        district: null,
        subdistrict: null,
        postal: null
    };

    provinceSelect.value = '';
    districtSelect.value = '';
    districtSelect.disabled = true;
    subdistrictSelect.value = '';
    subdistrictSelect.disabled = true;
    postalInput.value = '';
    quickSearchInput.value = '';
    suggestionsContainer.classList.remove('show');

    updatePreview();
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Show status message
 */
function showStatus(message, type) {
    statusMessage.textContent = message;
    statusMessage.className = `status-message ${type}`;
}

/**
 * Hide status message
 */
function hideStatus() {
    statusMessage.className = 'status-message';
}
