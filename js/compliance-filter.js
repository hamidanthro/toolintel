// Regulatory Fit Filter Component
// Filter tools by compliance requirements with presets and gap reports

const COMPLIANCE_API = 'https://v7086lxsji.execute-api.us-east-1.amazonaws.com';

const COMPLIANCE_STYLES = `
<style>
.compliance-filter-section {
    background: var(--white, #fff);
    border: 1px solid var(--gray-200, #e5e7eb);
    border-radius: 12px;
    margin-bottom: 24px;
    overflow: hidden;
}

.compliance-filter-header {
    padding: 20px 24px;
    background: linear-gradient(135deg, #0f2744 0%, #1e3a5f 100%);
    color: white;
    cursor: pointer;
    display: flex;
    justify-content: space-between;
    align-items: center;
}
.compliance-filter-header h3 {
    font-size: 1.1rem;
    font-weight: 600;
    margin: 0;
}
.compliance-filter-header .toggle-icon {
    font-size: 1.2rem;
    transition: transform 0.2s;
}
.compliance-filter-header.collapsed .toggle-icon {
    transform: rotate(-90deg);
}
.compliance-filter-subtitle {
    font-size: 0.85rem;
    opacity: 0.9;
    margin-top: 4px;
    font-weight: 400;
}

.compliance-filter-body {
    padding: 24px;
}
.compliance-filter-body.collapsed {
    display: none;
}

/* Industry Preset */
.preset-dropdown-container {
    margin-bottom: 20px;
}
.preset-dropdown-container label {
    display: block;
    font-size: 0.9rem;
    font-weight: 600;
    color: #0f2744;
    margin-bottom: 8px;
}
.preset-dropdown {
    width: 100%;
    max-width: 400px;
    padding: 12px 16px;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    font-size: 0.95rem;
    background: white;
    cursor: pointer;
}
.preset-description {
    font-size: 0.85rem;
    color: #6b7280;
    margin-top: 8px;
    padding: 12px;
    background: #f9fafb;
    border-radius: 6px;
    display: none;
}
.preset-description.visible {
    display: block;
}

/* Filter Groups */
.filter-groups {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 24px;
    margin-bottom: 24px;
}
.filter-group {
    background: #f9fafb;
    border-radius: 8px;
    padding: 16px;
}
.filter-group h4 {
    font-family: 'Inter', sans-serif;
    font-size: 0.9rem;
    font-weight: 600;
    color: #0f2744;
    margin-bottom: 12px;
    display: flex;
    align-items: center;
    gap: 8px;
}

/* Checkbox Items */
.compliance-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 0;
    border-bottom: 1px solid #e5e7eb;
}
.compliance-item:last-child {
    border-bottom: none;
}
.compliance-item input[type="checkbox"] {
    width: 18px;
    height: 18px;
    cursor: pointer;
    flex-shrink: 0;
}
.compliance-item label {
    flex: 1;
    cursor: pointer;
    font-size: 0.9rem;
    color: #374151;
}
.compliance-item .count {
    font-size: 0.75rem;
    color: #9ca3af;
    background: #e5e7eb;
    padding: 2px 8px;
    border-radius: 10px;
}

/* Confidence Indicator */
.confidence-indicator {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    font-size: 0.7rem;
    cursor: help;
    flex-shrink: 0;
}
.confidence-indicator.verified {
    background: #d1fae5;
    color: #065f46;
}
.confidence-indicator.vendor {
    background: #fef3c7;
    color: #92400e;
}
.confidence-indicator.expired {
    background: #fee2e2;
    color: #991b1b;
}
.confidence-indicator .tooltip {
    display: none;
    position: absolute;
    background: #0f2744;
    color: white;
    padding: 8px 12px;
    border-radius: 6px;
    font-size: 0.75rem;
    width: 200px;
    z-index: 100;
    margin-top: 8px;
    left: 50%;
    transform: translateX(-50%);
}
.confidence-indicator:hover .tooltip {
    display: block;
}

/* Filter Actions */
.filter-actions {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
    align-items: center;
    padding-top: 16px;
    border-top: 1px solid #e5e7eb;
}
.filter-btn {
    padding: 10px 20px;
    border-radius: 8px;
    font-size: 0.9rem;
    font-weight: 500;
    cursor: pointer;
    border: none;
}
.filter-btn.primary {
    background: #0f2744;
    color: white;
}
.filter-btn.primary:hover {
    background: #1e3a5f;
}
.filter-btn.secondary {
    background: #f3f4f6;
    color: #6b7280;
    border: 1px solid #e5e7eb;
}
.filter-btn.secondary:hover {
    background: #e5e7eb;
}
.filter-count {
    font-size: 0.85rem;
    color: #6b7280;
}

/* Results Section */
.filter-results {
    margin-top: 24px;
}
.results-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 16px;
}
.results-header h4 {
    font-size: 1rem;
    color: #0f2744;
}
.gap-report-btn {
    padding: 8px 16px;
    background: #eff6ff;
    border: 1px solid #bfdbfe;
    border-radius: 6px;
    font-size: 0.85rem;
    color: #1e40af;
    cursor: pointer;
}
.gap-report-btn:hover {
    background: #dbeafe;
}

/* Tool Cards with Badges */
.filtered-tools {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    gap: 16px;
}
.filtered-tool-card {
    background: white;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    padding: 16px;
    position: relative;
}
.filtered-tool-card .tool-name {
    font-weight: 600;
    color: #0f2744;
    margin-bottom: 8px;
}
.filtered-tool-card .tool-name a {
    color: inherit;
    text-decoration: none;
}
.filtered-tool-card .tool-name a:hover {
    text-decoration: underline;
}
.match-badge {
    position: absolute;
    top: 12px;
    right: 12px;
    padding: 4px 10px;
    border-radius: 4px;
    font-size: 0.75rem;
    font-weight: 600;
}
.match-badge.full {
    background: #d1fae5;
    color: #065f46;
}
.match-badge.partial {
    background: #fef3c7;
    color: #92400e;
    cursor: help;
}
.compliance-badges {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 8px;
}
.compliance-badge {
    font-size: 0.7rem;
    padding: 3px 8px;
    border-radius: 4px;
    background: #d1fae5;
    color: #065f46;
}
.compliance-badge.missing {
    background: #fee2e2;
    color: #991b1b;
    text-decoration: line-through;
}

/* Gap Report Modal */
.gap-report-modal {
    display: none;
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0,0,0,0.5);
    z-index: 1000;
    justify-content: center;
    align-items: flex-start;
    padding: 40px 20px;
    overflow-y: auto;
}
.gap-report-modal.active {
    display: flex;
}
.gap-report-content {
    background: white;
    border-radius: 12px;
    max-width: 900px;
    width: 100%;
    max-height: 90vh;
    overflow: auto;
}
.gap-report-header {
    padding: 20px 24px;
    border-bottom: 1px solid #e5e7eb;
    display: flex;
    justify-content: space-between;
    align-items: center;
    position: sticky;
    top: 0;
    background: white;
    z-index: 10;
}
.gap-report-header h3 {
    font-size: 1.1rem;
    font-weight: 600;
    color: #0f2744;
}
.gap-report-close {
    background: none;
    border: none;
    font-size: 1.5rem;
    cursor: pointer;
    color: #9ca3af;
}
.gap-report-body {
    padding: 24px;
}
.gap-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.85rem;
}
.gap-table th,
.gap-table td {
    padding: 10px 12px;
    border: 1px solid #e5e7eb;
    text-align: center;
}
.gap-table th {
    background: #f9fafb;
    font-weight: 600;
    color: #0f2744;
}
.gap-table th.req-name {
    text-align: left;
}
.gap-table .check {
    color: #10b981;
    font-size: 1.1rem;
}
.gap-table .x {
    color: #ef4444;
    font-size: 1.1rem;
}
.gap-report-actions {
    margin-top: 16px;
    display: flex;
    gap: 12px;
}
.gap-report-actions button {
    padding: 10px 20px;
    border-radius: 6px;
    font-weight: 500;
    cursor: pointer;
    border: none;
}

/* No Results */
.no-results {
    text-align: center;
    padding: 40px;
    background: #fef3c7;
    border: 1px solid #fde68a;
    border-radius: 8px;
}
.no-results h4 {
    color: #92400e;
    margin-bottom: 8px;
}
.no-results p {
    color: #78350f;
    font-size: 0.9rem;
    margin-bottom: 16px;
}
.no-results a {
    color: #b45309;
    font-weight: 500;
}

/* Save Profile */
.save-profile-section {
    margin-top: 16px;
    padding: 16px;
    background: #eff6ff;
    border: 1px solid #bfdbfe;
    border-radius: 8px;
}
.save-profile-section h4 {
    font-size: 0.9rem;
    color: #1e40af;
    margin-bottom: 8px;
}
.save-profile-row {
    display: flex;
    gap: 8px;
}
.save-profile-row input {
    flex: 1;
    padding: 8px 12px;
    border: 1px solid #bfdbfe;
    border-radius: 6px;
    font-size: 0.9rem;
}
.save-profile-row button {
    padding: 8px 16px;
    background: #1e40af;
    color: white;
    border: none;
    border-radius: 6px;
    font-weight: 500;
    cursor: pointer;
}

@media (max-width: 768px) {
    .filter-groups {
        grid-template-columns: 1fr;
    }
    .gap-table {
        font-size: 0.75rem;
    }
}
</style>
`;

// Compliance items organized by category
const COMPLIANCE_CATEGORIES = {
    privacy: {
        name: 'Data Privacy',
        icon: '🔒',
        items: [
            { id: 'gdpr', name: 'GDPR Compliant' },
            { id: 'ccpa', name: 'CCPA Compliant' },
            { id: 'pipeda', name: 'PIPEDA Compliant (Canada)' },
            { id: 'pdpa', name: 'PDPA Compliant (Singapore)' },
            { id: 'lgpd', name: 'LGPD Compliant (Brazil)' }
        ]
    },
    healthcare: {
        name: 'Healthcare',
        icon: '🏥',
        items: [
            { id: 'hipaa', name: 'HIPAA BAA Available' },
            { id: 'hitrust', name: 'HITRUST Certified' },
            { id: 'fda21', name: 'FDA 21 CFR Part 11' }
        ]
    },
    security: {
        name: 'Security',
        icon: '🛡️',
        items: [
            { id: 'soc2', name: 'SOC 2 Type II Certified' },
            { id: 'iso27001', name: 'ISO 27001 Certified' },
            { id: 'fedramp', name: 'FedRAMP Authorized' },
            { id: 'stateramp', name: 'StateRAMP Authorized' },
            { id: 'pcidss', name: 'PCI DSS Compliant' }
        ]
    },
    ai: {
        name: 'AI Specific',
        icon: '🤖',
        items: [
            { id: 'euaiact', name: 'EU AI Act Conformity' },
            { id: 'nistai', name: 'NIST AI RMF Aligned' },
            { id: 'ieeeai', name: 'IEEE AI Ethics Certified' }
        ]
    },
    education: {
        name: 'Education',
        icon: '🎓',
        items: [
            { id: 'ferpa', name: 'FERPA Compliant' },
            { id: 'coppa', name: 'COPPA Compliant' }
        ]
    }
};

const INDUSTRY_PRESETS = {
    healthcare: {
        name: 'Healthcare',
        items: ['hipaa', 'soc2', 'hitrust'],
        description: 'Recommended minimum compliance requirements for healthcare organizations handling protected health information.'
    },
    financial: {
        name: 'Financial Services',
        items: ['soc2', 'pcidss', 'gdpr', 'ccpa'],
        description: 'Recommended compliance requirements for financial institutions handling sensitive financial data.'
    },
    legal: {
        name: 'Legal',
        items: ['soc2', 'gdpr', 'ccpa', 'iso27001'],
        description: 'Recommended compliance for law firms and legal departments handling privileged information.'
    },
    government: {
        name: 'Government',
        items: ['fedramp', 'stateramp', 'soc2'],
        description: 'Required compliance for US federal and state government agencies.'
    },
    education: {
        name: 'Education',
        items: ['ferpa', 'coppa', 'soc2'],
        description: 'Required compliance for educational institutions handling student data.'
    },
    enterprise: {
        name: 'General Enterprise',
        items: ['soc2', 'gdpr', 'iso27001'],
        description: 'Standard enterprise compliance baseline for most business applications.'
    }
};

let complianceData = { tools: [], counts: {} };
let selectedRequirements = [];
let filterResults = { fullMatch: [], partialMatch: [] };

function getVisitorId() {
    let id = localStorage.getItem('toolintel_visitor_id');
    if (!id) {
        id = 'v_' + Math.random().toString(36).substr(2, 16);
        localStorage.setItem('toolintel_visitor_id', id);
    }
    return id;
}

async function initComplianceFilter(containerId) {
    // Inject styles
    if (!document.getElementById('complianceFilterStyles')) {
        const styleEl = document.createElement('div');
        styleEl.id = 'complianceFilterStyles';
        styleEl.innerHTML = COMPLIANCE_STYLES;
        document.head.appendChild(styleEl);
    }
    
    const container = document.getElementById(containerId);
    if (!container) return;
    
    // Load compliance data
    try {
        const res = await fetch(`${COMPLIANCE_API}/compliance/all`);
        complianceData = await res.json();
    } catch (e) {
        console.error('Failed to load compliance data:', e);
    }
    
    // Build filter UI
    container.innerHTML = buildFilterHTML();
    
    // Check for shared profile in URL
    const params = new URLSearchParams(window.location.search);
    const profileId = params.get('profile');
    if (profileId) {
        loadSharedProfile(profileId);
    }
}

function buildFilterHTML() {
    let html = `
        <div class="compliance-filter-section">
            <div class="compliance-filter-header" onclick="toggleFilterPanel()">
                <div>
                    <h3>🔍 Find Tools That Meet Your Compliance Requirements</h3>
                    <div class="compliance-filter-subtitle">Select your regulatory requirements and we'll show only tools with verified compliance for each. All compliance statuses are independently verified — not self-reported by vendors.</div>
                </div>
                <span class="toggle-icon">▼</span>
            </div>
            
            <div class="compliance-filter-body" id="filterBody">
                <!-- Industry Preset -->
                <div class="preset-dropdown-container">
                    <label>Industry Preset</label>
                    <select class="preset-dropdown" id="industryPreset" onchange="applyIndustryPreset(this.value)">
                        <option value="">-- Select your industry --</option>
                        ${Object.entries(INDUSTRY_PRESETS).map(([id, preset]) => 
                            `<option value="${id}">${preset.name}</option>`
                        ).join('')}
                    </select>
                    <div class="preset-description" id="presetDescription"></div>
                </div>
                
                <!-- Filter Groups -->
                <div class="filter-groups">
    `;
    
    // Build category groups
    for (const [catId, category] of Object.entries(COMPLIANCE_CATEGORIES)) {
        html += `
            <div class="filter-group">
                <h4>${category.icon} ${category.name}</h4>
        `;
        
        for (const item of category.items) {
            const count = complianceData.counts[item.id] || 0;
            html += `
                <div class="compliance-item">
                    <input type="checkbox" id="comp_${item.id}" value="${item.id}" onchange="updateSelectedRequirements()">
                    <label for="comp_${item.id}">${item.name}</label>
                    <span class="count">${count} tools</span>
                </div>
            `;
        }
        
        html += `</div>`;
    }
    
    html += `
                </div>
                
                <!-- Filter Actions -->
                <div class="filter-actions">
                    <button class="filter-btn primary" onclick="applyFilters()">Apply Filters</button>
                    <button class="filter-btn secondary" onclick="clearFilters()">Clear All</button>
                    <span class="filter-count" id="filterCount">0 requirements selected</span>
                </div>
                
                <!-- Save Profile -->
                <div class="save-profile-section" id="saveProfileSection" style="display:none;">
                    <h4>💾 Save Compliance Profile</h4>
                    <div class="save-profile-row">
                        <input type="text" id="profileNameInput" placeholder="Our Healthcare Vendor Requirements">
                        <button onclick="saveComplianceProfile()">Save & Share</button>
                    </div>
                </div>
            </div>
            
            <!-- Results Section -->
            <div class="filter-results" id="filterResults" style="display:none;"></div>
        </div>
        
        <!-- Gap Report Modal -->
        <div class="gap-report-modal" id="gapReportModal">
            <div class="gap-report-content">
                <div class="gap-report-header">
                    <h3>📊 Compliance Gap Report</h3>
                    <button class="gap-report-close" onclick="closeGapReport()">×</button>
                </div>
                <div class="gap-report-body" id="gapReportBody"></div>
            </div>
        </div>
    `;
    
    return html;
}

function toggleFilterPanel() {
    const header = document.querySelector('.compliance-filter-header');
    const body = document.getElementById('filterBody');
    header.classList.toggle('collapsed');
    body.classList.toggle('collapsed');
}

function applyIndustryPreset(presetId) {
    // Clear existing
    document.querySelectorAll('.compliance-item input[type="checkbox"]').forEach(cb => cb.checked = false);
    
    if (!presetId || !INDUSTRY_PRESETS[presetId]) {
        document.getElementById('presetDescription').classList.remove('visible');
        updateSelectedRequirements();
        return;
    }
    
    const preset = INDUSTRY_PRESETS[presetId];
    
    // Select preset items
    for (const itemId of preset.items) {
        const cb = document.getElementById(`comp_${itemId}`);
        if (cb) cb.checked = true;
    }
    
    // Show description
    const descEl = document.getElementById('presetDescription');
    descEl.textContent = preset.description;
    descEl.classList.add('visible');
    
    updateSelectedRequirements();
}

function updateSelectedRequirements() {
    selectedRequirements = [];
    document.querySelectorAll('.compliance-item input[type="checkbox"]:checked').forEach(cb => {
        selectedRequirements.push(cb.value);
    });
    
    document.getElementById('filterCount').textContent = `${selectedRequirements.length} requirement${selectedRequirements.length !== 1 ? 's' : ''} selected`;
    
    // Show save section if requirements selected
    document.getElementById('saveProfileSection').style.display = selectedRequirements.length > 0 ? 'block' : 'none';
    
    // Update counts in real-time based on remaining tools
    updateCounts();
}

function updateCounts() {
    // For now, just show total counts
    // In production, this would filter progressively
}

async function applyFilters() {
    if (selectedRequirements.length === 0) {
        alert('Please select at least one compliance requirement');
        return;
    }
    
    try {
        const res = await fetch(`${COMPLIANCE_API}/compliance/filter`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ requirements: selectedRequirements })
        });
        
        filterResults = await res.json();
        renderResults();
        
    } catch (e) {
        console.error('Filter failed:', e);
        alert('Failed to apply filters. Please try again.');
    }
}

function renderResults() {
    const container = document.getElementById('filterResults');
    container.style.display = 'block';
    
    const total = filterResults.fullMatch.length + filterResults.partialMatch.length;
    
    if (total === 0) {
        container.innerHTML = `
            <div class="no-results">
                <h4>⚠️ No Compliant Tools Found</h4>
                <p>No reviewed tools currently meet all selected requirements. This may mean compliant tools exist but have not yet been reviewed, or that this combination of requirements is rare in the current market.</p>
                <a href="/submit.html">Submit a tool for review →</a>
            </div>
        `;
        return;
    }
    
    let html = `
        <div class="results-header">
            <h4>Found ${total} tool${total !== 1 ? 's' : ''} (${filterResults.fullMatch.length} full match, ${filterResults.partialMatch.length} partial)</h4>
            ${filterResults.partialMatch.length > 0 ? `<button class="gap-report-btn" onclick="showGapReport()">📊 Show Compliance Gaps</button>` : ''}
        </div>
        <div class="filtered-tools">
    `;
    
    // Full matches first
    for (const tool of filterResults.fullMatch) {
        html += renderToolCard(tool, true);
    }
    
    // Then partial matches
    for (const tool of filterResults.partialMatch) {
        html += renderToolCard(tool, false);
    }
    
    html += `</div>`;
    container.innerHTML = html;
}

function renderToolCard(tool, isFullMatch) {
    const missingText = tool.missing.map(id => getComplianceName(id)).join(', ');
    
    return `
        <div class="filtered-tool-card">
            <div class="match-badge ${isFullMatch ? 'full' : 'partial'}" ${!isFullMatch ? `title="Missing: ${missingText}"` : ''}>
                ${isFullMatch ? '✓ Full Match' : '◐ Partial Match'}
            </div>
            <div class="tool-name"><a href="/reviews/${tool.toolSlug}.html">${tool.toolName}</a></div>
            <div class="compliance-badges">
                ${tool.met.map(id => `<span class="compliance-badge">${getComplianceName(id)}</span>`).join('')}
                ${tool.missing.map(id => `<span class="compliance-badge missing">${getComplianceName(id)}</span>`).join('')}
            </div>
        </div>
    `;
}

function getComplianceName(id) {
    for (const category of Object.values(COMPLIANCE_CATEGORIES)) {
        const item = category.items.find(i => i.id === id);
        if (item) return item.name.split(' ')[0]; // Short name
    }
    return id;
}

function showGapReport() {
    const allTools = [...filterResults.fullMatch, ...filterResults.partialMatch];
    
    let html = `
        <p style="color:#6b7280;margin-bottom:16px;">Copy this table to your vendor evaluation document.</p>
        <table class="gap-table">
            <thead>
                <tr>
                    <th class="req-name">Requirement</th>
                    ${allTools.map(t => `<th>${t.toolName}</th>`).join('')}
                </tr>
            </thead>
            <tbody>
    `;
    
    for (const reqId of selectedRequirements) {
        html += `
            <tr>
                <td class="req-name">${getComplianceName(reqId)}</td>
                ${allTools.map(t => {
                    const met = t.met.includes(reqId);
                    return `<td class="${met ? 'check' : 'x'}">${met ? '✓' : '✗'}</td>`;
                }).join('')}
            </tr>
        `;
    }
    
    html += `
            </tbody>
        </table>
        <div class="gap-report-actions">
            <button onclick="copyGapTable()" style="background:#0f2744;color:white;">📋 Copy Table</button>
            <button onclick="closeGapReport()" style="background:#f3f4f6;color:#6b7280;">Close</button>
        </div>
    `;
    
    document.getElementById('gapReportBody').innerHTML = html;
    document.getElementById('gapReportModal').classList.add('active');
}

function closeGapReport() {
    document.getElementById('gapReportModal').classList.remove('active');
}

function copyGapTable() {
    const table = document.querySelector('.gap-table');
    const range = document.createRange();
    range.selectNode(table);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
    document.execCommand('copy');
    window.getSelection().removeAllRanges();
    alert('Table copied to clipboard!');
}

function clearFilters() {
    document.querySelectorAll('.compliance-item input[type="checkbox"]').forEach(cb => cb.checked = false);
    document.getElementById('industryPreset').value = '';
    document.getElementById('presetDescription').classList.remove('visible');
    document.getElementById('filterResults').style.display = 'none';
    selectedRequirements = [];
    updateSelectedRequirements();
}

async function saveComplianceProfile() {
    const name = document.getElementById('profileNameInput').value.trim();
    if (!name) {
        alert('Please enter a profile name');
        return;
    }
    
    if (selectedRequirements.length === 0) {
        alert('Please select at least one requirement');
        return;
    }
    
    try {
        const res = await fetch(`${COMPLIANCE_API}/compliance/profile`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                visitorId: getVisitorId(),
                profileName: name,
                requirements: selectedRequirements
            })
        });
        
        const data = await res.json();
        
        await navigator.clipboard.writeText(data.shareUrl);
        alert(`Profile saved! Share link copied to clipboard:\n\n${data.shareUrl}`);
        document.getElementById('profileNameInput').value = '';
        
    } catch (e) {
        alert('Failed to save profile');
    }
}

async function loadSharedProfile(profileId) {
    try {
        const res = await fetch(`${COMPLIANCE_API}/compliance/profile/${profileId}`);
        if (!res.ok) return;
        
        const profile = await res.json();
        
        // Apply the requirements
        for (const reqId of profile.requirements) {
            const cb = document.getElementById(`comp_${reqId}`);
            if (cb) cb.checked = true;
        }
        
        updateSelectedRequirements();
        applyFilters();
        
    } catch (e) {
        console.error('Failed to load profile:', e);
    }
}

// Close modal handlers
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeGapReport();
});
document.addEventListener('click', (e) => {
    if (e.target.id === 'gapReportModal') closeGapReport();
});
