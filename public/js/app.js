// --- DOM Elements ---
const loginView = document.getElementById('login-view');
const dashboardView = document.getElementById('dashboard-view');
const loginForm = document.getElementById('login-form');
const loginError = document.getElementById('login-error');
const devicesContainer = document.getElementById('devices-container');

// --- Application State ---
let allDevices = [];
let currentTagFilter = 'all';
let expandedDeviceIds = new Set(); // Tracks which cards are open

function toggleExpand(id) {
    if (expandedDeviceIds.has(id)) {
        expandedDeviceIds.delete(id);
    } else {
        expandedDeviceIds.add(id);
    }
    renderDevices(allDevices); // Re-render to show/hide details
}

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
            if (currentTagFilter === 'no-tag' && hasTags) return;
            if (currentTagFilter !== 'no-tag' && (!hasTags || !d.tags.includes(currentTagFilter))) return;
        }

        const isExpanded = expandedDeviceIds.has(d.id);
        const hasLiveIPs = d.macs && d.macs.some(m => m.live_info && Object.keys(m.live_info.ips).length > 0);

        // Build Live IP Summary for the Collapsed View
        let ipSummaryHtml = '';
        const allFoundIPs = [];
        (d.macs || []).forEach(m => {
            if (m.live_info && m.live_info.ips) {
                Object.entries(m.live_info.ips).forEach(([ip, sources]) => {
                    const icons = sources.map(s => {
                        if (s === 'static') return '📌';
                        if (s === 'dhcp') return '⏳';
                        if (s === 'arp') return '📡';
                        return '';
                    }).join('');
                    allFoundIPs.push(`<span class="inline-flex items-center gap-1 mr-3">↳ ${ip} <span class="filter grayscale-[0.5] scale-90">${icons}</span></span>`);
                });
            }
        });
        ipSummaryHtml = allFoundIPs.length > 0
            ? `<div class="text-[10px] sm:text-xs font-mono text-brand-600 mt-1 flex flex-wrap">${allFoundIPs.join('')}</div>`
            : `<div class="text-[10px] text-gray-400 italic mt-1">Device Offline</div>`;

        // Tags Pills HTML
        const tagsPills = (d.tags || []).map(t =>
            `<span class="bg-brand-100 text-brand-700 text-[9px] font-bold px-2 py-0.5 rounded-full border border-brand-200">${t}</span>`
        ).join(' ');

        // Full MAC List (Visible only when expanded)
        const macsDetailHtml = (d.macs || []).map(m => `
            <div class="bg-gray-50 px-3 py-2 rounded text-sm mb-2 border border-gray-100 shadow-sm">
                <div class="flex justify-between items-center">
                    <span class="font-mono text-gray-700 text-xs">${m.mac_address} <span class="text-[10px] text-gray-400">(${m.interface_type})</span></span>
                    <button onclick="removeMac(${d.id}, ${m.id})" class="text-red-400 hover:text-red-600 font-bold">&times;</button>
                </div>
            </div>
        `).join('');

        const card = document.createElement('div');
        // Dim the card if it's offline (no live IPs found)
        card.className = `bg-white rounded-xl shadow-sm border border-gray-200 flex flex-col transition-all duration-300 ${!hasLiveIPs ? 'opacity-70 grayscale-[0.2]' : ''}`;

        card.innerHTML = `
            <!-- SUMMARY VIEW (Always Visible) -->
            <div class="p-4 sm:p-5">
                <div class="flex justify-between items-start mb-1">
                    <div class="flex-grow pr-2 truncate">
                        <h2 class="text-lg font-bold text-gray-800 truncate">${d.name}</h2>
                        <div class="flex flex-wrap gap-1 mt-1 min-h-[18px]">
                            ${tagsPills}
                        </div>
                    </div>
                    
                    <div class="flex items-center gap-4">
                        <!-- Block Toggle -->
                        <div class="relative inline-block w-10 flex-shrink-0 align-middle select-none">
                            <input type="checkbox" id="toggle-${d.id}" onchange="toggleBlock(${d.id}, this)" ${d.is_blocked ? 'checked' : ''} class="toggle-checkbox absolute block w-5 h-5 rounded-full bg-white border-4 appearance-none cursor-pointer z-10 transition-all"/>
                            <label for="toggle-${d.id}" class="block overflow-hidden h-5 rounded-full ${d.is_blocked ? 'bg-red-500' : 'bg-green-500'} cursor-pointer"></label>
                        </div>

                        <!-- Expand Chevron -->
                        <button onclick="toggleExpand(${d.id})" class="text-gray-400 hover:text-brand-500 transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}">
                            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
                        </button>
                    </div>
                </div>

                ${ipSummaryHtml}
            </div>

            <!-- DETAIL VIEW (Collapsible) -->
            <div id="details-${d.id}" class="${isExpanded ? 'block' : 'hidden'} bg-gray-50/50 border-t border-gray-100 p-4 sm:p-5 rounded-b-xl">
                
                <!-- Inline Tag Edit -->
                <div class="mb-5">
                    <h3 class="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Manage Tags</h3>
                    <div id="tags-edit-${d.id}" class="flex items-center gap-1">
                        <input type="text" id="tag-input-${d.id}" value="${(d.tags || []).join(', ')}" placeholder="kids, alex..." 
                            class="flex-grow text-xs px-2 py-1.5 border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-brand-500 bg-white"
                            onkeydown="if(event.key === 'Enter') saveTags(${d.id}); if(event.key === 'Escape') toggleExpand(${d.id});">
                        <button onclick="saveTags(${d.id})" class="bg-brand-600 text-white text-[10px] font-bold px-3 py-1.5 rounded">Save</button>
                    </div>
                </div>

                <!-- MAC Management -->
                <h3 class="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3">Registered MACs</h3>
                ${macsDetailHtml}
                
                <div class="flex flex-col sm:flex-row gap-2 mt-4 pt-4 border-t border-gray-200">
                    <input type="text" id="new-mac-${d.id}" placeholder="aa:bb:cc..." class="flex-grow text-sm px-3 py-2 border rounded-md bg-white">
                    <div class="flex gap-2">
                        <select id="new-type-${d.id}" class="text-sm border rounded-md bg-white px-2 py-2">
                            <option value="WiFi">WiFi</option>
                            <option value="Ethernet">Eth</option>
                        </select>
                        <button onclick="addMac(${d.id})" class="bg-brand-600 text-white text-sm font-bold py-2 px-4 rounded-md">Add</button>
                    </div>
                </div>

                <div class="mt-6 flex justify-end">
                    <button onclick="deleteDevice(${d.id})" class="text-[10px] font-bold text-red-400 hover:text-red-600 uppercase tracking-widest transition-colors">Delete Profile</button>
                </div>
            </div>
        `;
        devicesContainer.appendChild(card);
    });
}
