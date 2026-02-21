/**
 * ToolIntel Trust Score Component
 * Displays dual score rings (Product + Trust) on review pages
 */

const TrustScoreComponent = {
    
    // Component definitions for breakdown
    components: [
        { id: 'reviewParticipation', name: 'Review Process Participation', maxScore: 12.5 },
        { id: 'certificationTransparency', name: 'Certification Transparency', maxScore: 12.5 },
        { id: 'pricingTransparency', name: 'Pricing Transparency', maxScore: 12.5 },
        { id: 'tosStability', name: 'Terms of Service Stability', maxScore: 12.5 },
        { id: 'incidentResponse', name: 'Incident Response Quality', maxScore: 12.5 },
        { id: 'claimAccuracy', name: 'Marketing Claim Accuracy', maxScore: 12.5 },
        { id: 'communityEngagement', name: 'Community Review Engagement', maxScore: 12.5 },
        { id: 'dataRightsClarity', name: 'Data Rights Clarity', maxScore: 12.5 }
    ],
    
    // Get color based on score
    getScoreColor(score, type = 'product') {
        if (type === 'trust') {
            if (score >= 80) return '#8b5cf6'; // Purple
            if (score >= 60) return '#a78bfa';
            return '#c4b5fd';
        }
        if (score >= 80) return '#10b981'; // Green
        if (score >= 60) return '#f59e0b'; // Yellow
        return '#ef4444'; // Red
    },
    
    // Render dual score rings
    renderDualScores(containerId, productScore, trustScore, trustComponents = {}) {
        const container = document.getElementById(containerId);
        if (!container) return;
        
        const gap = trustScore - productScore;
        let callout = '';
        
        if (gap <= -15) {
            callout = `
                <div class="score-callout yellow">
                    <strong>⚠️ High performer, low transparency</strong> — this tool scores well on capability but the vendor has limited verifiable transparency. Enterprise buyers in regulated industries should review the Trust Score breakdown before procurement.
                </div>
            `;
        } else if (gap >= 15) {
            callout = `
                <div class="score-callout green">
                    <strong>✓ High transparency, moderate performance</strong> — this vendor demonstrates strong transparency practices. The product may have limitations but the vendor's integrity signals are positive.
                </div>
            `;
        }
        
        container.innerHTML = `
            <style>
                .dual-score-container {
                    display: flex;
                    justify-content: center;
                    gap: 40px;
                    margin: 24px 0;
                }
                .score-ring-wrapper {
                    text-align: center;
                }
                .score-ring {
                    width: 140px;
                    height: 140px;
                    border-radius: 50%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    flex-direction: column;
                    margin: 0 auto 12px;
                    position: relative;
                }
                .score-ring.product {
                    background: linear-gradient(135deg, #d1fae5 0%, #a7f3d0 100%);
                    border: 4px solid #10b981;
                }
                .score-ring.trust {
                    background: linear-gradient(135deg, #f5f3ff 0%, #ede9fe 100%);
                    border: 4px solid #8b5cf6;
                    cursor: help;
                }
                .score-number {
                    font-size: 2.5rem;
                    font-weight: 700;
                    line-height: 1;
                }
                .score-ring.product .score-number { color: #065f46; }
                .score-ring.trust .score-number { color: #5b21b6; }
                .score-label {
                    font-size: 0.8rem;
                    margin-top: 4px;
                }
                .score-ring.product .score-label { color: #047857; }
                .score-ring.trust .score-label { color: #6d28d9; }
                .score-title {
                    font-weight: 600;
                    color: #1f2937;
                    font-size: 0.95rem;
                }
                .score-subtitle {
                    font-size: 0.8rem;
                    color: #9ca3af;
                    max-width: 160px;
                    margin-top: 4px;
                }
                .score-callout {
                    max-width: 600px;
                    margin: 20px auto;
                    padding: 16px 20px;
                    border-radius: 8px;
                    font-size: 0.9rem;
                }
                .score-callout.yellow {
                    background: #fffbeb;
                    border: 1px solid #f59e0b;
                    color: #92400e;
                }
                .score-callout.green {
                    background: #ecfdf5;
                    border: 1px solid #10b981;
                    color: #065f46;
                }
                .trust-tooltip {
                    display: none;
                    position: absolute;
                    bottom: 100%;
                    left: 50%;
                    transform: translateX(-50%);
                    background: #0f2744;
                    color: white;
                    padding: 12px 16px;
                    border-radius: 8px;
                    font-size: 0.8rem;
                    width: 280px;
                    text-align: left;
                    z-index: 100;
                    margin-bottom: 8px;
                }
                .trust-tooltip::after {
                    content: '';
                    position: absolute;
                    top: 100%;
                    left: 50%;
                    transform: translateX(-50%);
                    border: 8px solid transparent;
                    border-top-color: #0f2744;
                }
                .score-ring.trust:hover .trust-tooltip {
                    display: block;
                }
                .breakdown-toggle {
                    text-align: center;
                    margin-top: 16px;
                }
                .breakdown-toggle button {
                    background: none;
                    border: none;
                    color: #8b5cf6;
                    cursor: pointer;
                    font-size: 0.9rem;
                    font-weight: 500;
                }
                .breakdown-toggle button:hover {
                    text-decoration: underline;
                }
                .trust-breakdown {
                    display: none;
                    max-width: 700px;
                    margin: 24px auto;
                    background: #f9fafb;
                    border: 1px solid #e5e7eb;
                    border-radius: 12px;
                    overflow: hidden;
                }
                .trust-breakdown.visible {
                    display: block;
                }
                .breakdown-header {
                    padding: 16px 20px;
                    background: #f3f4f6;
                    border-bottom: 1px solid #e5e7eb;
                    font-weight: 600;
                    color: #0f2744;
                }
                .breakdown-table {
                    width: 100%;
                    border-collapse: collapse;
                }
                .breakdown-table th, .breakdown-table td {
                    padding: 12px 16px;
                    text-align: left;
                    border-bottom: 1px solid #e5e7eb;
                }
                .breakdown-table th {
                    background: #f9fafb;
                    font-size: 0.75rem;
                    text-transform: uppercase;
                    color: #6b7280;
                }
                .breakdown-table td {
                    font-size: 0.9rem;
                }
                .breakdown-table tr:last-child td {
                    border-bottom: none;
                }
                .component-score {
                    font-weight: 600;
                }
                .component-score.full { color: #10b981; }
                .component-score.partial { color: #f59e0b; }
                .component-score.none { color: #9ca3af; }
                .history-section {
                    padding: 16px 20px;
                    border-top: 1px solid #e5e7eb;
                    background: white;
                }
                .history-section h4 {
                    font-size: 0.9rem;
                    color: #0f2744;
                    margin-bottom: 12px;
                }
                .history-item {
                    display: flex;
                    justify-content: space-between;
                    padding: 8px 0;
                    font-size: 0.85rem;
                    border-bottom: 1px solid #f3f4f6;
                }
                .history-item:last-child { border-bottom: none; }
                .history-date { color: #9ca3af; }
                .history-change { font-weight: 600; color: #10b981; }
                .history-reason { color: #6b7280; }
            </style>
            
            <div class="dual-score-container">
                <div class="score-ring-wrapper">
                    <div class="score-ring product">
                        <span class="score-number">${productScore}</span>
                        <span class="score-label">/ 100</span>
                    </div>
                    <div class="score-title">Product Score</div>
                    <div class="score-subtitle">How well does this tool perform?</div>
                </div>
                
                <div class="score-ring-wrapper">
                    <div class="score-ring trust">
                        <div class="trust-tooltip">
                            The Trust Score measures vendor transparency and integrity — not product quality. A tool can be excellent and score low on Trust. A tool can be average and score high on Trust. They measure different things.
                        </div>
                        <span class="score-number">${trustScore}</span>
                        <span class="score-label">/ 100</span>
                    </div>
                    <div class="score-title">Trust Score</div>
                    <div class="score-subtitle">How transparent and verifiable is this vendor?</div>
                </div>
            </div>
            
            ${callout}
            
            <div class="breakdown-toggle">
                <button onclick="TrustScoreComponent.toggleBreakdown()">▼ View Trust Score Breakdown</button>
            </div>
            
            <div class="trust-breakdown" id="trustBreakdown">
                <div class="breakdown-header">Trust Score Breakdown</div>
                <table class="breakdown-table">
                    <thead>
                        <tr>
                            <th>Component</th>
                            <th>Score</th>
                            <th>Reason</th>
                        </tr>
                    </thead>
                    <tbody id="breakdownBody">
                        ${this.renderBreakdownRows(trustComponents)}
                    </tbody>
                </table>
                <div class="history-section">
                    <h4>Trust Score History</h4>
                    <div id="historyContainer">
                        <div class="history-item">
                            <span class="history-date">Feb 15, 2026</span>
                            <span class="history-change">+6.5 pts</span>
                            <span class="history-reason">Completed developer interview</span>
                        </div>
                        <div class="history-item">
                            <span class="history-date">Jan 20, 2026</span>
                            <span class="history-change">+6.5 pts</span>
                            <span class="history-reason">SOC 2 Type II verified</span>
                        </div>
                    </div>
                </div>
            </div>
        `;
    },
    
    renderBreakdownRows(components) {
        return this.components.map(comp => {
            const data = components[comp.id] || { score: 0, reason: 'Not evaluated' };
            const scoreClass = data.score >= comp.maxScore ? 'full' : data.score > 0 ? 'partial' : 'none';
            return `
                <tr>
                    <td>${comp.name}</td>
                    <td><span class="component-score ${scoreClass}">${data.score} / ${comp.maxScore}</span></td>
                    <td>${data.reason}</td>
                </tr>
            `;
        }).join('');
    },
    
    toggleBreakdown() {
        const breakdown = document.getElementById('trustBreakdown');
        const btn = document.querySelector('.breakdown-toggle button');
        if (breakdown.classList.contains('visible')) {
            breakdown.classList.remove('visible');
            btn.textContent = '▼ View Trust Score Breakdown';
        } else {
            breakdown.classList.add('visible');
            btn.textContent = '▲ Hide Trust Score Breakdown';
        }
    },
    
    // Load trust score from API
    async loadTrustScore(toolSlug) {
        try {
            const res = await fetch(`https://v7086lxsji.execute-api.us-east-1.amazonaws.com/tools/${toolSlug}/trust-score`);
            if (res.ok) {
                return await res.json();
            }
        } catch (e) {
            console.error('Error loading trust score:', e);
        }
        return null;
    }
};

// Make available globally
window.TrustScoreComponent = TrustScoreComponent;
