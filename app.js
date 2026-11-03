/* ============================================================
   Collection Route — App Logic (app.js)
   ============================================================ */

// ===== CONFIGURATION =====
// Google Apps Script Web App URL
const WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbzaYtYhONgomInEczfjfl_xxbvfdI15RWi7YGpRmIhbU0xzSxj90DkxB5DNK-suvF5L/exec';

// ===== CONSTANTS =====
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

// ===== STATE =====
const state = {
  dueDate: 'AKINSE',
  month: '',
  year: '',
  routes: [],
  selectedIndex: null,
  editingIndex: null, // Highlight row ONLY during editing
  darkMode: false
};

// ===== DOM HELPERS =====
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);


/* ============================================================
   API LAYER (WITH DUAL GET/POST FALLBACK FOR CORS SAFETY)
   ============================================================ */

const api = {
  async get(action, params) {
    const url = new URL(WEB_APP_URL);
    url.searchParams.set('action', action);
    if (params) {
      Object.keys(params).forEach(key => {
        if (params[key] !== undefined && params[key] !== null) {
          url.searchParams.set(key, params[key]);
        }
      });
    }
    const res = await fetch(url.toString(), { redirect: 'follow' });
    if (!res.ok) throw new Error('HTTP ' + res.status + ': Failed to fetch');
    return res.json();
  },

  async post(action, data) {
    // Attempt standard POST first
    try {
      const res = await fetch(WEB_APP_URL, {
        method: 'POST',
        redirect: 'follow',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action, ...data })
      });
      if (res.ok) {
        return await res.json();
      }
    } catch (e) {
      console.warn('POST attempt failed, falling back to GET mutation:', e);
    }

    // Fallback to GET mutation with JSON payload
    const url = new URL(WEB_APP_URL);
    url.searchParams.set('action', action);
    url.searchParams.set('data', JSON.stringify(data));
    const res = await fetch(url.toString(), { redirect: 'follow' });
    if (!res.ok) throw new Error('HTTP ' + res.status + ': Failed to execute action');
    return res.json();
  },

  searchMembers(query) {
    return this.get('searchMembers', { query });
  },

  syncAll(dueDate, month, year) {
    return this.get('syncAll', { dueDate, month, year });
  },

  addRoute(data) {
    return this.post('addRoute', data);
  },

  updateRoute(data) {
    return this.post('updateRoute', data);
  },

  deleteRoute(data) {
    return this.post('deleteRoute', data);
  },

  clearRoutes(data) {
    return this.post('clearRoutes', data);
  },

  reorderRoutes(data) {
    return this.post('reorderRoutes', data);
  }
};


/* ============================================================
   LOADING PROGRESS MODAL / TOAST NOTIFICATIONS
   ============================================================ */

let progressInterval = null;

function showLoading(msg, initialPercent = 20, title = 'Connecting...') {
  const overlay = $('#loadingOverlay');
  if (title) $('#loadingTitle').textContent = title;
  if (msg) $('#loadingText').textContent = msg;

  clearInterval(progressInterval);
  updateProgress(initialPercent);
  overlay.classList.add('visible');

  // Increment progress smoothly while waiting
  let current = initialPercent;
  progressInterval = setInterval(() => {
    if (current < 88) {
      current += Math.random() * 6 + 2;
      updateProgress(current);
    }
  }, 220);
}

function updateProgress(percent, msg) {
  const p = Math.min(100, Math.max(0, percent));
  const fill = $('#progressBarFill');
  const label = $('#progressPercent');
  const text = $('#loadingText');
  if (fill) fill.style.width = p + '%';
  if (label) label.textContent = Math.round(p) + '%';
  if (msg && text) text.textContent = msg;
}

function hideLoading() {
  clearInterval(progressInterval);
  updateProgress(100, 'Done');
  setTimeout(() => {
    $('#loadingOverlay').classList.remove('visible');
    setTimeout(() => updateProgress(0), 200);
  }, 260);
}

function showToast(message, type) {
  let container = $('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = 'toast' + (type ? ' toast-' + type : '');
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s';
    setTimeout(() => toast.remove(), 300);
  }, 2800);
}


/* ============================================================
   CUSTOM MODAL SYSTEM (NO BROWSER POPUPS)
   ============================================================ */

function openModal(title, bodyHTML, footerHTML, onClose) {
  $('#modalTitle').textContent = title;
  $('#modalBody').innerHTML = bodyHTML;
  $('#modalFooter').innerHTML = footerHTML;
  $('#modalOverlay').classList.add('visible');
  document.body.style.overflow = 'hidden';

  // Store optional onClose callback
  window._modalOnClose = onClose || null;
}

function closeModal() {
  $('#modalOverlay').classList.remove('visible');
  document.body.style.overflow = '';

  if (window._modalOnClose) {
    const cb = window._modalOnClose;
    window._modalOnClose = null;
    cb();
  }

  setTimeout(() => {
    $('#modalBody').innerHTML = '';
    $('#modalFooter').innerHTML = '';
  }, 220);
}


/* ============================================================
   DARK MODE
   ============================================================ */

function toggleDarkMode() {
  state.darkMode = !state.darkMode;
  document.body.classList.toggle('dark', state.darkMode);
  localStorage.setItem('collectionRoute_darkMode', state.darkMode ? 'true' : 'false');

  const moonIcon = $('.icon-moon');
  const sunIcon = $('.icon-sun');
  if (state.darkMode) {
    moonIcon.style.display = 'none';
    sunIcon.style.display = 'block';
  } else {
    moonIcon.style.display = 'block';
    sunIcon.style.display = 'none';
  }
}

function initDarkMode() {
  const saved = localStorage.getItem('collectionRoute_darkMode');
  if (saved === 'true') {
    state.darkMode = true;
    document.body.classList.add('dark');
    $('.icon-moon').style.display = 'none';
    $('.icon-sun').style.display = 'block';
  }
}


/* ============================================================
   FORMATTING HELPERS
   ============================================================ */

// Robust MOP Classifier (GCASH vs CASH vs Other)
function getMopType(mop) {
  if (!mop) return '';
  const s = mop.toString().trim().toUpperCase();
  if (s.indexOf('GCASH') !== -1 || s.indexOf('G-CASH') !== -1) {
    return 'GCASH';
  }
  if (s.indexOf('CASH') !== -1) {
    return 'CASH';
  }
  return s;
}

function formatMOP(mop) {
  if (!mop) return '—';
  const type = getMopType(mop);
  if (type === 'GCASH') {
    return '<span class="mop-badge mop-gcash">GCASH</span>';
  }
  if (type === 'CASH') {
    return '<span class="mop-badge mop-cash">CASH</span>';
  }
  return '<span class="mop-badge">' + escapeHtml(mop) + '</span>';
}

// Compact Date Formatter: mm/dd/yy (e.g. 10/16/26) to save space on mobile
function formatDisplayDate(val) {
  if (!val) return '—';
  const s = val.toString().trim();
  if (!s) return '—';

  // Format 10/16/2026 -> 10/16/26
  const parts = s.split('/');
  if (parts.length === 3) {
    const m = parts[0];
    const d = parts[1];
    let y = parts[2];
    if (y.length === 4) y = y.substring(2);
    return `${m}/${d}/${y}`;
  }

  // Format YYYY-MM-DD
  const iso = s.split('-');
  if (iso.length === 3 && iso[0].length === 4) {
    return `${iso[1]}/${iso[2]}/${iso[0].substring(2)}`;
  }

  // Parse Date object
  const dt = new Date(s);
  if (!isNaN(dt.getTime())) {
    const mm = String(dt.getMonth() + 1).padStart(2, '0');
    const dd = String(dt.getDate()).padStart(2, '0');
    const yy = String(dt.getFullYear()).slice(-2);
    return `${mm}/${dd}/${yy}`;
  }

  return s;
}

function escapeHtml(str) {
  if (!str) return '';
  return str.toString()
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
}


/* ============================================================
   TABLE RENDERING (NO ROW HIGHLIGHT EXCEPT ON EDITING)
   ============================================================ */

function renderTable() {
  const tbody = $('#routeTableBody');
  const empty = $('#emptyState');

  if (state.routes.length === 0) {
    tbody.innerHTML = '';
    empty.classList.add('visible');
    $('.table-scroll').style.display = 'none';
    return;
  }

  empty.classList.remove('visible');
  $('.table-scroll').style.display = '';

  tbody.innerHTML = state.routes.map((route, index) => {
    const classes = [];
    if (state.selectedIndex === index) classes.push('selected');
    const isEditing = (state.editingIndex === index);
    if (isEditing) classes.push('editing'); // Highlight ONLY on editing

    const seqDisplay = route.sequence + (isEditing ? '<span class="editing-tag">EDIT</span>' : '');

    return '<tr data-index="' + index + '"' +
      (classes.length ? ' class="' + classes.join(' ') + '"' : '') + '>' +
      '<td class="col-seq">' + seqDisplay + '</td>' +
      '<td class="col-account">' + escapeHtml(route.accountNo) + '</td>' +
      '<td class="col-name">' + (route.fullName ? escapeHtml(route.fullName) : '<span style="color:var(--text-muted);">(Not Found)</span>') + '</td>' +
      '<td class="col-date">' + formatDisplayDate(route.receivedDate) + '</td>' +
      '<td class="col-mop">' + formatMOP(route.mop) + '</td>' +
      '<td class="col-lastmop">' + formatMOP(route.lastMonthMop) + '</td>' +
      '</tr>';
  }).join('');

  // Row selection event
  tbody.querySelectorAll('tr').forEach(tr => {
    tr.addEventListener('click', (e) => {
      const idx = parseInt(tr.dataset.index, 10);
      selectRow(idx);
    });
  });
}

// Robust Totals Calculation
function renderTotals() {
  let gcash = 0;
  let cash = 0;

  state.routes.forEach(r => {
    const type = getMopType(r.mop);
    if (type === 'GCASH') gcash++;
    else if (type === 'CASH') cash++;
  });

  $('#totalGcash').textContent = gcash;
  $('#totalCash').textContent = cash;
}


/* ============================================================
   ROW SELECTION & DETAILS PANEL
   ============================================================ */

function selectRow(index) {
  if (state.selectedIndex === index) {
    // Tapping again deselects
    deselectRow();
    return;
  }

  state.selectedIndex = index;
  const route = state.routes[index];

  const acctEl = $('#infoAccountNo');
  const nameEl = $('#infoMemberName');
  if (acctEl) acctEl.textContent = route.accountNo || '—';
  if (nameEl) nameEl.textContent = route.fullName || '(No Name)';

  $('#infoMembershipLevel').textContent = route.membershipLevel || '—';
  $('#infoRemarks').textContent = route.remarks || '—';
  $('#actionPanel').classList.add('visible');

  // Disable move buttons at boundaries
  $('#btnMoveUp').disabled = (index === 0);
  $('#btnMoveDown').disabled = (index === state.routes.length - 1);

  renderTable();
}

function deselectRow() {
  state.selectedIndex = null;
  state.editingIndex = null;
  $('#actionPanel').classList.remove('visible');
  renderTable();
}


/* ============================================================
   LAST UPDATED DATE & TIME
   ============================================================ */

function updateLastUpdatedTime() {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const yy = String(now.getFullYear()).slice(-2);

  let hours = now.getHours();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours ? hours : 12;
  const mins = String(now.getMinutes()).padStart(2, '0');

  const str = `Last updated: ${mm}/${dd}/${yy} ${hours}:${mins} ${ampm}`;
  const el = $('#lastUpdated');
  if (el) el.textContent = str;
  localStorage.setItem('collectionRoute_lastUpdated', str);
}

function initLastUpdatedTime() {
  const saved = localStorage.getItem('collectionRoute_lastUpdated');
  const el = $('#lastUpdated');
  if (el && saved) {
    el.textContent = saved;
  }
}


/* ============================================================
   SYNC DATA WITH GOOGLE SHEETS
   ============================================================ */

async function syncData() {
  if (WEB_APP_URL === 'YOUR_WEB_APP_URL_HERE' || !WEB_APP_URL.startsWith('http')) {
    openModal(
      'Apps Script Web App URL Required',
      '<div style="line-height:1.6;">' +
        '<p style="margin-bottom:10px;">Please check your <code>WEB_APP_URL</code> configuration in <code>app.js</code>.</p>' +
      '</div>',
      '<button class="btn btn-primary" onclick="closeModal()">Got it</button>'
    );
    return;
  }

  showLoading('Fetching ' + state.dueDate + ' route & payment records...', 20, 'Syncing with Sheets');
  try {
    const result = await api.syncAll(state.dueDate, state.month, state.year);

    if (result.error) {
      openModal(
        'Sync Error',
        '<p>' + escapeHtml(result.error) + '</p>',
        '<button class="btn btn-secondary" onclick="closeModal()">Close</button>'
      );
      return;
    }

    state.routes = result.routes || [];
    deselectRow();
    renderTable();
    renderTotals();
    updateLastUpdatedTime();
    showToast('Synced ' + state.dueDate + ' successfully', 'success');
  } catch (err) {
    openModal(
      'Sync Failed',
      '<p>Could not connect to Google Apps Script Web App.</p>' +
      '<p style="color:var(--text-muted);font-size:0.8rem;margin-top:8px;">' + escapeHtml(err.message) + '</p>',
      '<button class="btn btn-secondary" onclick="closeModal()">Close</button>'
    );
  } finally {
    hideLoading();
  }
}


/* ============================================================
   ADD ROW WITH AUTOCOMPLETE & DUE DATE TARGET AWARENESS
   ============================================================ */

function showAddRowModal() {
  // Compute next sequence for the active Due Date route
  const nextSeq = (state.routes.length > 0)
    ? Math.max(...state.routes.map(r => r.sequence || 0)) + 1
    : 1;

  const bodyHTML =
    '<div style="margin-bottom:12px;">' +
      '<span class="route-target-pill">' + escapeHtml(state.dueDate) + ' ROUTE &bull; Next Sequence #' + nextSeq + '</span>' +
    '</div>' +
    '<div class="form-group">' +
      '<label>Search Member (Account # or Name)</label>' +
      '<div class="search-wrapper">' +
        '<input type="text" id="searchMemberInput" placeholder="Type account number or name..." autocomplete="off">' +
        '<div class="search-dropdown" id="searchDropdown"></div>' +
      '</div>' +
    '</div>' +
    '<div class="selected-member" id="selectedMember">' +
      '<p><strong>Account #:</strong> <span id="selectedAccountNo"></span></p>' +
      '<p><strong>Fullname:</strong> <span id="selectedFullName"></span></p>' +
      '<p><strong>Level:</strong> <span id="selectedLevel"></span></p>' +
    '</div>' +
    '<div class="form-group">' +
      '<label>Remarks (Optional)</label>' +
      '<input type="text" id="addRemarks" placeholder="Enter collection notes...">' +
    '</div>';

  const footerHTML =
    '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
    '<button class="btn btn-primary" id="btnConfirmAdd" disabled>Add to ' + escapeHtml(state.dueDate) + '</button>';

  openModal('Add Member to ' + escapeHtml(state.dueDate) + ' Route', bodyHTML, footerHTML);

  let debounceTimer = null;
  let selectedAccount = null;

  const input = $('#searchMemberInput');
  const dropdown = $('#searchDropdown');
  const confirmBtn = $('#btnConfirmAdd');

  setTimeout(() => input.focus(), 120);

  function pickMember(acc, name, level) {
    selectedAccount = acc;
    input.value = acc + ' — ' + name;
    dropdown.classList.remove('visible');
    $('#selectedAccountNo').textContent = acc;
    $('#selectedFullName').textContent = name;
    $('#selectedLevel').textContent = level || 'Standard';
    $('#selectedMember').classList.add('visible');
    confirmBtn.disabled = false;
  }

  input.addEventListener('input', function() {
    clearTimeout(debounceTimer);
    selectedAccount = null;
    confirmBtn.disabled = true;
    $('#selectedMember').classList.remove('visible');

    const query = input.value.trim();
    if (query.length < 2) {
      dropdown.classList.remove('visible');
      dropdown.innerHTML = '';
      return;
    }

    // Direct account number recognition (if user types digits directly)
    if (/^\d{6,12}$/.test(query)) {
      selectedAccount = query;
      confirmBtn.disabled = false;
    }

    dropdown.innerHTML = '<div class="dropdown-loading">Searching database...</div>';
    dropdown.classList.add('visible');

    debounceTimer = setTimeout(async () => {
      try {
        const result = await api.searchMembers(query);
        if (result && result.results && result.results.length > 0) {
          dropdown.innerHTML = result.results.map(m =>
            '<div class="dropdown-item" data-account="' + escapeHtml(m.accountNo) +
            '" data-name="' + escapeHtml(m.fullName) +
            '" data-level="' + escapeHtml(m.membershipLevel || '') + '">' +
              '<div class="dropdown-item-details">' +
                '<strong>' + escapeHtml(m.accountNo) + '</strong>' +
                '<span>' + escapeHtml(m.fullName) + '</span>' +
              '</div>' +
              (m.membershipLevel ? '<span class="dropdown-item-meta">' + escapeHtml(m.membershipLevel) + '</span>' : '') +
            '</div>'
          ).join('');

          dropdown.querySelectorAll('.dropdown-item').forEach(item => {
            item.addEventListener('click', function() {
              pickMember(this.dataset.account, this.dataset.name, this.dataset.level);
            });
          });
        } else {
          dropdown.innerHTML = '<div class="dropdown-empty">No matching member found.</div>';
        }
      } catch (err) {
        dropdown.innerHTML = '<div class="dropdown-empty">Search unavailable (check connection).</div>';
      }
    }, 280);
  });

  confirmBtn.addEventListener('click', async function() {
    const acct = selectedAccount || input.value.trim();
    if (!acct) return;

    const remarks = ($('#addRemarks') || {}).value || '';
    closeModal();
    showLoading('Adding member to ' + state.dueDate + ' sheet...', 25, 'Adding to Route');

    try {
      const result = await api.addRoute({
        accountNo: acct,
        dueDate: state.dueDate,
        remarks: remarks
      });

      if (result.error) {
        hideLoading();
        openModal(
          'Error',
          '<p>' + escapeHtml(result.error) + '</p>',
          '<button class="btn btn-secondary" onclick="closeModal()">Close</button>'
        );
        return;
      }

      await syncData();
      showToast('Row added to ' + state.dueDate, 'success');
    } catch (err) {
      hideLoading();
      openModal(
        'Error',
        '<p>Failed to add row: ' + escapeHtml(err.message) + '</p>',
        '<button class="btn btn-secondary" onclick="closeModal()">Close</button>'
      );
    }
  });
}


/* ============================================================
   EDIT ROW WITH CLEAR MEMBER IDENTIFICATION
   ============================================================ */

function showEditRowModal() {
  if (state.selectedIndex === null) return;
  const route = state.routes[state.selectedIndex];
  if (!route) return;

  // Set editing state to highlight the row in the table
  state.editingIndex = state.selectedIndex;
  renderTable();

  const bodyHTML =
    '<div class="edit-identity-card">' +
      '<div class="edit-identity-seq">Editing Sequence #' + route.sequence + ' &bull; ' + escapeHtml(state.dueDate) + ' Route</div>' +
      '<div class="edit-identity-name">' + escapeHtml(route.fullName || 'Member') + '</div>' +
      '<div class="edit-identity-meta">Account #' + escapeHtml(route.accountNo) + ' &bull; Level: ' + escapeHtml(route.membershipLevel || 'Standard') + '</div>' +
    '</div>' +
    '<div class="form-group">' +
      '<label>Account Number</label>' +
      '<div class="search-wrapper">' +
        '<input type="text" id="editMemberInput" value="' + escapeHtml(route.accountNo) + '" autocomplete="off">' +
        '<div class="search-dropdown" id="editSearchDropdown"></div>' +
      '</div>' +
    '</div>' +
    '<div class="form-group">' +
      '<label>Remarks</label>' +
      '<input type="text" id="editRemarks" value="' + escapeHtml(route.remarks || '') + '" placeholder="Enter remarks...">' +
    '</div>';

  const footerHTML =
    '<button class="btn btn-secondary" id="btnCancelEdit">Cancel</button>' +
    '<button class="btn btn-primary" id="btnConfirmEdit">Save Changes</button>';

  openModal('Edit Member — #' + route.sequence, bodyHTML, footerHTML, () => {
    // When modal closes, clear editing highlight
    state.editingIndex = null;
    renderTable();
  });

  $('#btnCancelEdit').addEventListener('click', closeModal);

  let selectedAccount = route.accountNo;
  let debounceTimer = null;
  const input = $('#editMemberInput');
  const dropdown = $('#editSearchDropdown');

  input.addEventListener('input', function() {
    clearTimeout(debounceTimer);
    selectedAccount = input.value.trim();

    const query = input.value.trim();
    if (query.length < 2) {
      dropdown.classList.remove('visible');
      dropdown.innerHTML = '';
      return;
    }

    dropdown.innerHTML = '<div class="dropdown-loading">Searching...</div>';
    dropdown.classList.add('visible');

    debounceTimer = setTimeout(async () => {
      try {
        const result = await api.searchMembers(query);
        if (result && result.results && result.results.length > 0) {
          dropdown.innerHTML = result.results.map(m =>
            '<div class="dropdown-item" data-account="' + escapeHtml(m.accountNo) +
            '" data-name="' + escapeHtml(m.fullName) + '">' +
              '<div class="dropdown-item-details">' +
                '<strong>' + escapeHtml(m.accountNo) + '</strong>' +
                '<span>' + escapeHtml(m.fullName) + '</span>' +
              '</div>' +
            '</div>'
          ).join('');

          dropdown.querySelectorAll('.dropdown-item').forEach(item => {
            item.addEventListener('click', function() {
              selectedAccount = this.dataset.account;
              input.value = this.dataset.account;
              dropdown.classList.remove('visible');
            });
          });
        } else {
          dropdown.innerHTML = '<div class="dropdown-empty">No results found.</div>';
        }
      } catch (e) {
        dropdown.innerHTML = '<div class="dropdown-empty">Search unavailable.</div>';
      }
    }, 280);
  });

  $('#btnConfirmEdit').addEventListener('click', async function() {
    const newAcct = selectedAccount || input.value.trim();
    const newRemarks = ($('#editRemarks') || {}).value || '';

    closeModal();
    showLoading('Saving changes to sheet...', 25, 'Updating Route');

    try {
      const result = await api.updateRoute({
        rowIndex: route.rowIndex,
        origAccountNo: route.accountNo,
        accountNo: newAcct,
        dueDate: state.dueDate,
        remarks: newRemarks
      });

      if (result.error) {
        hideLoading();
        openModal(
          'Error',
          '<p>' + escapeHtml(result.error) + '</p>',
          '<button class="btn btn-secondary" onclick="closeModal()">Close</button>'
        );
        return;
      }

      await syncData();
      showToast('Route updated', 'success');
    } catch (err) {
      hideLoading();
      openModal(
        'Error',
        '<p>Failed to update: ' + escapeHtml(err.message) + '</p>',
        '<button class="btn btn-secondary" onclick="closeModal()">Close</button>'
      );
    }
  });
}


/* ============================================================
   DELETE ROW WITH CONFIRMATION MODAL
   ============================================================ */

function showDeleteConfirm() {
  if (state.selectedIndex === null) return;
  const route = state.routes[state.selectedIndex];
  if (!route) return;

  const bodyHTML =
    '<p style="margin-bottom:8px;">Are you sure you want to remove this member from the <strong>' + escapeHtml(state.dueDate) + '</strong> route?</p>' +
    '<div style="background:var(--bg-tertiary);padding:10px 14px;border-radius:6px;font-size:0.86rem;">' +
      '<div><strong>Sequence:</strong> #' + route.sequence + '</div>' +
      '<div><strong>Account #:</strong> ' + escapeHtml(route.accountNo) + '</div>' +
      '<div><strong>Name:</strong> ' + escapeHtml(route.fullName || '—') + '</div>' +
    '</div>';

  const footerHTML =
    '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
    '<button class="btn btn-danger" id="btnConfirmDelete">Delete</button>';

  openModal('Confirm Delete', bodyHTML, footerHTML);

  $('#btnConfirmDelete').addEventListener('click', async function() {
    closeModal();
    showLoading('Removing member from ' + state.dueDate + '...', 25, 'Deleting Member');

    try {
      const result = await api.deleteRoute({
        rowIndex: route.rowIndex,
        accountNo: route.accountNo,
        dueDate: state.dueDate
      });

      if (result.error) {
        hideLoading();
        openModal(
          'Error',
          '<p>' + escapeHtml(result.error) + '</p>',
          '<button class="btn btn-secondary" onclick="closeModal()">Close</button>'
        );
        return;
      }

      deselectRow();
      await syncData();
      showToast('Row deleted from ' + state.dueDate, 'success');
    } catch (err) {
      hideLoading();
      openModal(
        'Error',
        '<p>Failed to delete: ' + escapeHtml(err.message) + '</p>',
        '<button class="btn btn-secondary" onclick="closeModal()">Close</button>'
      );
    }
  });
}


/* ============================================================
   CLEAR ALL WITH CONFIRMATION MODAL
   ============================================================ */

function showClearAllConfirm() {
  if (state.routes.length === 0) {
    openModal(
      'Clear All',
      '<p>There are no routes to clear for <strong>' + escapeHtml(state.dueDate) + '</strong>.</p>',
      '<button class="btn btn-secondary" onclick="closeModal()">OK</button>'
    );
    return;
  }

  const bodyHTML =
    '<p>Are you sure you want to remove <strong>ALL ' + state.routes.length +
    ' routes</strong> for <strong>' + escapeHtml(state.dueDate) + '</strong>?</p>' +
    '<p style="color:var(--btn-danger-bg);font-weight:600;font-size:0.82rem;margin-top:10px;">⚠ This will only clear the ' + escapeHtml(state.dueDate) + ' route list. Other due dates will remain safe.</p>';

  const footerHTML =
    '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
    '<button class="btn btn-danger" id="btnConfirmClear">Clear All</button>';

  openModal('Clear All ' + escapeHtml(state.dueDate) + ' Routes', bodyHTML, footerHTML);

  $('#btnConfirmClear').addEventListener('click', async function() {
    closeModal();
    showLoading('Clearing ' + state.dueDate + ' routes...', 25, 'Clearing Routes');

    try {
      const result = await api.clearRoutes({ dueDate: state.dueDate });

      if (result.error) {
        hideLoading();
        openModal(
          'Error',
          '<p>' + escapeHtml(result.error) + '</p>',
          '<button class="btn btn-secondary" onclick="closeModal()">Close</button>'
        );
        return;
      }

      deselectRow();
      await syncData();
      showToast('All ' + state.dueDate + ' routes cleared', 'success');
    } catch (err) {
      hideLoading();
      openModal(
        'Error',
        '<p>Failed to clear routes: ' + escapeHtml(err.message) + '</p>',
        '<button class="btn btn-secondary" onclick="closeModal()">Close</button>'
      );
    }
  });
}


/* ============================================================
   REORDER / MOVE UP / DOWN (ISOLATED TO ACTIVE DUE DATE)
   ============================================================ */

async function moveRow(direction) {
  if (state.selectedIndex === null) return;

  const curIndex = state.selectedIndex;
  const newIndex = direction === 'up' ? curIndex - 1 : curIndex + 1;

  if (newIndex < 0 || newIndex >= state.routes.length) return;

  // Swap locally
  const temp = state.routes[curIndex];
  state.routes[curIndex] = state.routes[newIndex];
  state.routes[newIndex] = temp;

  // Update sequences
  state.routes.forEach((r, i) => { r.sequence = i + 1; });

  // Update selection
  state.selectedIndex = newIndex;

  // Update button states
  $('#btnMoveUp').disabled = (newIndex === 0);
  $('#btnMoveDown').disabled = (newIndex === state.routes.length - 1);

  renderTable();

  // Save order to Google Sheets
  try {
    await api.reorderRoutes({
      dueDate: state.dueDate,
      routes: state.routes.map(r => ({
        accountNo: r.accountNo,
        remarks: r.remarks || ''
      }))
    });
    showToast('Order saved for ' + state.dueDate, 'success');
  } catch (err) {
    showToast('Failed to save order: ' + err.message, 'error');
  }
}


/* ============================================================
   INITIALIZATION
   ============================================================ */

function initFilters() {
  const monthSelect = $('#month');
  const yearSelect = $('#year');
  const now = new Date();

  // Populate months
  monthSelect.innerHTML = '';
  MONTHS.forEach((m, i) => {
    const opt = document.createElement('option');
    opt.value = m;
    opt.textContent = m;
    if (i === now.getMonth()) opt.selected = true;
    monthSelect.appendChild(opt);
  });

  // Populate years (current year - 2 to current year + 2)
  yearSelect.innerHTML = '';
  const currentYear = now.getFullYear();
  for (let y = currentYear - 2; y <= currentYear + 2; y++) {
    const opt = document.createElement('option');
    opt.value = y.toString();
    opt.textContent = y.toString();
    if (y === currentYear) opt.selected = true;
    yearSelect.appendChild(opt);
  }

  state.dueDate = $('#dueDate').value;
  state.month = monthSelect.value;
  state.year = yearSelect.value;
}

function initEventListeners() {
  // Dark mode
  $('#darkModeToggle').addEventListener('click', toggleDarkMode);

  // Top header actions
  $('#btnAddRow').addEventListener('click', showAddRowModal);
  $('#btnSync').addEventListener('click', syncData);
  $('#btnClearAll').addEventListener('click', showClearAllConfirm);

  // Bottom action panel
  $('#btnEditRow').addEventListener('click', showEditRowModal);
  $('#btnDeleteRow').addEventListener('click', showDeleteConfirm);
  $('#btnMoveUp').addEventListener('click', () => moveRow('up'));
  $('#btnMoveDown').addEventListener('click', () => moveRow('down'));
  $('#btnClosePanel').addEventListener('click', deselectRow);

  // Modal close handlers
  $('#modalClose').addEventListener('click', closeModal);
  $('#modalOverlay').addEventListener('click', function(e) {
    if (e.target === this) closeModal();
  });

  // Keyboard accessibility
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      if ($('#modalOverlay').classList.contains('visible')) {
        closeModal();
      } else if (state.selectedIndex !== null) {
        deselectRow();
      }
    }
  });

  // Filters trigger sync
  $('#dueDate').addEventListener('change', function() {
    state.dueDate = this.value;
    deselectRow();
    syncData();
  });

  $('#month').addEventListener('change', function() {
    state.month = this.value;
    deselectRow();
    syncData();
  });

  $('#year').addEventListener('change', function() {
    state.year = this.value;
    deselectRow();
    syncData();
  });
}

function init() {
  initDarkMode();
  initLastUpdatedTime();
  initFilters();
  initEventListeners();

  renderTable();
  renderTotals();

  // If URL is set, sync immediately
  if (WEB_APP_URL !== 'YOUR_WEB_APP_URL_HERE' && WEB_APP_URL.startsWith('http')) {
    syncData();
  }
}

document.addEventListener('DOMContentLoaded', init);
