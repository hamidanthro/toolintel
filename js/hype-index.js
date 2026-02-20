// Hype vs Reality Index Component
// Include on tool pages to show hype analysis

const HYPE_API = 'https://v7086lxsji.execute-api.us-east-1.amazonaws.com';

const HYPE_STYLES = `
<style>
.hype-index-widget {
    margin: 24px 0;
}

.hype-badge-container {
    display: flex;
    align-items: center;
    gap: 16px;
    margin-bottom: 12px;
}

.hype-badge {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 12px 20px;
    border-radius: 8px;
    font-weight: 600;
    font-size: 1rem;
    cursor: help;
    position: relative;
}
.hype-badge.overrated {
    background: #fee2e2;
    color: #991b1b;
    border: 1px solid #fecaca;
}
.hype-badge.fairly-rated {
    background: #d1fae5;
    color: #065f46;
    border: 1px solid #a7f3d0;
}
.hype-badge.underrated {
    background: #dbeafe;
    color: #1e40af;
    border: 1px solid #bfdbfe;
}
.hype-badge.emerging {
    background: #f3f4f6;
    color: #6b7280;
    border: 1px solid #e5e7eb;
}

.hype-tooltip {
    display: none;
    position: absolute;
    bottom: 100%;
    left: 50%;
    transform: translateX(-50%);
    background: #0f2744;
    color: #fff;
    padding: 12px 16px;
    border-radius: 8px;
    font-size: 0.85rem;
    font-weight: 400;
    width: 300px;
    margin-bottom: 8px;
    line-height: 1.5;
    z-index: 100;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
}
.hype-tooltip::after {
    content: '';
    position: absolute;
    top: 100%;
    left: 50%;
    transform: translateX(-50%);
    border: 8px solid transparent;
    border-top-color: #0f2744;
}
.hype-badge:hover .hype-tooltip {
    display: block;
}

.hype-explanation {
    font-size: 0.95rem;
    color: #4b5563;
    margin-bottom: 16px;
    line-height: 1.6;
}

.hype-methodology {
    font-size: 0.8rem;
    color: #9ca3af;
    padding: 12px 16px;
    background: #f9fafb;
    border-radius: 6px;
    margin-bottom: 24px;
    line-height: 1.5;
}

.hype-scores {
    display: flex;
    gap: 24px;
    margin-bottom: 24px;
}
.hype-score-card {
    flex: 1;
    text-align: center;
    padding: 20px;
    background: #f9fafb;
    border-radius: 8px;
    border: 1px solid #e5e7eb;
}
.hype-score-value {
    font-size: 2rem;
    font-weight: 700;
    color: #0f2744;
}
.hype-score-label {
    font-size: 0.85rem;
    color: #6b7280;
    margin-top: 4px;
}
.hype-score-gap {
    background: #0f2744;
    color: #fff;
}
.hype-score-gap .hype-score-value {
    color: #fff;
}
.hype-score-gap .hype-score-label {
    color: #9ca3af;
}
.hype-score-gap.positive .hype-score-value { color: #fecaca; }
.hype-score-gap.negative .hype-score-value { color: #bfdbfe; }

/* Media Coverage Summary */
.media-coverage {
    margin: 24px 0;
}
.media-coverage h4 {
    font-family: 'Inter', sans-serif;
    font-size: 1rem;
    font-weight: 600;
    color: #0f2744;
    margin-bottom: 16px;
}
.media-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.9rem;
}
.media-table th, .media-table td {
    padding: 12px 16px;
    text-align: left;
    border-bottom: 1px solid #e5e7eb;
}
.media-table th {
    background: #f9fafb;
    font-weight: 600;
    color: #0f2744;
    font-size: 0.8rem;
    text-transform: uppercase;
}
.media-table tr:hover {
    background: #f9fafb;
}
.media-table a {
    color: #3b82f6;
    text-decoration: none;
}

.sentiment-badge {
    display: inline-block;
    padding: 3px 10px;
    border-radius: 4px;
    font-size: 0.75rem;
    font-weight: 600;
}
.sentiment-badge.positive { background: #d1fae5; color: #065f46; }
.sentiment-badge.neutral { background: #f3f4f6; color: #6b7280; }
.sentiment-badge.negative { background: #fee2e2; color: #991b1b; }
.sentiment-badge.mixed { background: #fef3c7; color: #92400e; }

/* History Section */
.hype-history {
    margin: 24px 0;
}
.hype-history-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 16px;
    background: #f9fafb;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.2s;
}
.hype-history-header:hover {
    background: #f3f4f6;
}
.hype-history-header h4 {
    font-family: 'Inter', sans-serif;
    font-size: 0.95rem;
    font-weight: 600;
    color: #0f2744;
    margin: 0;
}
.hype-history-toggle {
    font-size: 1.25rem;
    color: #9ca3af;
    transition: transform 0.2s;
}
.hype-history-toggle.open {
    transform: rotate(180deg);
}
.hype-history-content {
    display: none;
    padding: 16px;
    border: 1px solid #e5e7eb;
    border-top: none;
    border-radius: 0 0 8px 8px;
}
.hype-history-content.open {
    display: block;
}
.history-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.9rem;
}
.history-table th, .history-table td {
    padding: 10px 12px;
    text-align: center;
    border-bottom: 1px solid #e5e7eb;
}
.history-table th {
    font-weight: 600;
    color: #374151;
    font-size: 0.8rem;
}
.history-gap.positive { color: #991b1b; }
.history-gap.negative { color: #1e40af; }

.no-hype-data {
    text-align: center;
    padding: 32px;
    color: #6b7280;
}

@media (max-width: 768px) {
    .hype-scores {
        flex-direction: column;
        gap: 12px;
    }
    .hype-tooltip {
        width: 250px;
    }
}
</style>
`;

const TOOLTIP_TEXT = "A high Hype vs Reality gap is not automatically bad. It may reflect early-stage media excitement, successful marketing, or coverage that has not yet caught up with product improvements. Use it as a prompt to investigate further, not as a verdict.";

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatDate(dateStr) {
    if (!dateStr) return 'Unknown';
    return new Date(dateStr).toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'short', 
        day: 'numeric' 
    });
}

class HypeIndexWidget {
    constructor(containerId, toolSlug, toolName) {
        this.container = document.getElementById(containerId);
        this.toolSlug = toolSlug;
        this.toolName = toolName || toolSlug;
        
        if (!this.container) {
            console.error('Hype index container not found:', containerId);
            return;
        }
        
        this.init();
    }
    
    async init() {
        if (!document.getElementById('hype-index-styles')) {
            const styleEl = document.createElement('div');
            styleEl.id = 'hype-index-styles';
            styleEl.innerHTML = HYPE_STYLES;
            document.head.appendChild(styleEl.querySelector('style'));
        }
        
        await this.loadData();
    }
    
    async loadData() {
        try {
            const response = await fetch(`${HYPE_API}/hype-index?toolSlug=${this.toolSlug}`);
            const data = await response.json();
            this.render(data);
        } catch (error) {
            console.error('Failed to load hype data:', error);
            this.renderError();
        }
    }
    
    render(data) {
        const { hasData, mediaSentiment, independentScore, hypeStatus, explanation, sources, history } = data;
        
        const badgeClass = hypeStatus.status.toLowerCase().replace(' ', '-');
        const gap = mediaSentiment !== null && mediaSentiment !== undefined ? mediaSentiment - independentScore : null;
        const gapSign = gap > 0 ? '+' : '';
        const gapClass = gap > 0 ? 'positive' : gap < 0 ? 'negative' : '';
        
        let html = `
            <div class="hype-index-widget">
                <div class="hype-badge-container">
                    <span class="hype-badge ${badgeClass}">
                        ${this.getStatusIcon(hypeStatus.status)} ${hypeStatus.status}
                        <span class="hype-tooltip">${TOOLTIP_TEXT}</span>
                    </span>
                </div>
                
                <p class="hype-explanation">${escapeHtml(explanation)}</p>
                
                <p class="hype-methodology">
                    The Hype vs Reality Index compares aggregated media sentiment from major technology publications against our independent score. It is not a judgment of the tool — it is a signal about whether market perception matches verified performance.
                </p>
        `;
        
        if (hasData && mediaSentiment !== null) {
            html += `
                <div class="hype-scores">
                    <div class="hype-score-card">
                        <div class="hype-score-value">${mediaSentiment}</div>
                        <div class="hype-score-label">Media Sentiment</div>
                    </div>
                    <div class="hype-score-card">
                        <div class="hype-score-value">${independentScore}</div>
                        <div class="hype-score-label">Independent Score</div>
                    </div>
                    <div class="hype-score-card hype-score-gap ${gapClass}">
                        <div class="hype-score-value">${gapSign}${gap}</div>
                        <div class="hype-score-label">Gap</div>
                    </div>
                </div>
            `;
        }
        
        // Media Coverage Summary
        if (sources && sources.length > 0) {
            html += `
                <div class="media-coverage">
                    <h4>Media Coverage Summary</h4>
                    <table class="media-table">
                        <thead>
                            <tr>
                                <th>Publication</th>
                                <th>Sentiment</th>
                                <th>Most Recent Coverage</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${sources.slice(0, 10).map(s => `
                                <tr>
                                    <td>${s.articleUrl ? `<a href="${escapeHtml(s.articleUrl)}" target="_blank">${escapeHtml(s.publication)}</a>` : escapeHtml(s.publication)}</td>
                                    <td><span class="sentiment-badge ${(s.sentiment || '').toLowerCase()}">${escapeHtml(s.sentiment)}</span></td>
                                    <td>${formatDate(s.lastCoverageDate)}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            `;
        }
        
        // History Section
        if (history && history.length > 0) {
            html += `
                <div class="hype-history">
                    <div class="hype-history-header" onclick="toggleHypeHistory()">
                        <h4>📈 Hype Score History</h4>
                        <span class="hype-history-toggle" id="hypeHistoryToggle">▼</span>
                    </div>
                    <div class="hype-history-content" id="hypeHistoryContent">
                        <table class="history-table">
                            <thead>
                                <tr>
                                    <th>Quarter</th>
                                    <th>Media</th>
                                    <th>Independent</th>
                                    <th>Gap</th>
                                    <th>Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${history.map(h => {
                                    const hGapClass = h.gap > 0 ? 'positive' : h.gap < 0 ? 'negative' : '';
                                    const hGapSign = h.gap > 0 ? '+' : '';
                                    return `
                                        <tr>
                                            <td>${escapeHtml(h.quarter)}</td>
                                            <td>${h.mediaSentiment ?? '-'}</td>
                                            <td>${h.independentScore ?? '-'}</td>
                                            <td class="history-gap ${hGapClass}">${h.gap !== null ? `${hGapSign}${h.gap}` : '-'}</td>
                                            <td>${escapeHtml(h.status)}</td>
                                        </tr>
                                    `;
                                }).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>
            `;
        }
        
        html += `</div>`;
        
        this.container.innerHTML = html;
    }
    
    getStatusIcon(status) {
        switch(status) {
            case 'Overrated': return '📈';
            case 'Underrated': return '📉';
            case 'Fairly Rated': return '✓';
            case 'Emerging': return '🌱';
            default: return '•';
        }
    }
    
    renderError() {
        this.container.innerHTML = `
            <div class="hype-index-widget">
                <div class="no-hype-data">Unable to load hype analysis. Please try again later.</div>
            </div>
        `;
    }
}

// Global toggle function
function toggleHypeHistory() {
    const content = document.getElementById('hypeHistoryContent');
    const toggle = document.getElementById('hypeHistoryToggle');
    if (content && toggle) {
        content.classList.toggle('open');
        toggle.classList.toggle('open');
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { HypeIndexWidget };
}
