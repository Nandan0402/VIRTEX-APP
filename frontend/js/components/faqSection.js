/**
 * faqSection.js - Interactive Touch-Friendly Multilingual FAQ Component for Kiosk
 */

import { api } from '../services/api.js';

export class FaqSectionComponent {
  constructor({ containerId, onAskQuestion, onSpeakAnswer }) {
    this.container = document.getElementById(containerId);
    this.onAskQuestion = onAskQuestion;
    this.onSpeakAnswer = onSpeakAnswer;
    this.faqs = [];
    this.currentCategory = 'all';
    this.currentLanguage = 'en-IN';
    this.searchQuery = '';
    this.expandedFaqId = null;
  }

  async init(language = 'en-IN') {
    this.currentLanguage = language;
    await this.loadFaqs();
  }

  async setLanguage(language) {
    this.currentLanguage = language;
    await this.loadFaqs();
  }

  async loadFaqs() {
    if (!this.container) return;

    try {
      // Map BCP47 code to database language code (e.g. 'en-IN', 'kn-IN', 'hi-IN')
      const res = await api.getFaqs({
        language: this.currentLanguage,
        category: this.currentCategory !== 'all' ? this.currentCategory : undefined,
        q: this.searchQuery || undefined,
      });

      this.faqs = (res.success && res.data) ? res.data : [];
      this.render();
    } catch (err) {
      console.warn('[FaqSection] Error loading FAQs:', err);
      this.faqs = [];
      this.render();
    }
  }

  setCategory(category) {
    this.currentCategory = category;
    this.loadFaqs();
  }

  setSearchQuery(q) {
    this.searchQuery = q.trim();
    this.loadFaqs();
  }

  toggleAccordion(faqId) {
    this.expandedFaqId = this.expandedFaqId === faqId ? null : faqId;
    this.render();
  }

  render() {
    if (!this.container) return;

    const categories = [
      { id: 'all', label: 'All FAQs' },
      { id: 'general', label: 'General' },
      { id: 'timings', label: 'Timings' },
      { id: 'pricing', label: 'Pricing & Plans' },
      { id: 'facilities', label: 'Facilities' },
      { id: 'trainers', label: 'Trainers' },
      { id: 'rules', label: 'Gym Rules' },
    ];

    this.container.innerHTML = `
      <div class="faq-section-wrap">
        <div class="section-title-wrap">
          <span class="section-pill text-green font-mono">KNOWLEDGE BASE</span>
          <h2 class="section-heading">Frequently Asked Questions</h2>
          <p class="section-sub">Browse answers instantly or tap any question to ask FitBot.</p>
        </div>

        <!-- Search Toolbar & Category Pills -->
        <div class="faq-toolbar">
          <div class="faq-search-wrap">
            <span class="faq-search-icon" aria-hidden="true">🔍</span>
            <input 
              type="text" 
              class="faq-search-input" 
              placeholder="Search questions (e.g. lockers, showers, timings, guest pass)..." 
              value="${this.escapeHtml(this.searchQuery)}"
              aria-label="Search FAQs"
            />
            ${this.searchQuery ? '<button class="faq-search-clear" aria-label="Clear search">✕</button>' : ''}
          </div>

          <div class="faq-categories-row" role="group" aria-label="Filter FAQ Categories">
            ${categories.map(c => `
              <button class="btn-faq-cat ${this.currentCategory === c.id ? 'active' : ''}" data-cat="${c.id}">
                ${c.label}
              </button>
            `).join('')}
          </div>
        </div>

        <!-- FAQ Accordion List -->
        <div class="faq-accordion-list" role="region" aria-label="FAQ Accordion">
          ${this.faqs.length === 0 ? `
            <div class="no-faqs-box">
              <p>No matching questions found in this category.</p>
              <button class="btn btn-green btn-ask-reception-fallback" style="margin-top: 10px;">
                Ask FitBot Directly
              </button>
            </div>
          ` : this.faqs.map((f) => {
            const isExpanded = this.expandedFaqId === f.id;
            return `
              <div class="faq-card ${isExpanded ? 'expanded' : ''}" data-id="${f.id}">
                <button class="faq-question-btn" aria-expanded="${isExpanded}">
                  <span class="faq-q-text">
                    <span class="faq-q-mark font-mono text-green">Q.</span>
                    <strong>${this.escapeHtml(f.question)}</strong>
                  </span>
                  <span class="faq-expand-icon font-mono">${isExpanded ? '−' : '+'}</span>
                </button>

                ${isExpanded ? `
                  <div class="faq-answer-pane animate-slide-up">
                    <div class="faq-answer-content">
                      <p class="faq-a-text">${this.escapeHtml(f.answer)}</p>
                    </div>

                    <div class="faq-card-footer">
                      <button class="btn btn-xs btn-speak-faq" data-text="${encodeURIComponent(f.answer)}">
                        🔊 Read Answer
                      </button>
                      <button class="btn btn-xs btn-green btn-send-to-chat" data-q="${encodeURIComponent(f.question)}">
                        🤖 Ask FitBot Live
                      </button>
                    </div>
                  </div>
                ` : ''}
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;

    // Attach search input listeners
    const searchInput = this.container.querySelector('.faq-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this.searchQuery = e.target.value;
      });
      searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          this.setSearchQuery(this.searchQuery);
        }
      });
    }

    const clearBtn = this.container.querySelector('.faq-search-clear');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        this.setSearchQuery('');
      });
    }

    // Attach category button listeners
    this.container.querySelectorAll('.btn-faq-cat').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.setCategory(btn.dataset.cat);
      });
    });

    // Attach accordion toggle listeners
    this.container.querySelectorAll('.faq-question-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const card = btn.closest('.faq-card');
        const id = parseInt(card.dataset.id, 10);
        this.toggleAccordion(id);
      });
    });

    // Attach speak answer listener
    this.container.querySelectorAll('.btn-speak-faq').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const text = decodeURIComponent(btn.dataset.text);
        if (this.onSpeakAnswer) {
          this.onSpeakAnswer(text, this.currentLanguage);
        }
      });
    });

    // Attach ask receptionist listener
    this.container.querySelectorAll('.btn-send-to-chat').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const question = decodeURIComponent(btn.dataset.q);
        if (this.onAskQuestion) {
          this.onAskQuestion(question);
        }
      });
    });

    // Attach fallback ask button
    const fallbackBtn = this.container.querySelector('.btn-ask-reception-fallback');
    if (fallbackBtn && this.onAskQuestion) {
      fallbackBtn.addEventListener('click', () => {
        this.onAskQuestion(this.searchQuery || 'Tell me about the gym');
      });
    }
  }

  escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}

