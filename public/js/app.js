// --- DOM Elements ---
const loginView = document.getElementById('login-view');
const dashboardView = document.getElementById('dashboard-view');
const loginForm = document.getElementById('login-form');
const loginError = document.getElementById('login-error');
const devicesContainer = document.getElementById('devices-container');

// --- Application State ---
let allDevices = [];
let currentTagFilter = 'all';

function setFilter(tag) {
    currentTagFilter = tag;
    renderDevices(allDevices); // Re-render instantly using memory
}

// --- Initialization ---
document.addEventListener('DOMContentLoaded', checkSession);

// --- Auth Functions ---
async function checkSession() {
    // Attempt to fetch devices. If 401, show login. If 200, show dashboard.
    const res = await fetch('/api/devices');
    if (res.status === 401) {
        showLogin();
    } else if (res.ok) {
        allDevices = await res.json();
        showDashboard();
        renderDevices(allDevices);
    }
}

loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;

    const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
    });

    if (res.ok) {
        document.getElementById('password').value = '';
        loginError.classList.add('hidden');
        checkSession();
    } else {
        const data = await res.json();
        loginError.textContent = data.error || 'Login failed';
        loginError.classList.remove('hidden');
    }
});

async function logout() {
    await fetch('/api/logout', { method: 'POST' });
    showLogin();
}

function showLogin() {
    dashboardView.classList.add('hidden-view');
    loginView.classList.remove('hidden-view');
}

function showDashboard() {
    loginView.classList.add('hidden-view');
    dashboardView.classList.remove('hidden-view');
}

// --- Device Functions ---
async function fetchAndRender() {
    const res = await fetch('/api/devices');
    if (res.status === 401) return showLogin();
    // Save to state before rendering
    allDevices = await res.json();
    renderDevices(allDevices);
}

async function createDevice() {
    const nameInput = document.getElementById('new-device-name');
    const name = nameInput.value.trim();
    if (!name) return;

    const res = await fetch('/api/devices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
    });
    if (res.ok) {
        nameInput.value = '';
        fetchAndRender();
    }
}

async function deleteDevice(id) {
    if (!confirm('Are you sure you want to delete this device?')) return;
    await fetch(`/api/devices/${id}`, { method: 'DELETE' });
    fetchAndRender();
}

// --- Tag Functions ---
function enableTagEdit(deviceId) {
    document.getElementById(`tags-display-${deviceId}`).classList.add('hidden');
    const editDiv = document.getElementById(`tags-edit-${deviceId}`);
    editDiv.classList.remove('hidden');

    // Focus the input and move the cursor to the end
    const input = document.getElementById(`tag-input-${deviceId}`);
    input.focus();
    const val = input.value;
    input.value = '';
    input.value = val;
}

function cancelTagEdit(deviceId) {
    document.getElementById(`tags-edit-${deviceId}`).classList.add('hidden');
    document.getElementById(`tags-display-${deviceId}`).classList.remove('hidden');
}

async function saveTags(deviceId) {
    const inputValue = document.getElementById(`tag-input-${deviceId}`).value;
    const tags = inputValue.split(',').map(t => t.trim()).filter(t => t);

    await fetch(`/api/devices/${deviceId}/tags`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tags })
    });
    fetchAndRender(); // Re-render closes the edit mode automatically
}

async function toggleTagGroup(tag, isBlocked) {
    await fetch('/api/devices/block-by-tag', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tag, is_blocked: isBlocked })
    });
    fetchAndRender(); // Refresh UI to show all devices synced
}

async function toggleBlock(id, toggleElement) {
    const isBlocked = toggleElement.checked;
    await fetch(`/api/devices/${id}/block`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_blocked: isBlocked })
    });
    fetchAndRender();
}

// --- MAC Address Functions ---
async function addMac(deviceId) {
    const macInput = document.getElementById(`new-mac-${deviceId}`);
    const typeSelect = document.getElementById(`new-type-${deviceId}`);

    const mac_address = macInput.value.trim();
    const interface_type = typeSelect.value;
    if (!mac_address) return;

    const res = await fetch(`/api/devices/${deviceId}/macs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mac_address, interface_type })
    });

    if (res.ok) {
        fetchAndRender();
    } else {
        const data = await res.json();
        alert(data.error);
    }
}

async function removeMac(deviceId, macId) {
    await fetch(`/api/devices/${deviceId}/macs/${macId}`, { method: 'DELETE' });
    fetchAndRender();
}

// --- Rendering Logic ---
function renderDevices(devices) {
    devicesContainer.innerHTML = '';

    // 1. Calculate Tag States
    const tagMap = {};
    let untaggedCount = 0;

    devices.forEach(d => {
        if (!d.tags || d.tags.length === 0) {
            untaggedCount++;
        } else {
            d.tags.forEach(tag => {
                if (!tagMap[tag]) tagMap[tag] = { total: 0, blocked: 0 };
                tagMap[tag].total++;
                if (d.is_blocked) tagMap[tag].blocked++;
            });
        }
    });

    // 2. Render Tag Control Center
    const tagControlsDiv = document.getElementById('tag-controls');
    const tagContainer = document.getElementById('tag-controls-container');
    tagControlsDiv.innerHTML = '';

    // Always show Tag Control Center now
    tagContainer.classList.remove('hidden');

    // Helper functions for pill styling based on active filter
    const getPillClasses = (tagId) => currentTagFilter === tagId
        ? 'bg-brand-50 border-brand-300 ring-1 ring-brand-300'
        : 'bg-white border-gray-200 hover:bg-gray-50';
    const getTextColor = (tagId) => currentTagFilter === tagId
        ? 'text-brand-800'
        : 'text-gray-700';

    // Render "All Devices" Filter
    tagControlsDiv.innerHTML += `
        <div onclick="setFilter('all')" class="flex items-center border shadow-sm rounded-full px-4 py-1.5 cursor-pointer transition-colors ${getPillClasses('all')}">
            <span class="text-sm font-bold ${getTextColor('all')}">All Devices <span class="text-xs font-normal opacity-70">(${devices.length})</span></span>
        </div>
    `;

    // Render "Ungrouped (No-Tag)" Filter
    if (untaggedCount > 0) {
        tagControlsDiv.innerHTML += `
            <div onclick="setFilter('no-tag')" class="flex items-center border shadow-sm rounded-full px-4 py-1.5 cursor-pointer transition-colors ${getPillClasses('no-tag')}">
                <span class="text-sm font-bold ${getTextColor('no-tag')}">Ungrouped <span class="text-xs font-normal opacity-70">(${untaggedCount})</span></span>
            </div>
        `;
    }

    // Render Dynamic Tag Filters
    const uniqueTags = Object.keys(tagMap).sort();
    uniqueTags.forEach(tag => {
        const stats = tagMap[tag];
        const isAllBlocked = stats.blocked === stats.total;
        const isMixed = stats.blocked > 0 && stats.blocked < stats.total;

        let toggleBg = 'bg-gray-200';
        if (isAllBlocked) toggleBg = 'bg-red-500';
        else if (isMixed) toggleBg = 'bg-yellow-400';

        tagControlsDiv.innerHTML += `
            <div onclick="setFilter('${tag}')" class="flex items-center border shadow-sm rounded-full pl-3 pr-1 py-1 gap-3 cursor-pointer transition-colors ${getPillClasses(tag)}">
                <span class="text-sm font-bold ${getTextColor(tag)}">${tag} <span class="text-xs font-normal opacity-70">(${stats.total})</span></span>
                
                <!-- Use stopPropagation so clicking the switch doesn't accidentally trigger the filter click -->
                <div onclick="event.stopPropagation()" class="relative inline-block w-10 align-middle select-none transition duration-200 ease-in" title="${isMixed ? 'Mixed State - Click to sync' : ''}">
                    <input type="checkbox" id="tag-toggle-${tag}" onchange="toggleTagGroup('${tag}', this.checked)" ${isAllBlocked ? 'checked' : ''} class="toggle-checkbox absolute block w-5 h-5 rounded-full bg-white border-4 appearance-none cursor-pointer z-10 transition-all duration-300"/>
                    <label for="tag-toggle-${tag}" class="block overflow-hidden h-5 rounded-full ${toggleBg} cursor-pointer transition-colors duration-300"></label>
                </div>
            </div>
        `;
    });

    // 3. Render Individual Devices
    devices.forEach(d => {
        // --- APPLY THE FILTER ---
        if (currentTagFilter !== 'all') {
            const hasTags = d.tags && d.tags.length > 0;
            if (currentTagFilter === 'no-tag' && hasTags) return; // Skip tagged devices
            if (currentTagFilter !== 'no-tag' && (!hasTags || !d.tags.includes(currentTagFilter))) return; // Skip if it doesn't have the active tag
        }

        // Build Tags HTML for the card
        const tagsPills = (d.tags || []).map(t =>
            `<span class="bg-brand-100 text-brand-700 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide border border-brand-200">${t}</span>`
        ).join(' ');

        // Build MAC list HTML
        const macsHtml = (d.macs || []).map(m => `
            <div class="flex justify-between items-center bg-gray-50 px-3 py-2 rounded text-sm mb-2 border border-gray-100 shadow-sm overflow-hidden">
                <div class="flex-grow truncate mr-2">
                    <span class="font-mono text-gray-700 text-xs sm:text-sm">${m.mac_address}</span>
                    <span class="text-[10px] sm:text-xs text-gray-400 uppercase tracking-wide ml-1">(${m.interface_type})</span>
                </div>
                <button onclick="removeMac(${d.id}, ${m.id})" class="text-red-400 hover:text-red-600 text-lg font-bold px-1 transition-colors" title="Remove MAC">&times;</button>
            </div>
        `).join('');

        const card = document.createElement('div');
        card.className = 'bg-white rounded-xl shadow-sm border border-gray-200 p-4 sm:p-5 flex flex-col h-full';

        card.innerHTML = `
            <div class="flex justify-between items-start mb-2">
                <h2 class="text-lg font-bold text-gray-800 pr-2 truncate">${d.name}</h2>
                <div class="relative inline-block w-12 flex-shrink-0 align-middle select-none transition duration-200 ease-in mt-0.5">
                    <input type="checkbox" id="toggle-${d.id}" onchange="toggleBlock(${d.id}, this)" ${d.is_blocked ? 'checked' : ''} class="toggle-checkbox absolute block w-6 h-6 rounded-full bg-white border-4 appearance-none cursor-pointer z-10 transition-all duration-300"/>
                    <label for="toggle-${d.id}" class="block overflow-hidden h-6 rounded-full ${d.is_blocked ? 'bg-red-500' : 'bg-green-500'} cursor-pointer transition-colors duration-300"></label>
                </div>
            </div>

            <!-- Tags Section -->
            <div class="mb-4 min-h-[28px]">
                <div id="tags-display-${d.id}" class="flex items-center flex-wrap gap-1">
                    ${tagsPills}
                    <button onclick="enableTagEdit(${d.id})" class="text-[10px] text-gray-400 hover:text-brand-600 ml-1 underline bg-gray-50 px-2 py-0.5 rounded border border-gray-200 transition-colors">Edit Tags</button>
                </div>
                <div id="tags-edit-${d.id}" class="hidden flex items-center gap-1">
                    <input type="text" id="tag-input-${d.id}" value="${(d.tags || []).join(', ')}" placeholder="e.g., kids, tablet" 
                        class="flex-grow text-xs px-2 py-1.5 border border-brand-300 rounded focus:outline-none focus:ring-1 focus:ring-brand-500 shadow-inner"
                        onkeydown="if(event.key === 'Enter') saveTags(${d.id}); if(event.key === 'Escape') cancelTagEdit(${d.id});">
                    <button onclick="saveTags(${d.id})" class="text-[10px] font-bold bg-green-500 text-white px-2 py-1.5 rounded hover:bg-green-600 shadow-sm transition-colors">Save</button>
                    <button onclick="cancelTagEdit(${d.id})" class="text-[10px] font-bold bg-gray-200 text-gray-700 px-2 py-1.5 rounded hover:bg-gray-300 shadow-sm transition-colors">Cancel</button>
                </div>
            </div>

            <div class="flex-grow mb-5">
                <h3 class="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                    Registered MACs
                    <span class="bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full text-[10px]">${(d.macs || []).length}</span>
                </h3>
                <div class="space-y-1">
                    ${macsHtml}
                </div>
            </div>

            <div class="flex flex-col sm:flex-row gap-2 mt-auto pt-4 border-t border-gray-100">
                <input type="text" id="new-mac-${d.id}" placeholder="aa:bb:cc:..." class="w-full sm:flex-grow font-mono text-sm px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-brand-500 transition">
                <div class="flex gap-2 w-full sm:w-auto">
                    <select id="new-type-${d.id}" class="flex-grow sm:w-auto text-sm border rounded-md bg-white px-2 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500">
                        <option value="WiFi">WiFi</option>
                        <option value="Ethernet">Eth</option>
                    </select>
                    <button onclick="addMac(${d.id})" class="bg-brand-600 text-white text-sm font-bold py-2 px-4 rounded-md hover:bg-brand-500 transition shadow-sm whitespace-nowrap">Add</button>
                </div>
            </div>

            <div class="mt-4 text-right">
                <button onclick="deleteDevice(${d.id})" class="text-[11px] sm:text-xs font-semibold text-red-500 hover:text-red-700 hover:underline uppercase tracking-wide transition-colors">Delete Profile</button>
            </div>
        `;
        devicesContainer.appendChild(card);
    });
}
