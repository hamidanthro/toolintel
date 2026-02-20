// Procurement Intelligence Pack Component
// Download button, custom pack modal, and PDF generation

const PROCUREMENT_API = 'https://v7086lxsji.execute-api.us-east-1.amazonaws.com';

const PROCUREMENT_STYLES = `
<style>
.procurement-pack-container {
    display: inline-block;
    position: relative;
}

.procurement-btn {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 12px 20px;
    background: linear-gradient(135deg, #0f2744 0%, #1e3a5f 100%);
    color: white;
    border: none;
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.2s;
    min-width: 200px;
}
.procurement-btn:hover {
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(15, 39, 68, 0.3);
}
.procurement-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
    transform: none;
}
.procurement-btn-main {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 0.95rem;
    font-weight: 600;
}
.procurement-btn-sub {
    font-size: 0.7rem;
    opacity: 0.8;
    margin-top: 4px;
}
.procurement-btn-updated {
    font-size: 0.65rem;
    opacity: 0.6;
    margin-top: 2px;
}

.procurement-custom-link {
    display: block;
    text-align: center;
    font-size: 0.8rem;
    color: #3b82f6;
    margin-top: 8px;
    cursor: pointer;
}
.procurement-custom-link:hover {
    text-decoration: underline;
}

/* Modal */
.procurement-modal {
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
.procurement-modal.active {
    display: flex;
}
.procurement-modal-content {
    background: white;
    border-radius: 12px;
    max-width: 600px;
    width: 100%;
    max-height: 90vh;
    overflow-y: auto;
}
.procurement-modal-header {
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
.procurement-modal-header h3 {
    font-family: 'Inter', sans-serif;
    font-size: 1.1rem;
    font-weight: 600;
    color: #0f2744;
}
.procurement-modal-close {
    background: none;
    border: none;
    font-size: 1.5rem;
    cursor: pointer;
    color: #9ca3af;
}
.procurement-modal-body {
    padding: 24px;
}

/* Sections Checklist */
.sections-checklist {
    margin: 16px 0;
}
.section-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 0;
    border-bottom: 1px solid #f3f4f6;
}
.section-item:last-child {
    border-bottom: none;
}
.section-item input[type="checkbox"] {
    width: 18px;
    height: 18px;
    cursor: pointer;
}
.section-item label {
    flex: 1;
    cursor: pointer;
    font-size: 0.95rem;
    color: #4b5563;
}
.section-item .section-desc {
    font-size: 0.8rem;
    color: #9ca3af;
}

/* Branding Section */
.branding-section {
    background: #f9fafb;
    padding: 16px;
    border-radius: 8px;
    margin: 20px 0;
}
.branding-section h4 {
    font-family: 'Inter', sans-serif;
    font-size: 0.95rem;
    font-weight: 600;
    color: #0f2744;
    margin-bottom: 12px;
}
.branding-field {
    margin-bottom: 12px;
}
.branding-field label {
    display: block;
    font-size: 0.85rem;
    color: #6b7280;
    margin-bottom: 4px;
}
.branding-field input,
.branding-field textarea {
    width: 100%;
    padding: 10px 12px;
    border: 1px solid #e5e7eb;
    border-radius: 6px;
    font-size: 0.9rem;
    font-family: inherit;
}
.branding-field textarea {
    min-height: 80px;
    resize: vertical;
}

/* Upsell */
.custom-upsell {
    background: #eff6ff;
    border: 1px solid #bfdbfe;
    padding: 16px;
    border-radius: 8px;
    margin: 20px 0;
}
.custom-upsell h4 {
    font-family: 'Inter', sans-serif;
    font-size: 0.95rem;
    font-weight: 600;
    color: #1e40af;
    margin-bottom: 8px;
}
.custom-upsell p {
    font-size: 0.9rem;
    color: #3b82f6;
    margin-bottom: 12px;
}
.custom-upsell ul {
    font-size: 0.85rem;
    color: #3b82f6;
    padding-left: 20px;
    margin-bottom: 12px;
}
.custom-upsell .btn {
    background: #1e40af;
    color: white;
    border: none;
    padding: 10px 20px;
    border-radius: 6px;
    font-weight: 500;
    cursor: pointer;
}

/* Account Required */
.account-required {
    background: #fef3c7;
    border: 1px solid #fde68a;
    padding: 16px;
    border-radius: 8px;
    margin: 20px 0;
    text-align: center;
}
.account-required h4 {
    color: #92400e;
    margin-bottom: 8px;
}
.account-required p {
    font-size: 0.9rem;
    color: #78350f;
    margin-bottom: 12px;
}

/* Share Modal */
.share-section {
    background: #f0fdf4;
    border: 1px solid #bbf7d0;
    padding: 16px;
    border-radius: 8px;
    margin: 20px 0;
}
.share-section h4 {
    font-family: 'Inter', sans-serif;
    font-size: 0.95rem;
    font-weight: 600;
    color: #166534;
    margin-bottom: 8px;
}
.share-url-container {
    display: flex;
    gap: 8px;
    margin-top: 12px;
}
.share-url-container input {
    flex: 1;
    padding: 10px 12px;
    border: 1px solid #bbf7d0;
    border-radius: 6px;
    font-size: 0.9rem;
    background: white;
}
.share-url-container button {
    padding: 10px 16px;
    background: #166534;
    color: white;
    border: none;
    border-radius: 6px;
    font-weight: 500;
    cursor: pointer;
}

.procurement-modal-footer {
    padding: 16px 24px;
    border-top: 1px solid #e5e7eb;
    display: flex;
    justify-content: flex-end;
    gap: 12px;
    position: sticky;
    bottom: 0;
    background: white;
}
.procurement-modal-footer .btn {
    padding: 10px 20px;
    border-radius: 6px;
    font-weight: 500;
    cursor: pointer;
    border: none;
}
.procurement-modal-footer .btn-secondary {
    background: #f3f4f6;
    color: #6b7280;
}
.procurement-modal-footer .btn-primary {
    background: #0f2744;
    color: white;
}
.procurement-modal-footer .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}

.generating-status {
    text-align: center;
    padding: 40px;
    color: #6b7280;
}
.generating-status .spinner {
    display: inline-block;
    width: 40px;
    height: 40px;
    border: 3px solid #e5e7eb;
    border-top-color: #0f2744;
    border-radius: 50%;
    animation: spin 1s linear infinite;
    margin-bottom: 16px;
}
@keyframes spin {
    to { transform: rotate(360deg); }
}
</style>
`;

const PACK_SECTIONS = [
    { id: 'executive', name: 'Executive Summary', desc: 'Score, verdict, key findings' },
    { id: 'scores', name: 'Score Breakdown', desc: 'All 10 methodology categories' },
    { id: 'compliance', name: 'Compliance & Certifications', desc: 'HIPAA, SOC 2, GDPR, FedRAMP, etc.' },
    { id: 'pricing', name: 'Verified Pricing', desc: 'Current tiers, hidden costs' },
    { id: 'security', name: 'Security & Reliability', desc: 'Incidents, uptime' },
    { id: 'policies', name: 'Policy Changes', desc: 'TOS/Privacy changes (24 mo)' },
    { id: 'claims', name: 'Marketing Claims', desc: 'Verified claims and verdicts' },
    { id: 'vendor', name: 'Vendor Response', desc: 'Unedited vendor statement' },
    { id: 'metadata', name: 'Review Metadata', desc: 'Dates, methodology version' }
];

function getVisitorId() {
    let id = localStorage.getItem('toolintel_visitor_id');
    if (!id) {
        id = 'v_' + Math.random().toString(36).substr(2, 16);
        localStorage.setItem('toolintel_visitor_id', id);
    }
    return id;
}

function formatDate(d) {
    if (!d) return 'N/A';
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

async function initProcurementPack(toolSlug, toolName, reviewData, containerId) {
    // Inject styles
    if (!document.getElementById('procurementStyles')) {
        const styleEl = document.createElement('div');
        styleEl.id = 'procurementStyles';
        styleEl.innerHTML = PROCUREMENT_STYLES;
        document.head.appendChild(styleEl);
    }
    
    window.procurementToolSlug = toolSlug;
    window.procurementToolName = toolName;
    window.procurementReviewData = reviewData;
    
    const container = document.getElementById(containerId);
    if (!container) return;
    
    // Fetch last updated
    let lastUpdated = null;
    try {
        const res = await fetch(`${PROCUREMENT_API}/procurement/last-updated?toolSlug=${toolSlug}`);
        const data = await res.json();
        lastUpdated = data.lastUpdated;
    } catch (e) {}
    
    // Check free eligibility
    let canDownloadFree = true;
    try {
        const res = await fetch(`${PROCUREMENT_API}/procurement/check?visitorId=${getVisitorId()}`);
        const data = await res.json();
        canDownloadFree = data.canDownloadFree;
    } catch (e) {}
    
    container.innerHTML = `
        <div class="procurement-pack-container">
            <button class="procurement-btn" onclick="downloadProcurementPack(false)">
                <span class="procurement-btn-main">📄 Download Procurement Pack</span>
                <span class="procurement-btn-sub">Everything your legal & procurement team needs</span>
                ${lastUpdated ? `<span class="procurement-btn-updated">Data verified: ${formatDate(lastUpdated)}</span>` : ''}
            </button>
            <a class="procurement-custom-link" onclick="openCustomPackModal()">⚙️ Custom Procurement Pack (Enterprise)</a>
        </div>
        
        <!-- Custom Pack Modal -->
        <div class="procurement-modal" id="procurementModal">
            <div class="procurement-modal-content">
                <div class="procurement-modal-header">
                    <h3>📄 Custom Procurement Pack</h3>
                    <button class="procurement-modal-close" onclick="closeProcurementModal()">×</button>
                </div>
                <div class="procurement-modal-body" id="procurementModalBody">
                    <p style="color:#6b7280;margin-bottom:20px;">Select sections to include and add your company branding.</p>
                    
                    <h4 style="font-size:0.95rem;font-weight:600;color:#0f2744;margin-bottom:12px;">Sections to Include</h4>
                    <div class="sections-checklist">
                        ${PACK_SECTIONS.map(s => `
                            <div class="section-item">
                                <input type="checkbox" id="section_${s.id}" value="${s.id}" checked>
                                <label for="section_${s.id}">
                                    <strong>${s.name}</strong>
                                    <div class="section-desc">${s.desc}</div>
                                </label>
                            </div>
                        `).join('')}
                    </div>
                    
                    <div class="branding-section">
                        <h4>🏢 Company Branding</h4>
                        <div class="branding-field">
                            <label>Company Name</label>
                            <input type="text" id="customCompany" placeholder="Your Company Name">
                        </div>
                        <div class="branding-field">
                            <label>Logo URL (optional)</label>
                            <input type="url" id="customLogo" placeholder="https://yourcompany.com/logo.png">
                        </div>
                        <div class="branding-field">
                            <label>Internal Notes (optional)</label>
                            <textarea id="customNotes" placeholder="Notes for internal use only..."></textarea>
                        </div>
                    </div>
                    
                    ${!canDownloadFree ? `
                    <div class="account-required">
                        <h4>⚠️ Account Required</h4>
                        <p>You've already downloaded a free pack. Sign up for free to continue.</p>
                        <button class="btn" onclick="alert('Account signup coming soon!')">Create Free Account</button>
                    </div>
                    ` : ''}
                </div>
                <div class="procurement-modal-footer">
                    <button class="btn btn-secondary" onclick="closeProcurementModal()">Cancel</button>
                    <button class="btn btn-primary" onclick="downloadProcurementPack(true)" ${!canDownloadFree ? 'disabled' : ''}>Generate Custom Pack</button>
                </div>
            </div>
        </div>
        
        <!-- Generating Modal -->
        <div class="procurement-modal" id="generatingModal">
            <div class="procurement-modal-content">
                <div class="procurement-modal-body">
                    <div class="generating-status">
                        <div class="spinner"></div>
                        <p id="generatingStatus">Generating your Procurement Pack...</p>
                    </div>
                </div>
            </div>
        </div>
        
        <!-- Share Modal -->
        <div class="procurement-modal" id="shareModal">
            <div class="procurement-modal-content">
                <div class="procurement-modal-header">
                    <h3>🔗 Share Procurement Pack</h3>
                    <button class="procurement-modal-close" onclick="closeShareModal()">×</button>
                </div>
                <div class="procurement-modal-body">
                    <div class="share-section">
                        <h4>Shareable Link Generated</h4>
                        <p>This link expires in 90 days. Recipients don't need an account.</p>
                        <div class="share-url-container">
                            <input type="text" id="shareUrl" readonly>
                            <button onclick="copyShareUrl()">Copy</button>
                        </div>
                        <p style="font-size:0.8rem;color:#6b7280;margin-top:12px;">The shared PDF includes a watermark showing the generation date.</p>
                    </div>
                </div>
                <div class="procurement-modal-footer">
                    <button class="btn btn-secondary" onclick="closeShareModal()">Close</button>
                </div>
            </div>
        </div>
    `;
}

function openCustomPackModal() {
    document.getElementById('procurementModal').classList.add('active');
}

function closeProcurementModal() {
    document.getElementById('procurementModal').classList.remove('active');
}

function closeShareModal() {
    document.getElementById('shareModal').classList.remove('active');
}

async function downloadProcurementPack(isCustom) {
    const toolSlug = window.procurementToolSlug;
    const toolName = window.procurementToolName;
    const reviewData = window.procurementReviewData || { toolName, score: null };
    
    // Get options for custom pack
    let options = { isCustom: false };
    
    if (isCustom) {
        closeProcurementModal();
        
        const selectedSections = [];
        PACK_SECTIONS.forEach(s => {
            if (document.getElementById(`section_${s.id}`)?.checked) {
                selectedSections.push(s.id);
            }
        });
        
        options = {
            isCustom: true,
            sections: selectedSections,
            customCompany: document.getElementById('customCompany')?.value || null,
            customLogo: document.getElementById('customLogo')?.value || null,
            customNotes: document.getElementById('customNotes')?.value || null
        };
    }
    
    // Show generating modal
    document.getElementById('generatingModal').classList.add('active');
    document.getElementById('generatingStatus').textContent = 'Generating your Procurement Pack...';
    
    try {
        const res = await fetch(`${PROCUREMENT_API}/procurement/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                toolSlug,
                visitorId: getVisitorId(),
                reviewData: {
                    ...reviewData,
                    toolName
                },
                options
            })
        });
        
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'Generation failed');
        }
        
        const data = await res.json();
        
        document.getElementById('generatingStatus').textContent = 'Opening PDF...';
        
        // Parse JSON response and open HTML in new window for PDF printing
        const packData = typeof data === 'string' ? JSON.parse(data) : data;
        
        // Open HTML in new window
        const printWindow = window.open('', '_blank');
        printWindow.document.write(packData.html);
        printWindow.document.close();
        
        // Store for sharing
        window.lastGeneratedPack = packData;
        
        // Close generating modal
        setTimeout(() => {
            document.getElementById('generatingModal').classList.remove('active');
            
            // Offer to share
            if (confirm('Pack generated! Would you like to create a shareable link?')) {
                createShareableLink(packData);
            }
        }, 500);
        
    } catch (err) {
        document.getElementById('generatingModal').classList.remove('active');
        alert('Error generating pack: ' + err.message);
    }
}

async function createShareableLink(packData) {
    document.getElementById('generatingModal').classList.add('active');
    document.getElementById('generatingStatus').textContent = 'Creating shareable link...';
    
    try {
        const res = await fetch(`${PROCUREMENT_API}/procurement/share`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                packId: packData.packId,
                html: packData.html,
                toolSlug: packData.toolSlug,
                toolName: window.procurementToolName
            })
        });
        
        if (!res.ok) throw new Error('Failed to create share link');
        
        const data = await res.json();
        
        document.getElementById('generatingModal').classList.remove('active');
        document.getElementById('shareUrl').value = data.shareUrl;
        document.getElementById('shareModal').classList.add('active');
        
    } catch (err) {
        document.getElementById('generatingModal').classList.remove('active');
        alert('Error creating share link: ' + err.message);
    }
}

function copyShareUrl() {
    const input = document.getElementById('shareUrl');
    input.select();
    document.execCommand('copy');
    alert('Link copied to clipboard!');
}

// Close modals on escape/overlay click
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        closeProcurementModal();
        closeShareModal();
    }
});
document.addEventListener('click', (e) => {
    if (e.target.id === 'procurementModal') closeProcurementModal();
    if (e.target.id === 'shareModal') closeShareModal();
});
