/**
 * ====================================================================
 * Front-end Logic - Photo Compare & Cloud Storage App
 * ====================================================================
 */

document.addEventListener("DOMContentLoaded", () => {
  
  // ==========================================
  // 1. App State
  // ==========================================
  // 優先取得父視窗 Portal 的配置，並提供預設的 GAS 網址與資料夾 ID 備用
  let parentGasUrl = "";
  let parentFolderId = "";
  try {
    if (window.parent && window.parent.CONFIG && window.parent.CONFIG.apps) {
      const appConf = window.parent.CONFIG.apps.find(a => a.id === "photo_compare_storage");
      if (appConf) {
        if (appConf.gasUrl) parentGasUrl = appConf.gasUrl;
        if (appConf.folderId) parentFolderId = appConf.folderId;
      }
    }
  } catch (e) {
    // 跨域或獨立開啟，忽略此例外
  }

  let config = {
    gasUrl: localStorage.getItem("pcs_gas_url") || parentGasUrl || "https://script.google.com/macros/s/AKfycbwdEc2oEcYV_EMiJg5tRC-kyKzCjuayaVDY9dcEIuhdW9WGKBn8peDaW4ESz6ul2Cytag/exec",
    rootFolderId: localStorage.getItem("pcs_root_folder_id") || parentFolderId || "15toOQzCIVRBFd4x5C8Ao_2k1C-2yTMzA",
    downloadQuality: localStorage.getItem("pcs_download_quality") || "medium"
  };
  
  let currentFolderId = config.rootFolderId;
  let currentFolderName = "根目錄";
  let folderHistory = []; // Stack of { id, name }
  
  let lightboxPlaylist = [];
  let lightboxCurrentIndex = -1;
  let currentFileId = "";
  
  let foldersList = [];
  let filesList = [];
  let similarityGroups = []; // Array of groups: { id, keepFile, deleteFiles: [] }
  let selectedDeleteIds = new Set(); // Files selected for deletion in comparison panel
  let isUploading = false;
  let uploadQueue = [];
  let uploadProcessedCount = 0;
  let uploadTotalCount = 0;
  
  let calculatedHashes = []; // 圖片指紋特徵快取
  let currentThreshold = 8;  // 比對門檻 (預設中等 88% 相似)

  // ==========================================
  // 2. DOM Elements
  // ==========================================
  // Sections
  const setupGuideSection = document.getElementById("setupGuideSection");
  const storageExplorerSection = document.getElementById("storageExplorerSection");
  const mainSpinner = document.getElementById("mainSpinner");
  const spinnerText = document.getElementById("spinnerText");
  const explorerGrid = document.getElementById("explorerGrid");
  const emptyState = document.getElementById("emptyState");
  
  // Headers & Controls
  const refreshBtn = document.getElementById("refreshBtn");
  const settingsToggleBtn = document.getElementById("settingsToggleBtn");
  const breadcrumbTrail = document.getElementById("breadcrumbTrail");
  const newFolderBtn = document.getElementById("newFolderBtn");
  const uploadTriggerBtn = document.getElementById("uploadTriggerBtn");
  const fileInput = document.getElementById("fileInput");
  const analyzeBtn = document.getElementById("analyzeBtn");
  
  // First-time Setup Form
  const firstTimeSetupForm = document.getElementById("firstTimeSetupForm");
  const gasUrlInput = document.getElementById("gasUrlInput");
  const folderIdInput = document.getElementById("folderIdInput");
  
  // Settings Modal
  const settingsModal = document.getElementById("settingsModal");
  const settingsForm = document.getElementById("settingsForm");
  const modalGasUrl = document.getElementById("modalGasUrl");
  const modalFolderId = document.getElementById("modalFolderId");
  const modalDownloadQuality = document.getElementById("modalDownloadQuality");
  const settingsModalCloseBtn = document.getElementById("settingsModalCloseBtn");
  const modalCancelBtn = document.getElementById("modalCancelBtn");
  
  // Lightbox Modal
  const lightboxModal = document.getElementById("lightboxModal");
  const lightboxImageContainer = document.getElementById("lightboxImageContainer");
  const lightboxImage = document.getElementById("lightboxImage");
  const lightboxCaption = document.getElementById("lightboxCaption");
  const lightboxCloseBtn = document.getElementById("lightboxCloseBtn");
  const zoomOutBtn = document.getElementById("zoomOutBtn");
  const zoomResetBtn = document.getElementById("zoomResetBtn");
  const zoomInBtn = document.getElementById("zoomInBtn");
  const lightboxPrevBtn = document.getElementById("lightboxPrevBtn");
  const lightboxNextBtn = document.getElementById("lightboxNextBtn");
  const lightboxLoader = document.getElementById("lightboxLoader");

  // Threshold Control & Stats
  const thresholdDecrease = document.getElementById("thresholdDecrease");
  const thresholdIncrease = document.getElementById("thresholdIncrease");
  const explorerStats = document.getElementById("explorerStats");
  
  // Duplicate Compare Modal
  const compareModal = document.getElementById("compareModal");
  const compareModalCloseBtn = document.getElementById("compareModalCloseBtn");
  const compareModalCancelBtn = document.getElementById("compareModalCancelBtn");
  const compareLoadingBody = document.getElementById("compareLoadingBody");
  const compareResultsBody = document.getElementById("compareResultsBody");
  const noDuplicatesState = document.getElementById("noDuplicatesState");
  const duplicateGroupsList = document.getElementById("duplicateGroupsList");
  const compareProgressText = document.getElementById("compareProgressText");
  const compareProgressBar = document.getElementById("compareProgressBar");
  const compareModalFooter = document.getElementById("compareModalFooter");
  const selectedToDeleteCount = document.getElementById("selectedToDeleteCount");
  
  // Slider Controls
  const thresholdSlider = document.getElementById("thresholdSlider");
  const thresholdVal = document.getElementById("thresholdVal");
  const selectedToDeleteSize = document.getElementById("selectedToDeleteSize");
  const deleteSelectedBtn = document.getElementById("deleteSelectedBtn");
  const analysisSummaryText = document.getElementById("analysisSummaryText");
  
  // Upload Progress Toast
  const uploadProgressDrawer = document.getElementById("uploadProgressDrawer");
  const uploadDrawerTitle = document.getElementById("uploadDrawerTitle");
  const uploadProgressBar = document.getElementById("uploadProgressBar");
  const uploadProgressText = document.getElementById("uploadProgressText");
  const uploadFileList = document.getElementById("uploadFileList");
  const closeProgressBtn = document.getElementById("closeProgressBtn");
  
  // Drag and Drop
  const dragDropOverlay = document.getElementById("dragDropOverlay");

  // ==========================================
  // 3. Setup & Initial Load
  // ==========================================
  function init() {
    // Theme sync with Simon's Hub parent page
    syncTheme();
    setInterval(syncTheme, 1500); // Poll theme changes in parent
    
    // Check if configuration is set
    if (!config.gasUrl || !config.rootFolderId) {
      showSetupGuide(true);
    } else {
      showSetupGuide(false);
      currentFolderId = config.rootFolderId;
      folderHistory = [{ id: config.rootFolderId, name: "根目錄" }];
      loadFolderContents(currentFolderId);
    }

    // 綁定比對門檻拉桿事件
    if (thresholdSlider) {
      thresholdSlider.addEventListener("input", (e) => {
        currentThreshold = parseInt(e.target.value);
        updateThresholdDisplay();
        
        // 即時重新分組與渲染，不需重新從雲端下載！
        if (calculatedHashes.length > 0) {
          clusterDuplicates(calculatedHashes);
        }
      });
    }

    // 綁定比對門檻按鈕事件
    if (thresholdDecrease) {
      thresholdDecrease.addEventListener("click", () => {
        let val = parseInt(thresholdSlider.value);
        if (val > parseInt(thresholdSlider.min || 1)) {
          thresholdSlider.value = val - 1;
          currentThreshold = val - 1;
          updateThresholdDisplay();
          if (calculatedHashes.length > 0) {
            clusterDuplicates(calculatedHashes);
          }
        }
      });
    }
    if (thresholdIncrease) {
      thresholdIncrease.addEventListener("click", () => {
        let val = parseInt(thresholdSlider.value);
        if (val < parseInt(thresholdSlider.max || 58)) {
          thresholdSlider.value = val + 1;
          currentThreshold = val + 1;
          updateThresholdDisplay();
          if (calculatedHashes.length > 0) {
            clusterDuplicates(calculatedHashes);
          }
        }
      });
    }
  }

  function updateThresholdDisplay() {
    if (!thresholdVal) return;
    const similarityPercent = Math.round(((64 - currentThreshold) / 64) * 100);
    
    let text = "";
    if (currentThreshold <= 3) {
      text = `極嚴格 (${similarityPercent}%) - 幾乎完全相同`;
    } else if (currentThreshold <= 5) {
      text = `嚴格 (${similarityPercent}%) - 極度相近`;
    } else if (currentThreshold <= 7) {
      text = `一般 (${similarityPercent}%) - 相同角度/裁切`;
    } else if (currentThreshold <= 9) {
      text = `中等 (${similarityPercent}%) - 稍有視角偏移/亮度差`;
    } else if (currentThreshold <= 12) {
      text = `寬鬆 (${similarityPercent}%) - 相同場景或物體`;
    } else if (currentThreshold <= 20) {
      text = `超寬鬆 (${similarityPercent}%) - 構圖相似`;
    } else if (currentThreshold <= 40) {
      text = `極度寬鬆 (${similarityPercent}%) - 僅有微弱關聯`;
    } else {
      text = `任意比對 (${similarityPercent}%) - 幾乎無關聯的相片皆會分在同一組`;
    }
    
    thresholdVal.textContent = text;
  }

  function showSetupGuide(show) {
    if (show) {
      setupGuideSection.style.display = "flex";
      storageExplorerSection.style.display = "none";
      gasUrlInput.value = config.gasUrl;
      folderIdInput.value = config.rootFolderId;
    } else {
      setupGuideSection.style.display = "none";
      storageExplorerSection.style.display = "flex";
    }
  }

  // Sync portal theme if in iframe
  function syncTheme() {
    try {
      if (window.parent && window.parent.document) {
        const isLight = window.parent.document.body.classList.contains("theme-light");
        if (isLight) {
          document.body.classList.remove("theme-dark");
          document.body.classList.add("theme-light");
        } else {
          document.body.classList.remove("theme-light");
          document.body.classList.add("theme-dark");
        }
      }
    } catch (e) {
      // Cross-origin iframe environment, ignore
    }
  }

  // ==========================================
  // 4. API Communication (Google Apps Script)
  // ==========================================
  async function callGAS(params, postData = null) {
    if (!config.gasUrl) {
      throw new Error("GAS 閘道網址尚未設定");
    }
    
    // Create query parameters
    let url = config.gasUrl;
    if (params) {
      const urlObj = new URL(url);
      Object.keys(params).forEach(key => urlObj.searchParams.set(key, params[key]));
      url = urlObj.toString();
    }
    
    const fetchOptions = {
      mode: "cors"
    };
    
    if (postData) {
      fetchOptions.method = "POST";
      // 重要：使用 text/plain 以防止瀏覽器觸發 OPTIONS 預檢請求，GAS 不支援 OPTIONS
      fetchOptions.headers = {
        "Content-Type": "text/plain;charset=utf-8"
      };
      fetchOptions.body = JSON.stringify(postData);
    }
    
    const response = await fetch(url, fetchOptions);
    if (!response.ok) {
      throw new Error(`HTTP 錯誤! 狀態碼: ${response.status}`);
    }
    
    const data = await response.json();
    if (data.error) {
      throw new Error(data.error);
    }
    return data;
  }

  // ==========================================
  // 5. Explorer Operations & Rendering
  // ==========================================
  async function loadFolderContents(folderId) {
    showSpinner(true, "正在讀取雲端硬碟檔案與目錄...");
    explorerGrid.style.display = "none";
    emptyState.style.display = "none";
    setControlsDisabled(true);
    
    try {
      const data = await callGAS({ action: "list", folderId: folderId });
      if (data.success) {
        foldersList = data.folders || [];
        filesList = data.files || [];
        currentFolderName = data.folderName || "未命名資料夾";
        
        // Update current history name if found
        const currentHist = folderHistory.find(h => h.id === folderId);
        if (currentHist) currentHist.name = currentFolderName;
        
        renderExplorerGrid();
        renderBreadcrumbs();
      }
    } catch (error) {
      alert("載入失敗: " + error.message);
      console.error(error);
      
      // If root failed, might be incorrect credentials, fallback to guide
      if (folderId === config.rootFolderId) {
        showSetupGuide(true);
      }
    } finally {
      showSpinner(false);
      setControlsDisabled(false);
    }
  }

  function renderExplorerGrid() {
    explorerGrid.innerHTML = "";
    
    const hasFolders = foldersList.length > 0;
    const hasFiles = filesList.length > 0;
    
    // Update Stats Display
    if (explorerStats) {
      if (hasFolders || hasFiles) {
        explorerStats.style.display = "inline-flex";
        explorerStats.innerHTML = `
          <span>📁 ${foldersList.length} 個資料夾</span>
          <span class="stats-divider">•</span>
          <span>🖼️ ${filesList.length} 張照片</span>
        `;
      } else {
        explorerStats.style.display = "none";
      }
    }
    
    if (!hasFolders && !hasFiles) {
      explorerGrid.style.display = "none";
      emptyState.style.display = "flex";
      analyzeBtn.disabled = true;
      return;
    }
    
    explorerGrid.style.display = "grid";
    emptyState.style.display = "none";
    analyzeBtn.disabled = filesList.length < 2; // Need at least 2 files to analyze
    
    // 1. Render Folders
    foldersList.forEach(folder => {
      const card = document.createElement("div");
      card.className = "grid-item folder-item";
      card.innerHTML = `
        <div class="grid-item-preview">
          <div class="grid-item-icon">📁</div>
        </div>
        <div class="grid-item-info">
          <span class="grid-item-name" title="${folder.name}">${folder.name}</span>
          <span class="grid-item-meta">資料夾</span>
        </div>
        <button class="grid-item-delete-btn" title="刪除此資料夾" data-id="${folder.id}">
          <svg viewBox="0 0 24 24" width="16" height="16">
            <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" fill="currentColor"/>
          </svg>
        </button>
      `;
      
      // Enter directory double click or single click (mobile responsive click)
      card.addEventListener("click", (e) => {
        // Prevent trigger if delete was clicked
        if (e.target.closest(".grid-item-delete-btn")) return;
        
        folderHistory.push({ id: folder.id, name: folder.name });
        currentFolderId = folder.id;
        loadFolderContents(folder.id);
      });
      
      // Handle Delete Folder
      card.querySelector(".grid-item-delete-btn").addEventListener("click", (e) => {
        e.stopPropagation();
        confirmDelete(folder.id, folder.name, true);
      });
      
      explorerGrid.appendChild(card);
    });
    
    // 2. Render Photos
    filesList.forEach(file => {
      const card = document.createElement("div");
      card.className = "grid-item photo-item";
      
      // Generate a fast low-res thumbnail loader
      card.innerHTML = `
        <div class="grid-item-preview">
          <img class="grid-item-thumbnail" src="${file.thumbnailUrl || 'placeholder.jpg'}" alt="${file.name}" loading="lazy">
        </div>
        <div class="grid-item-info">
          <span class="grid-item-name" title="${file.name}">${file.name}</span>
          <span class="grid-item-meta">${formatBytes(file.size)}</span>
        </div>
        <button class="grid-item-delete-btn" title="刪除此圖片" data-id="${file.id}">
          <svg viewBox="0 0 24 24" width="16" height="16">
            <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" fill="currentColor"/>
          </svg>
        </button>
      `;
      
      // Open Lightbox
      card.addEventListener("click", (e) => {
        if (e.target.closest(".grid-item-delete-btn")) return;
        openLightbox(file);
      });
      
      // Handle Delete File
      card.querySelector(".grid-item-delete-btn").addEventListener("click", (e) => {
        e.stopPropagation();
        confirmDelete(file.id, file.name, false);
      });
      
      explorerGrid.appendChild(card);
    });
  }

  function renderBreadcrumbs() {
    breadcrumbTrail.innerHTML = "";
    
    folderHistory.forEach((historyItem, index) => {
      const isLast = index === folderHistory.length - 1;
      
      const itemSpan = document.createElement("span");
      itemSpan.className = `breadcrumb-item ${isLast ? 'active' : ''}`;
      itemSpan.textContent = historyItem.name;
      
      if (!isLast) {
        itemSpan.addEventListener("click", () => {
          // Truncate history stack
          folderHistory = folderHistory.slice(0, index + 1);
          currentFolderId = historyItem.id;
          loadFolderContents(currentFolderId);
        });
      }
      
      breadcrumbTrail.appendChild(itemSpan);
      
      if (!isLast) {
        const separator = document.createElement("span");
        separator.className = "breadcrumb-separator";
        separator.textContent = "/";
        breadcrumbTrail.appendChild(separator);
      }
    });
  }

  function setControlsDisabled(disabled) {
    newFolderBtn.disabled = disabled;
    uploadTriggerBtn.disabled = disabled;
    analyzeBtn.disabled = disabled || filesList.length < 2;
    refreshBtn.disabled = disabled;
  }

  function showSpinner(show, text = "") {
    if (show) {
      mainSpinner.style.display = "flex";
      spinnerText.textContent = text;
    } else {
      mainSpinner.style.display = "none";
    }
  }

  async function confirmDelete(id, name, isFolder) {
    const itemType = isFolder ? "資料夾" : "相片";
    if (confirm(`確認要刪除此 ${itemType}「${name}」嗎？\n(檔案將被移至 Google 雲端垃圾桶)`)) {
      showSpinner(true, `正在移至垃圾桶...`);
      try {
        const res = await callGAS(null, { action: "delete", fileId: id });
        if (res.success) {
          loadFolderContents(currentFolderId);
        }
      } catch (err) {
        alert("刪除失敗: " + err.message);
        showSpinner(false);
      }
    }
  }

  // ==========================================
  // 6. Creating Folders
  // ==========================================
  newFolderBtn.addEventListener("click", async () => {
    const name = prompt("請輸入新資料夾名稱：");
    if (!name || !name.trim()) return;
    
    showSpinner(true, `正在建立資料夾「${name}」...`);
    try {
      const res = await callGAS(null, {
        action: "createFolder",
        parentFolderId: currentFolderId,
        name: name.trim()
      });
      if (res.success) {
        loadFolderContents(currentFolderId);
      }
    } catch (err) {
      alert("建立資料夾失敗: " + err.message);
      showSpinner(false);
    }
  });

  // ==========================================
  // 7. Lightbox Preview (Zoom & Pan Enhanced)
  // ==========================================
  let zoomState = {
    scale: 1,
    x: 0,
    y: 0,
    isDragging: false,
    startX: 0,
    startY: 0
  };

  function resetZoom() {
    zoomState.scale = 1;
    zoomState.x = 0;
    zoomState.y = 0;
    applyZoom();
  }

  function applyZoom() {
    if (zoomState.scale < 0.5) zoomState.scale = 0.5;
    if (zoomState.scale > 5) zoomState.scale = 5;
    
    if (zoomState.scale === 1) {
      zoomState.x = 0;
      zoomState.y = 0;
      if (lightboxImageContainer) lightboxImageContainer.classList.remove("zoomed");
    } else {
      if (lightboxImageContainer) lightboxImageContainer.classList.add("zoomed");
    }
    
    if (lightboxImage) {
      lightboxImage.style.transform = `translate(${zoomState.x}px, ${zoomState.y}px) scale(${zoomState.scale})`;
    }
  }

  function showLightboxLoader(show) {
    if (lightboxLoader) {
      lightboxLoader.style.display = show ? "flex" : "none";
    }
  }

  function updateLightboxNavButtons() {
    if (!lightboxPrevBtn || !lightboxNextBtn) return;
    if (!lightboxPlaylist || lightboxPlaylist.length <= 1) {
      lightboxPrevBtn.style.display = "none";
      lightboxNextBtn.style.display = "none";
      return;
    }
    lightboxPrevBtn.style.display = "flex";
    lightboxNextBtn.style.display = "flex";
    lightboxPrevBtn.disabled = lightboxCurrentIndex <= 0;
    lightboxNextBtn.disabled = lightboxCurrentIndex >= lightboxPlaylist.length - 1;
  }

  function navigateLightbox(direction) {
    if (!lightboxPlaylist || lightboxPlaylist.length === 0) return;
    const newIndex = lightboxCurrentIndex + direction;
    if (newIndex >= 0 && newIndex < lightboxPlaylist.length) {
      const file = lightboxPlaylist[newIndex];
      openLightbox(file, lightboxPlaylist);
    }
  }

  function openLightbox(file, playlist = filesList) {
    lightboxPlaylist = playlist;
    lightboxCurrentIndex = playlist.findIndex(item => item.id === file.id);
    currentFileId = file.id;
    
    // Ensure clean style transitions
    lightboxImage.style.transition = "filter 0.4s ease, transform 0.2s cubic-bezier(0.16, 1, 0.3, 1)";
    
    lightboxCaption.querySelector(".photo-name").textContent = file.name;
    lightboxCaption.querySelector(".photo-details").textContent = `${formatBytes(file.size)} | 建立於 ${new Date(file.createdAt).toLocaleDateString()}`;
    
    lightboxModal.classList.add("open");
    lightboxModal.setAttribute("aria-hidden", "false");
    
    resetZoom();
    updateLightboxNavButtons();
    
    // 1. If we already have the downloaded high-res/medium image URL (cached)
    if (file.imgSrc) {
      lightboxImage.src = file.imgSrc;
      lightboxImage.classList.remove("is-blurred");
      showLightboxLoader(false);
      return;
    }
    
    // 2. Otherwise, load it in the background while displaying blurred thumbnail instantly
    let previewSrc = file.thumbnailUrl || 'placeholder.jpg';
    if (previewSrc.includes("=s") && !previewSrc.includes("=s400")) {
      previewSrc = previewSrc.replace(/=s\d+/, "=s400"); // 400px is perfect for blur
    } else if (previewSrc !== 'placeholder.jpg' && !previewSrc.includes("=s")) {
      previewSrc += "=s400";
    }
    
    lightboxImage.src = previewSrc;
    lightboxImage.classList.add("is-blurred");
    showLightboxLoader(true);
    
    loadImageForCanvas(file.id, file.thumbnailUrl)
      .then(url => {
        file.imgSrc = url; // cache it
        
        // Preload in hidden image to avoid white flashing
        const tempImg = new Image();
        tempImg.onload = () => {
          if (lightboxModal.classList.contains("open") && currentFileId === file.id) {
            lightboxImage.src = url;
            lightboxImage.classList.remove("is-blurred");
            showLightboxLoader(false);
          }
        };
        tempImg.src = url;
      })
      .catch(err => {
        console.warn("無法下載大圖，保留模糊預覽：" + err.message);
        if (currentFileId === file.id) {
          showLightboxLoader(false);
          lightboxImage.classList.remove("is-blurred");
        }
      });
  }

  function closeLightbox() {
    lightboxModal.classList.remove("open");
    lightboxModal.setAttribute("aria-hidden", "true");
    currentFileId = "";
    resetZoom();
  }

  // Register Zoom/Pan event listeners
  if (lightboxImageContainer) {
    // Click toggle zoom
    lightboxImage.addEventListener("click", (e) => {
      e.stopPropagation();
      if (zoomState.scale > 1) {
        resetZoom();
      } else {
        zoomState.scale = 2.0;
        applyZoom();
      }
    });

    // Mouse drag to pan
    lightboxImageContainer.addEventListener("mousedown", (e) => {
      if (zoomState.scale <= 1) return;
      zoomState.isDragging = true;
      zoomState.startX = e.clientX - zoomState.x;
      zoomState.startY = e.clientY - zoomState.y;
      e.preventDefault();
    });

    window.addEventListener("mousemove", (e) => {
      if (!zoomState.isDragging) return;
      zoomState.x = e.clientX - zoomState.startX;
      zoomState.y = e.clientY - zoomState.startY;
      applyZoom();
    });

    window.addEventListener("mouseup", () => {
      zoomState.isDragging = false;
    });

    // Scroll wheel zoom
    lightboxImageContainer.addEventListener("wheel", (e) => {
      e.preventDefault();
      const zoomFactor = 0.1;
      if (e.deltaY < 0) {
        zoomState.scale += zoomFactor;
      } else {
        zoomState.scale -= zoomFactor;
      }
      applyZoom();
    }, { passive: false });

    // Touch support for mobile devices (Pan, Pinch-to-zoom & Swipe Navigation)
    let touchStartDist = 0;
    let swipeStartX = 0;
    let swipeStartY = 0;
    let swipeStartTime = 0;
    let isSwiping = false;
    
    lightboxImageContainer.addEventListener("touchstart", (e) => {
      if (e.touches.length === 1) {
        if (zoomState.scale > 1) {
          zoomState.isDragging = true;
          zoomState.startX = e.touches[0].clientX - zoomState.x;
          zoomState.startY = e.touches[0].clientY - zoomState.y;
          isSwiping = false;
        } else {
          zoomState.isDragging = false;
          isSwiping = true;
          swipeStartX = e.touches[0].clientX;
          swipeStartY = e.touches[0].clientY;
          swipeStartTime = Date.now();
        }
      } else if (e.touches.length === 2) {
        zoomState.isDragging = false;
        isSwiping = false;
        touchStartDist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
      }
    }, { passive: true });

    lightboxImageContainer.addEventListener("touchmove", (e) => {
      if (e.touches.length === 1) {
        if (zoomState.isDragging && zoomState.scale > 1) {
          zoomState.x = e.touches[0].clientX - zoomState.startX;
          zoomState.y = e.touches[0].clientY - zoomState.startY;
          applyZoom();
        } else if (isSwiping) {
          const deltaX = e.touches[0].clientX - swipeStartX;
          const deltaY = e.touches[0].clientY - swipeStartY;
          
          if (Math.abs(deltaX) > Math.abs(deltaY)) {
            lightboxImage.style.transition = "none";
            lightboxImage.style.transform = `translateX(${deltaX}px)`;
          }
        }
      } else if (e.touches.length === 2 && touchStartDist > 0) {
        const dist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        const factor = dist / touchStartDist;
        zoomState.scale *= factor;
        touchStartDist = dist;
        applyZoom();
      }
    }, { passive: true });

    lightboxImageContainer.addEventListener("touchend", (e) => {
      if (zoomState.isDragging) {
        zoomState.isDragging = false;
      }
      
      if (isSwiping) {
        isSwiping = false;
        const deltaX = e.changedTouches[0].clientX - swipeStartX;
        const deltaY = e.changedTouches[0].clientY - swipeStartY;
        const deltaTime = Date.now() - swipeStartTime;
        
        if (Math.abs(deltaX) > 60 && Math.abs(deltaY) < 80 && deltaTime < 350) {
          if (deltaX > 0) {
            if (lightboxCurrentIndex > 0) {
              lightboxImage.style.transition = "transform 0.2s cubic-bezier(0.25, 0.8, 0.25, 1)";
              lightboxImage.style.transform = "translateX(100%)";
              setTimeout(() => {
                navigateLightbox(-1);
              }, 200);
            } else {
              resetSwipeAnimation();
            }
          } else {
            if (lightboxCurrentIndex < lightboxPlaylist.length - 1) {
              lightboxImage.style.transition = "transform 0.2s cubic-bezier(0.25, 0.8, 0.25, 1)";
              lightboxImage.style.transform = "translateX(-100%)";
              setTimeout(() => {
                navigateLightbox(1);
              }, 200);
            } else {
              resetSwipeAnimation();
            }
          }
        } else {
          resetSwipeAnimation();
        }
      }
      
      touchStartDist = 0;
    });

    function resetSwipeAnimation() {
      lightboxImage.style.transition = "transform 0.35s cubic-bezier(0.175, 0.885, 0.32, 1.275), filter 0.4s ease";
      lightboxImage.style.transform = "translateX(0px)";
      setTimeout(() => {
        lightboxImage.style.transition = "transform 0.2s cubic-bezier(0.16, 1, 0.3, 1)";
      }, 350);
    }
  }

  // Hook Zoom control buttons
  if (zoomInBtn) {
    zoomInBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      zoomState.scale += 0.25;
      applyZoom();
    });
  }
  if (zoomOutBtn) {
    zoomOutBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      zoomState.scale -= 0.25;
      applyZoom();
    });
  }
  if (zoomResetBtn) {
    zoomResetBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      resetZoom();
    });
  }

  lightboxCloseBtn.addEventListener("click", closeLightbox);
  lightboxModal.addEventListener("click", (e) => {
    if (e.target === lightboxModal || e.target.closest(".lightbox-close-btn")) {
      closeLightbox();
    }
  });

  // Lightbox Navigation Controls (Click Handlers)
  if (lightboxPrevBtn) {
    lightboxPrevBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      navigateLightbox(-1);
    });
  }

  if (lightboxNextBtn) {
    lightboxNextBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      navigateLightbox(1);
    });
  }

  // Keyboard navigation when lightbox is open
  window.addEventListener("keydown", (e) => {
    if (!lightboxModal.classList.contains("open")) return;
    
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      navigateLightbox(-1);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      navigateLightbox(1);
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeLightbox();
    }
  });

  // ==========================================
  // 8. Image Loading Helper (CORS & Base64 Proxy)
  // ==========================================
  async function loadImageForCanvas(fileId, thumbnailUrl) {
    // 1. Try to download low-res thumbnail directly via browser cache/CORS if allowed (only when quality is medium)
    if (config.downloadQuality === "medium" && thumbnailUrl) {
      try {
        // Change thumbnail query to pull a larger preview size (up to =s800)
        let highResThumb = thumbnailUrl;
        if (highResThumb.includes("=s")) {
          highResThumb = highResThumb.replace(/=s\d+/, "=s800");
        } else {
          highResThumb += "=s800";
        }
        
        const res = await fetch(highResThumb, { mode: "cors" });
        if (res.ok) {
          const blob = await res.blob();
          return URL.createObjectURL(blob);
        }
      } catch (e) {
        console.warn("Direct thumbnail CORS fetch failed, falling back to secure GAS base64 proxy.", e);
      }
    }
    
    // 2. Secure Fallback / Original Quality: Fetch bytes from user's GAS Web App and convert to local Blob URL
    const res = await callGAS({ action: "download", fileId: fileId, quality: config.downloadQuality });
    if (res.success && res.base64Data) {
      const byteCharacters = atob(res.base64Data);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: res.mimeType || "image/jpeg" });
      return URL.createObjectURL(blob);
    }
    
    throw new Error("無法取得圖片資料");
  }

  // ==========================================
  // 9. Batch Upload Mechanics (Queue + Drag-and-Drop)
  // ==========================================
  uploadTriggerBtn.addEventListener("click", () => fileInput.click());
  
  fileInput.addEventListener("change", (e) => {
    if (e.target.files.length > 0) {
      handleFilesUpload(Array.from(e.target.files));
    }
  });

  // Drag and drop overlay bindings
  window.addEventListener("dragenter", (e) => {
    e.preventDefault();
    if (!config.gasUrl || isUploading) return;
    dragDropOverlay.classList.add("active");
  });

  dragDropOverlay.addEventListener("dragover", (e) => {
    e.preventDefault();
  });

  dragDropOverlay.addEventListener("dragleave", (e) => {
    e.preventDefault();
    dragDropOverlay.classList.remove("active");
  });

  dragDropOverlay.addEventListener("drop", (e) => {
    e.preventDefault();
    dragDropOverlay.classList.remove("active");
    
    if (e.dataTransfer.files.length > 0) {
      handleFilesUpload(Array.from(e.dataTransfer.files).filter(f => f.type.startsWith("image/")));
    }
  });

  function handleFilesUpload(files) {
    if (files.length === 0) return;
    
    uploadQueue = uploadQueue.concat(files);
    uploadTotalCount = uploadQueue.length;
    
    if (!isUploading) {
      isUploading = true;
      uploadProcessedCount = 0;
      uploadProgressDrawer.classList.add("open");
      updateUploadDrawerUI();
      processNextUpload();
    } else {
      updateUploadDrawerUI();
    }
  }

  function updateUploadDrawerUI() {
    uploadDrawerTitle.textContent = `上傳相片中 (${uploadProcessedCount} / ${uploadTotalCount})`;
    const percentage = uploadTotalCount > 0 ? Math.round((uploadProcessedCount / uploadTotalCount) * 100) : 0;
    uploadProgressBar.style.width = `${percentage}%`;
    uploadProgressText.textContent = `${uploadProcessedCount} / ${uploadTotalCount} 檔案 (${percentage}%)`;
    
    // Clear list and render items
    uploadFileList.innerHTML = "";
    uploadQueue.forEach((file, index) => {
      const item = document.createElement("div");
      item.className = "upload-file-item";
      let statusClass = "pending";
      let statusText = "排隊中";
      
      if (index === 0) {
        statusClass = "uploading";
        statusText = "上傳中...";
      }
      
      item.innerHTML = `
        <span class="file-item-name">${file.name}</span>
        <span class="file-item-status ${statusClass}">${statusText}</span>
      `;
      uploadFileList.appendChild(item);
    });
  }

  async function processNextUpload() {
    if (uploadQueue.length === 0) {
      isUploading = false;
      uploadDrawerTitle.textContent = "上傳完成！";
      uploadProgressText.textContent = `成功上傳 ${uploadTotalCount} 張相片`;
      setTimeout(() => {
        uploadProgressDrawer.classList.remove("open");
      }, 3000);
      
      loadFolderContents(currentFolderId);
      return;
    }
    
    const file = uploadQueue[0];
    updateUploadDrawerUI();
    
    try {
      const base64Data = await fileToBase64(file);
      // Strip standard prefix e.g., "data:image/jpeg;base64,"
      const base64Clean = base64Data.split(",")[1];
      
      const res = await callGAS(null, {
        action: "upload",
        folderId: currentFolderId,
        filename: file.name,
        mimeType: file.type,
        base64Data: base64Clean
      });
      
      if (res.success) {
        uploadProcessedCount++;
        uploadQueue.shift(); // Remove from queue
        processNextUpload();
      } else {
        throw new Error(res.error || "雲端未知的上傳錯誤");
      }
    } catch (err) {
      console.error(err);
      alert(`相片「${file.name}」上傳失敗：\n${err.message}`);
      
      // Remove failed file from queue and continue
      uploadProcessedCount++;
      uploadQueue.shift();
      processNextUpload();
    }
  }

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result);
      reader.onerror = error => reject(error);
    });
  }

  closeProgressBtn.addEventListener("click", () => {
    uploadProgressDrawer.classList.remove("open");
  });

  // ==========================================
  // 10. Image Perceptual Hashing (dHash) & Deduplication
  // ==========================================
  analyzeBtn.addEventListener("click", async () => {
    if (filesList.length < 2) return;
    
    // Open Duplicate Modal and reset views
    compareModal.classList.add("open");
    compareModal.setAttribute("aria-hidden", "false");
    
    compareLoadingBody.style.display = "flex";
    compareResultsBody.style.display = "none";
    compareModalFooter.style.display = "none";
    
    compareProgressText.textContent = "準備下載圖片特徵中...";
    compareProgressBar.style.width = "0%";
    
    // 初始化拉桿狀態
    if (thresholdSlider) {
      thresholdSlider.value = currentThreshold;
    }
    updateThresholdDisplay();
    calculatedHashes = [];
    
    try {
      // 1. Calculate hashes for all files in the current folder (並行下載與計算)
      const imagesWithHashes = [];
      const totalFiles = filesList.length;
      let completedCount = 0;
      const concurrencyLimit = 4; // 限制最多 4 個並行下載，避免瀏覽器連接上限或 API 限流
      
      let currentIndex = 0;
      
      async function worker() {
        while (currentIndex < totalFiles) {
          const index = currentIndex++;
          if (index >= totalFiles) break;
          const file = filesList[index];
          
          try {
            compareProgressText.textContent = `讀取圖片中 (${completedCount + 1} / ${totalFiles}): ${file.name}`;
            
            const url = await loadImageForCanvas(file.id, file.thumbnailUrl);
            const img = await loadImageObject(url);
            const { hash, avgRGB } = await computePHashAndColor(img);
            
            imagesWithHashes.push({
              id: file.id,
              name: file.name,
              size: file.size,
              thumbnailUrl: file.thumbnailUrl,
              hash: hash,
              avgRGB: avgRGB,
              createdAt: file.createdAt,
              imgSrc: url,
              width: img.naturalWidth,
              height: img.naturalHeight
            });
          } catch (fileErr) {
            console.warn(`跳過毀損或無法讀取的圖片 「${file.name}」:`, fileErr);
          } finally {
            completedCount++;
            compareProgressText.textContent = `計算特徵中 (${completedCount} / ${totalFiles})`;
            compareProgressBar.style.width = `${Math.round((completedCount / totalFiles) * 100)}%`;
          }
        }
      }
      
      // 啟動多個並行 Worker
      const workers = [];
      for (let w = 0; w < Math.min(concurrencyLimit, totalFiles); w++) {
        workers.push(worker());
      }
      await Promise.all(workers);
      
      compareProgressBar.style.width = "100%";
      compareProgressText.textContent = "比對指紋特徵中...";
      
      calculatedHashes = imagesWithHashes;
      
      // 2. Perform pairwise Hamming distance check and cluster duplicates
      clusterDuplicates(calculatedHashes);
      
    } catch (err) {
      alert("分析失敗: " + err.message);
      closeCompareModal();
    }
  });

  function loadImageObject(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = (err) => reject(err);
      img.src = url;
    });
  }

  /**
   * Computes Perceptual Hash (pHash) via Discrete Cosine Transform (DCT) and Average RGB
   * Analyzes spatial frequency to represent overall COMPOSITION (構圖)
   */
  function computePHashAndColor(img) {
    return new Promise((resolve) => {
      const width = 32;
      const height = 32;
      
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      
      ctx.drawImage(img, 0, 0, width, height);
      
      const imgData = ctx.getImageData(0, 0, width, height);
      const data = imgData.data;
      
      // Calculate Average RGB & Grayscale matrix
      let sumR = 0, sumG = 0, sumB = 0;
      const pixelCount = width * height;
      const matrix = [];
      
      for (let y = 0; y < height; y++) {
        const row = [];
        for (let x = 0; x < width; x++) {
          const idx = (y * width + x) * 4;
          const r = data[idx];
          const g = data[idx + 1];
          const b = data[idx + 2];
          
          sumR += r;
          sumG += g;
          sumB += b;
          
          // Grayscale conversion
          row.push(0.299 * r + 0.587 * g + 0.114 * b);
        }
        matrix.push(row);
      }
      
      const avgRGB = {
        r: Math.round(sumR / pixelCount),
        g: Math.round(sumG / pixelCount),
        b: Math.round(sumB / pixelCount)
      };
      
      // 2D Discrete Cosine Transform (DCT) - Top-left 8x8 coefficients
      const dctRows = 8;
      const dctCols = 8;
      const dctCoeffs = [];
      
      for (let u = 0; u < dctRows; u++) {
        const row = [];
        for (let v = 0; v < dctCols; v++) {
          let sum = 0;
          for (let x = 0; x < width; x++) {
            for (let y = 0; y < height; y++) {
              sum += matrix[y][x] * 
                     Math.cos(((2 * x + 1) * u * Math.PI) / 64) * 
                     Math.cos(((2 * y + 1) * v * Math.PI) / 64);
            }
          }
          
          const cu = (u === 0) ? (1 / Math.sqrt(2)) : 1;
          const cv = (v === 0) ? (1 / Math.sqrt(2)) : 1;
          sum = (1 / 4) * cu * cv * sum;
          
          row.push(sum);
        }
        dctCoeffs.push(row);
      }
      
      // Find Median of DCT coefficients (excluding DC component [0,0])
      const flat = [];
      for (let u = 0; u < dctRows; u++) {
        for (let v = 0; v < dctCols; v++) {
          if (u === 0 && v === 0) continue; // Exclude DC
          flat.push(dctCoeffs[u][v]);
        }
      }
      
      const sorted = [...flat].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      
      // Generate 64-bit Perceptual Hash
      let hash = "";
      for (let u = 0; u < dctRows; u++) {
        for (let v = 0; v < dctCols; v++) {
          if (u === 0 && v === 0) {
            hash += "0";
            continue;
          }
          hash += (dctCoeffs[u][v] > median) ? "1" : "0";
        }
      }
      
      resolve({ hash, avgRGB });
    });
  }

  function getColorDistance(rgb1, rgb2) {
    return Math.abs(rgb1.r - rgb2.r) + Math.abs(rgb1.g - rgb2.g) + Math.abs(rgb1.b - rgb2.b);
  }

  function getHammingDistance(hash1, hash2) {
    let dist = 0;
    for (let i = 0; i < hash1.length; i++) {
      if (hash1[i] !== hash2[i]) {
        dist++;
      }
    }
    return dist;
  }

  /**
   * Group similar images based on Hamming Distance threshold (<= 5 bits difference out of 64)
   * Using simple Connected Components (Union-Find) clustering
   */
  function clusterDuplicates(images) {
    const parent = {};
    images.forEach(img => parent[img.id] = img.id);
    
    function find(id) {
      if (parent[id] === id) return id;
      return parent[id] = find(parent[id]);
    }
    
    function union(id1, id2) {
      const root1 = find(id1);
      const root2 = find(id2);
      if (root1 !== root2) {
        parent[root1] = root2;
      }
    }
    
    // Pairwise comparison
    for (let i = 0; i < images.length; i++) {
      for (let j = i + 1; j < images.length; j++) {
        const dist = getHammingDistance(images[i].hash, images[j].hash);
        const colorDist = getColorDistance(images[i].avgRGB, images[j].avgRGB);
        
        // 混合分析法：結構相似 (漢明距離符合拉桿) 且 色調相似 (RGB 平均差 <= 60)，才判定為重複！
        if (dist <= currentThreshold && colorDist <= 60) {
          union(images[i].id, images[j].id);
        }
      }
    }
    
    // Group files by root parent
    const clusters = {};
    images.forEach(img => {
      const root = find(img.id);
      if (!clusters[root]) clusters[root] = [];
      clusters[root].push(img);
    });
    
    // Filter out clusters of size 1 (unique pictures)
    similarityGroups = [];
    selectedDeleteIds.clear();
    
    Object.keys(clusters).forEach(root => {
      const cluster = clusters[root];
      if (cluster.length > 1) {
        // Sort cluster so the BEST candidate is at index 0 (Keep candidate)
        // Rule: 1st by resolution (width * height desc), 2nd by file size desc, 3rd by age (oldest first)
        cluster.sort((a, b) => {
          const resA = a.width * a.height;
          const resB = b.width * b.height;
          if (resB !== resA) return resB - resA;
          
          if (b.size !== a.size) return b.size - a.size;
          return a.createdAt - b.createdAt;
        });
        
        const keepFile = cluster[0];
        const deleteFiles = cluster.slice(1);
        
        similarityGroups.push({
          id: root,
          keepFile: keepFile,
          deleteFiles: deleteFiles
        });
        
        // Auto pre-select duplicates for deletion
        deleteFiles.forEach(file => {
          selectedDeleteIds.add(file.id);
        });
      }
    });
    
    renderComparisonDashboard();
  }

  function renderComparisonDashboard() {
    compareLoadingBody.style.display = "none";
    compareResultsBody.style.display = "block";
    compareModalFooter.style.display = "flex";
    
    duplicateGroupsList.innerHTML = "";
    
    if (similarityGroups.length === 0) {
      noDuplicatesState.style.display = "flex";
      duplicateGroupsList.style.display = "none";
      analysisSummaryText.textContent = "掃描完成。無重複相片";
      
      selectedToDeleteCount.textContent = "0";
      selectedToDeleteSize.textContent = "0 KB";
      deleteSelectedBtn.disabled = true;
      return;
    }
    
    noDuplicatesState.style.display = "none";
    duplicateGroupsList.style.display = "flex";
    
    let totalDuplicatesFound = 0;
    similarityGroups.forEach(g => totalDuplicatesFound += g.deleteFiles.length);
    analysisSummaryText.textContent = `共偵測到 ${similarityGroups.length} 組相似相片（共 ${totalDuplicatesFound} 張重複項）`;
    
    // Render Groups
    similarityGroups.forEach((group, index) => {
      const groupCard = document.createElement("div");
      groupCard.className = "duplicate-group-card";
      
      const allFiles = [group.keepFile, ...group.deleteFiles];
      
      groupCard.innerHTML = `
        <div class="group-card-header">
          <span class="group-tag">相似組 #${index + 1}</span>
          <span class="group-meta">共 ${allFiles.length} 張圖片相似</span>
        </div>
        <div class="group-photos-layout" id="group-layout-${group.id}">
          <!-- Photo items will be injected here -->
        </div>
      `;
      
      const layoutContainer = groupCard.querySelector(`#group-layout-${group.id}`);
      
      allFiles.forEach(file => {
        const isOriginal = file.id === group.keepFile.id;
        const photoItem = document.createElement("div");
        photoItem.className = `compare-photo-item ${isOriginal ? 'is-keep' : 'is-delete'}`;
        photoItem.dataset.id = file.id;
        
        photoItem.innerHTML = `
          <div class="compare-photo-preview">
            <img class="compare-photo-img" src="${file.imgSrc}" alt="${file.name}">
            
            ${isOriginal 
              ? `<span class="keep-badge">保留主要</span>` 
              : `<span class="delete-badge" id="badge-${file.id}">刪除重複</span>`
            }
            
            ${!isOriginal ? `
              <div class="compare-select-overlay">
                <label class="compare-checkbox-custom">
                  <input type="checkbox" class="compare-checkbox" data-id="${file.id}" ${selectedDeleteIds.has(file.id) ? 'checked' : ''}>
                  <span class="checkbox-icon">✓</span>
                </label>
              </div>
            ` : ''}
          </div>
          <div class="compare-photo-info">
            <span class="compare-photo-name" title="${file.name}">${file.name}</span>
            <div class="compare-photo-meta">
              <span>${file.width} x ${file.height}</span>
              <span>${formatBytes(file.size)}</span>
            </div>
          </div>
        `;
        
        // Click to enlarge thumbnail in compare results
        const previewContainer = photoItem.querySelector(".compare-photo-preview");
        previewContainer.style.cursor = "zoom-in";
        previewContainer.addEventListener("click", (e) => {
          if (e.target.closest(".compare-select-overlay") || e.target.closest(".compare-checkbox-custom")) {
            return;
          }
          openLightbox(file, allFiles);
        });

        // Checkbox toggle logic
        if (!isOriginal) {
          const checkbox = photoItem.querySelector(".compare-checkbox");
          checkbox.addEventListener("change", (e) => {
            const isChecked = e.target.checked;
            const badge = photoItem.querySelector(`#badge-${file.id}`);
            
            if (isChecked) {
              selectedDeleteIds.add(file.id);
              photoItem.classList.replace("is-keep", "is-delete");
              badge.className = "delete-badge";
              badge.textContent = "刪除重複";
            } else {
              selectedDeleteIds.delete(file.id);
              photoItem.classList.replace("is-delete", "is-keep");
              badge.className = "keep-badge";
              badge.textContent = "手動保留";
            }
            
            updateCompareStats();
          });
        }
        
        layoutContainer.appendChild(photoItem);
      });
      
      duplicateGroupsList.appendChild(groupCard);
    });
    
    updateCompareStats();
  }

  function updateCompareStats() {
    selectedToDeleteCount.textContent = selectedDeleteIds.size;
    
    // Sum size
    let sumSize = 0;
    similarityGroups.forEach(g => {
      g.deleteFiles.forEach(file => {
        if (selectedDeleteIds.has(file.id)) {
          sumSize += file.size;
        }
      });
    });
    
    selectedToDeleteSize.textContent = formatBytes(sumSize);
    deleteSelectedBtn.disabled = selectedDeleteIds.size === 0;
  }

  // Confirm delete selected
  deleteSelectedBtn.addEventListener("click", async () => {
    const count = selectedDeleteIds.size;
    if (confirm(`確認要刪除這 ${count} 張勾選的重複圖片嗎？`)) {
      compareLoadingBody.style.display = "flex";
      compareResultsBody.style.display = "none";
      compareModalFooter.style.display = "none";
      compareProgressBar.style.width = "0%";
      
      const idsArray = Array.from(selectedDeleteIds);
      let successCount = 0;
      
      for (let i = 0; i < idsArray.length; i++) {
        const id = idsArray[i];
        compareProgressText.textContent = `正在刪除相片 (${i + 1} / ${count})...`;
        compareProgressBar.style.width = `${Math.round((i / count) * 100)}%`;
        
        try {
          const res = await callGAS(null, { action: "delete", fileId: id });
          if (res.success) successCount++;
        } catch (e) {
          console.error("Failed to delete id: " + id, e);
        }
      }
      
      alert(`刪除作業完成，成功將 ${successCount} 張重複相片移至垃圾桶！`);
      closeCompareModal();
      loadFolderContents(currentFolderId);
    }
  });

  function closeCompareModal() {
    compareModal.classList.remove("open");
    compareModal.setAttribute("aria-hidden", "true");
  }

  compareModalCloseBtn.addEventListener("click", closeCompareModal);
  compareModalCancelBtn.addEventListener("click", closeCompareModal);

  // ==========================================
  // 11. Configuration Settings Panels & Form Handlers
  // ==========================================
  
  // Settings Modals bindings
  settingsToggleBtn.addEventListener("click", () => {
    modalGasUrl.value = config.gasUrl;
    modalFolderId.value = config.rootFolderId;
    if (modalDownloadQuality) {
      modalDownloadQuality.value = config.downloadQuality || "medium";
    }
    
    settingsModal.classList.add("open");
    settingsModal.setAttribute("aria-hidden", "false");
  });

  function closeSettingsModal() {
    settingsModal.classList.remove("open");
    settingsModal.setAttribute("aria-hidden", "true");
  }

  settingsModalCloseBtn.addEventListener("click", closeSettingsModal);
  modalCancelBtn.addEventListener("click", closeSettingsModal);
  settingsModal.addEventListener("click", (e) => {
    if (e.target === settingsModal) {
      closeSettingsModal();
    }
  });

  // Settings Save (First time)
  firstTimeSetupForm.addEventListener("submit", (e) => {
    e.preventDefault();
    saveConfiguration(gasUrlInput.value.trim(), folderIdInput.value.trim(), "medium");
  });

  // Settings Save (Modal)
  settingsForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const quality = modalDownloadQuality ? modalDownloadQuality.value : "medium";
    saveConfiguration(modalGasUrl.value.trim(), modalFolderId.value.trim(), quality);
    closeSettingsModal();
  });

  function saveConfiguration(url, folderId, quality) {
    config.gasUrl = url;
    config.rootFolderId = folderId;
    config.downloadQuality = quality || "medium";
    
    localStorage.setItem("pcs_gas_url", url);
    localStorage.setItem("pcs_root_folder_id", folderId);
    localStorage.setItem("pcs_download_quality", config.downloadQuality);
    
    showSetupGuide(false);
    currentFolderId = folderId;
    folderHistory = [{ id: folderId, name: "根目錄" }];
    loadFolderContents(folderId);
  }

  // Refresh
  refreshBtn.addEventListener("click", () => {
    if (currentFolderId) {
      loadFolderContents(currentFolderId);
    }
  });

  // ==========================================
  // 12. Formatting Utilities
  // ==========================================
  function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return "0 Bytes";
    
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
    
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
  }

  // ==========================================
  // 13. Run
  // ==========================================
  init();
});
